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
export function resolveTarget(x, y, elementFromPoint, accepts = () => true) {
  let hit = elementFromPoint(x, y);
  if (!hit) return null;
  while (hit) {
    const candidate = hit.closest ? hit.closest('[data-drop-target]') : null;
    if (!candidate) return null;
    if (accepts(candidate)) return candidate;
    // Reject -- try the candidate's parent.
    hit = candidate.parentElement;
  }
  return null;
}

const sources = new WeakMap(); // element -> { payload(), onTap?, onDragStart?, onDragEnd? }
const targets = new WeakMap(); // element -> { accepts?, onDrop }

const REDUCED_MOTION = typeof matchMedia !== 'undefined'
  ? matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;

export const dragManager = {
  registerSource(el, opts) {
    sources.set(el, opts);
    el.dataset.dragSource = '1';
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', onPointerDown);
  },

  registerTarget(el, opts) {
    targets.set(el, opts);
    el.dataset.dropTarget = opts.kind ?? '1';
  },
};

let active = null; // { el, opts, payload, startX, startY, dragging, ghost, hoverTarget, pointerId }

function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return; // ignore right/middle
  const el = e.currentTarget;
  const opts = sources.get(el);
  if (!opts) return;
  active = {
    el,
    opts,
    payload: opts.payload(),
    startX: e.clientX,
    startY: e.clientY,
    dragging: false,
    ghost: null,
    hoverTarget: null,
    pointerId: e.pointerId,
  };
  // Capture so we keep getting events even if pointer leaves el.
  try { el.setPointerCapture(e.pointerId); } catch { /* unsupported on some browsers */ }
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('keydown', onKeyDown);
}

function onPointerMove(e) {
  if (!active || e.pointerId !== active.pointerId) return;
  if (!active.dragging) {
    if (!exceedsThreshold(active.startX, active.startY, e.clientX, e.clientY)) return;
    beginDrag();
  }
  positionGhost(e.clientX, e.clientY);
  updateHoverTarget(e.clientX, e.clientY);
}

function onPointerUp(e) {
  if (!active || e.pointerId !== active.pointerId) return;
  if (!active.dragging) {
    // Tap -- no movement.
    const onTap = active.opts.onTap;
    teardown();
    if (onTap) onTap();
    active = null;
    return;
  }
  const targetEl = resolveTarget(
    e.clientX, e.clientY,
    document.elementFromPoint.bind(document),
    (el) => {
      const o = targets.get(el);
      return o && (!o.accepts || o.accepts(active.payload));
    },
  );
  const targetOpts = targetEl ? targets.get(targetEl) : null;
  if (targetOpts) {
    tick(12);
    const payload = active.payload;
    snapToTarget(targetEl, () => {
      teardown();
      targetOpts.onDrop(payload);
      active = null;
    });
  } else {
    snapBackHome(() => {
      teardown();
      active = null;
    });
  }
}

function onPointerCancel() {
  if (!active) return;
  if (active.dragging) snapBackHome(() => { teardown(); active = null; });
  else { teardown(); active = null; }
}

function onKeyDown(e) {
  if (!active || e.key !== 'Escape') return;
  if (active.dragging) snapBackHome(() => { teardown(); active = null; });
  else { teardown(); active = null; }
}

function beginDrag() {
  active.dragging = true;
  document.body.classList.add('dragging');
  active.el.classList.add('dragging');
  active.ghost = makeGhost(active.el);
  document.body.appendChild(active.ghost);
  if (active.opts.onDragStart) active.opts.onDragStart(active.payload);
  highlightAllTargets(true);
  tick(8);
}

function makeGhost(src) {
  const rect = src.getBoundingClientRect();
  const g = src.cloneNode(true);
  g.removeAttribute('data-drag-source');
  g.classList.add('drag-ghost');
  g.style.position = 'fixed';
  g.style.left = '0';
  g.style.top = '0';
  g.style.width = rect.width + 'px';
  g.style.height = rect.height + 'px';
  g.style.pointerEvents = 'none';
  g.style.zIndex = '9999';
  g.style.willChange = 'transform';
  g.dataset.ghostX = rect.left;
  g.dataset.ghostY = rect.top;
  return g;
}

function positionGhost(x, y) {
  const g = active.ghost;
  if (!g) return;
  const w = parseFloat(g.style.width);
  const h = parseFloat(g.style.height);
  const nx = x - w / 2;
  const ny = y - h - 24; // 24 px above the finger; ghost is scaled so visual top is ~32 px
  const scale = REDUCED_MOTION ? 1 : 1.15;
  g.style.transform = `translate(${nx}px, ${ny}px) scale(${scale})`;
}

function updateHoverTarget(x, y) {
  const targetEl = resolveTarget(
    x, y,
    document.elementFromPoint.bind(document),
    (el) => {
      const o = targets.get(el);
      return o && (!o.accepts || o.accepts(active.payload));
    },
  );
  if (active.hoverTarget === targetEl) return;
  if (active.hoverTarget) active.hoverTarget.classList.remove('drop-target');
  active.hoverTarget = targetEl;
  if (targetEl) targetEl.classList.add('drop-target');
}

function highlightAllTargets(on) {
  document.body.classList.toggle('drag-hint', on);
}

function snapToTarget(targetEl, done) {
  const ghost = active.ghost;
  if (!ghost || !targetEl || REDUCED_MOTION) { done(); return; }
  const r = targetEl.getBoundingClientRect();
  ghost.style.transition = 'transform 120ms ease';
  ghost.style.transform = `translate(${r.left}px, ${r.top}px) scale(1)`;
  setTimeout(done, 130);
}

function snapBackHome(done) {
  const ghost = active.ghost;
  if (!ghost || REDUCED_MOTION) { done(); return; }
  const x = parseFloat(ghost.dataset.ghostX);
  const y = parseFloat(ghost.dataset.ghostY);
  ghost.style.transition = 'transform 160ms ease';
  ghost.style.transform = `translate(${x}px, ${y}px) scale(1)`;
  setTimeout(done, 170);
}

function teardown() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
  document.removeEventListener('keydown', onKeyDown);
  if (active?.el) active.el.classList.remove('dragging');
  if (active?.hoverTarget) active.hoverTarget.classList.remove('drop-target');
  if (active?.ghost) active.ghost.remove();
  document.body.classList.remove('dragging', 'drag-hint');
  if (active?.dragging && active?.opts?.onDragEnd) active.opts.onDragEnd();
}

function tick(ms) {
  if (!navigator.vibrate) return;
  try { navigator.vibrate(ms); } catch { /* ignore */ }
}
