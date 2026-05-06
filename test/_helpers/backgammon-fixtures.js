// Deterministic LCG used across all backgammon tests.
export function det(seed = 0) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export const PARTICIPANTS = [
  { userId: 1, side: 'a' },
  { userId: 2, side: 'b' },
];

import { applyBackgammonAction } from '../../plugins/backgammon/server/actions.js';
import { buildInitialState } from '../../plugins/backgammon/server/state.js';

// Build a state past the initial-roll phase, with `winner` as activePlayer
// and dice values [hi, lo].
export function stateAfterInitialRoll({ winner = 'a', hi = 5, lo = 3 } = {}) {
  let s = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  // First roll
  const firstSide = winner;
  const firstActorId = firstSide === 'a' ? 1 : 2;
  const firstValue = hi;
  s = applyBackgammonAction({
    state: s, actorId: firstActorId,
    action: { type: 'roll-initial', payload: { value: firstValue, throwParams: [] } },
  }).state;
  // Second roll
  const secondSide = winner === 'a' ? 'b' : 'a';
  const secondActorId = secondSide === 'a' ? 1 : 2;
  s = applyBackgammonAction({
    state: s, actorId: secondActorId,
    action: { type: 'roll-initial', payload: { value: lo, throwParams: [] } },
  }).state;
  // Now activePlayer === winner, phase === 'moving', dice = [hi, lo].
  return s;
}

// Build a state ready to roll (phase: pre-roll) for the given side.
export function statePreRoll({ activePlayer = 'a' } = {}) {
  // Start moving, then immediately call pass-turn to advance to pre-roll for the opponent.
  // For simplicity we just hand-craft the state.
  let s = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  return {
    ...s,
    turn: { activePlayer, phase: 'pre-roll', dice: null },
  };
}
