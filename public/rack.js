import { ui } from './state.js';
import { POINTS } from './board.js';
import { applyTileTexture } from './themes.js';

// Render the player's rack reflecting tiles already placed tentatively (those slots are empty).
export function renderRack(root, { onSlotClick, onDragStart, onRecallDrop, onRackReorder } = {}) {
  root.innerHTML = '';
  const inUse = new Set();
  for (const t of ui.tentative) inUse.add(t.fromRackIdx);
  ui.rackOrder.forEach((letter, idx) => {
    const slot = document.createElement('div');
    slot.className = 'rack-slot';
    slot.dataset.idx = idx;
    if (!inUse.has(idx)) {
      slot.classList.add('tile');
      const blank = letter === '_';
      const lt = document.createElement('span');
      lt.className = 'tile-letter';
      lt.textContent = blank ? '·' : letter;
      slot.appendChild(lt);
      if (!blank) {
        const pt = document.createElement('span');
        pt.className = 'tile-points';
        pt.textContent = POINTS[letter] ?? '';
        slot.appendChild(pt);
      }
      applyTileTexture(slot, `r:${idx}:${letter}`);
      slot.draggable = true;
      slot.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `rack:${idx}`);
        slot.classList.add('dragging');
        if (onDragStart) onDragStart({ kind: 'rack', idx });
      });
      slot.addEventListener('dragend', () => slot.classList.remove('dragging'));
      if (onSlotClick) slot.addEventListener('click', () => onSlotClick(idx, letter));

      // Reorder: a rack tile dragged onto another visible rack tile swaps
      // their positions in rackOrder. We handle this on the tile itself and
      // stop propagation so the rack-root recall handler doesn't also fire.
      if (onRackReorder) {
        slot.addEventListener('dragover', (e) => {
          const types = e.dataTransfer.types;
          if (!types || !types.includes('text/plain')) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          slot.classList.add('drop-target');
        });
        slot.addEventListener('dragleave', () => slot.classList.remove('drop-target'));
        slot.addEventListener('drop', (e) => {
          slot.classList.remove('drop-target');
          const data = e.dataTransfer.getData('text/plain');
          if (!data.startsWith('rack:')) return;
          e.preventDefault();
          e.stopPropagation();
          const fromIdx = Number(data.slice(5));
          if (Number.isNaN(fromIdx) || fromIdx === idx) return;
          onRackReorder(fromIdx, idx);
        });
      }
    }
    root.appendChild(slot);
  });

  // Recall a tentative tile by dropping it back on the rack. Use property
  // assignment so repeated renders replace rather than stack listeners.
  if (onRecallDrop) {
    root.ondragover = (e) => {
      const types = e.dataTransfer.types;
      if (!types || !types.includes('text/plain')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      root.classList.add('drop-target');
    };
    root.ondragleave = (e) => {
      if (e.target === root) root.classList.remove('drop-target');
    };
    root.ondrop = (e) => {
      root.classList.remove('drop-target');
      const data = e.dataTransfer.getData('text/plain');
      if (!data.startsWith('cell:')) return;
      e.preventDefault();
      const [, r, c] = data.split(':');
      onRecallDrop(Number(r), Number(c));
    };
  }
}

export function shuffleRack() {
  const a = ui.rackOrder.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  ui.rackOrder = a;
}
