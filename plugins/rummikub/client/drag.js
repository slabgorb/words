import { moveTileTo, getTentative } from './turn.js';
import { openJokerPicker } from './joker-picker.js';

const TAP_THRESHOLD_PX = 6;

export function attachDrag(rootEl, onAfterMove) {
  let dragging = null;

  rootEl.addEventListener('pointerdown', (e) => {
    const tileEl = e.target.closest('.tile');
    if (!tileEl) return;
    dragging = {
      tileId: tileEl.dataset.tileId,
      ghost: makeGhost(tileEl, e),
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      sourceEl: tileEl,
    };
    tileEl.classList.add('dragging');
    rootEl.setPointerCapture(e.pointerId);
  });

  rootEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (!dragging.moved) {
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      if (dx * dx + dy * dy > TAP_THRESHOLD_PX * TAP_THRESHOLD_PX) dragging.moved = true;
    }
    dragging.ghost.style.left = `${e.clientX - 20}px`;
    dragging.ghost.style.top = `${e.clientY - 25}px`;
    document.querySelectorAll('.set').forEach(s => s.classList.remove('drop-target'));
    const dropEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.set, #rack');
    if (dropEl?.classList.contains('set')) dropEl.classList.add('drop-target');
  });

  rootEl.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    const wasTap = !dragging.moved;
    const tileId = dragging.tileId;
    const sourceEl = dragging.sourceEl;

    cleanup();

    if (wasTap) {
      const tile = findTileInTentative(tileId);
      const onTable = !!sourceEl.closest('#table');
      if (tile?.kind === 'joker' && onTable) {
        openJokerPicker(tile, onAfterMove);
      }
      return;
    }

    const dropEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.set, #rack');
    let target;
    if (!dropEl) target = null;
    else if (dropEl.id === 'rack') target = { kind: 'rack' };
    else if (dropEl.dataset.newSet) target = { kind: 'new-set' };
    else if (dropEl.dataset.setIdx) target = { kind: 'set', setIdx: Number(dropEl.dataset.setIdx) };

    if (target) moveTileTo(tileId, target);
    onAfterMove?.();
  });

  function cleanup() {
    if (dragging?.ghost) dragging.ghost.remove();
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.set').forEach(s => s.classList.remove('drop-target'));
    dragging = null;
  }
}

function findTileInTentative(tileId) {
  const tent = getTentative();
  if (!tent) return null;
  for (const set of tent.table) {
    const found = set.find(t => t.id === tileId);
    if (found) return found;
  }
  for (const t of tent.rack) {
    if (t.id === tileId) return t;
  }
  return null;
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
