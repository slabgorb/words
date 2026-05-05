import { validateEndState } from './validate.js';
import { withInferredJokers, setValue } from './sets.js';
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

  const startKeys = new Set(state.table.map(s => s.map(t => t.id).sort().join(',')));
  let meldPoints = 0;
  for (const set of proposedTable) {
    const key = set.map(t => t.id).sort().join(',');
    if (!startKeys.has(key)) meldPoints += setValue(set);
  }
  const tilesPlayed = state.racks[actorSide].length - proposedRack.length;
  const openedInitialMeld =
    !state.initialMeldComplete[actorSide] && proposedRack !== state.racks[actorSide];
  const summary = {
    kind: 'commit-turn',
    meldPoints,
    tilesPlayed,
    openedInitialMeld,
  };

  const persistedTable = proposedTable.map(set => withInferredJokers(set));

  const next = {
    ...state,
    racks: { ...state.racks, [actorSide]: proposedRack },
    table: persistedTable,
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
      summary,
    };
  }

  return { state: next, ended: false, summary };
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
      summary: { kind: 'draw-tile' },
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
    summary: { kind: 'draw-tile' },
  };
}

function doResign(state, actorSide) {
  const winner = actorSide === 'a' ? 'b' : 'a';
  return {
    state: { ...state, endedReason: 'resign', winnerSide: winner },
    ended: true,
    summary: { kind: 'resign' },
  };
}

function addScores(base, delta) {
  return { a: base.a + (delta.a ?? 0), b: base.b + (delta.b ?? 0) };
}
