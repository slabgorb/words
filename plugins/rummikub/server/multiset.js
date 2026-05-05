export function tileIdsOf({ rack = [], table = [] }) {
  const ids = [];
  for (const tile of rack) ids.push(tile.id);
  for (const set of table) for (const tile of set) ids.push(tile.id);
  return ids;
}

function counts(ids) {
  const m = new Map();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const ca = counts(a), cb = counts(b);
  if (ca.size !== cb.size) return false;
  for (const [k, v] of ca) if (cb.get(k) !== v) return false;
  return true;
}

export function multisetDiff(before, after) {
  const cb = counts(before), ca = counts(after);
  const added = [], removed = [];
  for (const [k, v] of ca) {
    const b = cb.get(k) ?? 0;
    if (v > b) for (let i = 0; i < v - b; i++) added.push(k);
  }
  for (const [k, v] of cb) {
    const a = ca.get(k) ?? 0;
    if (v > a) for (let i = 0; i < v - a; i++) removed.push(k);
  }
  return { added, removed };
}
