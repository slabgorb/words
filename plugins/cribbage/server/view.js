export function cribbagePublicView({ state, viewerId }) {
  const viewerSide = state.sides.a === viewerId ? 0 : (state.sides.b === viewerId ? 1 : null);

  const hands = [
    viewerSide === 0 ? state.hands[0] : { count: state.hands[0].length },
    viewerSide === 1 ? state.hands[1] : { count: state.hands[1].length },
  ];

  const cribVisible = state.phase === 'show' || state.phase === 'done';

  return {
    phase: state.phase,
    dealer: state.dealer,
    deck: { count: state.deck.length },
    hands,
    pendingDiscards: [
      viewerSide === 0 ? state.pendingDiscards[0] : (state.pendingDiscards[0] != null),
      viewerSide === 1 ? state.pendingDiscards[1] : (state.pendingDiscards[1] != null),
    ],
    crib: cribVisible ? state.crib : { count: state.crib.length },
    starter: state.starter,
    pegging: state.pegging,
    scores: state.scores,
    showBreakdown: state.showBreakdown,
    acknowledged: state.acknowledged,
    sides: state.sides,
    activeUserId: state.activeUserId,
    endedReason: state.endedReason,
    winnerSide: state.winnerSide,
  };
}
