import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBackgammonAction } from '../plugins/backgammon/server/actions.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { PARTICIPANTS, det, stateAfterInitialRoll, statePreRoll } from './_helpers/backgammon-fixtures.js';

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

test('roll: rejects when phase is not pre-roll', () => {
  // After initial-roll resolves, phase is 'moving', not 'pre-roll'.
  const s = stateAfterInitialRoll({ winner: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [3, 4], throwParams: [] } },
  });
  assert.match(result.error, /phase/i);
});

test('roll: accepts at pre-roll and primes turn.dice.remaining', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [5, 3], throwParams: ['p'] } },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.turn.phase, 'moving');
  assert.deepEqual(result.state.turn.dice.values, [5, 3]);
  assert.deepEqual(result.state.turn.dice.remaining, [5, 3]);
});

test('roll: doubles primes 4-entry remaining', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [3, 3], throwParams: ['p'] } },
  });
  assert.deepEqual(result.state.turn.dice.remaining, [3, 3, 3, 3]);
});

test('roll: rejects from non-active player', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 2,  // B is not active
    action: { type: 'roll', payload: { values: [3, 4], throwParams: [] } },
  });
  assert.match(result.error, /not your turn/i);
});

test('roll: rejects malformed values', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [7, 0], throwParams: [] } },
  });
  assert.match(result.error, /values/i);
});

test('roll: auto-passes turn when no legal moves', () => {
  // Construct: A on bar, all 6 entry points blocked.
  const base = statePreRoll({ activePlayer: 'a' });
  const points = base.board.points.map(p => ({ ...p }));
  for (let i = 0; i < 6; i++) points[i] = { color: 'b', count: 2 };
  const s = {
    ...base,
    board: { ...base.board, points, barA: 1 },
  };
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [3, 5], throwParams: [] } },
  });
  // Expect: phase advanced through moving and back to pre-roll for B.
  assert.equal(result.state.turn.phase, 'pre-roll');
  assert.equal(result.state.turn.activePlayer, 'b');
  assert.equal(result.state.turn.dice, null);
});
