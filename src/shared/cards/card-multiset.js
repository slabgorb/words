export function cardIdsOf(state) {
  const out = [];
  for (const value of Object.values(state)) {
    collect(value, out);
  }
  return out;
}

function collect(value, out) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
    return;
  }
  if (typeof value === 'object') {
    if (typeof value.id === 'string') {
      out.push(value.id);
      return;
    }
    // Plain container objects ({ a: [...], b: [...] }) — recurse into values.
    for (const v of Object.values(value)) collect(v, out);
  }
  // Primitives are ignored.
}

export function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const counts = new Map();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of b) {
    const n = counts.get(x);
    if (!n) return false;
    counts.set(x, n - 1);
  }
  return true;
}
