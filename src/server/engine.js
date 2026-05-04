import { BOARD_SIZE } from './board.js';

const CENTER = 7;

// Validates that a placement is geometrically legal.
// Returns { valid: true, axis: 'row'|'col' } or { valid: false, reason: string }.
//
// `board` is a 15x15 array of null | { letter, byPlayer }.
// `placement` is an array of { r, c, letter, blank? } — newly-placed tiles only.
// `isFirstMove` is true iff the board has no existing tiles.
export function validatePlacement(board, placement, isFirstMove) {
  if (!Array.isArray(placement) || placement.length === 0) {
    return { valid: false, reason: 'placement is empty' };
  }
  // Bounds + occupancy check
  for (const t of placement) {
    if (t.r < 0 || t.r >= BOARD_SIZE || t.c < 0 || t.c >= BOARD_SIZE) {
      return { valid: false, reason: `tile at (${t.r},${t.c}) is out of bounds` };
    }
    if (board[t.r][t.c] !== null) {
      return { valid: false, reason: `cell (${t.r},${t.c}) is already occupied` };
    }
  }
  // Determine axis: all rows equal → horizontal; all cols equal → vertical; both → single tile (call it 'row').
  const rows = new Set(placement.map(t => t.r));
  const cols = new Set(placement.map(t => t.c));
  let axis;
  if (rows.size === 1) axis = 'row';
  else if (cols.size === 1) axis = 'col';
  else return { valid: false, reason: 'tiles must be in a single line (row or column)' };

  // First-move rule: must cover the center square.
  if (isFirstMove) {
    const touchesCenter = placement.some(t => t.r === CENTER && t.c === CENTER);
    if (!touchesCenter) return { valid: false, reason: 'first move must cover the center star' };
  }

  // Contiguity: along the placement axis, the span from min to max must be filled
  // by either newly-placed tiles or existing board tiles. No gaps.
  const fixed = axis === 'row' ? placement[0].r : placement[0].c;
  const positions = placement.map(t => axis === 'row' ? t.c : t.r).sort((a, b) => a - b);
  const lo = positions[0], hi = positions[positions.length - 1];
  const placed = new Set(positions);
  for (let i = lo; i <= hi; i++) {
    if (placed.has(i)) continue;
    const r = axis === 'row' ? fixed : i;
    const c = axis === 'row' ? i : fixed;
    if (board[r][c] === null) {
      return { valid: false, reason: `gap at (${r},${c})` };
    }
  }

  // Non-first-move: at least one newly-placed tile must be orthogonally adjacent
  // to an existing tile, OR the placement extends an existing tile along the axis
  // (which the gap-fill check above already requires touching). For first move we
  // skipped this; for subsequent moves, check 4-neighbors of each new tile.
  if (!isFirstMove) {
    let touches = false;
    for (const t of placement) {
      const neighbors = [[t.r-1,t.c],[t.r+1,t.c],[t.r,t.c-1],[t.r,t.c+1]];
      for (const [r,c] of neighbors) {
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
        if (board[r][c] !== null) { touches = true; break; }
      }
      if (touches) break;
    }
    if (!touches) return { valid: false, reason: 'placement must touch an existing tile' };
  }

  return { valid: true, axis };
}

// Returns { mainWord: { text, tiles[] } | null, crossWords: Array<{ text, tiles[] }> }
// `tiles` items are { r, c, letter, isNew: bool, blank?: bool }.
// Words of length < 2 are not words; mainWord may be null if the placement is a single tile
// with no neighbors along the axis.
export function extractWords(board, placement, axis) {
  const newByKey = new Map();
  for (const t of placement) newByKey.set(`${t.r},${t.c}`, t);

  const tileAt = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
    const key = `${r},${c}`;
    if (newByKey.has(key)) {
      const t = newByKey.get(key);
      return { r, c, letter: t.letter, blank: !!t.blank, isNew: true };
    }
    const cell = board[r][c];
    if (cell === null) return null;
    return { r, c, letter: cell.letter, blank: !!cell.blank, isNew: false };
  };

  // Walk along an axis from a starting cell, returning the contiguous tiles in order.
  function walk(r, c, dr, dc) {
    const tiles = [];
    let rr = r, cc = c;
    while (tileAt(rr, cc) !== null) { rr -= dr; cc -= dc; }
    rr += dr; cc += dc;
    while (tileAt(rr, cc) !== null) {
      tiles.push(tileAt(rr, cc));
      rr += dr; cc += dc;
    }
    return tiles;
  }

  // Main word: walk along the placement axis from any new tile.
  const first = placement[0];
  const mainTiles = axis === 'row'
    ? walk(first.r, first.c, 0, 1)
    : walk(first.r, first.c, 1, 0);
  const mainWord = mainTiles.length >= 2
    ? { text: mainTiles.map(t => t.letter).join(''), tiles: mainTiles }
    : null;

  // Crosswords: for each new tile, walk perpendicular to the axis. If length >= 2, it's a cross-word.
  const crossWords = [];
  for (const t of placement) {
    const cross = axis === 'row'
      ? walk(t.r, t.c, 1, 0)
      : walk(t.r, t.c, 0, 1);
    if (cross.length >= 2) {
      crossWords.push({ text: cross.map(x => x.letter).join(''), tiles: cross });
    }
  }

  return { mainWord, crossWords };
}
