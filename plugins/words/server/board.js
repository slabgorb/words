export const BOARD_SIZE = 15;

// =====================================================================
// Words with Friends ruleset
// Reference: official WwF tile distribution + premium-square layout.
// Center (7,7) is DW (the start star).
// =====================================================================
const WWF_LETTER_VALUE = {
  A: 1, B: 4, C: 4, D: 2, E: 1, F: 4, G: 3, H: 3, I: 1, J: 10,
  K: 5, L: 2, M: 4, N: 2, O: 1, P: 4, Q: 10, R: 1, S: 1, T: 1,
  U: 2, V: 5, W: 4, X: 8, Y: 3, Z: 10, _: 0
};

// 104 tiles total.
const WWF_TILE_COUNTS = {
  A: 9, B: 2, C: 2, D: 5, E: 13, F: 2, G: 3, H: 4, I: 8, J: 1,
  K: 1, L: 4, M: 2, N: 5, O: 8, P: 2, Q: 1, R: 6, S: 5, T: 7,
  U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, _: 2
};

const WWF_TW = [[0,3],[0,11],[3,0],[3,14],[11,0],[11,14],[14,3],[14,11]];
const WWF_DW = [[1,5],[1,9],[5,1],[5,13],[9,1],[9,13],[13,5],[13,9],[7,7]];
const WWF_TL = [[0,6],[0,8],[3,3],[3,11],[6,0],[6,14],[8,0],[8,14],[11,3],[11,11],[14,6],[14,8]];
const WWF_DL = [[1,2],[1,12],[2,1],[2,4],[2,10],[2,13],[4,2],[4,6],[4,8],[4,12],[6,4],[6,10],[8,4],[8,10],[10,2],[10,6],[10,8],[10,12],[12,1],[12,4],[12,10],[12,13],[13,2],[13,12]];

// =====================================================================
// Scrabble (classic) ruleset
// Reference: standard Scrabble tile distribution + premium-square layout.
// Center (7,7) is DW (the start star).
// =====================================================================
const SCRABBLE_LETTER_VALUE = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, _: 0
};

// 100 tiles total.
const SCRABBLE_TILE_COUNTS = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1,
  K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6,
  U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, _: 2
};

const SCRABBLE_TW = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]];
const SCRABBLE_DW = [[1,1],[2,2],[3,3],[4,4],[10,10],[11,11],[12,12],[13,13],[1,13],[2,12],[3,11],[4,10],[10,4],[11,3],[12,2],[13,1],[7,7]];
const SCRABBLE_TL = [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]];
const SCRABBLE_DL = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]];

function buildPremiumGrid({ tw, dw, tl, dl }) {
  const grid = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  for (const [r,c] of tw) grid[r][c] = 'TW';
  for (const [r,c] of dw) grid[r][c] = 'DW';
  for (const [r,c] of tl) grid[r][c] = 'TL';
  for (const [r,c] of dl) grid[r][c] = 'DL';
  return grid;
}

function buildBag(counts) {
  return Object.entries(counts).flatMap(([letter, n]) => Array(n).fill(letter));
}

const RULES = {
  wwf: {
    variant: 'wwf',
    displayName: 'Words with Friends',
    letterValue: WWF_LETTER_VALUE,
    tileBag: buildBag(WWF_TILE_COUNTS),
    premiums: buildPremiumGrid({ tw: WWF_TW, dw: WWF_DW, tl: WWF_TL, dl: WWF_DL }),
    bingoBonus: 35,
  },
  scrabble: {
    variant: 'scrabble',
    displayName: 'Scrabble',
    letterValue: SCRABBLE_LETTER_VALUE,
    tileBag: buildBag(SCRABBLE_TILE_COUNTS),
    premiums: buildPremiumGrid({ tw: SCRABBLE_TW, dw: SCRABBLE_DW, tl: SCRABBLE_TL, dl: SCRABBLE_DL }),
    bingoBonus: 50,
  },
};

export const VARIANTS = Object.keys(RULES);
export const DEFAULT_VARIANT = 'wwf';

export function getRules(variant) {
  return RULES[variant] ?? RULES[DEFAULT_VARIANT];
}

// Backwards-compatible exports — default to WwF rules. Existing code and
// tests that import these constants directly continue to work as the
// classic Words-with-Friends ruleset.
export const LETTER_VALUE = RULES.wwf.letterValue;
export const TILE_BAG = RULES.wwf.tileBag;
export const BOARD_PREMIUMS = RULES.wwf.premiums;
