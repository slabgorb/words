import { isPointBlocked } from './board.js';
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
