import { getAiSession, markStalled, clearStall, setPendingSequence, clearPendingSequence, setClaudeSessionId, bumpResumeCount, rotateClaudeSession } from './agent-session.js';

// Resume the same claude CLI session this many times before rotating to a
// fresh one. Resumes hit the prompt cache (huge latency win) but each one
// appends the prior turn to the conversation, so input cost grows with
// every resume. Rotating periodically caps the bloat.
const MAX_RESUMES_PER_SESSION = 10;
import { InvalidLlmResponse, InvalidLlmMove } from './errors.js';
import { TimeoutError, SubprocessFailed, ParseError, EmptyResponse } from './llm-client.js';
import { appendTurnEntry } from '../history.js';

function rngFor(gameId) {
  let s = (Date.now() ^ (gameId * 9301 + 49297)) >>> 0;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// Phases that have a single mechanical outcome — skip the LLM and apply
// the action directly. Entries are either:
//   - a (state, rng) => action factory (the action is deterministic and
//     no banter is solicited), OR
//   - an object { action, banter? } where `action` is the same factory
//     and `banter: { hint }` opts into a non-blocking banter side-call
//     fired after the action is applied.
const autoActions = {
  backgammon: {
    'initial-roll': (state, rng) => ({
      type: 'roll-initial',
      payload: { value: Math.floor(rng() * 6) + 1, throwParams: [] },
    }),
    // Auto-roll: skip the LLM "roll vs offer-double" decision. Tradeoff —
    // the bot can no longer offer the cube, but it still accepts/declines
    // doubles (awaiting-double-response is still LLM-driven). Saves one
    // LLM round-trip per turn (~20–60s with sonnet).
    'pre-roll': (state, rng) => ({
      type: 'roll',
      payload: {
        values: [Math.floor(rng() * 6) + 1, Math.floor(rng() * 6) + 1],
        throwParams: [],
      },
    }),
  },
  cribbage: {
    // 'show' is mechanical: both players acknowledge to continue. A blocking
    // LLM call here cost up to 2 round-trips per hand for no decision value.
    // The optional banter side-call lets the bot still chirp at hand-count
    // time without blocking the update broadcast.
    show: {
      action: () => ({ type: 'next' }),
      banter: { hint: 'show-ack' },
    },
  },
};

function normalizeAutoEntry(entry) {
  return typeof entry === 'function' ? { action: entry, banter: null } : entry;
}

function stallReasonFor(err) {
  if (err instanceof TimeoutError) return 'timeout';
  if (err instanceof InvalidLlmMove) return 'illegal_move';
  if (err instanceof InvalidLlmResponse || err instanceof ParseError) return 'invalid_response';
  if (err instanceof SubprocessFailed || err instanceof EmptyResponse) return 'subprocess_error';
  return 'subprocess_error';
}

function botPlayerIdxOf(state, botUserId) {
  return state.sides.a === botUserId ? 0 : 1;
}

export function createOrchestrator({ db, llm, sse, personas, adapters, logger = console }) {
  const inFlight = new Map();

  async function _runOnce(gameId, depth = 0) {
    const session = getAiSession(db, gameId);
    if (!session) {
      logger.warn?.(`[ai] runTurn: no ai_sessions row for game ${gameId}`);
      return;
    }
    const gameRow = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId);
    if (!gameRow || gameRow.status !== 'active') return;
    const state = JSON.parse(gameRow.state);
    // Allow bot to act when activeUserId is explicitly theirs, OR when
    // activeUserId is null (concurrent phases: discard, show) and the bot
    // hasn't yet submitted its half.
    const botPlayerIdx = botPlayerIdxOf(state, session.botUserId);
    const botSideKey = botPlayerIdx === 0 ? 'a' : 'b';
    const botMustActConcurrently =
      state.activeUserId == null &&
      (
        // Cribbage concurrent phases
        (state.phase === 'discard' && state.pendingDiscards?.[botPlayerIdx] == null) ||
        (state.phase === 'show' && state.acknowledged?.[botPlayerIdx] === false) ||
        // Backgammon initial-roll: both sides roll; bot acts if its side hasn't rolled yet.
        (state.turn?.phase === 'initial-roll' && state.initialRoll?.[botSideKey] == null)
      );
    if (state.activeUserId !== session.botUserId && !botMustActConcurrently) return;

    const persona = personas.get(session.personaId);
    const adapter = adapters[gameRow.game_type];
    if (!persona || !adapter) {
      const detail = !persona ? `unknown persona ${session.personaId}` : `no AI adapter for game_type ${gameRow.game_type}`;
      logger.error?.(`[ai] game ${gameId}: ${detail}`);
      markStalled(db, gameId, 'invalid_response');
      // Compute bot side from state so the client knows where to render the banner.
      const botSide = state.sides.a === session.botUserId ? 'a' : 'b';
      sse.broadcast(gameId, {
        type: 'bot_stalled',
        payload: {
          side: botSide,
          personaId: session.personaId,
          displayName: persona?.displayName ?? 'AI',
          reason: 'invalid_response',
        },
      });
      return;
    }
    const botSide = botPlayerIdx === 0 ? 'a' : 'b';

    // Mechanical phases (e.g., backgammon initial-roll) bypass the LLM.
    const phaseKey = state.turn?.phase ?? state.phase;
    const autoForGame = autoActions[gameRow.game_type];
    if (autoForGame && autoForGame[phaseKey]) {
      const autoEntry = normalizeAutoEntry(autoForGame[phaseKey]);
      const rng = rngFor(gameId);
      const action = autoEntry.action(state, rng);
      const result = adapter.plugin.applyAction({
        state, action, actorId: session.botUserId, rng,
      });
      if (result.error) {
        logger.warn?.(`[ai] game ${gameId} auto-action ${phaseKey} rejected: ${result.error}`);
        markStalled(db, gameId, 'invalid_response');
        sse.broadcast(gameId, {
          type: 'bot_stalled',
          payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, reason: 'invalid_response' },
        });
        return;
      }
      const newState = result.state;
      let turnRow = null;
      const tx = db.transaction(() => {
        db.prepare("UPDATE games SET state = ?, updated_at = ? WHERE id = ?")
          .run(JSON.stringify(newState), Date.now(), gameId);
        if (result.summary) {
          turnRow = appendTurnEntry(db, gameId, botSide, result.summary.kind, result.summary);
        }
        if (result.ended) {
          db.prepare("UPDATE games SET status='ended', ended_reason=?, winner_side=? WHERE id=?")
            .run(newState.endedReason ?? 'plugin', newState.winnerSide ?? null, gameId);
        }
      });
      tx();
      clearStall(db, gameId);
      sse.broadcast(gameId, { type: 'update', payload: {} });
      if (turnRow) {
        sse.broadcast(gameId, {
          type: 'turn',
          payload: {
            turnNumber: turnRow.turnNumber,
            side: turnRow.side,
            kind: turnRow.kind,
            summary: turnRow.summary,
            createdAt: turnRow.createdAt,
          },
        });
      }
      // Optional fire-and-forget banter side-call. The auto-action and its
      // update are already on the wire; banter floats in 1–10s later as a
      // separate SSE event. Failures are logged, never surfaced.
      if (autoEntry.banter && typeof adapter.chooseBanter === 'function') {
        Promise.resolve()
          .then(() => adapter.chooseBanter({
            llm, persona, state: newState, botPlayerIdx, hint: autoEntry.banter.hint,
          }))
          .then(({ banter }) => {
            if (banter) sse.broadcast(gameId, {
              type: 'banter',
              payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, text: banter },
            });
          })
          .catch(err => logger.warn?.(`[ai] game ${gameId} banter side-call failed: ${err.message}`));
      }
      // Recurse so the bot can act in the new phase (e.g. pre-roll) without
      // waiting on an external SSE wake-up. Depth=0 guard prevents runaway:
      // at most two consecutive auto-actions per external trigger (handles
      // back-to-back initial-roll ties).
      if (!result.ended &&
          (newState.activeUserId === session.botUserId || newState.activeUserId == null) &&
          depth === 0) {
        await _runOnce(gameId, 1);
      }
      return;
    }

    // Drain pending-sequence cache — no LLM call needed.
    if (session.pendingSequence && session.pendingSequence.length > 0) {
      const [head, ...rest] = session.pendingSequence;
      const result = adapter.plugin.applyAction({
        state, action: head, actorId: session.botUserId, rng: rngFor(gameId),
      });
      if (result.error) {
        clearPendingSequence(db, gameId);
        markStalled(db, gameId, 'illegal_move');
        sse.broadcast(gameId, {
          type: 'bot_stalled',
          payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, reason: 'illegal_move' },
        });
        return;
      }
      const newState = result.state;
      let turnRow = null;
      const tx = db.transaction(() => {
        db.prepare("UPDATE games SET state = ?, updated_at = ? WHERE id = ?")
          .run(JSON.stringify(newState), Date.now(), gameId);
        if (result.summary) {
          turnRow = appendTurnEntry(db, gameId, botSide, result.summary.kind, result.summary);
        }
        if (rest.length > 0 && newState.turn?.phase === 'moving') {
          setPendingSequence(db, gameId, rest);
        } else {
          clearPendingSequence(db, gameId);
        }
        if (result.ended) {
          db.prepare("UPDATE games SET status='ended', ended_reason=?, winner_side=? WHERE id=?")
            .run(newState.endedReason ?? 'plugin', newState.winnerSide ?? null, gameId);
        }
      });
      tx();
      sse.broadcast(gameId, { type: 'update', payload: {} });
      if (turnRow) {
        sse.broadcast(gameId, {
          type: 'turn',
          payload: {
            turnNumber: turnRow.turnNumber,
            side: turnRow.side,
            kind: turnRow.kind,
            summary: turnRow.summary,
            createdAt: turnRow.createdAt,
          },
        });
      }
      // Recurse to drain the next cached move immediately, if any. Bounded
      // by the tail length (drain shrinks the cache each call).
      if (!result.ended && rest.length > 0 && newState.activeUserId === session.botUserId) {
        await _runOnce(gameId, depth + 1);
      }
      return;
    }

    sse.broadcast(gameId, {
      type: 'bot_thinking',
      payload: { side: botSide, personaId: persona.id, displayName: persona.displayName },
    });

    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Resume the prior claude session for this game so the CLI hits
        // its prompt cache (persona system prompt + prior turns), dropping
        // per-turn latency from ~80s to a few seconds. Rotate after
        // MAX_RESUMES_PER_SESSION turns to cap conversation bloat.
        const resuming = session.claudeSessionId
          && (session.resumeCount ?? 0) < MAX_RESUMES_PER_SESSION;
        const r = await adapter.chooseAction({
          llm, persona, sessionId: resuming ? session.claudeSessionId : null,
          state, botPlayerIdx, rng: rngFor(gameId),
        });
        if (r.usedLlm === false) {
          // Adapter short-circuited (e.g., cribbage pegging with one legal
          // card) — no subprocess was launched, so don't burn a resume slot.
        } else if (resuming) {
          bumpResumeCount(db, gameId);
          session.resumeCount = (session.resumeCount ?? 0) + 1;
        } else if (r.sessionId) {
          // Fresh session — either no prior or just rotated. Reset counter.
          if (session.claudeSessionId) rotateClaudeSession(db, gameId);
          setClaudeSessionId(db, gameId, r.sessionId);
          session.claudeSessionId = r.sessionId;
          session.resumeCount = 0;
        }

        // Re-read fresh state inside the write transaction and re-apply.
        // Race-prone case: cribbage 'discard' (and other concurrent phases)
        // — the human may have submitted while the LLM was in flight, and
        // applying against the stale snapshot would clobber their entry.
        // Re-applying against the freshest state lets both writes land.
        let newState, result, freshState, turnRow = null;
        const updateGame = db.prepare("UPDATE games SET state = ?, updated_at = ? WHERE id = ?");
        const tx = db.transaction(() => {
          const freshRow = db.prepare("SELECT state, status FROM games WHERE id = ?").get(gameId);
          if (!freshRow || freshRow.status !== 'active') { result = { error: 'game no longer active' }; return; }
          freshState = JSON.parse(freshRow.state);
          result = adapter.plugin.applyAction({
            state: freshState, action: r.action, actorId: session.botUserId, rng: rngFor(gameId),
          });
          if (result.error) return;
          newState = result.state;
          updateGame.run(JSON.stringify(newState), Date.now(), gameId);
          if (result.summary) {
            turnRow = appendTurnEntry(db, gameId, botSide, result.summary.kind, result.summary);
          }
          if (result.ended) {
            db.prepare("UPDATE games SET status='ended', ended_reason=?, winner_side=? WHERE id=?")
              .run(newState.endedReason ?? 'plugin', newState.winnerSide ?? null, gameId);
          }
        });
        tx();
        if (result.error) {
          lastError = new InvalidLlmMove(`engine rejected action: ${result.error}`, []);
          logger.warn?.(`[ai] game ${gameId} attempt ${attempt + 1} engine-rejected ${JSON.stringify(r.action)}: ${result.error}`);
          continue;
        }
        clearStall(db, gameId);
        if (Array.isArray(r.sequenceTail) && r.sequenceTail.length > 0) {
          setPendingSequence(db, gameId, r.sequenceTail);
        }

        if (r.banter != null) {
          sse.broadcast(gameId, {
            type: 'banter',
            payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, text: r.banter },
          });
        }
        sse.broadcast(gameId, { type: 'update', payload: {} });
        if (turnRow) {
          sse.broadcast(gameId, {
            type: 'turn',
            payload: {
              turnNumber: turnRow.turnNumber,
              side: turnRow.side,
              kind: turnRow.kind,
              summary: turnRow.summary,
              createdAt: turnRow.createdAt,
            },
          });
        }

        // If the bot is STILL active after this action (e.g., advancing
        // through 'cut' as non-dealer, or multi-step show acks), recurse
        // once more so the bot can act immediately. Depth is capped at 1 to
        // prevent an unbounded chain (e.g., pegging → show → next-deal).
        // Guard: phase must have changed so we don't loop on a partial-
        // discard state where activeUserId is inherited unchanged.
        const prevPhase = freshState.phase ?? freshState.turn?.phase ?? null;
        const nextPhase = newState.phase ?? newState.turn?.phase ?? null;
        const phaseChanged = nextPhase !== prevPhase;
        const hasCachedTail = Array.isArray(r.sequenceTail) && r.sequenceTail.length > 0;
        // Two recurse triggers: (a) a cached sequence tail to drain — bounded
        // by tail length, no depth cap; (b) a phase change that still has the
        // bot active — depth-capped at 1 to avoid runaway chains in games
        // like cribbage (pegging → show → next-deal).
        if (!result.ended && newState.activeUserId === session.botUserId) {
          if (hasCachedTail) {
            await _runOnce(gameId, depth + 1);
          } else if (phaseChanged && depth === 0) {
            await _runOnce(gameId, 1);
          }
        }
        return;
      } catch (err) {
        lastError = err;
        logger.warn?.(`[ai] game ${gameId} attempt ${attempt + 1} failed: ${err.message}`);
      }
    }

    const reason = stallReasonFor(lastError);
    markStalled(db, gameId, reason);
    sse.broadcast(gameId, {
      type: 'bot_stalled',
      payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, reason },
    });
  }

  async function runTurn(gameId) {
    const prev = inFlight.get(gameId) ?? Promise.resolve();
    let release;
    const next = prev.then(async () => {
      try { await _runOnce(gameId); } finally { release(); }
    });
    next.catch(() => {});
    const settled = new Promise(r => { release = r; });
    inFlight.set(gameId, settled);
    settled.then(() => {
      if (inFlight.get(gameId) === settled) inFlight.delete(gameId);
    });
    return next;
  }

  function scheduleTurn(gameId) {
    runTurn(gameId).catch(err => logger.error?.(`[ai] runTurn(${gameId}) failed: ${err.stack || err}`));
  }

  function isInFlight(gameId) {
    return inFlight.has(gameId);
  }

  return { runTurn, scheduleTurn, isInFlight };
}
