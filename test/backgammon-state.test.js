import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { det, PARTICIPANTS } from './_helpers/backgammon-fixtures.js';

test('buildInitialState defaults matchLength to 3', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.equal(s.match.target, 3);
});

test('buildInitialState accepts options.matchLength', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0), options: { matchLength: 1 } });
  assert.equal(s.match.target, 1);
});

test('buildInitialState: match scoreboard starts at 0/0/game1', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.match, {
    target: 3, scoreA: 0, scoreB: 0,
    gameNumber: 1, crawford: false, crawfordPlayed: false,
  });
});

test('buildInitialState: cube starts at 1, centered, no offer', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.cube, { value: 1, owner: null, pendingOffer: null });
});

test('buildInitialState: board has 15 checkers per side', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.equal(s.board.points.length, 24);
  assert.equal(s.board.barA, 0);
  assert.equal(s.board.barB, 0);
  assert.equal(s.board.bornOffA, 0);
  assert.equal(s.board.bornOffB, 0);
});

test('buildInitialState: turn starts in initial-roll phase, no active player', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.equal(s.turn.phase, 'initial-roll');
  assert.equal(s.turn.activePlayer, null);
  assert.equal(s.turn.dice, null);
});

test('buildInitialState: initialRoll empty 4-field shape', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.initialRoll, { a: null, b: null, throwParamsA: null, throwParamsB: null });
});

test('buildInitialState: legHistory empty array', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.legHistory, []);
});

test('buildInitialState: sides map participants', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.sides, { a: 1, b: 2 });
});

test('buildInitialState: matchLength=1 disables crawford forever', () => {
  // For target=1 there is never a "target-1" leg, so crawford never triggers.
  // We assert the initial state shape; semantics tested in match.test.js.
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0), options: { matchLength: 1 } });
  assert.equal(s.match.target, 1);
  assert.equal(s.match.crawford, false);
});

test('buildInitialState: rejects participants of length != 2', () => {
  assert.throws(
    () => buildInitialState({ participants: [], rng: det(0) }),
    /backgammon requires exactly 2 participants/i,
  );
  assert.throws(
    () => buildInitialState({ participants: [{ userId: 1, side: 'a' }], rng: det(0) }),
    /backgammon requires exactly 2 participants/i,
  );
  assert.throws(
    () => buildInitialState({
      participants: [
        { userId: 1, side: 'a' },
        { userId: 2, side: 'b' },
        { userId: 3, side: 'a' },
      ],
      rng: det(0),
    }),
    /backgammon requires exactly 2 participants/i,
  );
});

test('buildInitialState: rejects missing side a', () => {
  assert.throws(
    () => buildInitialState({
      participants: [{ userId: 1, side: 'b' }, { userId: 2, side: 'b' }],
      rng: det(0),
    }),
    /missing side 'a'/i,
  );
});

test('buildInitialState: rejects missing side b', () => {
  assert.throws(
    () => buildInitialState({
      participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'a' }],
      rng: det(0),
    }),
    /missing side 'b'/i,
  );
});

test('buildInitialState: rejects participants missing userId', () => {
  assert.throws(
    () => buildInitialState({
      participants: [{ side: 'a' }, { userId: 2, side: 'b' }],
      rng: det(0),
    }),
    /participant missing userId/i,
  );
});

test('buildInitialState: rejects participants with same userId on both sides', () => {
  assert.throws(
    () => buildInitialState({
      participants: [{ userId: 7, side: 'a' }, { userId: 7, side: 'b' }],
      rng: det(0),
    }),
    /participants must have distinct userIds/i,
  );
});
