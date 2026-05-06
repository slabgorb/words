import { tileEl } from './tile.js';
import { withInferredJokers } from './sets.js';

export function renderTable(tableEl, sets) {
  tableEl.innerHTML = '';
  sets.forEach((set, idx) => {
    const setDiv = document.createElement('div');
    setDiv.className = 'set';
    setDiv.dataset.setIdx = idx;
    const display = withInferredJokers(set);
    for (const tile of display) setDiv.appendChild(tileEl(tile));
    tableEl.appendChild(setDiv);
  });
  const newSetDiv = document.createElement('div');
  newSetDiv.className = 'set new-set';
  newSetDiv.dataset.newSet = '1';
  newSetDiv.textContent = '+ New set';
  tableEl.appendChild(newSetDiv);
}
