// Board-surface theme. Sets body[data-theme]; CSS responds.

const THEMES = {
  baize:  { label: 'Baize'  },
  jersey: { label: 'Jersey' },
};

const ORDER = ['baize', 'jersey'];
const STORAGE_KEY = 'rummikub.theme';

let active = localStorage.getItem(STORAGE_KEY);
if (!THEMES[active]) active = 'baize';

function syncBodyAttr() {
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.theme = active;
  }
}
syncBodyAttr();
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', syncBodyAttr, { once: true });
}

export function getTheme() { return active; }
export function getThemeLabel() { return THEMES[active].label; }

export function cycleTheme() {
  const i = ORDER.indexOf(active);
  active = ORDER[(i + 1) % ORDER.length];
  localStorage.setItem(STORAGE_KEY, active);
  syncBodyAttr();
  return active;
}
