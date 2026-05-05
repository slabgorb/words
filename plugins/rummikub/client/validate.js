import { tileIdsOf, multisetEqual } from './multiset.js';
import { isValidSet, setValue } from './sets.js';
import { isJoker } from './tiles.js';

export function validateEndState(start, end) {
  // 1. Multiset balance
  const startIds = tileIdsOf({ rack: start.rack, table: start.table });
  const endIds = tileIdsOf({ rack: end.rack, table: end.table });
  if (!multisetEqual(startIds, endIds)) {
    return { valid: false, reason: 'multiset balance violated: tiles invented or vanished' };
  }

  // 2. Rack subset
  const startRackIds = new Set(start.rack.map(t => t.id));
  for (const t of end.rack) {
    if (!startRackIds.has(t.id)) {
      return { valid: false, reason: `tile ${t.id} appeared in rack but was not there at turn start` };
    }
  }

  // 3. At least one rack tile played
  if (end.rack.length >= start.rack.length) {
    return { valid: false, reason: 'must play at least one tile from rack (or use draw-tile action)' };
  }

  // 4. Every end-state set valid
  for (const set of end.table) {
    if (!isValidSet(set)) {
      return { valid: false, reason: `invalid set on table: ${set.map(t => t.id).join(',')}` };
    }
  }

  // 5. Initial meld constraint
  if (!start.initialMeldComplete) {
    const startKeys = start.table.map(setKey);
    const endKeys = end.table.map(setKey);

    // All start-table sets must still appear unchanged in end-table
    for (const key of startKeys) {
      if (!endKeys.includes(key)) {
        return { valid: false, reason: 'initial meld: cannot modify existing sets' };
      }
    }

    // Identify new sets (not present in start.table)
    const startKeySet = new Set(startKeys);
    const newSets = end.table.filter(s => !startKeySet.has(setKey(s)));

    // New sets must be composed entirely of player's rack tiles
    for (const set of newSets) {
      for (const tile of set) {
        if (!startRackIds.has(tile.id)) {
          return { valid: false, reason: 'initial meld: new sets must be composed entirely of your rack tiles' };
        }
      }
    }

    const meldPoints = newSets.reduce((sum, s) => sum + setValue(s), 0);
    if (meldPoints < 30) {
      return { valid: false, reason: `initial meld must be at least 30 points (got ${meldPoints})` };
    }
  }

  // 6. Joker harvest
  const startJokersByLocation = collectJokersFromTable(start.table);
  const endTableJokerSetKeys = new Map();
  for (const t of end.rack) {
    if (isJoker(t)) endTableJokerSetKeys.set(t.id, null);
  }
  for (const set of end.table) {
    for (const t of set) {
      if (isJoker(t)) endTableJokerSetKeys.set(t.id, setKey(set));
    }
  }
  const startKeySet = new Set(start.table.map(setKey));
  const preservedKeys = new Set(end.table.map(setKey).filter(k => startKeySet.has(k)));

  for (const [jokerId, startKey] of startJokersByLocation) {
    const endKey = endTableJokerSetKeys.get(jokerId);
    if (endKey === null || endKey === undefined) {
      return { valid: false, reason: `joker ${jokerId} cannot be returned to rack` };
    }
    // Joker stayed in the same preserved set — fine
    if (endKey === startKey && preservedKeys.has(endKey)) {
      continue;
    }
    // Joker moved to a preserved set — not allowed
    if (preservedKeys.has(endKey)) {
      return { valid: false, reason: `joker ${jokerId} was harvested but is still in a preserved set — must be in a new set` };
    }
    // Joker is in a new set — fine
  }

  return { valid: true };
}

function setKey(set) {
  return set.map(t => t.id).slice().sort().join(',');
}

function collectJokersFromTable(table) {
  const out = new Map();
  for (const set of table) {
    for (const t of set) {
      if (isJoker(t)) out.set(t.id, setKey(set));
    }
  }
  return out;
}
