import { BOARD_SIZE, HOME_INDICES, opponent } from './constants.js';

export { BOARD_SIZE, HOME_INDICES };

export function initialPoints() {
  const pts = Array.from({ length: BOARD_SIZE }, () => ({ color: null, count: 0 }));
  // A: 24-point, 13-point, 8-point, 6-point → indices 0, 11, 16, 18
  pts[0]  = { color: 'a', count: 2 };
  pts[11] = { color: 'a', count: 5 };
  pts[16] = { color: 'a', count: 3 };
  pts[18] = { color: 'a', count: 5 };
  // B (mirror): 24-point, 13-point, 8-point, 6-point → indices 23, 12, 7, 5
  pts[23] = { color: 'b', count: 2 };
  pts[12] = { color: 'b', count: 5 };
  pts[7]  = { color: 'b', count: 3 };
  pts[5]  = { color: 'b', count: 5 };
  return pts;
}

function clonePoints(points) {
  return points.map(p => ({ ...p }));
}

function place(points, idx, color) {
  const cell = points[idx];
  if (cell.color === null || cell.color === color) {
    points[idx] = { color, count: cell.count + 1 };
  } else {
    // Caller is responsible for hitCheck before calling place; this branch
    // is only reachable in tests that bypass validation.
    points[idx] = { color, count: 1 };
  }
}

function lift(points, idx) {
  const cell = points[idx];
  const count = cell.count - 1;
  points[idx] = count === 0 ? { color: null, count: 0 } : { color: cell.color, count };
}

function pushToBar(board, color) {
  return color === 'a'
    ? { ...board, barA: board.barA + 1 }
    : { ...board, barB: board.barB + 1 };
}

export function isPointBlocked(board, mover, idx) {
  const cell = board.points[idx];
  return cell.color === opponent(mover) && cell.count >= 2;
}

// Mutator: move one checker `mover` from `from` to `to` (point-to-point only).
// If destination has an opponent blot, hits it (opponent goes to bar).
// Caller must ensure move is otherwise legal.
export function applyMove(board, mover, from, to) {
  const points = clonePoints(board.points);
  let next = { ...board, points };
  // Hit before placing.
  const dest = points[to];
  if (dest.color === opponent(mover) && dest.count === 1) {
    points[to] = { color: null, count: 0 };
    next = pushToBar(next, opponent(mover));
  }
  lift(points, from);
  place(points, to, mover);
  return next;
}

export function enterFromBar(board, mover, to) {
  const points = clonePoints(board.points);
  let next = { ...board, points };
  if (mover === 'a') next.barA = next.barA - 1;
  else next.barB = next.barB - 1;
  const dest = points[to];
  if (dest.color === opponent(mover) && dest.count === 1) {
    points[to] = { color: null, count: 0 };
    next = pushToBar(next, opponent(mover));
  }
  place(points, to, mover);
  return next;
}

export function bearOff(board, mover, from) {
  const points = clonePoints(board.points);
  lift(points, from);
  const next = { ...board, points };
  if (mover === 'a') next.bornOffA = next.bornOffA + 1;
  else next.bornOffB = next.bornOffB + 1;
  return next;
}
