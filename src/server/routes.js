import { Router } from 'express';
import { getGameState, persistMove, resetGame } from './db.js';
import {
  validatePlacement, extractWords, scoreMove, applyMove,
  detectGameEnd, applyEndGameAdjustment, otherPlayer
} from './engine.js';
import { broadcast } from './sse.js';
import { setIdentityCookie, requireIdentity, attachIdentity } from './identity.js';

const VALID_IDS = new Set(['keith', 'sonia']);

export function buildRoutes({ db, dict, secret }) {
  const r = Router();
  r.use(attachIdentity(secret));

  // -- Identity --
  r.get('/whoami', (req, res) => {
    res.json({ playerId: req.playerId });
  });

  r.post('/whoami', (req, res) => {
    const { playerId } = req.body ?? {};
    if (!VALID_IDS.has(playerId)) return res.status(400).json({ error: 'bad-identity' });
    setIdentityCookie(res, playerId, secret);
    res.json({ playerId });
  });

  // -- State (read-only snapshot) --
  r.get('/state', requireIdentity, (req, res) => {
    const state = getGameState(db);
    res.json({ ...state, you: req.playerId });
  });

  // -- Validate (live word check, never 4xx for "not a word") --
  r.post('/validate', requireIdentity, (req, res) => {
    const state = getGameState(db);
    const { placement } = req.body ?? {};
    if (!Array.isArray(placement)) return res.status(400).json({ error: 'bad-placement' });

    const isFirstMove = state.board.every(row => row.every(c => c === null));
    const geo = validatePlacement(state.board, placement, isFirstMove);
    if (!geo.valid) return res.json({ valid: false, words: [], score: 0, reason: geo.reason });

    const { mainWord, crossWords } = extractWords(state.board, placement, geo.axis);
    const allWords = [mainWord, ...crossWords].filter(Boolean);
    const wordResults = allWords.map(w => ({ word: w.text, ok: dict.isWord(w.text) }));
    const allWordsValid = wordResults.every(w => w.ok);
    const score = allWordsValid ? scoreMove(state.board, placement, mainWord, crossWords) : 0;
    res.json({ valid: allWordsValid, words: wordResults, score });
  });

  // -- Submit a move (the canonical write path) --
  r.post('/move', requireIdentity, (req, res) => {
    const state = getGameState(db);
    if (state.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (state.currentTurn !== req.playerId) return res.status(409).json({ error: 'not-your-turn' });

    const { placement, clientNonce } = req.body ?? {};
    if (!Array.isArray(placement) || !clientNonce) {
      return res.status(400).json({ error: 'bad-request' });
    }

    const isFirstMove = state.board.every(row => row.every(c => c === null));
    const geo = validatePlacement(state.board, placement, isFirstMove);
    if (!geo.valid) return res.status(400).json({ error: 'placement-invalid', reason: geo.reason });

    // Verify each placed tile (by rack-key, where blanks are '_') is in player's rack.
    const rack = state.racks[req.playerId].slice();
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

    let next = applyMove(state, { playerId: req.playerId, kind: 'play', placement, scoreDelta });
    const endReason = detectGameEnd(next);
    if (endReason) next = applyEndGameAdjustment(next, endReason, null);

    const result = persistMove(db, next, {
      playerId: req.playerId, kind: 'play', placement,
      wordsFormed: allWords.map(w => w.text), scoreDelta, clientNonce
    });

    broadcast({ type: 'move', payload: { by: req.playerId, words: allWords.map(w => w.text), score: scoreDelta, ended: !!endReason } });
    res.json({ ok: true, moveId: result.moveId, idempotent: result.idempotent, ended: endReason });
  });

  // -- Pass turn --
  r.post('/pass', requireIdentity, (req, res) => {
    const state = getGameState(db);
    if (state.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (state.currentTurn !== req.playerId) return res.status(409).json({ error: 'not-your-turn' });
    const { clientNonce } = req.body ?? {};
    if (!clientNonce) return res.status(400).json({ error: 'bad-request' });
    let next = applyMove(state, { playerId: req.playerId, kind: 'pass' });
    const endReason = detectGameEnd(next);
    if (endReason) next = applyEndGameAdjustment(next, endReason, null);
    persistMove(db, next, { playerId: req.playerId, kind: 'pass', scoreDelta: 0, clientNonce });
    broadcast({ type: 'pass', payload: { by: req.playerId, ended: !!endReason } });
    res.json({ ok: true, ended: endReason });
  });

  // -- Swap tiles --
  r.post('/swap', requireIdentity, (req, res) => {
    const state = getGameState(db);
    if (state.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (state.currentTurn !== req.playerId) return res.status(409).json({ error: 'not-your-turn' });
    const { tiles, clientNonce } = req.body ?? {};
    if (!Array.isArray(tiles) || tiles.length === 0 || !clientNonce) {
      return res.status(400).json({ error: 'bad-request' });
    }
    if (state.bag.length < 7) return res.status(400).json({ error: 'bag-too-small' });
    const rack = state.racks[req.playerId].slice();
    for (const letter of tiles) {
      const idx = rack.indexOf(letter);
      if (idx === -1) return res.status(400).json({ error: 'rack-mismatch', missing: letter });
      rack.splice(idx, 1);
    }
    let next = applyMove(state, { playerId: req.playerId, kind: 'swap', swapTiles: tiles });
    const endReason = detectGameEnd(next);
    if (endReason) next = applyEndGameAdjustment(next, endReason, null);
    persistMove(db, next, { playerId: req.playerId, kind: 'swap', scoreDelta: 0, clientNonce });
    broadcast({ type: 'swap', payload: { by: req.playerId, count: tiles.length, ended: !!endReason } });
    res.json({ ok: true, ended: endReason });
  });

  // -- Resign --
  r.post('/resign', requireIdentity, (req, res) => {
    const state = getGameState(db);
    if (state.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    const { clientNonce } = req.body ?? {};
    if (!clientNonce) return res.status(400).json({ error: 'bad-request' });
    const next = applyEndGameAdjustment(state, 'resigned', req.playerId);
    persistMove(db, next, { playerId: req.playerId, kind: 'pass', scoreDelta: 0, clientNonce });
    broadcast({ type: 'resign', payload: { by: req.playerId } });
    res.json({ ok: true, ended: 'resigned' });
  });

  // -- New game (requires both confirms) --
  // Simple model: a small in-memory pending-confirms set keyed on game-state.updated_at.
  // Cleared on reset. This works because the server is single-process.
  const pendingNewGame = new Set();
  r.post('/new-game', requireIdentity, (_req2, res2) => {
    const state = getGameState(db);
    if (state.status !== 'ended') return res2.status(409).json({ error: 'game-not-ended' });
    pendingNewGame.add(_req2.playerId);
    if (pendingNewGame.size === 2) {
      pendingNewGame.clear();
      resetGame(db);
      broadcast({ type: 'new-game', payload: {} });
      return res2.json({ ok: true, started: true });
    }
    res2.json({ ok: true, started: false, waitingFor: ['keith','sonia'].find(p => p !== _req2.playerId) });
  });

  // -- SSE event stream --
  r.get('/events', requireIdentity, (req, res) => {
    // import lazily to avoid a circular import at top
    import('./sse.js').then(({ subscribe }) => subscribe(req, res));
  });

  return r;
}
