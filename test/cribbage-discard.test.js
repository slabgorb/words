import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';
import { sameCard } from '../src/shared/cards/deck.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function makeState() {
  return buildInitialState({ participants, rng: det() });
}

test('discard: rejects non-array payload.cards', () => {
  const r = applyCribbageAction({ state: makeState(), action: { type: 'discard', payload: { cards: 'x' } }, actorId: 1, rng: det() });
  assert.match(r.error, /two cards/i);
});

test('discard: rejects payload with !=2 cards', () => {
  const s = makeState();
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0]] } }, actorId: 1, rng: det() });
  assert.match(r.error, /two cards/i);
});

test('discard: rejects duplicate cards in payload', () => {
  const s = makeState();
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], s.hands[0][0]] } }, actorId: 1, rng: det() });
  assert.match(r.error, /duplicate/i);
});

test('discard: rejects card not in actor hand', () => {
  const s = makeState();
  const not_mine = s.hands[1][0];
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], not_mine] } }, actorId: 1, rng: det() });
  assert.match(r.error, /not in your hand/i);
});

test('discard: first player submission stores pendingDiscards, no phase advance', () => {
  const s = makeState();
  const cards = [s.hands[0][0], s.hands[0][1]];
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards } }, actorId: 1, rng: det() });
  assert.equal(r.error, undefined);
  assert.equal(r.state.phase, 'discard');
  assert.equal(r.state.pendingDiscards[0].length, 2);
  assert.equal(r.state.pendingDiscards[1], null);
  assert.equal(r.state.hands[0].length, 6, 'hand not yet shrunk');
  assert.equal(r.state.crib.length, 0);
});

test('discard: same player twice → already-discarded error', () => {
  const s = makeState();
  const r1 = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], s.hands[0][1]] } }, actorId: 1, rng: det() });
  const r2 = applyCribbageAction({ state: r1.state, action: { type: 'discard', payload: { cards: [r1.state.hands[0][2], r1.state.hands[0][3]] } }, actorId: 1, rng: det() });
  assert.match(r2.error, /already discarded/i);
});

test('discard: both players submit → auto-cut → pegging, build crib, shrink hands', () => {
  const s = makeState();
  const r1 = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], s.hands[0][1]] } }, actorId: 1, rng: det() });
  const r2 = applyCribbageAction({ state: r1.state, action: { type: 'discard', payload: { cards: [r1.state.hands[1][0], r1.state.hands[1][1]] } }, actorId: 2, rng: det() });
  assert.equal(r2.state.phase, 'pegging');
  assert.equal(r2.state.hands[0].length, 4);
  assert.equal(r2.state.hands[1].length, 4);
  assert.equal(r2.state.crib.length, 4);
  assert.ok(r2.state.starter, 'starter card was cut automatically');
  // After auto-cut, non-dealer leads pegging (player 1 = userId 2 since dealer=0)
  assert.equal(r2.state.activeUserId, 2);
  assert.deepEqual(r2.state.pendingDiscards, [null, null]);
  assert.equal(r2.summary?.kind, 'cut', 'auto-cut summary surfaces starter info');
});

test('discard: first player submission returns summary with kind=discard', () => {
  const s = makeState();
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], s.hands[0][1]] } }, actorId: 1, rng: det() });
  assert.equal(r.summary?.kind, 'discard');
  assert.equal(r.ended, false);
});
