// public/drag.js — Pointer-Events drag manager
// Replaces HTML5 dragstart/drop. Works on mouse, touch, pen.

export const DRAG_THRESHOLD_PX = 6;

/** True iff the Euclidean distance between (x0,y0) and (x1,y1) exceeds the threshold. */
export function exceedsThreshold(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return (dx * dx + dy * dy) > (DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX);
}

/**
 * Resolve the drop-target element under (x, y), if any.
 * @param {number} x – clientX
 * @param {number} y – clientY
 * @param {(x:number,y:number) => Element|null} elementFromPoint – usually `document.elementFromPoint`
 * @returns {Element|null} The nearest ancestor (inclusive) carrying `data-drop-target`, or null.
 */
export function resolveTarget(x, y, elementFromPoint) {
  const hit = elementFromPoint(x, y);
  if (!hit) return null;
  return hit.closest ? hit.closest('[data-drop-target]') : null;
}
