import { BOARD_SIZE, LETTER_VALUE, BOARD_PREMIUMS } from './board.js';

const CENTER = 7;
const BINGO_BONUS = 35; // WwF bingo bonus
const RACK_SIZE = 7;

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

// Score a single word given its tiles (array of {r,c,letter,isNew,blank?}).
// Premiums apply only to newly-placed tiles.
function scoreWord(tiles) {
  let wordMult = 1;
  let letterTotal = 0;
  for (const t of tiles) {
    const base = t.blank ? 0 : (LETTER_VALUE[t.letter] ?? 0);
    if (t.isNew) {
      const premium = BOARD_PREMIUMS[t.r][t.c];
      switch (premium) {
        case 'TL': letterTotal += base * 3; break;
        case 'DL': letterTotal += base * 2; break;
        case 'TW': letterTotal += base; wordMult *= 3; break;
        case 'DW': letterTotal += base; wordMult *= 2; break;
        default:   letterTotal += base; break;
      }
    } else {
      letterTotal += base;
    }
  }
  return letterTotal * wordMult;
}

export function scoreMove(board, placement, mainWord, crossWords) {
  let total = 0;
  if (mainWord) total += scoreWord(mainWord.tiles);
  for (const cw of crossWords) total += scoreWord(cw.tiles);
  if (placement.length === RACK_SIZE) total += BINGO_BONUS;
  return total;
}

const PLAYER_IDS = ['keith', 'sonia'];

function otherPlayer(id) { return id === 'keith' ? 'sonia' : 'keith'; }

// Returns a new state. Does NOT mutate the input.
// move: { playerId, kind: 'play'|'pass'|'swap', placement?, scoreDelta?, swapTiles? }
export function applyMove(state, move) {
  const next = {
    board: state.board.map(row => row.slice()),
    bag: state.bag.slice(),
    racks: { keith: state.racks.keith.slice(), sonia: state.racks.sonia.slice() },
    scores: { ...state.scores },
    currentTurn: otherPlayer(state.currentTurn),
    consecutiveScorelessTurns: state.consecutiveScorelessTurns
  };

  if (move.kind === 'play') {
    const playerRack = next.racks[move.playerId];
    // Place tiles, remove from rack
    for (const t of move.placement) {
      next.board[t.r][t.c] = { letter: t.letter, byPlayer: move.playerId, blank: !!t.blank };
      // Remove one matching tile from rack: blank tiles play as '_' from rack but become specific letter.
      const rackKey = t.blank ? '_' : t.letter;
      const idx = playerRack.indexOf(rackKey);
      if (idx === -1) throw new Error(`tile ${rackKey} not in rack`);
      playerRack.splice(idx, 1);
    }
    // Refill rack from front of bag
    while (playerRack.length < 7 && next.bag.length > 0) {
      playerRack.push(next.bag.shift());
    }
    next.scores[move.playerId] = (next.scores[move.playerId] ?? 0) + (move.scoreDelta ?? 0);
    next.consecutiveScorelessTurns = (move.scoreDelta && move.scoreDelta > 0) ? 0 : next.consecutiveScorelessTurns + 1;
  } else if (move.kind === 'pass') {
    next.consecutiveScorelessTurns += 1;
  } else if (move.kind === 'swap') {
    const playerRack = next.racks[move.playerId];
    // Remove swap tiles from rack
    for (const letter of move.swapTiles) {
      const idx = playerRack.indexOf(letter);
      if (idx === -1) throw new Error(`swap tile ${letter} not in rack`);
      playerRack.splice(idx, 1);
    }
    // Draw replacements from front of bag
    const drawCount = move.swapTiles.length;
    for (let i = 0; i < drawCount && next.bag.length > 0; i++) {
      playerRack.push(next.bag.shift());
    }
    // Return swapped tiles to bag (caller may shuffle later)
    next.bag.push(...move.swapTiles);
    next.consecutiveScorelessTurns += 1;
  } else {
    throw new Error(`unknown move kind: ${move.kind}`);
  }

  return next;
}

export { PLAYER_IDS, otherPlayer };
