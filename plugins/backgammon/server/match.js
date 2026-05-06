import { HOME_INDICES, opponent, PHASE } from './constants.js';
import { initialPoints } from './board.js';

function freshTurn() {
  return { activePlayer: null, phase: PHASE.INITIAL_ROLL, dice: null };
}

function freshBoard() {
  return {
    points: initialPoints(),
    barA: 0, barB: 0,
    bornOffA: 0, bornOffB: 0,
  };
}

function freshCube() {
  return { value: 1, owner: null, pendingOffer: null };
}

export function resolveLeg({ state, winner, type, multiplier, cubeValue }) {
  const points = cubeValue * multiplier;

  // Score
  const scoreA = state.match.scoreA + (winner === 'a' ? points : 0);
  const scoreB = state.match.scoreB + (winner === 'b' ? points : 0);

  // Crawford transition. The just-completed leg may BE the Crawford leg
  // (state.match.crawford === true) → crawfordPlayed flips true.
  // Or this leg may TRIGGER Crawford (a player hit target-1, Crawford not yet
  // played, target > 1).
  let crawford = false;
  let crawfordPlayed = state.match.crawfordPlayed;
  if (state.match.crawford) {
    crawford = false;
    crawfordPlayed = true;
  } else if (state.match.target > 1 && !crawfordPlayed) {
    if (scoreA === state.match.target - 1 || scoreB === state.match.target - 1) {
      crawford = true;
    }
  }

  // History entry
  const entry = {
    gameNumber: state.match.gameNumber,
    winner,
    points,
    type,
    cube: cubeValue,
  };

  return {
    ...state,
    match: {
      ...state.match,
      scoreA,
      scoreB,
      gameNumber: state.match.gameNumber + 1,
      crawford,
      crawfordPlayed,
    },
    cube: freshCube(),
    board: freshBoard(),
    turn: freshTurn(),
    initialRoll: { a: null, b: null, throwParamsA: null, throwParamsB: null },
    legHistory: [...state.legHistory, entry],
  };
}

export function classifyLegEnd(board, winner) {
  const loser = opponent(winner);
  const loserBornOff = loser === 'a' ? board.bornOffA : board.bornOffB;
  if (loserBornOff > 0) return { type: 'single', multiplier: 1 };

  // Gammon vs Backgammon: backgammon if loser has any checker in winners home or on bar.
  const loserBar = loser === 'a' ? board.barA : board.barB;
  const winnerHome = HOME_INDICES[winner];
  const inWinnerHome = winnerHome.some(idx =>
    board.points[idx].color === loser && board.points[idx].count > 0
  );
  if (loserBar > 0 || inWinnerHome) return { type: 'backgammon', multiplier: 3 };
  return { type: 'gammon', multiplier: 2 };
}
