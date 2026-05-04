import { ui } from './state.js';

// Render the player's rack reflecting tiles already placed tentatively (those slots are empty).
export function renderRack(root, { onSlotClick } = {}) {
  root.innerHTML = '';
  const inUse = new Set();
  for (const t of ui.tentative) inUse.add(t.fromRackIdx);
  ui.rackOrder.forEach((letter, idx) => {
    const slot = document.createElement('div');
    slot.className = 'rack-slot';
    slot.dataset.idx = idx;
    if (!inUse.has(idx)) {
      slot.classList.add('tile');
      slot.textContent = letter === '_' ? '·' : letter;
      if (onSlotClick) slot.addEventListener('click', () => onSlotClick(idx, letter));
    }
    root.appendChild(slot);
  });
}

export function shuffleRack() {
  const a = ui.rackOrder.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  ui.rackOrder = a;
}
