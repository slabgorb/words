import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cribbagePublicView } from '../plugins/cribbage/server/view.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('view: viewer sees their own hand as cards; opponent as count', () => {
  const state = buildInitialState({ participants, rng: det() });
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.equal(v.hands[0].length, 6);
  assert.deepEqual(v.hands[1], { count: 6 });
});

test('view: deck is always count-only', () => {
  const state = buildInitialState({ participants, rng: det() });
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.deepEqual(v.deck, { count: 40 });
});

test('view: rngSeed is never exposed', () => {
  const state = buildInitialState({ participants, rng: det() });
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.equal(v.rngSeed, undefined);
});

test('view: crib is count-only until phase=show', () => {
  const state = { ...buildInitialState({ participants, rng: det() }), crib: [{ rank:'A', suit:'S' }, { rank:'2', suit:'S' }, { rank:'3', suit:'S' }, { rank:'4', suit:'S' }], phase: 'pegging' };
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.deepEqual(v.crib, { count: 4 });
});

test('view: crib is full cards in phase=show', () => {
  const state = { ...buildInitialState({ participants, rng: det() }), crib: [{ rank:'A', suit:'S' }, { rank:'2', suit:'S' }, { rank:'3', suit:'S' }, { rank:'4', suit:'S' }], phase: 'show' };
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.equal(v.crib.length, 4);
  assert.equal(v.crib[0].rank, 'A');
});

test('view: pendingDiscards — viewer sees own as cards, opp as boolean submitted', () => {
  const state = buildInitialState({ participants, rng: det() });
  const next = { ...state, pendingDiscards: [[{ rank:'A', suit:'S' }, { rank:'2', suit:'S' }], null] };
  const v = cribbagePublicView({ state: next, viewerId: 1 });
  assert.equal(v.pendingDiscards[0].length, 2);
  assert.equal(v.pendingDiscards[1], false);
});

test('view: starter, pegging, scores, showBreakdown, phase, sides, activeUserId all public', () => {
  const state = buildInitialState({ participants, rng: det() });
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.equal(v.phase, 'discard');
  assert.deepEqual(v.scores, [0, 0]);
  assert.deepEqual(v.sides, { a: 1, b: 2 });
  assert.equal(v.activeUserId, null);
  assert.equal(v.starter, null);
  assert.equal(v.pegging, null);
});
