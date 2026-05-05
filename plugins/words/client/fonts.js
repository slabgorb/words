// Display-font selection. Sets `body[data-font]`; CSS overrides `--type-serif`
// per attribute. The sans body and the JetBrains Mono points are unaffected.

const FONTS = {
  serif:       { label: 'Source Serif 4'    },
  baskerville: { label: 'Libre Baskerville' },
  montserrat:  { label: 'Montserrat'        },
  fredoka:     { label: 'Fredoka'           },
  raleway:     { label: 'Raleway'           },
  henny:       { label: 'Henny Penny'       },
};

const ORDER = ['serif', 'baskerville', 'montserrat', 'fredoka', 'raleway', 'henny'];
const STORAGE_KEY = 'words.font';

let active = localStorage.getItem(STORAGE_KEY);
if (!FONTS[active]) active = 'serif';

function syncBodyAttr() {
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.font = active;
  }
}
syncBodyAttr();
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', syncBodyAttr, { once: true });
}

export function getFont() { return active; }
export function getFontLabel() { return FONTS[active].label; }

export function cycleFont() {
  const i = ORDER.indexOf(active);
  active = ORDER[(i + 1) % ORDER.length];
  localStorage.setItem(STORAGE_KEY, active);
  syncBodyAttr();
  return active;
}
