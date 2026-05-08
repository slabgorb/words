export function assertCardConservation(state) {
  const ids = [
    ...state.stock.map(c => c.id),
    ...state.discard.map(c => c.id),
    ...state.hands.a.map(c => c.id),
    ...state.hands.b.map(c => c.id),
    ...state.mortos.a.map(c => c.id),
    ...state.mortos.b.map(c => c.id),
    ...state.melds.a.flat().map(c => c.id),
    ...state.melds.b.flat().map(c => c.id),
  ];
  if (ids.length !== 108) {
    throw new Error(`card conservation: expected 108 cards, got ${ids.length}`);
  }
  if (new Set(ids).size !== 108) {
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} (×${n})`);
    throw new Error(`card conservation: duplicate ids: ${dupes.join(', ')}`);
  }
}

export function assertOpponentMeldsUnchanged(prev, next, currentSide) {
  const opp = currentSide === 'a' ? 'b' : 'a';
  const a = prev.melds[opp];
  const b = next.melds[opp];
  if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`opponent (${opp}) melds were mutated`);
  }
}
