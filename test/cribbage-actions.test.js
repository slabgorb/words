import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('action with unknown type → error', () => {
  const state = buildInitialState({ participants, rng: det() });
  const result = applyCribbageAction({ state, action: { type: 'nope' }, actorId: 1, rng: det() });
  assert.match(result.error, /unknown action/);
});

test('action by non-participant → error', () => {
  const state = buildInitialState({ participants, rng: det() });
  const result = applyCribbageAction({ state, action: { type: 'discard', payload: {} }, actorId: 99, rng: det() });
  assert.match(result.error, /not a participant/);
});

test('action with wrong phase → phase error', () => {
  const state = buildInitialState({ participants, rng: det() });
  const result = applyCribbageAction({ state, action: { type: 'play', payload: { card: state.hands[0][0] } }, actorId: 1, rng: det() });
  assert.match(result.error, /phase/i);
});
