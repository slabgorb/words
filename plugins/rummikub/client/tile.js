const SUIT_GLYPH = { red: '●', blue: '■', orange: '⬢', black: '◆' };

export function tileEl(tile, opts = {}) {
  const { faceDown = false, size = 'md' } = opts;
  const el = document.createElement('div');
  el.className = 'tile';
  if (size === 'sm') el.classList.add('size-sm');
  if (faceDown) {
    el.classList.add('face-down');
    return el;
  }
  if (tile.id) el.dataset.tileId = tile.id;
  if (tile.kind === 'numbered') {
    el.classList.add(`color-${tile.color}`);
    const glyph = SUIT_GLYPH[tile.color] ?? '';
    appendNumberAndSuits(el, tile.value, glyph);
  } else if (tile.kind === 'joker') {
    el.classList.add('joker');
    if (tile.representsValue !== undefined) {
      const glyph = SUIT_GLYPH[tile.representsColor] ?? '';
      appendNumberAndSuits(el, tile.representsValue, glyph);
      const r = document.createElement('span');
      r.className = 'represents';
      r.textContent = 'joker';
      el.appendChild(r);
    } else {
      appendNumberAndSuits(el, '★', '★');
    }
  }
  return el;
}

function appendNumberAndSuits(el, value, glyph) {
  const suit = document.createElement('span');
  suit.className = 'suit';
  suit.textContent = glyph;
  el.appendChild(suit);

  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = value;
  el.appendChild(num);

  const mirror = document.createElement('span');
  mirror.className = 'suit-mirror';
  mirror.textContent = glyph;
  el.appendChild(mirror);
}
