import { isPointBlocked, applyMove, enterFromBar } from './board.js';
import { HOME_INDICES, BOARD_SIZE } from './constants.js';

function isOnBar(board, player) {
  return player === 'a' ? board.barA > 0 : board.barB > 0;
}

function entryIndex(player, die) {
  return player === 'a' ? die - 1 : BOARD_SIZE - die;
}

function uniqueDice(dice) {
  return Array.from(new Set(dice));
}

function barEntries(board, dice, player) {
  const out = [];
  for (const die of uniqueDice(dice)) {
    const to = entryIndex(player, die);
    if (!isPointBlocked(board, player, to)) {
      out.push({ from: 'bar', to, die });
    }
  }
  return out;
}

function destination(player, from, die) {
  return player === 'a' ? from + die : from - die;
}

function pointToPointMoves(board, dice, player) {
  const out = [];
  const seen = new Set();
  for (const die of uniqueDice(dice)) {
    for (let from = 0; from < BOARD_SIZE; from++) {
      const cell = board.points[from];
      if (cell.color !== player || cell.count === 0) continue;
      const to = destination(player, from, die);
      if (to < 0 || to >= BOARD_SIZE) continue;  // bear-off handled later
      if (isPointBlocked(board, player, to)) continue;
      const key = `${from}->${to}@${die}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from, to, die });
    }
  }
  return out;
}

// Returns the maximum number of dice consumable in any sequence from this board state.
// Used to enforce must-use-both. Brute-force DFS bounded by dice length (≤ 4).
export function maxConsumableDice(board, dice, player) {
  if (dice.length === 0) return 0;
  let best = 0;
  function dfs(b, remaining) {
    const moves = enumerateLegalMoves(b, remaining, player);
    if (moves.length === 0) return;
    for (const m of moves) {
      const nextBoard = applyMoveOrEnter(b, player, m);
      const nextDice = removeOne(remaining, m.die);
      const consumed = (dice.length - nextDice.length);
      if (consumed > best) best = consumed;
      if (best === dice.length) return;  // can't do better
      dfs(nextBoard, nextDice);
    }
  }
  dfs(board, dice);
  return best;
}

function applyMoveOrEnter(board, player, m) {
  if (m.from === 'bar') return enterFromBar(board, player, m.to);
  if (m.to === 'off')   return board; // bear-off slot used in later task; stub here
  return applyMove(board, player, m.from, m.to);
}

function removeOne(arr, value) {
  const idx = arr.indexOf(value);
  if (idx < 0) return arr.slice();
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
}

// Filter the raw legal-move list by must-use-both / higher-die rules.
// Returns moves that are legal as the FIRST move of the turn under those rules.
export function legalFirstMoves(board, dice, player) {
  const raw = enumerateLegalMoves(board, dice, player);
  if (raw.length === 0) return [];
  const max = maxConsumableDice(board, dice, player);
  if (max === 0) return [];
  if (max === dice.length) return raw;  // unrestricted: every raw move is fine

  // We can consume `max` dice but not all. A first move is legal iff some
  // continuation from it consumes `max` total dice (counting itself as 1).
  const out = [];
  for (const m of raw) {
    const nextBoard = applyMoveOrEnter(board, player, m);
    const nextDice = removeOne(dice, m.die);
    const fromHere = 1 + maxConsumableDice(nextBoard, nextDice, player);
    if (fromHere >= max) out.push(m);
  }

  // Higher-die rule: if max === 1 AND both dice individually playable, only the
  // higher die's move survives. (Doubles never trigger this — all dice equal.)
  if (max === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const dieValues = new Set(out.map(m => m.die));
    if (dieValues.size === 2) {
      const higher = Math.max(...dieValues);
      return out.filter(m => m.die === higher);
    }
  }
  return out;
}

export function enumerateLegalMoves(board, dice, player) {
  if (!Array.isArray(dice) || dice.length === 0) return [];
  if (isOnBar(board, player)) return barEntries(board, dice, player);
  return pointToPointMoves(board, dice, player);
}

export function isLegalMove(board, dice, player, from, to) {
  return enumerateLegalMoves(board, dice, player).some(m => m.from === from && m.to === to);
}

// Internal helpers exported for later tasks (and tests that want them).
export const _internals = { isOnBar, entryIndex, HOME_INDICES };
