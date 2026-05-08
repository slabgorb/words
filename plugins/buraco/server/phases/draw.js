export function applyDraw(state, payload, side) {
  if (state.phase !== 'draw' || state.hasDrawn) {
    return { error: 'not in draw phase or already drawn' };
  }
  const { source } = payload ?? {};
  if (source === 'stock') {
    if (state.stock.length === 0) return { error: 'stock is empty' };
    const drawn = state.stock[state.stock.length - 1];
    return {
      state: {
        ...state,
        stock: state.stock.slice(0, -1),
        hands: { ...state.hands, [side]: [...state.hands[side], drawn] },
        phase: 'meld',
        hasDrawn: true,
        lastEvent: { kind: 'draw', side, summary: `${side} drew from stock` },
      },
    };
  }
  if (source === 'discard') {
    if (state.discard.length === 0) return { error: 'discard pile is empty' };
    return {
      state: {
        ...state,
        discard: [],
        hands: { ...state.hands, [side]: [...state.hands[side], ...state.discard] },
        phase: 'meld',
        hasDrawn: true,
        lastEvent: { kind: 'draw', side, summary: `${side} took the discard pile (${state.discard.length} cards)` },
      },
    };
  }
  return { error: `unknown draw source: ${source}` };
}
