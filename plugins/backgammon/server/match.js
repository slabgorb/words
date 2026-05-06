import { HOME_INDICES, opponent } from './constants.js';

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
