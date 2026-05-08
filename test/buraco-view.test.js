import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buracoPublicView } from '../plugins/buraco/server/view.js';
import { buildInitialState } from '../plugins/buraco/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det() { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('publicView for side a: opp hand → count, my hand → cards', () => {
  const s = buildInitialState({ participants, rng: det() });
  const v = buracoPublicView({ state: s, viewerId: 1 });
  assert.ok(Array.isArray(v.hands.a));
  assert.equal(v.hands.a.length, 11);
  assert.equal(typeof v.hands.b, 'number');
  assert.equal(v.hands.b, 11);
});

test('publicView: stock → count, mortos → counts', () => {
  const s = buildInitialState({ participants, rng: det() });
  const v = buracoPublicView({ state: s, viewerId: 1 });
  assert.equal(typeof v.stock, 'number');
  assert.equal(v.stock, 63);
  assert.equal(typeof v.mortos.a, 'number');
  assert.equal(typeof v.mortos.b, 'number');
});

test('publicView: discard, melds, scores, phase, currentTurn fully visible', () => {
  const s = buildInitialState({ participants, rng: det() });
  const v = buracoPublicView({ state: s, viewerId: 1 });
  assert.deepEqual(v.discard, s.discard);
  assert.deepEqual(v.melds, s.melds);
  assert.deepEqual(v.scores, s.scores);
  assert.equal(v.phase, s.phase);
  assert.equal(v.currentTurn, s.currentTurn);
});

test('publicView for non-participant viewer: both hands → counts', () => {
  const s = buildInitialState({ participants, rng: det() });
  const v = buracoPublicView({ state: s, viewerId: 999 });
  assert.equal(typeof v.hands.a, 'number');
  assert.equal(typeof v.hands.b, 'number');
});
