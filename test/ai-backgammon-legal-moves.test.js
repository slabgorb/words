import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateLegalMoves } from '../plugins/backgammon/server/ai/legal-moves.js';

function makeState(over) {
  return {
    sides: { a: 1, b: 2 },
    match: { target: 3, scoreA: 0, scoreB: 0, gameNumber: 1, crawford: false, crawfordPlayed: false },
    cube: { value: 1, owner: null, pendingOffer: null },
    board: emptyBoard(),
    turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] },
    legHistory: [],
    activeUserId: 1,
    ...over,
  };
}
function emptyBoard() {
  return {
    points: Array.from({ length: 24 }, () => ({ color: null, count: 0 })),
    barA: 0, barB: 0, bornOffA: 0, bornOffB: 0,
  };
}

test('legal-moves initial-roll: single roll-initial option', () => {
  const s = makeState({ turn: { activePlayer: 'a', phase: 'initial-roll', dice: [] } });
  const moves = enumerateLegalMoves(s, 0);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 'roll-initial');
  assert.deepEqual(moves[0].action, { type: 'roll-initial' });
});

test('legal-moves pre-roll: roll + offer-double when cube unowned', () => {
  const s = makeState({ turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] } });
  const moves = enumerateLegalMoves(s, 0);
  const ids = moves.map(m => m.id).sort();
  assert.deepEqual(ids, ['offer-double:2', 'roll']);
});

test('legal-moves pre-roll: no offer-double when opponent owns the cube', () => {
  const s = makeState({
    cube: { value: 2, owner: 'b', pendingOffer: null },
    turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] },
  });
  const moves = enumerateLegalMoves(s, 0);
  assert.deepEqual(moves.map(m => m.id), ['roll']);
});

test('legal-moves pre-roll: no offer-double during Crawford', () => {
  const s = makeState({
    match: { target: 3, scoreA: 2, scoreB: 0, gameNumber: 2, crawford: true, crawfordPlayed: false },
    turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] },
  });
  assert.deepEqual(enumerateLegalMoves(s, 0).map(m => m.id), ['roll']);
});

test('legal-moves pre-roll: no offer-double at cap (cube=64)', () => {
  const s = makeState({
    cube: { value: 64, owner: 'a', pendingOffer: null },
    turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] },
  });
  assert.deepEqual(enumerateLegalMoves(s, 0).map(m => m.id), ['roll']);
});

test('legal-moves awaiting-double-response: accept and decline', () => {
  const s = makeState({
    cube: { value: 1, owner: null, pendingOffer: { from: 'b' } },
    turn: { activePlayer: 'a', phase: 'awaiting-double-response', dice: [] },
  });
  const moves = enumerateLegalMoves(s, 0);
  const ids = moves.map(m => m.id).sort();
  assert.deepEqual(ids, ['accept-double', 'decline-double']);
});

test('legal-moves player B uses correct cube owner check', () => {
  const s = makeState({
    cube: { value: 2, owner: 'b', pendingOffer: null },
    turn: { activePlayer: 'b', phase: 'pre-roll', dice: [] },
  });
  // Bot is player B (idx 1); cube is owned by B so offer is allowed.
  const moves = enumerateLegalMoves(s, 1);
  assert.deepEqual(moves.map(m => m.id).sort(), ['offer-double:4', 'roll']);
});
