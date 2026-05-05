export const BOARD_SIZE = 15;

// Words with Friends letter values.
// Reference: official WwF tile distribution.
export const LETTER_VALUE = {
  A: 1, B: 4, C: 4, D: 2, E: 1, F: 4, G: 3, H: 3, I: 1, J: 10,
  K: 5, L: 2, M: 4, N: 2, O: 1, P: 4, Q: 10, R: 1, S: 1, T: 1,
  U: 2, V: 5, W: 4, X: 8, Y: 3, Z: 10, _: 0
};

// Words with Friends tile distribution (104 tiles total).
// Reference counts: A:9 B:2 C:2 D:5 E:13 F:2 G:3 H:4 I:8 J:1 K:1 L:4 M:2 N:5 O:8
//                   P:2 Q:1 R:6 S:5 T:7 U:4 V:2 W:2 X:1 Y:2 Z:1 blank:2
const TILE_COUNTS = {
  A: 9, B: 2, C: 2, D: 5, E: 13, F: 2, G: 3, H: 4, I: 8, J: 1,
  K: 1, L: 4, M: 2, N: 5, O: 8, P: 2, Q: 1, R: 6, S: 5, T: 7,
  U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, _: 2
};

export const TILE_BAG = Object.entries(TILE_COUNTS).flatMap(([letter, n]) =>
  Array(n).fill(letter)
);

// Words with Friends premium-square layout (15x15).
// Sources: TW=triple word, DW=double word, TL=triple letter, DL=double letter.
// Center (7,7) is DW (the start star).
const TW = [[0,3],[0,11],[3,0],[3,14],[11,0],[11,14],[14,3],[14,11]];
const DW = [[1,5],[1,9],[5,1],[5,13],[9,1],[9,13],[13,5],[13,9],[7,7]];
const TL = [[0,6],[0,8],[3,3],[3,11],[6,0],[6,14],[8,0],[8,14],[11,3],[11,11],[14,6],[14,8]];
const DL = [[1,2],[1,12],[2,1],[2,4],[2,10],[2,13],[4,2],[4,6],[4,8],[4,12],[6,4],[6,10],[8,4],[8,10],[10,2],[10,6],[10,8],[10,12],[12,1],[12,4],[12,10],[12,13],[13,2],[13,12]];

export const BOARD_PREMIUMS = (() => {
  const grid = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  for (const [r,c] of TW) grid[r][c] = 'TW';
  for (const [r,c] of DW) grid[r][c] = 'DW';
  for (const [r,c] of TL) grid[r][c] = 'TL';
  for (const [r,c] of DL) grid[r][c] = 'DL';
  return grid;
})();
