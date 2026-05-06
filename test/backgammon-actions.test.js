import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBackgammonAction } from '../plugins/backgammon/server/actions.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { PARTICIPANTS, det } from './_helpers/backgammon-fixtures.js';

function freshState() {
  return buildInitialState({ participants: PARTICIPANTS, rng: det() });
}

test('roll-initial: A rolls first, B not yet — phase stays initial-roll', () => {
  const state = freshState();
  const result = applyBackgammonAction({
    state, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 4, throwParams: ['p1'] } },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.initialRoll.a, 4);
  assert.equal(result.state.initialRoll.b, null);
  assert.equal(result.state.turn.phase, 'initial-roll');
  assert.equal(result.ended, false);
});

test('roll-initial: both roll, A higher — A becomes active, dice primed, phase moves', () => {
  let s = freshState();
  s = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: ['pA'] } },
  }).state;
  const result = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'roll-initial', payload: { value: 3, throwParams: ['pB'] } },
  });
  assert.equal(result.state.turn.activePlayer, 'a');
  assert.equal(result.state.turn.phase, 'moving');
  assert.deepEqual(result.state.turn.dice.values, [5, 3]);
  assert.deepEqual(result.state.turn.dice.remaining, [5, 3]);
  // ThrowParams preserved per side (active player's first, then opponent's)
  assert.equal(result.state.turn.dice.throwParams.length, 2);
});

test('roll-initial: tie — both cleared, phase still initial-roll', () => {
  let s = freshState();
  s = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 4, throwParams: ['pA'] } },
  }).state;
  const result = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'roll-initial', payload: { value: 4, throwParams: ['pB'] } },
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.state.initialRoll, { a: null, b: null, throwParamsA: null, throwParamsB: null });
  assert.equal(result.state.turn.phase, 'initial-roll');
});

test('roll-initial: rejects when actor has already rolled', () => {
  let s = freshState();
  s = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 4, throwParams: [] } },
  }).state;
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: [] } },
  });
  assert.match(result.error, /already rolled/i);
});

test('roll-initial: rejects when phase is not initial-roll', () => {
  let s = freshState();
  s = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: [] } },
  }).state;
  s = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'roll-initial', payload: { value: 3, throwParams: [] } },
  }).state;
  // Now phase is 'moving'
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 6, throwParams: [] } },
  });
  assert.match(result.error, /phase/i);
});

test('roll-initial: rejects unknown actorId', () => {
  const s = freshState();
  const result = applyBackgammonAction({
    state: s, actorId: 999,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: [] } },
  });
  assert.match(result.error, /participant/i);
});
