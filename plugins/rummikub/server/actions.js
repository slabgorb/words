import { validateEndState } from './validate.js';
import { computeFinalScores } from './scoring.js';

export function applyRummikubAction({ state, action, actorId, rng }) {
  const actorSide = state.sides.a === actorId ? 'a' : 'b';
  const oppSide = actorSide === 'a' ? 'b' : 'a';
  const oppUserId = state.sides[oppSide];

  switch (action.type) {
    case 'commit-turn': return doCommitTurn(state, action.payload, actorSide, oppSide, oppUserId);
    case 'draw-tile': return doDrawTile(state, actorSide, oppUserId, rng);
    case 'resign': return doResign(state, actorSide);
    default: return { error: `unknown action: ${action.type}` };
  }
}

function doCommitTurn(state, payload, actorSide, oppSide, oppUserId) {
  const proposedRack = payload?.rack;
  const proposedTable = payload?.table;
  if (!Array.isArray(proposedRack) || !Array.isArray(proposedTable)) {
    return { error: 'commit-turn payload requires {rack, table} arrays' };
  }
  const validation = validateEndState(
    {
      rack: state.racks[actorSide],
      table: state.table,
      initialMeldComplete: state.initialMeldComplete[actorSide],
    },
    { rack: proposedRack, table: proposedTable }
  );
  if (!validation.valid) return { error: validation.reason };

  const next = {
    ...state,
    racks: { ...state.racks, [actorSide]: proposedRack },
    table: proposedTable,
    initialMeldComplete: { ...state.initialMeldComplete, [actorSide]: true },
    activeUserId: oppUserId,
    consecutiveDraws: 0,
  };

  if (proposedRack.length === 0) {
    const final = computeFinalScores({ winnerSide: actorSide, racks: next.racks });
    return {
      state: {
        ...next,
        endedReason: 'rummikub',
        winnerSide: final.winnerSide,
        scores: addScores(state.scores, final.scoreDeltas),
      },
      ended: true,
      scoreDelta: final.scoreDeltas,
    };
  }

  return { state: next, ended: false };
}

function doDrawTile(state, actorSide, oppUserId, rng) {
  if (state.pool.length === 0) {
    const final = computeFinalScores({ winnerSide: null, racks: state.racks });
    return {
      state: {
        ...state,
        endedReason: 'pool-exhausted',
        winnerSide: final.winnerSide,
        scores: addScores(state.scores, final.scoreDeltas),
      },
      ended: true,
      scoreDelta: final.scoreDeltas,
    };
  }
  const idx = Math.floor(rng() * state.pool.length);
  const drawn = state.pool[idx];
  const pool = [...state.pool.slice(0, idx), ...state.pool.slice(idx + 1)];
  const racks = { ...state.racks, [actorSide]: [...state.racks[actorSide], drawn] };
  return {
    state: {
      ...state,
      pool,
      racks,
      activeUserId: oppUserId,
      consecutiveDraws: state.consecutiveDraws + 1,
    },
    ended: false,
  };
}

function doResign(state, actorSide) {
  const winner = actorSide === 'a' ? 'b' : 'a';
  return {
    state: { ...state, endedReason: 'resign', winnerSide: winner },
    ended: true,
  };
}

function addScores(base, delta) {
  return { a: base.a + (delta.a ?? 0), b: base.b + (delta.b ?? 0) };
}
