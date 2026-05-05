import { tileEl } from './tile.js';

export function renderTable(tableEl, sets) {
  tableEl.innerHTML = '';
  sets.forEach((set, idx) => {
    const setDiv = document.createElement('div');
    setDiv.className = 'set';
    setDiv.dataset.setIdx = idx;
    for (const tile of set) setDiv.appendChild(tileEl(tile));
    tableEl.appendChild(setDiv);
  });
  const newSetDiv = document.createElement('div');
  newSetDiv.className = 'set new-set';
  newSetDiv.dataset.newSet = '1';
  newSetDiv.textContent = '+ New set';
  tableEl.appendChild(newSetDiv);
}
