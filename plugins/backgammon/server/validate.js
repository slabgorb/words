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

export function enumerateLegalMoves(board, dice, player) {
  if (!Array.isArray(dice) || dice.length === 0) return [];
  if (isOnBar(board, player)) return barEntries(board, dice, player);
  // Point-to-point and bear-off come in later tasks.
  return [];
}

export function isLegalMove(board, dice, player, from, to) {
  return enumerateLegalMoves(board, dice, player).some(m => m.from === from && m.to === to);
}

// Internal helpers exported for later tasks (and tests that want them).
export const _internals = { isOnBar, entryIndex, HOME_INDICES };
