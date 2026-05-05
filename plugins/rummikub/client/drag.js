import { moveTileTo } from './turn.js';

export function attachDrag(rootEl, onAfterMove) {
  let dragging = null;

  rootEl.addEventListener('pointerdown', (e) => {
    const tileEl = e.target.closest('.tile');
    if (!tileEl) return;
    dragging = { tileId: tileEl.dataset.tileId, ghost: makeGhost(tileEl, e) };
    tileEl.classList.add('dragging');
    rootEl.setPointerCapture(e.pointerId);
  });

  rootEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dragging.ghost.style.left = `${e.clientX - 20}px`;
    dragging.ghost.style.top = `${e.clientY - 25}px`;
    document.querySelectorAll('.set').forEach(s => s.classList.remove('drop-target'));
    const dropEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.set, #rack');
    if (dropEl?.classList.contains('set')) dropEl.classList.add('drop-target');
  });

  rootEl.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    const dropEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.set, #rack');
    let target;
    if (!dropEl) target = null;
    else if (dropEl.id === 'rack') target = { kind: 'rack' };
    else if (dropEl.dataset.newSet) target = { kind: 'new-set' };
    else if (dropEl.dataset.setIdx) target = { kind: 'set', setIdx: Number(dropEl.dataset.setIdx) };

    if (target) moveTileTo(dragging.tileId, target);

    dragging.ghost.remove();
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.set').forEach(s => s.classList.remove('drop-target'));
    dragging = null;
    onAfterMove?.();
  });
}

function makeGhost(srcEl, ev) {
  const g = srcEl.cloneNode(true);
  g.style.position = 'fixed';
  g.style.left = `${ev.clientX - 20}px`;
  g.style.top = `${ev.clientY - 25}px`;
  g.style.pointerEvents = 'none';
  g.style.zIndex = 1000;
  document.body.appendChild(g);
  return g;
}
