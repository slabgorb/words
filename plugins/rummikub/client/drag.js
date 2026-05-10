import { moveTileTo, getTentative } from './turn.js';
import { openJokerPicker } from './joker-picker.js';

const TAP_SLOP_PX = 8;

let selectedTileId = null;
let afterMove = null;
let touchMoved = false;

export function attachDrag(rootEl, onAfterMove) {
  afterMove = onAfterMove;

  let startX = 0, startY = 0;
  rootEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { touchMoved = true; return; }
    touchMoved = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  rootEl.addEventListener('touchmove', (e) => {
    if (touchMoved) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - startX, t.clientY - startY) > TAP_SLOP_PX) touchMoved = true;
  }, { passive: true });

  rootEl.addEventListener('click', (e) => {
    if (touchMoved) { touchMoved = false; return; }

    const tileEl = e.target.closest('.tile[data-tile-id]');
    if (tileEl) { handleTileClick(tileEl); return; }

    const dropEl = e.target.closest('.set, #rack');
    if (dropEl && selectedTileId) { handleDropClick(dropEl); return; }

    if (selectedTileId) clearSelection();
  });
}

export function refreshSelection() {
  if (!selectedTileId) {
    document.body.classList.remove('has-selection');
    return;
  }
  const el = document.querySelector(`.tile[data-tile-id="${CSS.escape(selectedTileId)}"]`);
  if (!el) {
    selectedTileId = null;
    document.body.classList.remove('has-selection');
    return;
  }
  document.querySelectorAll('.tile.selected').forEach(n => { if (n !== el) n.classList.remove('selected'); });
  el.classList.add('selected');
  document.body.classList.add('has-selection');
}

function handleTileClick(tileEl) {
  const tileId = tileEl.dataset.tileId;
  const onTable = !!tileEl.closest('#table');

  if (selectedTileId === tileId) {
    const tile = findTileInTentative(tileId);
    if (tile?.kind === 'joker' && onTable) {
      openJokerPicker(tile, () => { clearSelection(); afterMove?.(); });
      return;
    }
    clearSelection();
    return;
  }

  setSelection(tileId);
}

function handleDropClick(dropEl) {
  let target;
  if (dropEl.id === 'rack') target = { kind: 'rack' };
  else if (dropEl.dataset.newSet) target = { kind: 'new-set' };
  else if (dropEl.dataset.setIdx !== undefined) target = { kind: 'set', setIdx: Number(dropEl.dataset.setIdx) };
  if (!target) return;

  moveTileTo(selectedTileId, target);
  clearSelection();
  afterMove?.();
}

function setSelection(tileId) {
  document.querySelectorAll('.tile.selected').forEach(n => n.classList.remove('selected'));
  selectedTileId = tileId;
  const el = document.querySelector(`.tile[data-tile-id="${CSS.escape(tileId)}"]`);
  if (el) el.classList.add('selected');
  document.body.classList.add('has-selection');
}

function clearSelection() {
  selectedTileId = null;
  document.body.classList.remove('has-selection');
  document.querySelectorAll('.tile.selected').forEach(n => n.classList.remove('selected'));
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
