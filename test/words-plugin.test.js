import { test } from 'node:test';
import assert from 'node:assert/strict';
import wordsPlugin from '../plugins/words/plugin.js';

const participants = [
  { userId: 1, side: 'a' },
  { userId: 2, side: 'b' },
];
const rng = () => 0.5;

test('manifest fields', () => {
  assert.equal(wordsPlugin.id, 'words');
  assert.equal(wordsPlugin.displayName, 'Words');
  assert.equal(wordsPlugin.players, 2);
  assert.match(wordsPlugin.clientDir, /plugins\/words\/client/);
  assert.equal(typeof wordsPlugin.initialState, 'function');
  assert.equal(typeof wordsPlugin.applyAction, 'function');
  assert.equal(typeof wordsPlugin.publicView, 'function');
  assert.equal(wordsPlugin.auxRoutes?.validate?.method, 'POST');
});

test('initialState produces 2 racks of 7 tiles, empty board, full bag minus 14', () => {
  const state = wordsPlugin.initialState({ participants, rng });
  assert.equal(state.racks.a.length, 7);
  assert.equal(state.racks.b.length, 7);
  assert.equal(state.bag.length, 90); // 104-tile WwF bag minus 14 dealt tiles
  assert.equal(state.board.flat().filter(Boolean).length, 0);
  assert.equal(state.scores.a, 0);
  assert.equal(state.scores.b, 0);
  assert.ok(state.activeUserId === 1 || state.activeUserId === 2);
  assert.equal(state.initialMoveDone, false);
  assert.equal(state.consecutiveScorelessTurns, 0);
});

test('applyAction(pass) advances turn and increments scoreless counter', () => {
  let state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const result = wordsPlugin.applyAction({ state, action: { type: 'pass', payload: {} }, actorId: 1, rng });
  assert.equal(result.error, undefined);
  assert.equal(result.state.activeUserId, 2);
  assert.equal(result.state.consecutiveScorelessTurns, 1);
});

test('applyAction(resign) ends game with opponent as winner', () => {
  const state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const result = wordsPlugin.applyAction({ state, action: { type: 'resign', payload: {} }, actorId: 1, rng });
  assert.equal(result.ended, true);
  assert.equal(result.state.endedReason, 'resign');
  assert.equal(result.state.winnerSide, 'b');
});

test('applyAction(unknown) returns error', () => {
  const state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const result = wordsPlugin.applyAction({ state, action: { type: 'frobnicate', payload: {} }, actorId: 1, rng });
  assert.match(result.error, /unknown action/i);
});

test('publicView hides opponent rack but keeps count', () => {
  const state = wordsPlugin.initialState({ participants, rng });
  const view = wordsPlugin.publicView({ state, viewerId: 1 });
  assert.equal(view.racks.a.length, 7);
  assert.deepEqual(Object.keys(view.opponentRack), ['count']);
  assert.equal(view.opponentRack.count, 7);
  assert.equal(view.racks.b, undefined);
});
