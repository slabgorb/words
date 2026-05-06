const SUIT_GLYPH = { red: '●', blue: '■', orange: '⬢', black: '◆' };

export function tileEl(tile) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.tileId = tile.id;
  if (tile.kind === 'numbered') {
    el.classList.add(`color-${tile.color}`);
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = tile.value;
    el.appendChild(num);
    const suit = document.createElement('span');
    suit.className = 'suit';
    suit.textContent = SUIT_GLYPH[tile.color] ?? '';
    el.appendChild(suit);
  } else if (tile.kind === 'joker') {
    el.classList.add('joker');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = '★';
    el.appendChild(num);
    if (tile.representsValue !== undefined) {
      const r = document.createElement('span');
      r.className = 'represents';
      r.textContent = ` ${tile.representsColor?.[0] ?? '?'}${tile.representsValue}`;
      el.appendChild(r);
      const suit = document.createElement('span');
      suit.className = 'suit';
      suit.textContent = SUIT_GLYPH[tile.representsColor] ?? '';
      el.appendChild(suit);
    }
  }
  return el;
}
