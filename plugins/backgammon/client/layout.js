// Standard tournament layout, home bottom-right (player A's home = idx 18..23).
//   Top row left→right:    labels 13..18 | 19..24
//   Bottom row left→right: labels 12..7  | 6..1
// Each indices array is THE 6 cells of one quadrant in render order.
export const LAYOUT_A = {
  topLeft:  [11, 10, 9, 8, 7, 6],     // labels 13..18
  topRight: [5, 4, 3, 2, 1, 0],       // labels 19..24
  botLeft:  [12, 13, 14, 15, 16, 17], // labels 12..7
  botRight: [18, 19, 20, 21, 22, 23], // labels 6..1 — A's HOME
};

// Mirrored layout for player B's perspective. B's home is idx 0..5 and must
// occupy the bottom-right quadrant. Labels 1..24 are computed per-side via
// pointLabel(idx, youAre).
export const LAYOUT_B = {
  topLeft:  [12, 13, 14, 15, 16, 17], // B's view of A's outer (labels 13..18 from B)
  topRight: [18, 19, 20, 21, 22, 23], // B's view of A's home (labels 19..24 from B)
  botLeft:  [11, 10, 9, 8, 7, 6],     // labels 12..7 from B
  botRight: [5, 4, 3, 2, 1, 0],       // labels 6..1 — B's HOME
};

export function layoutFor(youAre) {
  return youAre === 'b' ? LAYOUT_B : LAYOUT_A;
}

// Standard backgammon point numbering FROM EACH VIEWER'S OWN PERSPECTIVE.
// For A: idx 0 = label 24 (their farthest); idx 23 = label 1 (their 1-point).
// For B: idx 0 = label 1 (their 1-point); idx 23 = label 24 (their farthest).
export function pointLabel(idx, youAre) {
  return youAre === 'b' ? idx + 1 : 24 - idx;
}
