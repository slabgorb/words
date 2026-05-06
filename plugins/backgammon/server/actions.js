import { PHASE, opponent } from './constants.js';
import { enumerateLegalMoves, legalFirstMoves } from './validate.js';
import { applyMove, enterFromBar, bearOff } from './board.js';
import { classifyLegEnd, resolveLeg, isMatchOver } from './match.js';
import { canOffer, applyOffer, applyAccept, applyDecline } from './cube.js';

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
    case 'move':         return doMove(state, action.payload, side);
    case 'offer-double':   return doOfferDouble(state, side);
    case 'accept-double':  return doAcceptDouble(state, side);
    case 'decline-double': return doDeclineDouble(state, side);
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

function applyOnePly(board, player, m) {
  if (m.from === 'bar') return enterFromBar(board, player, m.to);
  if (m.to === 'off')   return bearOff(board, player, m.from);
  return applyMove(board, player, m.from, m.to);
}

function removeOneDie(remaining, die) {
  const idx = remaining.indexOf(die);
  if (idx < 0) return remaining.slice();
  return [...remaining.slice(0, idx), ...remaining.slice(idx + 1)];
}

function bornOffWinner(board) {
  if (board.bornOffA === 15) return 'a';
  if (board.bornOffB === 15) return 'b';
  return null;
}

function doMove(state, payload, side) {
  if (state.turn.phase !== PHASE.MOVING) {
    return { error: `cannot move in phase: ${state.turn.phase}` };
  }
  if (!isActive(state, side)) return { error: 'not your turn' };
  const from = payload?.from;
  const to = payload?.to;
  if (from === undefined || to === undefined) return { error: 'move requires {from, to}' };

  const candidates = legalFirstMoves(state.board, state.turn.dice.remaining, side);
  const chosen = candidates.find(m => m.from === from && m.to === to);
  if (!chosen) return { error: 'move is not legal under current dice' };

  const nextBoard = applyOnePly(state.board, side, chosen);
  const nextRemaining = removeOneDie(state.turn.dice.remaining, chosen.die);

  // Leg end?
  const winner = bornOffWinner(nextBoard);
  if (winner) {
    const klass = classifyLegEnd(nextBoard, winner);
    return endLegAndMaybeMatch({
      state: { ...state, board: nextBoard,
               turn: { ...state.turn, dice: { ...state.turn.dice, remaining: nextRemaining } } },
      winner,
      type: klass.type,
      multiplier: klass.multiplier,
      cubeValue: state.cube.value,
    });
  }

  const next = {
    ...state,
    board: nextBoard,
    turn: {
      ...state.turn,
      dice: { ...state.turn.dice, remaining: nextRemaining },
    },
  };

  // Auto-pass if remaining empty OR no further legal moves
  if (nextRemaining.length === 0 ||
      legalFirstMoves(next.board, nextRemaining, side).length === 0) {
    return doPassTurn(next, side);
  }

  return { state: next, ended: false, summary: { kind: 'move' } };
}

function doOfferDouble(state, side) {
  if (state.turn.phase !== PHASE.PRE_ROLL) {
    return { error: `cannot offer-double in phase: ${state.turn.phase}` };
  }
  if (!isActive(state, side)) return { error: 'not your turn' };
  if (!canOffer({ cube: state.cube, match: state.match }, side)) {
    return { error: 'cannot offer double now' };
  }
  return {
    state: {
      ...state,
      cube: applyOffer(state.cube, side),
      turn: { ...state.turn, phase: PHASE.AWAITING_DOUBLE_RESPONSE },
    },
    ended: false,
    summary: { kind: 'offer-double' },
  };
}

function doAcceptDouble(state, side) {
  if (state.turn.phase !== PHASE.AWAITING_DOUBLE_RESPONSE) {
    return { error: `cannot accept-double in phase: ${state.turn.phase}` };
  }
  if (state.cube.pendingOffer === null || state.cube.pendingOffer.from === side) {
    return { error: 'only opponent of offerer can accept' };
  }
  return {
    state: {
      ...state,
      cube: applyAccept(state.cube, side),
      turn: { ...state.turn, phase: PHASE.PRE_ROLL },
    },
    ended: false,
    summary: { kind: 'accept-double' },
  };
}

function doDeclineDouble(state, side) {
  if (state.turn.phase !== PHASE.AWAITING_DOUBLE_RESPONSE) {
    return { error: `cannot decline-double in phase: ${state.turn.phase}` };
  }
  if (state.cube.pendingOffer === null || state.cube.pendingOffer.from === side) {
    return { error: 'only opponent of offerer can decline' };
  }
  const { awardedToOfferer, offerer } = applyDecline(state.cube);
  return endLegAndMaybeMatch({
    state,
    winner: offerer,
    type: 'single',
    multiplier: 1,
    cubeValue: awardedToOfferer,
  });
}

function endLegAndMaybeMatch({ state, winner, type, multiplier, cubeValue }) {
  const nextState = resolveLeg({ state, winner, type, multiplier, cubeValue });
  const matchWinner = isMatchOver(nextState.match);
  if (matchWinner) {
    const winnerUserId = nextState.sides[matchWinner];
    return {
      state: nextState,
      ended: true,
      scoreDelta: { [winnerUserId]: nextState.match.target },
      summary: { kind: 'match-end', winner: matchWinner, type },
    };
  }
  return { state: nextState, ended: false, summary: { kind: 'leg-end', winner, type } };
}
