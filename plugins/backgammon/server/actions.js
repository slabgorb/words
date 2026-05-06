import { PHASE, opponent } from './constants.js';
import { enumerateLegalMoves } from './validate.js';

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
    case 'roll':         return doRoll(state, action.payload, side);
    case 'pass-turn':    return doPassTurn(state, side);
    default: return { error: `unknown action: ${action.type}` };
  }
}

function isActive(state, side) {
  return state.turn.activePlayer === side;
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

function doRoll(state, payload, side) {
  if (state.turn.phase !== PHASE.PRE_ROLL) {
    return { error: `cannot roll in phase: ${state.turn.phase}` };
  }
  if (!isActive(state, side)) return { error: 'not your turn' };
  const values = payload?.values;
  const throwParams = payload?.throwParams;
  if (!Array.isArray(values) || values.length !== 2 ||
      !values.every(v => Number.isInteger(v) && v >= 1 && v <= 6)) {
    return { error: 'roll values must be two integers 1..6' };
  }
  if (!Array.isArray(throwParams)) return { error: 'roll requires throwParams array' };

  const remaining = values[0] === values[1] ? [values[0], values[0], values[0], values[0]] : values.slice();
  const dice = { values: values.slice(), remaining, throwParams };

  const afterRoll = {
    ...state,
    turn: { ...state.turn, phase: PHASE.MOVING, dice },
  };

  // Auto-pass if no legal moves
  const moves = enumerateLegalMoves(afterRoll.board, remaining, side);
  if (moves.length === 0) {
    return doPassTurn(afterRoll, side);
  }
  return { state: afterRoll, ended: false, summary: { kind: 'roll', values: values.slice() } };
}

function doPassTurn(state, side) {
  if (state.turn.phase !== PHASE.MOVING) {
    return { error: `cannot pass-turn in phase: ${state.turn.phase}` };
  }
  if (!isActive(state, side)) return { error: 'not your turn' };
  return {
    state: {
      ...state,
      turn: {
        activePlayer: opponent(side),
        phase: PHASE.PRE_ROLL,
        dice: null,
      },
    },
    ended: false,
    summary: { kind: 'pass-turn' },
  };
}
