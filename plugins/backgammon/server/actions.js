import { PHASE, opponent } from './constants.js';

function actorSide(state, actorId) {
  if (state.sides.a === actorId) return 'a';
  if (state.sides.b === actorId) return 'b';
  return null;
}

export function applyBackgammonAction({ state, action, actorId }) {
  const side = actorSide(state, actorId);
  if (side === null) return { error: 'unknown participant' };

  switch (action.type) {
    case 'roll-initial': return doRollInitial(state, action.payload, side);
    default: return { error: `unknown action: ${action.type}` };
  }
}

function doRollInitial(state, payload, side) {
  if (state.turn.phase !== PHASE.INITIAL_ROLL) {
    return { error: `cannot roll-initial in phase: ${state.turn.phase}` };
  }
  if (state.initialRoll[side] !== null) {
    return { error: 'already rolled this leg' };
  }
  const value = payload?.value;
  const throwParams = payload?.throwParams;
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    return { error: 'roll-initial value must be 1..6' };
  }
  if (!Array.isArray(throwParams)) {
    return { error: 'roll-initial requires throwParams array' };
  }

  const tpKey = side === 'a' ? 'throwParamsA' : 'throwParamsB';
  const ir = { ...state.initialRoll, [side]: value, [tpKey]: throwParams };

  // Both rolled?
  if (ir.a !== null && ir.b !== null) {
    if (ir.a === ir.b) {
      // Tie: clear all four fields and reroll
      return {
        state: {
          ...state,
          initialRoll: { a: null, b: null, throwParamsA: null, throwParamsB: null },
        },
        ended: false,
        summary: { kind: 'roll-initial', tie: true },
      };
    }
    const winner = ir.a > ir.b ? 'a' : 'b';
    const loser = opponent(winner);
    const sortedValues = [ir[winner], ir[loser]];
    const winnerTp = winner === 'a' ? ir.throwParamsA : ir.throwParamsB;
    const loserTp  = loser  === 'a' ? ir.throwParamsA : ir.throwParamsB;
    return {
      state: {
        ...state,
        initialRoll: ir,  // keep the 4-field shape per spec §4.2
        turn: {
          activePlayer: winner,
          phase: PHASE.MOVING,
          dice: {
            values: sortedValues,
            remaining: sortedValues.slice(),
            throwParams: [...winnerTp, ...loserTp],
          },
        },
      },
      ended: false,
      summary: { kind: 'roll-initial', activePlayer: winner },
    };
  }

  // Only this side has rolled.
  return {
    state: { ...state, initialRoll: ir },
    ended: false,
    summary: { kind: 'roll-initial', side },
  };
}
