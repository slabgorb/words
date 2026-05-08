import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/buraco/server/state.js';
import { applyBuracoAction } from '../plugins/buraco/server/actions.js';
import { assertCardConservation } from '../plugins/buraco/server/validate-turn.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];

test('full deal: each turn keeps card-conservation invariant', () => {
  let state = buildInitialState({ participants, rng: deterministicRng(7) });
  assertCardConservation(state);

  for (let i = 0; i < 100; i++) {
    if (state.phase === 'deal-end' || state.phase === 'game-end') break;

    const actor = state.currentTurn === 'a' ? 1 : 2;

    const dealBefore = state.dealNumber;
    const r1 = applyBuracoAction({
      state,
      action: { type: 'draw', payload: { source: 'stock' } },
      actorId: actor,
      rng: deterministicRng(i + 1),
    });
    if (r1.error) {
      assert.fail(`draw error at turn ${i}: ${r1.error}`);
    }
    state = r1.state;
    assertCardConservation(state);
    // Stock-exhaustion mid-turn rolled into a new deal or game-end. Stop here.
    if (state.dealNumber !== dealBefore || state.phase === 'game-end') break;

    const card = state.hands[state.currentTurn][0];
    const r2 = applyBuracoAction({
      state,
      action: { type: 'discard', payload: { card } },
      actorId: actor,
      rng: deterministicRng(i + 2),
    });
    if (r2.error) {
      assert.fail(`discard error at turn ${i}: ${r2.error}`);
    }
    state = r2.state;
    assertCardConservation(state);
  }
});

function deterministicRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
