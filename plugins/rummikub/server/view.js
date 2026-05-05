export function rummikubPublicView({ state, viewerId }) {
  const viewerSide = state.sides.a === viewerId ? 'a' : (state.sides.b === viewerId ? 'b' : null);
  const oppSide = viewerSide === 'a' ? 'b' : 'a';

  const racks = {};
  if (viewerSide) racks[viewerSide] = state.racks[viewerSide];

  return {
    table: state.table,
    racks,
    opponentRack: { count: state.racks[oppSide]?.length ?? 0 },
    pool: { count: state.pool.length },
    initialMeldComplete: state.initialMeldComplete,
    sides: state.sides,
    activeUserId: state.activeUserId,
    scores: state.scores,
    endedReason: state.endedReason,
    winnerSide: state.winnerSide,
  };
}
