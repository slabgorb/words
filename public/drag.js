// public/drag.js — Pointer-Events drag manager
// Replaces HTML5 dragstart/drop. Works on mouse, touch, pen.

export const DRAG_THRESHOLD_PX = 6;

/** True iff the Euclidean distance between (x0,y0) and (x1,y1) exceeds the threshold. */
export function exceedsThreshold(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return (dx * dx + dy * dy) > (DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX);
}
