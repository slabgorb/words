import { getAiSession, setClaudeSessionId, markStalled, clearStall } from './agent-session.js';
import { InvalidLlmResponse, InvalidLlmMove } from '../../../plugins/cribbage/server/ai/cribbage-player.js';
import { TimeoutError, SubprocessFailed, ParseError, EmptyResponse } from './llm-client.js';

function rngFor(gameId) {
  let s = gameId * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
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
    if (state.activeUserId !== session.botUserId) return;

    const persona = personas.get(session.personaId);
    if (!persona) throw new Error(`unknown persona ${session.personaId}`);
    const adapter = adapters[gameRow.game_type];
    if (!adapter) throw new Error(`no AI adapter for game_type ${gameRow.game_type}`);
    const botPlayerIdx = botPlayerIdxOf(state, session.botUserId);
    const botSide = botPlayerIdx === 0 ? 'a' : 'b';

    sse.broadcast(gameId, {
      type: 'bot_thinking',
      payload: { side: botSide, personaId: persona.id, displayName: persona.displayName },
    });

    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await adapter.chooseAction({
          llm, persona, sessionId: session.claudeSessionId,
          state, botPlayerIdx,
        });
        if (r.sessionId && r.sessionId !== session.claudeSessionId) {
          setClaudeSessionId(db, gameId, r.sessionId);
        }

        const result = adapter.plugin.applyAction({
          state, action: r.action, actorId: session.botUserId, rng: rngFor(gameId),
        });
        if (result.error) {
          lastError = new InvalidLlmMove(`engine rejected action: ${result.error}`, []);
          continue;
        }

        const newState = result.state;
        const updateGame = db.prepare("UPDATE games SET state = ?, updated_at = ? WHERE id = ?");
        const tx = db.transaction(() => {
          updateGame.run(JSON.stringify(newState), Date.now(), gameId);
          if (result.ended) {
            db.prepare("UPDATE games SET status='ended', ended_reason=?, winner_side=? WHERE id=?")
              .run(newState.endedReason ?? 'plugin', newState.winnerSide ?? null, gameId);
          }
        });
        tx();
        clearStall(db, gameId);

        if (r.banter != null) {
          sse.broadcast(gameId, {
            type: 'banter',
            payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, text: r.banter },
          });
        }
        sse.broadcast(gameId, { type: 'update', payload: {} });

        // If the bot is STILL active after this action (e.g., advancing
        // through 'cut' as non-dealer, or multi-step show acks), recurse
        // once more so the bot can act immediately. Depth is capped at 1 to
        // prevent an unbounded chain (e.g., pegging → show → next-deal).
        // Guard: phase must have changed so we don't loop on a partial-
        // discard state where activeUserId is inherited unchanged.
        if (!result.ended && newState.activeUserId === session.botUserId && newState.phase !== state.phase && depth === 0) {
          await _runOnce(gameId, 1);
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
    return next;
  }

  function scheduleTurn(gameId) {
    runTurn(gameId).catch(err => logger.error?.(`[ai] runTurn(${gameId}) failed: ${err.stack || err}`));
  }

  return { runTurn, scheduleTurn };
}
