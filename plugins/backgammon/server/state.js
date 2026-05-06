import { initialPoints } from './board.js';
import { PHASE } from './constants.js';

export function buildInitialState({ participants, options }) {
  if (!Array.isArray(participants) || participants.length !== 2) {
    throw new Error('backgammon requires exactly 2 participants');
  }
  const pA = participants.find(p => p?.side === 'a');
  const pB = participants.find(p => p?.side === 'b');
  if (!pA) throw new Error("backgammon: missing side 'a' participant");
  if (!pB) throw new Error("backgammon: missing side 'b' participant");
  if (pA.userId === undefined || pB.userId === undefined) {
    throw new Error('backgammon: participant missing userId');
  }
  if (pA.userId === pB.userId) {
    throw new Error('backgammon: participants must have distinct userIds');
  }
  const a = pA.userId;
  const b = pB.userId;
  const target = Number.isInteger(options?.matchLength) && options.matchLength > 0
    ? options.matchLength
    : 3;

  return {
    sides: { a, b },
    match: {
      target,
      scoreA: 0,
      scoreB: 0,
      gameNumber: 1,
      crawford: false,
      crawfordPlayed: false,
    },
    cube: { value: 1, owner: null, pendingOffer: null },
    board: {
      points: initialPoints(),
      barA: 0, barB: 0,
      bornOffA: 0, bornOffB: 0,
    },
    turn: {
      activePlayer: null,
      phase: PHASE.INITIAL_ROLL,
      dice: null,
    },
    legHistory: [],
    initialRoll: { a: null, b: null, throwParamsA: null, throwParamsB: null },
  };
}
