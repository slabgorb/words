// Thin facade over the engine's legalFirstMoves. The server remains the
// authoritative validator (every action is re-checked server-side). Client
// uses this only to highlight valid destinations during selection.
//
// Imports through ./_engine/ which is a symlink to ../server/. The host's
// express.static follows symlinks, so the browser resolves these files
// under /play/backgammon/<gameId>/_engine/<file>.js.
import { legalFirstMoves } from './_engine/validate.js';

// Returns Set<idx | 'off'> of valid destinations from `from` for `side`.
// `from` is idx (0..23) | 'bar'.
// `dice` is state.turn.dice.remaining (or null/undefined if not rolled).
export function legalTargetsFrom(board, dice, side, from) {
  if (!dice || dice.length === 0) return new Set();
  if (from === null || from === undefined) return new Set();
  const all = legalFirstMoves(board, dice, side);
  const matches = all.filter(m => m.from === from);
  return new Set(matches.map(m => m.to));
}

// Returns true if the player has any legal first move at all.
export function hasAnyLegalMove(board, dice, side) {
  if (!dice || dice.length === 0) return false;
  return legalFirstMoves(board, dice, side).length > 0;
}
