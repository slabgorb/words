import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCardConservation } from '../plugins/buraco/server/validate-turn.js';
import { buildInitialState } from '../plugins/buraco/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det() { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('initial state has 108 unique card ids', () => {
  const s = buildInitialState({ participants, rng: det() });
  assertCardConservation(s);
});

test('throws when a card is duplicated', () => {
  const s = buildInitialState({ participants, rng: det() });
  s.hands.a.push(s.hands.b[0]);
  assert.throws(() => assertCardConservation(s), /duplicate|108/);
});

test('throws when a card is missing', () => {
  const s = buildInitialState({ participants, rng: det() });
  s.hands.a.pop();
  assert.throws(() => assertCardConservation(s), /108/);
});
