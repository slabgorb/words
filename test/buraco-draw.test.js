import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/buraco/server/state.js';
import { applyDraw } from '../plugins/buraco/server/phases/draw.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('draw from stock moves one card to current player\'s hand and sets phase=meld', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  const r = applyDraw(s0, { source: 'stock' }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.hands.a.length, 12);
  assert.equal(r.state.stock.length, s0.stock.length - 1);
  assert.equal(r.state.phase, 'meld');
  assert.equal(r.state.hasDrawn, true);
});

test('draw from discard moves ALL discard cards to current player\'s hand', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  // Synthetically pad the discard pile to 4 for the test
  const padded = { ...s0, discard: [s0.discard[0], ...s0.stock.slice(0, 3)] };
  const r = applyDraw(padded, { source: 'discard' }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.hands.a.length, 11 + 4);
  assert.equal(r.state.discard.length, 0);
  assert.equal(r.state.phase, 'meld');
  assert.equal(r.state.hasDrawn, true);
});

test('draw rejected when hasDrawn already true', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  const after = applyDraw(s0, { source: 'stock' }, 'a').state;
  const r = applyDraw(after, { source: 'stock' }, 'a');
  assert.match(r.error, /already drawn|not in draw phase/i);
});

test('draw from empty discard rejected', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  const empty = { ...s0, discard: [] };
  const r = applyDraw(empty, { source: 'discard' }, 'a');
  assert.match(r.error, /discard.*empty/i);
});

test('unknown draw source rejected', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  const r = applyDraw(s0, { source: 'morto' }, 'a');
  assert.match(r.error, /source/i);
});
