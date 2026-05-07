import { tileEl } from './tile.js';
import { withInferredJokers, classifySet, setValue } from './sets.js';

const KIND_LABEL = { run: 'Run', group: 'Group' };

export function renderTable(tableEl, sets) {
  tableEl.innerHTML = '';
  sets.forEach((set, idx) => {
    const setDiv = document.createElement('div');
    setDiv.className = 'set';
    setDiv.dataset.setIdx = idx;
    setDiv.dataset.label = labelForSet(set);
    const display = withInferredJokers(set);
    for (const tile of display) setDiv.appendChild(tileEl(tile));
    tableEl.appendChild(setDiv);
  });
  const newSetDiv = document.createElement('div');
  newSetDiv.className = 'set new-set';
  newSetDiv.dataset.newSet = '1';
  newSetDiv.dataset.label = 'New set';
  for (let i = 0; i < 3; i++) {
    const ghost = document.createElement('div');
    ghost.className = 'ghost-slot';
    ghost.textContent = '+';
    newSetDiv.appendChild(ghost);
  }
  tableEl.appendChild(newSetDiv);
}

function labelForSet(set) {
  const kind = classifySet(withInferredJokers(set));
  if (!kind) return `${set.length} tiles`;
  const pts = setValue(set);
  return `${KIND_LABEL[kind]} · ${pts} pts`;
}
