import { tileEl } from './tile.js';

const COLOR_ORDER = ['red', 'blue', 'orange', 'black'];
let sortMode = 'color-num';

export function setRackSortMode(mode) { sortMode = mode; }

export function renderRack(rackEl, tiles) {
  rackEl.innerHTML = '';
  for (const t of sortedTiles(tiles)) rackEl.appendChild(tileEl(t));
}

export function toggleSortMode() {
  sortMode = sortMode === 'color-num' ? 'num-color' : 'color-num';
}

function sortedTiles(tiles) {
  const out = [...tiles];
  out.sort((a, b) => {
    if (a.kind === 'joker' && b.kind !== 'joker') return 1;
    if (b.kind === 'joker' && a.kind !== 'joker') return -1;
    if (a.kind === 'joker' && b.kind === 'joker') return a.id.localeCompare(b.id);
    if (sortMode === 'color-num') {
      const ca = COLOR_ORDER.indexOf(a.color), cb = COLOR_ORDER.indexOf(b.color);
      if (ca !== cb) return ca - cb;
      return a.value - b.value;
    } else {
      if (a.value !== b.value) return a.value - b.value;
      return COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color);
    }
  });
  return out;
}
