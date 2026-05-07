// Board-surface theme cycler. Sets body[data-theme]; CSS responds.

const THEMES = {
  'inlay-marble':   { label: 'Inlay Marble'   },
  'inlay-walnut':   { label: 'Inlay Walnut'   },
  'inlay-noir':     { label: 'Inlay Noir'     },
};
const ORDER = ['inlay-marble', 'inlay-walnut', 'inlay-noir'];
const STORAGE_KEY = 'backgammon.theme';

let active = localStorage.getItem(STORAGE_KEY);
if (!THEMES[active]) active = 'inlay-marble';

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
