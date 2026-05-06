import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgammonPublicView } from '../plugins/backgammon/server/view.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { PARTICIPANTS, det } from './_helpers/backgammon-fixtures.js';

test('publicView: passes through full state', () => {
  const state = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const view = backgammonPublicView({ state, viewerId: 1 });
  assert.deepEqual(view.match, state.match);
  assert.deepEqual(view.cube, state.cube);
  assert.deepEqual(view.board, state.board);
  assert.deepEqual(view.turn, state.turn);
  assert.deepEqual(view.legHistory, state.legHistory);
  assert.deepEqual(view.initialRoll, state.initialRoll);
  assert.deepEqual(view.sides, state.sides);
});

test('publicView: youAre = "a" for participant 1', () => {
  const state = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const view = backgammonPublicView({ state, viewerId: 1 });
  assert.equal(view.youAre, 'a');
});

test('publicView: youAre = "b" for participant 2', () => {
  const state = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const view = backgammonPublicView({ state, viewerId: 2 });
  assert.equal(view.youAre, 'b');
});

test('publicView: youAre = null for non-participant', () => {
  const state = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const view = backgammonPublicView({ state, viewerId: 999 });
  assert.equal(view.youAre, null);
});
