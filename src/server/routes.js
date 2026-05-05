import { Router } from 'express';
import { attachIdentity, requireIdentity } from './identity.js';
import { listUsers, getUserById } from './users.js';
import {
  createWordsGame, listGamesForUser, sideForUser, getGameById,
  endGame
} from './games.js';
import { broadcast, subscribe } from './sse.js';
import { writeGameState } from './state.js';
import { getPlugin } from './plugins.js';

export function buildRoutes({ db, dict, isProd, devUser }) {
  const r = Router();
  r.use(attachIdentity({ db, isProd, devUser }));

  r.get('/me', requireIdentity, (req, res) => {
    const games = listGamesForUser(db, req.user.id).map(g => {
      const otherId = g.playerAId === req.user.id ? g.playerBId : g.playerAId;
      const other = getUserById(db, otherId);
      const you = sideForUser(g, req.user.id);
      const yourScore = you === 'a' ? g.scoreA : g.scoreB;
      const theirScore = you === 'a' ? g.scoreB : g.scoreA;
      return {
        id: g.id,
        opponent: { id: other.id, friendlyName: other.friendlyName, color: other.color },
        status: g.status,
        yourTurn: g.status === 'active' && g.currentTurn === you,
        yourScore, theirScore,
        endedReason: g.endedReason,
        winnerSide: g.winnerSide,
        updatedAt: g.updatedAt
      };
    });
    res.json({
      user: { id: req.user.id, email: req.user.email, friendlyName: req.user.friendlyName, color: req.user.color },
      games
    });
  });

  r.get('/users', requireIdentity, (_req, res) => {
    res.json(listUsers(db).map(u => ({ id: u.id, friendlyName: u.friendlyName, color: u.color })));
  });

  // -- Per-game authorization --
  function loadGameForUser(req, res, next) {
    const gameId = Number(req.params.id);
    if (!Number.isInteger(gameId)) return res.status(400).json({ error: 'bad-game-id' });
    const game = getGameById(db, gameId);
    if (!game) return res.status(404).json({ error: 'game-not-found' });
    const side = sideForUser(game, req.user.id);
    if (!side) return res.status(403).json({ error: 'not-a-participant' });
    req.game = game;
    req.side = side;
    next();
  }

  r.get('/games/:id/state', requireIdentity, loadGameForUser, (req, res) => {
    const g = req.game;
    const otherId = g.playerAId === req.user.id ? g.playerBId : g.playerAId;
    const other = getUserById(db, otherId);
    res.json({
      gameId: g.id,
      you: req.side,
      opponent: { friendlyName: other.friendlyName, color: other.color },
      yourFriendlyName: req.user.friendlyName,
      yourColor: req.user.color,
      status: g.status,
      currentTurn: g.currentTurn,
      board: g.board,
      bag: g.bag,
      racks: { a: g.rackA, b: g.rackB },
      scores: { a: g.scoreA, b: g.scoreB },
      consecutiveScorelessTurns: g.consecutiveScorelessTurns,
      endedReason: g.endedReason,
      winner: g.winnerSide,
      sides: g.state?.sides ?? null,
    });
  });

  r.get('/games/:id/events', requireIdentity, loadGameForUser, (req, res) => {
    subscribe(req.game.id, req, res);
  });

  return r;
}

export function mountRoutes(app, { db, registry, sse }) {
  // Game-scoped middleware: load + check membership
  app.param('gameId', (req, res, next, gameId) => {
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

  app.get('/api/plugins', (req, res) => {
    res.json({
      plugins: Object.values(registry).map(p => ({ id: p.id, displayName: p.displayName })),
    });
  });

  app.get('/api/games', (req, res) => {
    const rows = db.prepare(`
      SELECT id, player_a_id AS playerAId, player_b_id AS playerBId,
             game_type AS gameType, status, updated_at AS updatedAt
      FROM games
      WHERE status = 'active' AND (player_a_id = ? OR player_b_id = ?)
      ORDER BY updated_at DESC
    `).all(req.user.id, req.user.id);
    res.json({ games: rows });
  });

  app.post('/api/games', (req, res) => {
    const { opponentId, gameType } = req.body ?? {};
    if (!Number.isInteger(opponentId) || opponentId === req.user.id) {
      return res.status(400).json({ error: 'invalid opponentId' });
    }
    if (typeof gameType !== 'string' || !registry[gameType]) {
      return res.status(400).json({ error: 'invalid gameType' });
    }
    const opponent = db.prepare('SELECT id FROM users WHERE id = ?').get(opponentId);
    if (!opponent) return res.status(400).json({ error: 'opponent not on roster' });

    const plugin = registry[gameType];
    const aId = Math.min(req.user.id, opponentId);
    const bId = Math.max(req.user.id, opponentId);
    const participants = [
      { userId: aId, side: 'a' },
      { userId: bId, side: 'b' },
    ];

    let initialState;
    try {
      initialState = plugin.initialState({ participants, rng: makeRng(Date.now()) });
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
      res.json({ id: result.id, gameType });
    } catch (err) {
      if (/UNIQUE constraint failed/.test(err.message)) {
        return res.status(409).json({ error: 'an active game of this type already exists with this opponent' });
      }
      throw err;
    }
  });
  app.get('/api/games/:gameId', (req, res) => {
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

  app.post('/api/games/:gameId/action', (req, res) => {
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

      if (result.ended) {
        endGame(db, req.game.id, {
          endedReason: newState.endedReason ?? 'plugin',
          winnerSide: newState.winnerSide ?? null,
          finalState: newState,
        });
      }

      const view = plugin.publicView({ state: newState, viewerId: req.user.id });
      return { http: 200, body: { state: view, ended: !!result.ended, scoreDelta: result.scoreDelta ?? null } };
    });

    const out = txn();
    if (out.http === 200) sse.broadcast(req.game.id, { type: 'update' });
    res.status(out.http).json(out.body);
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
      app[method](path, (req, res, next) => {
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
