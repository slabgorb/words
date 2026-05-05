import { moveTileTo, getTentative } from './turn.js';

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

    if (target) {
      moveTileTo(dragging.tileId, target);
      if (target.kind === 'set' || target.kind === 'new-set') {
        const tile = findTileInTentative(dragging.tileId);
        if (tile?.kind === 'joker') promptJokerRepresentation(tile);
      }
    }

    dragging.ghost.remove();
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.set').forEach(s => s.classList.remove('drop-target'));
    dragging = null;
    onAfterMove?.();
  });
}

function findTileInTentative(tileId) {
  const tent = getTentative();
  if (!tent) return null;
  for (const set of tent.table) {
    const found = set.find(t => t.id === tileId);
    if (found) return found;
  }
  return null;
}

function promptJokerRepresentation(tile) {
  const color = prompt('Joker represents which color? (red/blue/orange/black)', tile.representsColor ?? '');
  if (!color) return;
  const valStr = prompt('Joker represents which value? (1-13)', tile.representsValue ?? '');
  const value = Number(valStr);
  if (!Number.isInteger(value) || value < 1 || value > 13) return;
  tile.representsColor = color;
  tile.representsValue = value;
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
