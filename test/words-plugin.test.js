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

test('applyAction(move) returns summary with words and scoreDelta', () => {
  // Build a state where 'a' has the word 'CAT' on rack and an empty board.
  let state = wordsPlugin.initialState({ participants, rng });
  // Force a deterministic rack and turn for the test.
  state.racks.a = ['C', 'A', 'T', 'X', 'Y', 'Z', 'Q'];
  state.activeUserId = 1;
  state.initialMoveDone = false;
  // First-move placement must cross the center (board size is 15; center 7,7).
  const placement = [
    { r: 7, c: 7, letter: 'C' },
    { r: 7, c: 8, letter: 'A' },
    { r: 7, c: 9, letter: 'T' },
  ];
  const result = wordsPlugin.applyAction({
    state, action: { type: 'move', payload: { placement } }, actorId: 1, rng,
  });
  assert.equal(result.error, undefined, `unexpected error: ${result.error}`);
  assert.ok(result.summary, 'summary should be present');
  assert.equal(result.summary.kind, 'play');
  assert.ok(Array.isArray(result.summary.words));
  assert.ok(result.summary.words.includes('CAT'));
  assert.equal(typeof result.summary.scoreDelta, 'number');
  assert.ok(result.summary.scoreDelta > 0);
});

test('applyAction(pass) returns summary { kind: pass }', () => {
  let state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const result = wordsPlugin.applyAction({ state, action: { type: 'pass', payload: {} }, actorId: 1, rng });
  assert.deepEqual(result.summary, { kind: 'pass' });
});

test('applyAction(swap) returns summary { kind: swap, count }', () => {
  let state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const tiles = state.racks.a.slice(0, 2);
  const result = wordsPlugin.applyAction({
    state, action: { type: 'swap', payload: { tiles } }, actorId: 1, rng,
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.summary, { kind: 'swap', count: 2 });
});

test('applyAction(resign) returns summary { kind: resign }', () => {
  let state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const result = wordsPlugin.applyAction({ state, action: { type: 'resign', payload: {} }, actorId: 1, rng });
  assert.deepEqual(result.summary, { kind: 'resign' });
});

test('initialState defaults to wwf variant with 90-tile bag remaining', () => {
  const state = wordsPlugin.initialState({ participants, rng });
  assert.equal(state.variant, 'wwf');
  assert.equal(state.bag.length, 90); // 104 - 14
});

test('initialState with variant: "scrabble" yields a scrabble bag and stores variant', () => {
  const state = wordsPlugin.initialState({ participants, rng, variant: 'scrabble' });
  assert.equal(state.variant, 'scrabble');
  assert.equal(state.bag.length, 86); // 100 - 14
});

test('publicView exposes the variant', () => {
  const state = wordsPlugin.initialState({ participants, rng, variant: 'scrabble' });
  const view = wordsPlugin.publicView({ state, viewerId: 1 });
  assert.equal(view.variant, 'scrabble');
});

