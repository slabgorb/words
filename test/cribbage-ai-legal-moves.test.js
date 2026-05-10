import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateLegalMoves } from '../plugins/cribbage/server/ai/legal-moves.js';

const CARD = (rank, suit) => ({ rank, suit });

test('discard: returns C(6,2)=15 moves with deterministic id format', () => {
  const state = {
    phase: 'discard',
    hands: [[CARD('A','H'), CARD('2','H'), CARD('3','H'), CARD('4','H'), CARD('5','H'), CARD('6','H')], []],
    sides: { a: 1, b: 2 },
  };
  const moves = enumerateLegalMoves(state, /* botPlayerIdx= */ 0);
  assert.equal(moves.length, 15);
  for (const m of moves) {
    assert.match(m.id, /^discard:\d+,\d+$/);
    assert.equal(m.action.type, 'discard');
    assert.equal(m.action.payload.cards.length, 2);
    assert.ok(typeof m.summary === 'string' && m.summary.length > 0);
  }
  assert.equal(new Set(moves.map(m => m.id)).size, 15);
});

test('cut: returns single move {type:"cut"}', () => {
  const state = { phase: 'cut', dealer: 0, hands: [[],[]], sides: { a:1, b:2 } };
  const moves = enumerateLegalMoves(state, /* botPlayerIdx= */ 1);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 'cut');
  assert.deepEqual(moves[0].action, { type: 'cut' });
});

test('pegging: returns one move per playable card; running+pip ≤ 31', () => {
  const state = {
    phase: 'pegging',
    hands: [[CARD('K','H'), CARD('5','S'), CARD('2','D')], []],
    pegging: { running: 25, next: 0 },
    sides: { a:1, b:2 },
  };
  const moves = enumerateLegalMoves(state, 0);
  assert.equal(moves.length, 2);
  assert.deepEqual(moves.map(m => m.id).sort(), ['play:5S', 'play:2D'].sort());
});

test('show: returns single {type:"next"} acknowledgement', () => {
  const state = { phase: 'show', hands: [[],[]], sides: { a:1, b:2 } };
  const moves = enumerateLegalMoves(state, 0);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 'next');
  assert.deepEqual(moves[0].action, { type: 'next' });
});

test('match-end: returns empty array (no moves)', () => {
  const state = { phase: 'match-end', hands: [[],[]], sides: { a:1, b:2 } };
  assert.equal(enumerateLegalMoves(state, 0).length, 0);
});
