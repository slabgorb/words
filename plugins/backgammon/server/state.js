import { initialPoints } from './board.js';
import { PHASE } from './constants.js';

export function buildInitialState({ participants, options }) {
  const a = participants.find(p => p.side === 'a').userId;
  const b = participants.find(p => p.side === 'b').userId;
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
