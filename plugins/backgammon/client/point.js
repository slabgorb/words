import { pointLabel } from './layout.js';

// ─── Checker ─────────────────────────────────────────────────────────────

export function createCheckerEl({ color, selected = false, badge = null } = {}) {
  const el = document.createElement('div');
  el.className = `checker color-${color}`;
  if (selected) el.classList.add('selected');
  if (badge != null) {
    const b = document.createElement('div');
    b.className = 'stack-badge';
    b.textContent = `×${badge}`;
    el.appendChild(b);
  }
  return el;
}

// ─── Point triangle (SVG) ────────────────────────────────────────────────

let triUid = 0;
export function createPointTriEl({ position, parity }) {
  const wrap = document.createElement('div');
  wrap.className = 'point-tri';
  const fill = parity === 'light' ? 'var(--pt-light)' : 'var(--pt-dark)';
  const path = position === 'top'
    ? 'M0,0 L100,0 L50,100 Z'
    : 'M0,100 L100,100 L50,0 Z';
  const sheen = position === 'top'
    ? 'M50,4 L52,4 L51,96 Z'
    : 'M50,96 L52,96 L51,4 Z';
  const gid = `g-${position}-${parity}-${++triUid}`;
  wrap.innerHTML = `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${fill}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${fill}" stop-opacity="0.78"/>
        </linearGradient>
      </defs>
      <path d="${path}" fill="url(#${gid})" stroke="var(--pt-edge)" stroke-width="0.6"/>
      <path d="${sheen}" fill="rgba(255,255,255,0.18)"/>
    </svg>`;
  return wrap;
}

// ─── Point ───────────────────────────────────────────────────────────────

export function createPointEl({
  idx, position, parity, cell, youAre,
  selected = false, isLegalTarget = false, showLegalDots = true,
}) {
  const el = document.createElement('div');
  el.className = `point ${position}`;
  if (cell.color) el.classList.add('movable');
  el.dataset.idx = String(idx);

  el.appendChild(createPointTriEl({ position, parity }));

  const num = document.createElement('div');
  num.className = 'point-num';
  num.textContent = String(pointLabel(idx, youAre));
  el.appendChild(num);

  const stack = document.createElement('div');
  stack.className = 'point-stack';
  const count = cell.count;
  if (count > 5) stack.classList.add('compressed');
  const visible = Math.min(count, 5);
  const overflow = count - visible;
  for (let i = 0; i < visible; i++) {
    const isTopOfStack = position === 'top' ? (i === visible - 1) : (i === 0);
    const badge = isTopOfStack && overflow > 0 ? count : null;
    const c = createCheckerEl({
      color: cell.color,
      selected: selected && isTopOfStack,
      badge,
    });
    stack.appendChild(c);
  }
  el.appendChild(stack);

  if (showLegalDots && isLegalTarget) {
    const dot = document.createElement('div');
    dot.className = 'legal-target';
    el.appendChild(dot);
  }

  return el;
}
