import { isPointBlocked, applyMove, enterFromBar, bearOff } from './board.js';
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

function checkerCount(board, player) {
  let n = 0;
  for (const p of board.points) if (p.color === player) n += p.count;
  return n + (player === 'a' ? board.barA + board.bornOffA : board.barB + board.bornOffB);
}

function isAllInHome(board, player) {
  if ((player === 'a' ? board.barA : board.barB) > 0) return false;
  const home = HOME_INDICES[player];
  const homeSet = new Set(home);
  // Every point with a player checker outside home → not all-in-home.
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (homeSet.has(i)) continue;
    const cell = board.points[i];
    if (cell.color === player && cell.count > 0) return false;
  }
  // Sanity: total accounted for equals 15.
  const total = checkerCount(board, player);
  if (total !== 15) return false;
  return true;
}

function highestPipIndex(board, player) {
  // For A, "highest pip" = lowest index in home that A occupies.
  // For B, "highest pip" = highest index in home that B occupies.
  if (player === 'a') {
    for (let i = 18; i <= 23; i++) {
      if (board.points[i].color === 'a' && board.points[i].count > 0) return i;
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      if (board.points[i].color === 'b' && board.points[i].count > 0) return i;
    }
  }
  return -1;
}

function bearOffMoves(board, dice, player) {
  if (!isAllInHome(board, player)) return [];
  const out = [];
  const seen = new Set();
  const highest = highestPipIndex(board, player);
  for (const die of uniqueDice(dice)) {
    if (player === 'a') {
      for (let from = 18; from < BOARD_SIZE; from++) {
        const cell = board.points[from];
        if (cell.color !== 'a' || cell.count === 0) continue;
        const exact = (24 - from) === die;
        const higherDie = die > (24 - from) && from === highest;
        if (!exact && !higherDie) continue;
        const key = `${from}->off@${die}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from, to: 'off', die });
      }
    } else {
      for (let from = 0; from <= 5; from++) {
        const cell = board.points[from];
        if (cell.color !== 'b' || cell.count === 0) continue;
        const exact = (from + 1) === die;
        const higherDie = die > (from + 1) && from === highest;
        if (!exact && !higherDie) continue;
        const key = `${from}->off@${die}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from, to: 'off', die });
      }
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
  if (m.to === 'off')   return bearOff(board, player, m.from);
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
  return [
    ...pointToPointMoves(board, dice, player),
    ...bearOffMoves(board, dice, player),
  ];
}

export function isLegalMove(board, dice, player, from, to) {
  return enumerateLegalMoves(board, dice, player).some(m => m.from === from && m.to === to);
}

// Internal helpers exported for later tasks (and tests that want them).
export const _internals = { isOnBar, entryIndex, HOME_INDICES };
