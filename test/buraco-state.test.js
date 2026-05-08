import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/buraco/server/state.js';
import { cardIdsOf } from '../src/shared/cards/card-multiset.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('buildInitialState returns 11 cards in each hand', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.hands.a.length, 11);
  assert.equal(s.hands.b.length, 11);
});

test('buildInitialState returns 11 cards in each morto', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.mortos.a.length, 11);
  assert.equal(s.mortos.b.length, 11);
});

test('buildInitialState flips one card to discard', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.discard.length, 1);
});

test('buildInitialState leaves remaining cards in stock', () => {
  const s = buildInitialState({ participants, rng: det() });
  // 108 - 11*4 - 1 = 63
  assert.equal(s.stock.length, 63);
});

test('total cards across all locations = 108', () => {
  const s = buildInitialState({ participants, rng: det() });
  const all = cardIdsOf(s);
  assert.equal(all.length, 108);
  assert.equal(new Set(all).size, 108);
});

test('initial phase is draw, currentTurn is a, hasDrawn false', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.phase, 'draw');
  assert.equal(s.currentTurn, 'a');
  assert.equal(s.hasDrawn, false);
});

test('initial scores are zero, no winner', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.scores, { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } });
  assert.equal(s.winner, null);
});

test('initial mortoTaken is false on both sides', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.mortoTaken, { a: false, b: false });
});

test('initial melds are empty arrays', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.melds, { a: [], b: [] });
});
