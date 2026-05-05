export function tileEl(tile) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.tileId = tile.id;
  if (tile.kind === 'numbered') {
    el.classList.add(`color-${tile.color}`);
    el.textContent = tile.value;
  } else if (tile.kind === 'joker') {
    el.classList.add('joker');
    el.textContent = '★';
    if (tile.representsValue !== undefined) {
      const r = document.createElement('span');
      r.className = 'represents';
      r.textContent = ` ${tile.representsColor?.[0] ?? '?'}${tile.representsValue}`;
      el.appendChild(r);
    }
  }
  return el;
}
