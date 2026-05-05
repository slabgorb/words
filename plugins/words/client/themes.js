// Tile theme + rotation-pool selection.
//
// Each theme is a pool of one or more texture URLs. For pools >1, a
// deterministic hash from the caller's `key` picks the same texture for the
// same tile across re-renders, so tiles don't flicker when the board
// re-renders.

const THEMES = {
  ivory:  { textures: ['assets/tile-cream.png?v=3'] },
  marble: { textures: [
    'assets/marble-1.png?v=2','assets/marble-2.png?v=2','assets/marble-3.png?v=2',
    'assets/marble-4.png?v=2','assets/marble-5.png?v=2','assets/marble-6.png?v=2',
    'assets/marble-7.png?v=2','assets/marble-8.png?v=2','assets/marble-9.png?v=2',
  ] },
  jade: { textures: [
    'assets/jade-1.png?v=2','assets/jade-2.png?v=2','assets/jade-3.png?v=2',
    'assets/jade-4.png?v=2','assets/jade-5.png?v=2','assets/jade-6.png?v=2',
    'assets/jade-7.png?v=2','assets/jade-8.png?v=2','assets/jade-9.png?v=2',
  ] },
  wood:   { textures: [
    'assets/wood-1.png?v=2','assets/wood-2.png?v=2','assets/wood-3.png?v=2',
    'assets/wood-4.png?v=2','assets/wood-5.png?v=2','assets/wood-6.png?v=2',
    'assets/wood-7.png?v=2','assets/wood-8.png?v=2','assets/wood-9.png?v=2',
  ] },
};

const ORDER = ['ivory', 'marble', 'jade', 'wood'];
const STORAGE_KEY = 'words.theme';

let active = localStorage.getItem(STORAGE_KEY);
if (!THEMES[active]) active = 'wood';

function syncBodyAttr() {
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.theme = active;
  }
}
syncBodyAttr();
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', syncBodyAttr, { once: true });
}

function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function pickTexture(pool, key) {
  if (pool.length === 1) return pool[0];
  return pool[djb2(String(key)) % pool.length];
}

export function applyTileTexture(el, key) {
  const theme = THEMES[active] || THEMES.wood;
  const url = pickTexture(theme.textures, key);
  el.style.backgroundImage = `url('${url}')`;
}

export function getTheme() { return active; }

export function cycleTheme() {
  const i = ORDER.indexOf(active);
  active = ORDER[(i + 1) % ORDER.length];
  localStorage.setItem(STORAGE_KEY, active);
  syncBodyAttr();
  return active;
}
