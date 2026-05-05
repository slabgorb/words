export const COLORS = ['red', 'blue', 'orange', 'black'];
export const NUMBERS = Array.from({ length: 13 }, (_, i) => i + 1);

const COLOR_PREFIX = { red: 'r', blue: 'b', orange: 'o', black: 'k' };

export function buildBag() {
  const tiles = [];
  for (const color of COLORS) {
    const p = COLOR_PREFIX[color];
    for (const value of NUMBERS) {
      tiles.push({ id: `${p}${value}a`, kind: 'numbered', color, value });
      tiles.push({ id: `${p}${value}b`, kind: 'numbered', color, value });
    }
  }
  tiles.push({ id: 'joker1', kind: 'joker' });
  tiles.push({ id: 'joker2', kind: 'joker' });
  return tiles;
}

export function isJoker(tile) {
  return tile?.kind === 'joker';
}

export function tileValue(tile, opts = {}) {
  if (tile.kind === 'numbered') return tile.value;
  if (tile.kind === 'joker') {
    if (opts.asPlayed && typeof tile.representsValue === 'number') return tile.representsValue;
    return 30;
  }
  throw new Error(`unknown tile kind: ${tile.kind}`);
}
