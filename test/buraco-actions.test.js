import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBuracoAction } from '../plugins/buraco/server/actions.js';
import { buildInitialState } from '../plugins/buraco/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('unknown action type → error', () => {
  const s = buildInitialState({ participants, rng: det() });
  const r = applyBuracoAction({ state: s, action: { type: 'nope' }, actorId: 1, rng: det() });
  assert.match(r.error, /unknown action/);
});

test('action by non-participant → error', () => {
  const s = buildInitialState({ participants, rng: det() });
  const r = applyBuracoAction({ state: s, action: { type: 'draw', payload: { source: 'stock' } }, actorId: 999, rng: det() });
  assert.match(r.error, /not a participant/i);
});

test('action by wrong side (not currentTurn) → error', () => {
  const s = buildInitialState({ participants, rng: det() });
  const r = applyBuracoAction({ state: s, action: { type: 'draw', payload: { source: 'stock' } }, actorId: 2, rng: det() });
  assert.match(r.error, /not your turn/i);
});

test('full flow: draw stock → discard returns ended:false', () => {
  const s = buildInitialState({ participants, rng: det() });
  const r1 = applyBuracoAction({ state: s, action: { type: 'draw', payload: { source: 'stock' } }, actorId: 1, rng: det() });
  assert.equal(r1.error, undefined);
  const cardToDiscard = r1.state.hands.a[0];
  const r2 = applyBuracoAction({ state: r1.state, action: { type: 'discard', payload: { card: cardToDiscard } }, actorId: 1, rng: det() });
  assert.equal(r2.error, undefined);
  assert.equal(r2.ended, false);
  assert.equal(r2.state.currentTurn, 'b');
});
