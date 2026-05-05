import { Router } from 'express';
import { attachIdentity, requireIdentity } from './identity.js';
import { listUsers, getUserById } from './users.js';
import {
  createGame, listGamesForUser, sideForUser, getGameById,
  persistMove, resetGameForPair
} from './games.js';
import {
  validatePlacement, extractWords, scoreMove, applyMove,
  detectGameEnd, applyEndGameAdjustment
} from './engine.js';
import { broadcast, subscribe } from './sse.js';

const pendingNewGame = new Map(); // gameId -> Set<userId>  (module-level, shared across all app instances)

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

  r.post('/games', requireIdentity, (req, res) => {
    const { otherUserId } = req.body ?? {};
    if (typeof otherUserId !== 'number') return res.status(400).json({ error: 'bad-request' });
    if (otherUserId === req.user.id) return res.status(400).json({ error: 'self-pairing' });
    const other = getUserById(db, otherUserId);
    if (!other) return res.status(404).json({ error: 'unknown-user' });
    try {
      const g = createGame(db, req.user.id, otherUserId);
      res.status(201).json({ gameId: g.id });
    } catch (e) {
      const msg = String(e?.message ?? '');
      if (/UNIQUE|one_active_per_pair/i.test(msg)) {
        return res.status(409).json({ error: 'pair-active' });
      }
      throw e;
    }
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

  // Engine adapter — converts a games row into the shape the engine expects.
  function toEngineState(g) {
    return {
      status: g.status,
      currentTurn: g.currentTurn,
      bag: g.bag,
      board: g.board,
      racks: { a: g.rackA, b: g.rackB },
      scores: { a: g.scoreA, b: g.scoreB },
      consecutiveScorelessTurns: g.consecutiveScorelessTurns,
      endedReason: g.endedReason,
      winner: g.winnerSide
    };
  }
  function fromEngineState(es) {
    return {
      status: es.status,
      currentTurn: es.currentTurn,
      bag: es.bag,
      board: es.board,
      rackA: es.racks.a,
      rackB: es.racks.b,
      scoreA: es.scores.a,
      scoreB: es.scores.b,
      consecutiveScorelessTurns: es.consecutiveScorelessTurns,
      endedReason: es.endedReason ?? null,
      winnerSide: es.winner ?? null
    };
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
      winner: g.winnerSide
    });
  });

  r.post('/games/:id/validate', requireIdentity, loadGameForUser, (req, res) => {
    const state = toEngineState(req.game);
    const { placement } = req.body ?? {};
    if (!Array.isArray(placement)) return res.status(400).json({ error: 'bad-placement' });
    const isFirstMove = state.board.every(row => row.every(c => c === null));
    const geo = validatePlacement(state.board, placement, isFirstMove);
    if (!geo.valid) return res.json({ valid: false, words: [], score: 0, reason: geo.reason });
    const { mainWord, crossWords } = extractWords(state.board, placement, geo.axis);
    const allWords = [mainWord, ...crossWords].filter(Boolean);
    const wordResults = allWords.map(w => ({ word: w.text, ok: dict.isWord(w.text) }));
    const allValid = wordResults.every(w => w.ok);
    const score = allValid ? scoreMove(state.board, placement, mainWord, crossWords) : 0;
    res.json({ valid: allValid, words: wordResults, score });
  });

  r.post('/games/:id/move', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (game.currentTurn !== req.side) return res.status(409).json({ error: 'not-your-turn' });
    const { placement, clientNonce } = req.body ?? {};
    if (!Array.isArray(placement) || !clientNonce) return res.status(400).json({ error: 'bad-request' });

    const state = toEngineState(game);
    const isFirstMove = state.board.every(row => row.every(c => c === null));
    const geo = validatePlacement(state.board, placement, isFirstMove);
    if (!geo.valid) return res.status(400).json({ error: 'placement-invalid', reason: geo.reason });

    const rack = state.racks[req.side].slice();
    for (const t of placement) {
      const key = t.blank ? '_' : t.letter;
      const idx = rack.indexOf(key);
      if (idx === -1) return res.status(400).json({ error: 'rack-mismatch', missing: key });
      rack.splice(idx, 1);
    }
    const { mainWord, crossWords } = extractWords(state.board, placement, geo.axis);
    const allWords = [mainWord, ...crossWords].filter(Boolean);
    if (allWords.length === 0) return res.status(400).json({ error: 'no-word-formed' });
    for (const w of allWords) {
      if (!dict.isWord(w.text)) return res.status(400).json({ error: 'invalid-word', word: w.text });
    }
    const scoreDelta = scoreMove(state.board, placement, mainWord, crossWords);

    let nextEs = applyMove(state, { playerId: req.side, kind: 'play', placement, scoreDelta });
    const endReason = detectGameEnd(nextEs);
    if (endReason) nextEs = applyEndGameAdjustment(nextEs, endReason, null);
    const next = fromEngineState(nextEs);

    const result = persistMove(db, game.id, next, {
      side: req.side, kind: 'play', placement,
      wordsFormed: allWords.map(w => w.text), scoreDelta, clientNonce
    });
    broadcast(game.id, { type: 'move', payload: { by: req.side, words: allWords.map(w => w.text), score: scoreDelta, ended: !!endReason } });
    res.json({ ok: true, moveId: result.moveId, idempotent: result.idempotent, ended: endReason });
  });

  r.post('/games/:id/pass', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (game.currentTurn !== req.side) return res.status(409).json({ error: 'not-your-turn' });
    const { clientNonce } = req.body ?? {};
    if (!clientNonce) return res.status(400).json({ error: 'bad-request' });
    const state = toEngineState(game);
    let nextEs = applyMove(state, { playerId: req.side, kind: 'pass' });
    const endReason = detectGameEnd(nextEs);
    if (endReason) nextEs = applyEndGameAdjustment(nextEs, endReason, null);
    const next = fromEngineState(nextEs);
    persistMove(db, game.id, next, { side: req.side, kind: 'pass', scoreDelta: 0, clientNonce });
    broadcast(game.id, { type: 'pass', payload: { by: req.side, ended: !!endReason } });
    res.json({ ok: true, ended: endReason });
  });

  r.post('/games/:id/swap', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (game.currentTurn !== req.side) return res.status(409).json({ error: 'not-your-turn' });
    const { tiles, clientNonce } = req.body ?? {};
    if (!Array.isArray(tiles) || tiles.length === 0 || !clientNonce) return res.status(400).json({ error: 'bad-request' });
    if (game.bag.length < 7) return res.status(400).json({ error: 'bag-too-small' });
    const state = toEngineState(game);
    const rack = state.racks[req.side].slice();
    for (const letter of tiles) {
      const idx = rack.indexOf(letter);
      if (idx === -1) return res.status(400).json({ error: 'rack-mismatch', missing: letter });
      rack.splice(idx, 1);
    }
    let nextEs = applyMove(state, { playerId: req.side, kind: 'swap', swapTiles: tiles });
    const endReason = detectGameEnd(nextEs);
    if (endReason) nextEs = applyEndGameAdjustment(nextEs, endReason, null);
    const next = fromEngineState(nextEs);
    persistMove(db, game.id, next, { side: req.side, kind: 'swap', scoreDelta: 0, clientNonce });
    broadcast(game.id, { type: 'swap', payload: { by: req.side, count: tiles.length, ended: !!endReason } });
    res.json({ ok: true, ended: endReason });
  });

  r.post('/games/:id/resign', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    const { clientNonce } = req.body ?? {};
    if (!clientNonce) return res.status(400).json({ error: 'bad-request' });
    const state = toEngineState(game);
    const nextEs = applyEndGameAdjustment(state, 'resigned', req.side);
    const next = fromEngineState(nextEs);
    persistMove(db, game.id, next, { side: req.side, kind: 'pass', scoreDelta: 0, clientNonce });
    broadcast(game.id, { type: 'resign', payload: { by: req.side } });
    res.json({ ok: true, ended: 'resigned' });
  });

  r.post('/games/:id/new-game', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'ended') return res.status(409).json({ error: 'game-not-ended' });
    let pending = pendingNewGame.get(game.id);
    if (!pending) { pending = new Set(); pendingNewGame.set(game.id, pending); }
    pending.add(req.user.id);
    if (pending.size === 2) {
      pendingNewGame.delete(game.id);
      const fresh = resetGameForPair(db, game.id);
      broadcast(game.id, { type: 'new-game', payload: { newGameId: fresh.id } });
      return res.json({ ok: true, started: true, newGameId: fresh.id });
    }
    const otherId = game.playerAId === req.user.id ? game.playerBId : game.playerAId;
    const other = getUserById(db, otherId);
    res.json({ ok: true, started: false, waitingFor: other.friendlyName });
  });

  r.get('/games/:id/events', requireIdentity, loadGameForUser, (req, res) => {
    subscribe(req.game.id, req, res);
  });

  return r;
}
