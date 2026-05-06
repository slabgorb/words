import { BOARD_SIZE, HOME_INDICES } from './constants.js';

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
