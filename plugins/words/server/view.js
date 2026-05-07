export function wordsPublicView({ state, viewerId }) {
  const viewerSide =
    state.sides?.a === viewerId ? 'a' :
    state.sides?.b === viewerId ? 'b' : null;
  if (!viewerSide) {
    // Unknown viewer — return a fully redacted view.
    return {
      variant: state.variant,
      board: state.board,
      bag: { count: state.bag.length },
      racks: {},
      opponentRack: { count: 0 },
      scores: state.scores,
      sides: state.sides,
      activeUserId: state.activeUserId,
      initialMoveDone: state.initialMoveDone,
      endedReason: state.endedReason,
      winnerSide: state.winnerSide,
    };
  }
  const oppSide = viewerSide === 'a' ? 'b' : 'a';
  return {
    variant: state.variant,
    board: state.board,
    bag: { count: state.bag.length },
    racks: { [viewerSide]: state.racks[viewerSide] },
    opponentRack: { count: state.racks[oppSide]?.length ?? 0 },
    scores: state.scores,
    sides: state.sides,
    activeUserId: state.activeUserId,
    initialMoveDone: state.initialMoveDone,
    endedReason: state.endedReason,
    winnerSide: state.winnerSide,
  };
}
