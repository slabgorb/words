import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateLegalMoves } from '../plugins/backgammon/server/ai/legal-moves.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';

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

function diceObj(values) {
  return { values: values.slice(), remaining: values.slice(), throwParams: [] };
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

function startedState(over) {
  const base = buildInitialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng: () => 0.5,
  });
  base.turn.phase = 'moving';
  base.turn.activePlayer = 'a';
  base.turn.dice = diceObj([5, 3]);
  base.activeUserId = 1;
  return { ...base, ...over };
}

test('legal-moves moving: produces sequence entries with seq: ids', () => {
  const s = startedState({});
  const moves = enumerateLegalMoves(s, 0);
  assert.ok(moves.length > 0, 'should have at least one legal sequence');
  for (const m of moves) {
    assert.match(m.id, /^seq:\d+$/, `unexpected id ${m.id}`);
    assert.equal(m.action.type, 'move', `action should be a move; got ${m.action.type}`);
    assert.ok(m.action.payload && typeof m.action.payload === 'object', 'move has payload');
    assert.ok(Array.isArray(m.sequenceTail), `sequenceTail array on ${m.id}`);
  }
});

test('legal-moves moving: each sequence consumes max possible dice', () => {
  const s = startedState({});
  const moves = enumerateLegalMoves(s, 0);
  // From the standard 5-3 opening, both dice are always playable, so every
  // sequence must use both — exactly 1 tail move per sequence.
  for (const m of moves) {
    assert.equal(m.sequenceTail.length, 1,
      `with both dice playable, tail should have exactly 1 move; got ${m.sequenceTail.length} for ${m.id}`);
  }
});

test('legal-moves moving: returns pass-turn when no legal move exists', () => {
  // Construct a contrived state: bot on the bar with all opponent home points blocked.
  const board = {
    points: Array.from({ length: 24 }, () => ({ color: null, count: 0 })),
    barA: 1, barB: 0, bornOffA: 0, bornOffB: 0,
  };
  // Block all of A's entry points (0..5) with 2+ B checkers each.
  for (let i = 0; i < 6; i++) board.points[i] = { color: 'b', count: 2 };
  const s = startedState({ board, turn: { activePlayer: 'a', phase: 'moving', dice: diceObj([1, 2]) } });
  const moves = enumerateLegalMoves(s, 0);
  assert.deepEqual(moves.map(m => m.id), ['pass-turn']);
  assert.deepEqual(moves[0].action, { type: 'pass-turn' });
});

test('legal-moves moving: doubles produce sequences of 4 moves', () => {
  const s = startedState({ turn: { activePlayer: 'a', phase: 'moving', dice: diceObj([2, 2, 2, 2]) } });
  const moves = enumerateLegalMoves(s, 0);
  // From the opening with 2-2-2-2, full consumption is always achievable.
  for (const m of moves) {
    assert.equal(m.sequenceTail.length, 3, `4 dice → 1 head + 3 tail; got ${m.sequenceTail.length}`);
  }
});
