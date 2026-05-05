import { tileValue } from './tiles.js';

export function computeFinalScores({ winnerSide, racks }) {
  let resolvedWinner = winnerSide;
  if (resolvedWinner === null) {
    if (racks.a.length === racks.b.length) {
      resolvedWinner = null;
    } else {
      resolvedWinner = racks.a.length < racks.b.length ? 'a' : 'b';
    }
  }

  if (resolvedWinner === null) {
    return { winnerSide: null, scoreDeltas: { a: 0, b: 0 } };
  }

  const loser = resolvedWinner === 'a' ? 'b' : 'a';
  const loserPoints = racks[loser].reduce((sum, t) => sum + tileValue(t), 0);
  return {
    winnerSide: resolvedWinner,
    scoreDeltas: {
      [resolvedWinner]: +loserPoints,
      [loser]: -loserPoints,
    },
  };
}
