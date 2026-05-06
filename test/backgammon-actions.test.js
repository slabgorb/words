import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBackgammonAction } from '../plugins/backgammon/server/actions.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { PARTICIPANTS, det, stateAfterInitialRoll, statePreRoll } from './_helpers/backgammon-fixtures.js';
import { resolveLeg } from '../plugins/backgammon/server/match.js';

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

test('move: applies valid move, removes consumed die', () => {
  const s = stateAfterInitialRoll({ winner: 'a', hi: 5, lo: 3 });
  // A has checker at index 0 (count 2). die=3 → 0→3.
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 0, to: 3 } },
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.state.turn.dice.remaining, [5]);
  assert.equal(result.state.board.points[0].count, 1);
  assert.equal(result.state.board.points[3].color, 'a');
});

test('move: rejects illegal move', () => {
  const s = stateAfterInitialRoll({ winner: 'a', hi: 5, lo: 3 });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 0, to: 7 } },  // die would be 7, not in remaining
  });
  assert.match(result.error, /legal/i);
});

test('move: rejects when phase is not moving', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 0, to: 3 } },
  });
  assert.match(result.error, /phase/i);
});

test('move: rejects from opponent', () => {
  const s = stateAfterInitialRoll({ winner: 'a', hi: 5, lo: 3 });
  const result = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'move', payload: { from: 0, to: 3 } },
  });
  assert.match(result.error, /not your turn/i);
});

test('move: auto-passes when remaining empties', () => {
  const s = stateAfterInitialRoll({ winner: 'a', hi: 5, lo: 3 });
  const r1 = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 0, to: 3 } },
  });
  const r2 = applyBackgammonAction({
    state: r1.state, actorId: 1,
    action: { type: 'move', payload: { from: 11, to: 16 } },  // die=5
  });
  assert.equal(r2.state.turn.phase, 'pre-roll');
  assert.equal(r2.state.turn.activePlayer, 'b');
  assert.equal(r2.state.turn.dice, null);
});

test('move: leg ends when 15th checker borne off', () => {
  // Set up an A turn with all 14 checkers borne off, last on index 23 (1-point).
  // die=1 bears off exactly.
  const base = stateAfterInitialRoll({ winner: 'a', hi: 2, lo: 1 });
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  points[23] = { color: 'a', count: 1 };
  // B is still mid-game; still has 15 checkers somewhere
  points[10] = { color: 'b', count: 15 };
  const s = {
    ...base,
    board: { points, barA: 0, barB: 0, bornOffA: 14, bornOffB: 0 },
  };
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 23, to: 'off' } },
  });
  assert.equal(result.error, undefined);
  // Leg classified as gammon (B has 0 borne off, no checkers in A home).
  // Score updated, board reset, gameNumber incremented.
  assert.equal(result.state.match.scoreA, 2);  // gammon × cube=1
  assert.equal(result.state.match.gameNumber, 2);
  assert.equal(result.state.turn.phase, 'initial-roll');
  // Match continues (target 3, scoreA 2): ended=false (still need 1 more).
  assert.equal(result.ended, false);
});

test('move: leg ends → match ends when target reached', () => {
  // target=1 — first leg completes ends match.
  let s = buildInitialState({
    participants: PARTICIPANTS, rng: det(), options: { matchLength: 1 },
  });
  // Hand-craft: A on index 23 with one checker, 14 borne off.
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  points[23] = { color: 'a', count: 1 };
  points[10] = { color: 'b', count: 15 };
  s = {
    ...s,
    board: { points, barA: 0, barB: 0, bornOffA: 14, bornOffB: 0 },
    turn: {
      activePlayer: 'a',
      phase: 'moving',
      dice: { values: [1, 2], remaining: [1, 2], throwParams: [] },
    },
  };
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 23, to: 'off' } },
  });
  assert.equal(result.ended, true);
  assert.deepEqual(result.scoreDelta, { 1: 1 });  // userId 1 (=side 'a') wins target=1 points
});

test('pass-turn: explicit call by active player switches sides', () => {
  const s = stateAfterInitialRoll({ winner: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'pass-turn', payload: {} },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.turn.activePlayer, 'b');
  assert.equal(result.state.turn.phase, 'pre-roll');
  assert.equal(result.state.turn.dice, null);
});

test('pass-turn: rejects from non-active player', () => {
  const s = stateAfterInitialRoll({ winner: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'pass-turn', payload: {} },
  });
  assert.match(result.error, /not your turn/i);
});
