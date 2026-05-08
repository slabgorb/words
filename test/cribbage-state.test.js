import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

const participants = [
  { userId: 1, side: 'a' },
  { userId: 2, side: 'b' },
];

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('buildInitialState: phase=discard, dealer is 0 or 1, scores=[0,0]', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.phase, 'discard');
  assert.ok(s.dealer === 0 || s.dealer === 1, `dealer must be 0 or 1, got ${s.dealer}`);
  assert.deepEqual(s.scores, [0, 0]);
});

test('buildInitialState: opening dealer is rng-driven (coin flip)', () => {
  const lowRng = () => 0.1;
  const highRng = () => 0.9;
  assert.equal(buildInitialState({ participants, rng: lowRng }).dealer, 0);
  assert.equal(buildInitialState({ participants, rng: highRng }).dealer, 1);
});

test('buildInitialState: deals 6 to each hand, 40 left in deck', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.hands[0].length, 6);
  assert.equal(s.hands[1].length, 6);
  assert.equal(s.deck.length, 40);
});

test('buildInitialState: pendingDiscards [null,null], crib [], starter null, pegging null', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.pendingDiscards, [null, null]);
  assert.deepEqual(s.crib, []);
  assert.equal(s.starter, null);
  assert.equal(s.pegging, null);
});

test('buildInitialState: sides map participants', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.sides, { a: 1, b: 2 });
});

test('buildInitialState: activeUserId is null during discard (simultaneous)', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.activeUserId, null);
});

test('buildInitialState: total cards across hands+deck = 52, no duplicates', () => {
  const s = buildInitialState({ participants, rng: det() });
  const all = [...s.hands[0], ...s.hands[1], ...s.deck];
  assert.equal(all.length, 52);
  const ids = new Set(all.map(c => c.rank + c.suit));
  assert.equal(ids.size, 52);
});

test('buildInitialState: same rng seed → same deal (determinism)', () => {
  const s1 = buildInitialState({ participants, rng: det(42) });
  const s2 = buildInitialState({ participants, rng: det(42) });
  assert.deepEqual(s1.hands, s2.hands);
  assert.deepEqual(s1.deck, s2.deck);
});

test('buildInitialState: acknowledged starts [false,false]', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.acknowledged, [false, false]);
});
