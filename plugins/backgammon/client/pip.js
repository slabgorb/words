// Pure pip-count calculator.
//   For player A: each checker at idx i contributes (24 - i) pips; bar = 25.
//   For player B: each checker at idx i contributes (i + 1)  pips; bar = 25.
//   Borne-off contribute 0.
export function pipCount(board, side) {
  let total = 0;
  for (let i = 0; i < board.points.length; i++) {
    const cell = board.points[i];
    if (cell.color !== side || cell.count === 0) continue;
    const dist = side === 'a' ? (24 - i) : (i + 1);
    total += dist * cell.count;
  }
  const bar = side === 'a' ? board.barA : board.barB;
  total += bar * 25;
  return total;
}
