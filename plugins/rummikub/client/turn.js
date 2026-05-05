let snapshot = null;
let tentative = null;

export function beginTurn(rack, table) {
  snapshot = { rack: deepClone(rack), table: deepCloneTable(table) };
  tentative = { rack: deepClone(rack), table: deepCloneTable(table) };
}

export function getTentative() { return tentative; }
export function getSnapshot() { return snapshot; }

export function resetTurn() {
  if (!snapshot) return;
  tentative = { rack: deepClone(snapshot.rack), table: deepCloneTable(snapshot.table) };
}

export function moveTileTo(tileId, target) {
  if (!tentative) return;
  let tile = removeFromRack(tentative.rack, tileId);
  if (!tile) tile = removeFromTable(tentative.table, tileId);
  if (!tile) return;
  if (target.kind === 'rack') {
    if (tile.kind === 'joker') {
      delete tile.representsColor;
      delete tile.representsValue;
    }
    tentative.rack.push(tile);
  } else if (target.kind === 'set') {
    const set = tentative.table[target.setIdx];
    if (set) {
      const insertAt = target.position ?? set.length;
      set.splice(insertAt, 0, tile);
    }
  } else if (target.kind === 'new-set') {
    tentative.table.push([tile]);
  }
  pruneEmptySets(tentative.table);
}

export function hasPendingChanges() {
  return tentative && (tentative.rack.length !== snapshot.rack.length || !tableSame(tentative.table, snapshot.table));
}

function deepClone(arr) { return arr.map(t => ({ ...t })); }
function deepCloneTable(table) { return table.map(deepClone); }

function removeFromRack(rack, id) {
  const idx = rack.findIndex(t => t.id === id);
  if (idx < 0) return null;
  return rack.splice(idx, 1)[0];
}
function removeFromTable(table, id) {
  for (const set of table) {
    const idx = set.findIndex(t => t.id === id);
    if (idx >= 0) return set.splice(idx, 1)[0];
  }
  return null;
}
function pruneEmptySets(table) {
  for (let i = table.length - 1; i >= 0; i--) {
    if (table[i].length === 0) table.splice(i, 1);
  }
}
function tableSame(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) {
      if (a[i][j].id !== b[i][j].id) return false;
    }
  }
  return true;
}
