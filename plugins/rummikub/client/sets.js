import { COLORS, isJoker } from './tiles.js';

export function classifySet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return null;
  if (looksLikeRun(tiles)) return 'run';
  if (looksLikeGroup(tiles)) return 'group';
  return null;
}

export function isValidSet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return false;
  const completed = withInferredJokers(tiles);
  for (const t of completed) {
    if (isJoker(t)) {
      if (typeof t.representsValue !== 'number') return false;
      if (typeof t.representsColor !== 'string') return false;
    }
  }
  const kind = classifySet(completed);
  if (!kind) return false;
  if (kind === 'run') return validateRun(completed);
  if (kind === 'group') return validateGroup(completed);
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
  const completed = withInferredJokers(tiles);
  const kind = classifySet(completed);
  if (kind === 'run') return runValue(completed);
  if (kind === 'group') return groupValue(completed);
  return 0;
}

// When a joker has no explicit representation, infer it from set context.
// Returns a new array with inferred jokers when context is unambiguous;
// otherwise returns the input unchanged. Already-annotated jokers are preserved.
export function withInferredJokers(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return tiles;
  const needsInference = tiles.some(t => isJoker(t)
    && (typeof t.representsValue !== 'number' || typeof t.representsColor !== 'string'));
  if (!needsInference) return tiles;
  return inferAsRun(tiles) ?? inferAsGroup(tiles) ?? tiles;
}

function inferAsRun(tiles) {
  const known = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (!isJoker(t)) known.push({ t, i });
    else if (typeof t.representsValue === 'number' && typeof t.representsColor === 'string') {
      known.push({ t, i, joker: true });
    }
  }
  if (known.length === 0) return null;
  const colors = new Set(known.map(x => x.joker ? x.t.representsColor : x.t.color));
  if (colors.size !== 1) return null;
  const runColor = [...colors][0];
  const startVals = known.map(x => (x.joker ? x.t.representsValue : x.t.value) - x.i);
  if (new Set(startVals).size !== 1) return null;
  const startVal = startVals[0];
  if (startVal < 1 || startVal + tiles.length - 1 > 13) return null;
  return tiles.map((t, i) => {
    if (!isJoker(t)) return t;
    if (typeof t.representsValue === 'number' && typeof t.representsColor === 'string') return t;
    return { ...t, representsColor: runColor, representsValue: startVal + i };
  });
}

function inferAsGroup(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return null;
  const known = tiles.filter(t => !isJoker(t));
  const annotatedJokers = tiles.filter(t => isJoker(t)
    && typeof t.representsValue === 'number' && typeof t.representsColor === 'string');
  const knownVals = [...known.map(t => t.value), ...annotatedJokers.map(t => t.representsValue)];
  if (knownVals.length === 0) return null;
  if (new Set(knownVals).size !== 1) return null;
  const groupVal = knownVals[0];
  const usedColors = new Set([
    ...known.map(t => t.color),
    ...annotatedJokers.map(t => t.representsColor),
  ]);
  const availableColors = COLORS.filter(c => !usedColors.has(c));
  const unsetJokers = tiles.filter(t => isJoker(t)
    && (typeof t.representsValue !== 'number' || typeof t.representsColor !== 'string'));
  if (unsetJokers.length > availableColors.length) return null;
  let colorIdx = 0;
  return tiles.map(t => {
    if (!isJoker(t)) return t;
    if (typeof t.representsValue === 'number' && typeof t.representsColor === 'string') return t;
    return { ...t, representsColor: availableColors[colorIdx++], representsValue: groupVal };
  });
}
