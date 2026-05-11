import { requireIdentity } from './identity.js';
import { listUsers, getUserById } from './users.js';
import { listGamesForUser, sideForUser, getGameById, endGame } from './games.js';
import { subscribe } from './sse.js';
import { writeGameState } from './state.js';
import { getPlugin } from './plugins.js';
import { appendTurnEntry, listTurnEntries } from './history.js';
import { createAiSession, getAiSession, clearStall } from './ai/agent-session.js';

export function mountRoutes(app, { db, registry, sse, ai = null }) {
  // Game-scoped middleware: validate id, load game, check membership.
  app.param('gameId', (req, res, next, gameId) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    const id = Number(gameId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad game id' });
    const game = getGameById(db, id);
    if (!game) return res.status(404).json({ error: 'game not found' });
    if (req.user.id !== game.playerAId && req.user.id !== game.playerBId) {
      return res.status(403).json({ error: 'not a participant' });
    }
    req.game = game;
    next();
  });

  // -- Identity-scoped, no game id --
  app.get('/api/me', requireIdentity, (req, res) => {
    const games = listGamesForUser(db, req.user.id).map(g => {
      const otherId = g.playerAId === req.user.id ? g.playerBId : g.playerAId;
      const other = getUserById(db, otherId);
      const you = sideForUser(g, req.user.id);
      const scoreA = g.state?.scores?.a ?? 0;
      const scoreB = g.state?.scores?.b ?? 0;
      const yourScore = you === 'a' ? scoreA : scoreB;
      const theirScore = you === 'a' ? scoreB : scoreA;
      return {
        id: g.id,
        gameType: g.gameType,
        variant: g.state?.variant ?? null,
        opponent: { id: other.id, friendlyName: other.friendlyName, color: other.color, glyph: other.glyph },
        you,
        status: g.status,
        yourTurn: g.status === 'active' && g.currentTurn === you,
        yourScore, theirScore,
        endedReason: g.endedReason,
        winnerSide: g.winnerSide,
        updatedAt: g.updatedAt
      };
    });
    res.json({
      user: { id: req.user.id, email: req.user.email, friendlyName: req.user.friendlyName, color: req.user.color, glyph: req.user.glyph },
      games
    });
  });

  app.get('/api/users', requireIdentity, (_req, res) => {
    res.json(listUsers(db).map(u => ({ id: u.id, friendlyName: u.friendlyName, color: u.color, glyph: u.glyph })));
  });

  app.get('/api/plugins', requireIdentity, (_req, res) => {
    res.json({
      plugins: Object.values(registry).map(p => ({ id: p.id, displayName: p.displayName })),
    });
  });

  // -- Generic game listing & creation --
  app.get('/api/games', requireIdentity, (req, res) => {
    const rows = db.prepare(`
      SELECT id, player_a_id AS playerAId, player_b_id AS playerBId,
             game_type AS gameType, status, updated_at AS updatedAt
      FROM games
      WHERE status = 'active' AND (player_a_id = ? OR player_b_id = ?)
      ORDER BY updated_at DESC
    `).all(req.user.id, req.user.id);
    res.json({ games: rows });
  });

  app.post('/api/games', requireIdentity, (req, res) => {
    const { opponentId, gameType, variant } = req.body ?? {};
    if (!Number.isInteger(opponentId) || opponentId === req.user.id) {
      return res.status(400).json({ error: 'invalid opponentId' });
    }
    if (typeof gameType !== 'string' || !registry[gameType]) {
      return res.status(400).json({ error: 'invalid gameType' });
    }
    if (variant !== undefined && typeof variant !== 'string') {
      return res.status(400).json({ error: 'invalid variant' });
    }
    const opponentRow = db.prepare('SELECT id, is_bot FROM users WHERE id = ?').get(opponentId);
    if (!opponentRow) return res.status(400).json({ error: 'opponent not on roster' });
    const opponentIsBot = opponentRow.is_bot === 1;

    let personaId = null;
    if (opponentIsBot) {
      personaId = req.body?.personaId;
      if (typeof personaId !== 'string' || !personaId) {
        return res.status(400).json({ error: 'personaId required for AI opponent' });
      }
      if (!ai?.personas?.has(personaId)) {
        return res.status(400).json({ error: `unknown personaId: ${personaId}` });
      }
    }

    const plugin = registry[gameType];
    const aId = Math.min(req.user.id, opponentId);
    const bId = Math.max(req.user.id, opponentId);
    const participants = [
      { userId: aId, side: 'a' },
      { userId: bId, side: 'b' },
    ];

    let initialState;
    try {
      initialState = plugin.initialState({ participants, rng: makeRng(Date.now()), variant });
    } catch (err) {
      return res.status(500).json({ error: `initialState failed: ${err.message}` });
    }

    try {
      const now = Date.now();
      const result = db.prepare(`
        INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?, ?, ?)
        RETURNING id
      `).get(aId, bId, gameType, JSON.stringify(initialState), now, now);
      if (opponentIsBot && ai) {
        createAiSession(db, { gameId: result.id, botUserId: opponentId, personaId });
      }
      res.json({ id: result.id, gameType });
    } catch (err) {
      if (/UNIQUE constraint failed/.test(err.message)) {
        return res.status(409).json({ error: 'an active game of this type already exists with this opponent' });
      }
      throw err;
    }
  });

  // -- Per-game routes (use :gameId) --
  app.get('/api/games/:gameId', requireIdentity, (req, res) => {
    const plugin = getPlugin(registry, req.game.gameType);
    const view = plugin.publicView({ state: req.game.state, viewerId: req.user.id });
    res.json({
      id: req.game.id,
      gameType: req.game.gameType,
      status: req.game.status,
      playerAId: req.game.playerAId,
      playerBId: req.game.playerBId,
      state: view,
    });
  });

  app.get('/api/games/:gameId/history', requireIdentity, (req, res) => {
    const entries = listTurnEntries(db, req.game.id);
    res.json({ entries });
  });

  app.get('/api/games/:gameId/events', requireIdentity, (req, res) => {
    subscribe(req.game.id, req, res);
  });

  app.post('/api/games/:gameId/action', requireIdentity, (req, res) => {
    const { action } = parseAction(req);
    if (!action) return res.status(400).json({ error: 'missing action' });
    if (req.game.status !== 'active') {
      return res.status(409).json({ error: 'game ended' });
    }

    let plugin;
    try { plugin = getPlugin(registry, req.game.gameType); }
    catch { return res.status(500).json({ error: 'plugin unavailable' }); }

    // Turn ownership check (only if state declares activeUserId)
    const activeUserId = req.game.state.activeUserId;
    if (typeof activeUserId === 'number' && activeUserId !== req.user.id) {
      return res.status(422).json({ error: 'not your turn' });
    }

    const txn = db.transaction(() => {
      const result = plugin.applyAction({
        state: req.game.state,
        action,
        actorId: req.user.id,
        rng: makeRng(req.game.id),
      });
      if (result.error) return { http: 422, body: { error: result.error } };

      const newState = result.state;
      writeGameState(db, req.game.id, newState);

      const turnRows = [];
      if (result.summary) {
        const actorSide = newState.sides?.a === req.user.id ? 'a'
                        : newState.sides?.b === req.user.id ? 'b'
                        : (req.game.state.sides?.a === req.user.id ? 'a'
                        : (req.game.playerAId === req.user.id ? 'a' : 'b'));
        turnRows.push(appendTurnEntry(db, req.game.id, actorSide, result.summary.kind, result.summary));
      }

      if (result.ended) {
        endGame(db, req.game.id, {
          endedReason: newState.endedReason ?? 'plugin',
          winnerSide: newState.winnerSide ?? null,
          finalState: newState,
        });
        const actorSide = newState.sides?.a === req.user.id ? 'a'
                        : newState.sides?.b === req.user.id ? 'b'
                        : (req.game.state.sides?.a === req.user.id ? 'a'
                        : (req.game.playerAId === req.user.id ? 'a' : 'b'));
        const endedSummary = {
          kind: 'game-ended',
          reason: newState.endedReason ?? 'plugin',
          winnerSide: newState.winnerSide ?? null,
        };
        turnRows.push(appendTurnEntry(db, req.game.id, actorSide, 'game-ended', endedSummary));
      }

      const view = plugin.publicView({ state: newState, viewerId: req.user.id });
      return {
        http: 200,
        body: { state: view, ended: !!result.ended, scoreDelta: result.scoreDelta ?? null },
        turnRows,
      };
    });

    const out = txn();
    if (out.http === 200) {
      sse.broadcast(req.game.id, { type: 'update' });
      // If the next active player is a bot (or it's a concurrent-discard phase
      // where activeUserId is null and the bot may still need to act), schedule
      // an AI turn.
      if (ai) {
        const nextActiveUserId = out.body?.state?.activeUserId;
        if (typeof nextActiveUserId === 'number') {
          const isBot = db.prepare("SELECT is_bot FROM users WHERE id = ?").get(nextActiveUserId)?.is_bot === 1;
          if (isBot) ai.orchestrator.scheduleTurn(req.game.id);
        } else if (nextActiveUserId == null) {
          // Concurrent phase (e.g. discard): check if this game has a bot session.
          const sess = db.prepare("SELECT bot_user_id FROM ai_sessions WHERE game_id = ?").get(req.game.id);
          if (sess) ai.orchestrator.scheduleTurn(req.game.id);
        }
      }
      for (const row of out.turnRows ?? []) {
        sse.broadcast(req.game.id, {
          type: 'turn',
          payload: {
            turnNumber: row.turnNumber,
            side: row.side,
            kind: row.kind,
            summary: row.summary,
            createdAt: row.createdAt,
          },
        });
      }
    }
    res.status(out.http).json(out.body);
  });

  // -- AI stall resolution --
  app.post('/api/games/:gameId/ai/retry', requireIdentity, (req, res) => {
    if (!ai) return res.status(500).json({ error: 'ai subsystem not enabled' });
    const sess = getAiSession(db, req.game.id);
    if (!sess) return res.status(404).json({ error: 'no AI session' });
    if (sess.stalledAt == null) return res.status(422).json({ error: 'not stalled' });
    clearStall(db, req.game.id);
    ai.orchestrator.scheduleTurn(req.game.id);
    res.json({ ok: true });
  });

  app.post('/api/games/:gameId/ai/abandon', requireIdentity, (req, res) => {
    if (!ai) return res.status(500).json({ error: 'ai subsystem not enabled' });
    const sess = getAiSession(db, req.game.id);
    if (!sess) return res.status(404).json({ error: 'no AI session' });
    db.prepare("UPDATE games SET status='ended', ended_reason=?, winner_side=NULL, updated_at=? WHERE id=?")
      .run('ai_stalled', Date.now(), req.game.id);
    sse.broadcast(req.game.id, { type: 'ended', payload: { reason: 'ai_stalled' } });
    res.json({ ok: true });
  });

  // Mount each plugin's auxiliary routes
  for (const plugin of Object.values(registry)) {
    if (!plugin.auxRoutes) continue;
    for (const [name, route] of Object.entries(plugin.auxRoutes)) {
      const path = `/api/games/:gameId/${name}`;
      const method = route.method.toLowerCase();
      if (typeof app[method] !== 'function') {
        throw new Error(`plugin(${plugin.id}).auxRoutes['${name}']: unsupported method ${route.method}`);
      }
      // Wrap handler so it only runs for matching game_type
      app[method](path, requireIdentity, (req, res, next) => {
        if (req.game.gameType !== plugin.id) return next();
        return route.handler(req, res, next);
      });
    }
  }
}

function parseAction(req) {
  if (!req.body || typeof req.body !== 'object') return { action: null };
  const { type, payload } = req.body;
  if (typeof type !== 'string' || type.length === 0) return { action: null };
  return { action: { type, payload: payload ?? {} } };
}

function makeRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
