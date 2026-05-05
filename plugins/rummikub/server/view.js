export function rummikubPublicView({ state, viewerId }) {
  const viewerSide = state.sides.a === viewerId ? 'a' : (state.sides.b === viewerId ? 'b' : null);

  const racks = {};
  let opponentRackCount = 0;
  if (viewerSide) {
    racks[viewerSide] = state.racks[viewerSide];
    const oppSide = viewerSide === 'a' ? 'b' : 'a';
    opponentRackCount = state.racks[oppSide]?.length ?? 0;
  }

  return {
    table: state.table,
    racks,
    opponentRack: { count: opponentRackCount },
    pool: { count: state.pool.length },
    initialMeldComplete: state.initialMeldComplete,
    sides: state.sides,
    activeUserId: state.activeUserId,
    scores: state.scores,
    endedReason: state.endedReason,
    winnerSide: state.winnerSide,
  };
}
