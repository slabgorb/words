import { ui } from './state.js';
import { pointsFor } from './board.js';
import { applyTileTexture } from './themes.js';
import { dragManager } from './drag.js';

// Render the player's rack reflecting tiles already placed tentatively (those slots are empty).
export function renderRack(root, { onSlotClick, onDragStart, onRecallDrop, onRackReorder } = {}) {
  const points = pointsFor(ui.server?.variant);
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
      lt.textContent = blank ? '\xb7' : letter;
      slot.appendChild(lt);
      if (!blank) {
        const pt = document.createElement('span');
        pt.className = 'tile-points';
        pt.textContent = points[letter] ?? '';
        slot.appendChild(pt);
      }
      applyTileTexture(slot, `r:${idx}:${letter}`);

      // Source: drag = pick up; tap = select.
      dragManager.registerSource(slot, {
        payload: () => ({ kind: 'rack', idx }),
        onTap: () => { if (onSlotClick) onSlotClick(idx, letter); },
        onDragStart: () => { if (onDragStart) onDragStart({ kind: 'rack', idx }); },
      });

      // Target: drop = swap rack order.
      if (onRackReorder) {
        dragManager.registerTarget(slot, {
          kind: 'rack-slot',
          accepts: (payload) => payload.kind === 'rack' && payload.idx !== idx,
          onDrop: (payload) => onRackReorder(payload.idx, idx),
        });
      }
    }
    root.appendChild(slot);
  });

  // Recall: dropping a board-tentative tile onto the rack frame recalls it.
  if (onRecallDrop) {
    dragManager.registerTarget(root, {
      kind: 'rack',
      accepts: (payload) => payload.kind === 'cell',
      onDrop: (payload) => onRecallDrop(payload.r, payload.c),
    });
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
