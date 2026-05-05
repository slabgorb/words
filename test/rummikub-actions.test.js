import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRummikubAction } from '../plugins/rummikub/server/actions.js';

function det(seed = 0) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

const t = (id, color, value) => ({ id, kind: 'numbered', color, value });

function makeState() {
  return {
    pool: [t('p1', 'red', 8), t('p2', 'blue', 8), t('p3', 'orange', 8)],
    racks: {
      a: [t('r9', 'red', 9), t('r10', 'red', 10), t('r11', 'red', 11), t('extra', 'blue', 1)],
      b: [t('q1', 'blue', 5), t('q2', 'blue', 6), t('q3', 'blue', 7)],
    },
    table: [],
    initialMeldComplete: { a: false, b: false },
    sides: { a: 1, b: 2 },
    activeUserId: 1,
    scores: { a: 0, b: 0 },
    consecutiveDraws: 0,
    endedReason: null,
    winnerSide: null,
  };
}

test('commit-turn with valid initial meld advances state', () => {
  const state = makeState();
  const proposedEnd = {
    rack: [t('extra', 'blue', 1)],
    table: [[t('r9', 'red', 9), t('r10', 'red', 10), t('r11', 'red', 11)]],
  };
  const result = applyRummikubAction({
    state, action: { type: 'commit-turn', payload: proposedEnd }, actorId: 1, rng: det(1),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.activeUserId, 2);
  assert.equal(result.state.initialMeldComplete.a, true);
  assert.equal(result.state.racks.a.length, 1);
  assert.equal(result.state.table.length, 1);
});

test('commit-turn rejects invalid end-state', () => {
  const state = makeState();
  const proposedEnd = {
    rack: [],
    table: [[t('r9', 'red', 9)]],
  };
  const result = applyRummikubAction({
    state, action: { type: 'commit-turn', payload: proposedEnd }, actorId: 1, rng: det(1),
  });
  assert.match(result.error, /set/i);
});

test('commit-turn that empties rack triggers Rummikub! end-game', () => {
  const state = makeState();
  state.initialMeldComplete.a = true;
  state.racks.a = [t('r9', 'red', 9), t('r10', 'red', 10), t('r11', 'red', 11)];
  const proposedEnd = {
    rack: [],
    table: [[t('r9', 'red', 9), t('r10', 'red', 10), t('r11', 'red', 11)]],
  };
  const result = applyRummikubAction({
    state, action: { type: 'commit-turn', payload: proposedEnd }, actorId: 1, rng: det(1),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.ended, true);
  assert.equal(result.state.endedReason, 'rummikub');
  assert.equal(result.state.winnerSide, 'a');
});

test('draw-tile pulls from pool and ends turn', () => {
  const state = makeState();
  const result = applyRummikubAction({
    state, action: { type: 'draw-tile', payload: {} }, actorId: 1, rng: det(2),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.racks.a.length, 5);
  assert.equal(result.state.pool.length, 2);
  assert.equal(result.state.activeUserId, 2);
});

test('draw-tile when pool empty triggers end-game evaluation', () => {
  const state = makeState();
  state.pool = [];
  const result = applyRummikubAction({
    state, action: { type: 'draw-tile', payload: {} }, actorId: 1, rng: det(3),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.ended, true);
});

test('resign ends the game with opponent as winner', () => {
  const state = makeState();
  const result = applyRummikubAction({
    state, action: { type: 'resign', payload: {} }, actorId: 1, rng: det(4),
  });
  assert.equal(result.ended, true);
  assert.equal(result.state.endedReason, 'resign');
  assert.equal(result.state.winnerSide, 'b');
});

test('unknown action returns error', () => {
  const state = makeState();
  const result = applyRummikubAction({
    state, action: { type: 'frobnicate', payload: {} }, actorId: 1, rng: det(5),
  });
  assert.match(result.error, /unknown action/i);
});
