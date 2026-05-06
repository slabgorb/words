import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLegEnd, resolveLeg, isMatchOver } from '../plugins/backgammon/server/match.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { PARTICIPANTS, det } from './_helpers/backgammon-fixtures.js';

function emptyBoard() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  return { points, barA: 0, barB: 0, bornOffA: 0, bornOffB: 0 };
}

test('classifyLegEnd: single — opponent has borne off ≥ 1', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.bornOffB = 5;
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'single', multiplier: 1 });
});

test('classifyLegEnd: gammon — opponent has 0 borne off, none in winners home/bar', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.points[10] = { color: 'b', count: 15 };  // outside A's home, not on bar
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'gammon', multiplier: 2 });
});

test('classifyLegEnd: backgammon — opponent has 0 borne off + checker in winners home', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.points[20] = { color: 'b', count: 1 };  // in A's home (indices 18..23)
  b.points[10] = { color: 'b', count: 14 };
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'backgammon', multiplier: 3 });
});

test('classifyLegEnd: backgammon — opponent on bar', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.barB = 1;
  b.points[10] = { color: 'b', count: 14 };
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'backgammon', multiplier: 3 });
});

test('classifyLegEnd: B winner mirrored', () => {
  const b = emptyBoard();
  b.bornOffB = 15;
  b.points[3] = { color: 'a', count: 1 };  // in B home (indices 0..5)
  b.points[10] = { color: 'a', count: 14 };
  assert.deepEqual(classifyLegEnd(b, 'b'), { type: 'backgammon', multiplier: 3 });
});

test('resolveLeg: pushes legHistory entry with cubeValue × multiplier', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const next = resolveLeg({ state: s0, winner: 'a', type: 'gammon', multiplier: 2, cubeValue: 2 });
  assert.equal(next.legHistory.length, 1);
  assert.deepEqual(next.legHistory[0], {
    gameNumber: 1, winner: 'a', points: 4, type: 'gammon', cube: 2,
  });
});

test('resolveLeg: increments scoreA by cubeValue × multiplier', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const next = resolveLeg({ state: s0, winner: 'a', type: 'gammon', multiplier: 2, cubeValue: 2 });
  assert.equal(next.match.scoreA, 4);
  assert.equal(next.match.scoreB, 0);
});

test('resolveLeg: increments gameNumber, resets cube/board/turn/initialRoll', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  // Tweak some state so we can confirm reset
  const dirty = {
    ...s0,
    cube: { value: 8, owner: 'a', pendingOffer: null },
    turn: { activePlayer: 'a', phase: 'moving', dice: { values: [3,4], remaining: [3], throwParams: [] } },
    initialRoll: { a: 5, b: 3 },
  };
  const next = resolveLeg({ state: dirty, winner: 'a', type: 'single', multiplier: 1, cubeValue: 8 });
  assert.equal(next.match.gameNumber, 2);
  assert.deepEqual(next.cube, { value: 1, owner: null, pendingOffer: null });
  assert.equal(next.turn.activePlayer, null);
  assert.equal(next.turn.phase, 'initial-roll');
  assert.equal(next.turn.dice, null);
  assert.deepEqual(next.initialRoll, { a: null, b: null, throwParamsA: null, throwParamsB: null });
  // Board reset to standard initial layout — quick sanity check: A at index 0 has 2 checkers
  assert.deepEqual(next.board.points[0], { color: 'a', count: 2 });
  assert.equal(next.board.barA, 0);
  assert.equal(next.board.bornOffA, 0);
});

test('resolveLeg: triggers Crawford when winner reaches target - 1', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  // s0.match.target = 3, scoreA starts at 0.
  // After this single (1pt cube) leg, scoreA = 2 = target - 1. Crawford should trigger.
  const next = resolveLeg({ state: s0, winner: 'a', type: 'gammon', multiplier: 2, cubeValue: 1 });
  assert.equal(next.match.scoreA, 2);
  assert.equal(next.match.crawford, true);
  assert.equal(next.match.crawfordPlayed, false);
});

test('resolveLeg: completing Crawford leg flips crawford → crawfordPlayed', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const dirty = { ...s0, match: { ...s0.match, scoreA: 2, crawford: true } };
  // Loser wins this Crawford leg — scoreB++. crawford → false; crawfordPlayed → true.
  const next = resolveLeg({ state: dirty, winner: 'b', type: 'single', multiplier: 1, cubeValue: 1 });
  assert.equal(next.match.crawford, false);
  assert.equal(next.match.crawfordPlayed, true);
});

test('resolveLeg: target=1 never triggers Crawford', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det(), options: { matchLength: 1 } });
  const next = resolveLeg({ state: s0, winner: 'a', type: 'single', multiplier: 1, cubeValue: 1 });
  assert.equal(next.match.crawford, false);
  assert.equal(next.match.crawfordPlayed, false);
});

test('resolveLeg: leg type "resigned" persists in legHistory', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const next = resolveLeg({ state: s0, winner: 'a', type: 'resigned', multiplier: 1, cubeValue: 4 });
  assert.equal(next.legHistory[0].type, 'resigned');
  assert.equal(next.legHistory[0].points, 4);
});

test('isMatchOver: returns null when no one has reached target', () => {
  assert.equal(isMatchOver({ target: 3, scoreA: 2, scoreB: 1 }), null);
});

test('isMatchOver: returns "a" when scoreA >= target', () => {
  assert.equal(isMatchOver({ target: 3, scoreA: 3, scoreB: 1 }), 'a');
});

test('isMatchOver: returns "b" when scoreB >= target', () => {
  assert.equal(isMatchOver({ target: 3, scoreA: 1, scoreB: 4 }), 'b');
});

test('isMatchOver: target=1 ends match on first win', () => {
  assert.equal(isMatchOver({ target: 1, scoreA: 1, scoreB: 0 }), 'a');
});
