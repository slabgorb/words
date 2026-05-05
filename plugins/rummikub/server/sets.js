import { COLORS, isJoker } from './tiles.js';

export function classifySet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return null;
  if (looksLikeRun(tiles)) return 'run';
  if (looksLikeGroup(tiles)) return 'group';
  return null;
}

export function isValidSet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return false;
  for (const t of tiles) {
    if (isJoker(t)) {
      if (typeof t.representsValue !== 'number') return false;
      if (typeof t.representsColor !== 'string') return false;
    }
  }
  const kind = classifySet(tiles);
  if (!kind) return false;
  if (kind === 'run') return validateRun(tiles);
  if (kind === 'group') return validateGroup(tiles);
  return false;
}

function tileColor(t) { return isJoker(t) ? t.representsColor : t.color; }
function tileNumber(t) { return isJoker(t) ? t.representsValue : t.value; }

function looksLikeRun(tiles) {
  const colors = new Set(tiles.map(tileColor));
  return colors.size === 1;
}

function looksLikeGroup(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return false;
  const values = new Set(tiles.map(tileNumber));
  return values.size === 1;
}

function validateRun(tiles) {
  const color = tileColor(tiles[0]);
  for (let i = 0; i < tiles.length; i++) {
    if (tileColor(tiles[i]) !== color) return false;
    if (tileNumber(tiles[i]) !== tileNumber(tiles[0]) + i) return false;
    if (tileNumber(tiles[i]) < 1 || tileNumber(tiles[i]) > 13) return false;
  }
  return true;
}

function validateGroup(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return false;
  const value = tileNumber(tiles[0]);
  const colors = new Set();
  for (const t of tiles) {
    if (tileNumber(t) !== value) return false;
    const c = tileColor(t);
    if (!COLORS.includes(c)) return false;
    if (colors.has(c)) return false;
    colors.add(c);
  }
  return true;
}

export function runValue(tiles) {
  return tiles.reduce((sum, t) => sum + tileNumber(t), 0);
}

export function groupValue(tiles) {
  const value = tileNumber(tiles[0]);
  return value * tiles.length;
}

export function setValue(tiles) {
  const kind = classifySet(tiles);
  if (kind === 'run') return runValue(tiles);
  if (kind === 'group') return groupValue(tiles);
  return 0;
}
