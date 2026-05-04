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

  return r;
}
