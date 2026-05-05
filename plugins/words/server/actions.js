import {
  validatePlacement, extractWords, scoreMove,
  applyMove, detectGameEnd, applyEndGameAdjustment,
} from './engine.js';
import { loadDictionary } from './dictionary.js';

let _dict;
function dict() { return _dict ??= loadDictionary(); }

// Translate a plugin-state object to the shape engine.js expects.
function toEngine(state) {
  return {
    bag: state.bag,
    board: state.board,
    racks: state.racks,
    scores: state.scores,
    currentTurn: state.activeUserId === state.sides.a ? 'a' : 'b',
    consecutiveScorelessTurns: state.consecutiveScorelessTurns,
  };
}

// Merge engine result back into the plugin state (preserving sides, etc.)
function fromEngine(plugin, eng, { initialMoveDone = plugin.initialMoveDone } = {}) {
  return {
    ...plugin,
    bag: eng.bag,
    board: eng.board,
    racks: eng.racks,
    scores: eng.scores,
    activeUserId: eng.currentTurn === 'a' ? plugin.sides.a : plugin.sides.b,
    consecutiveScorelessTurns: eng.consecutiveScorelessTurns,
    initialMoveDone,
  };
}

function actorSide(state, actorId) {
  if (state.sides.a === actorId) return 'a';
  if (state.sides.b === actorId) return 'b';
  return null;
}

export function applyWordsAction({ state, action, actorId, rng }) {
  // Defensive check for legacy state shape: must have sides mapping
  if (!state.sides || typeof state.sides.a !== 'number' || typeof state.sides.b !== 'number') {
    return { error: 'state missing sides mapping (legacy game; needs migration)' };
  }
  const side = actorSide(state, actorId);
  if (!side) return { error: 'not a participant' };

  switch (action.type) {
    case 'move':   return doMove(state, action.payload, side);
    case 'pass':   return doPass(state, side);
    case 'swap':   return doSwap(state, action.payload, side, rng);
    case 'resign': return doResign(state, side);
    default:       return { error: `unknown action: ${action.type}` };
  }
}

function doMove(state, payload, side) {
  const placement = payload?.placement;
  if (!Array.isArray(placement) || placement.length === 0) {
    return { error: 'placement required' };
  }
  const isFirstMove = !state.initialMoveDone;
  const eng = toEngine(state);

  const geo = validatePlacement(eng.board, placement, isFirstMove);
  if (!geo.valid) return { error: geo.reason };

  // Verify rack contains every placed tile (consume blanks as '_').
  const rack = state.racks[side].slice();
  for (const t of placement) {
    const key = t.blank ? '_' : t.letter;
    const i = rack.indexOf(key);
    if (i === -1) return { error: `rack-mismatch: ${key}` };
    rack.splice(i, 1);
  }

  const { mainWord, crossWords } = extractWords(eng.board, placement, geo.axis);
  const allWords = [mainWord, ...crossWords].filter(Boolean);
  if (allWords.length === 0) return { error: 'no-word-formed' };
  for (const w of allWords) {
    if (!dict().isWord(w.text)) return { error: `invalid word: ${w.text}` };
  }
  const scoreDelta = scoreMove(eng.board, placement, mainWord, crossWords);

  let nextEng = applyMove(eng, { playerId: side, kind: 'play', placement, scoreDelta });
  let endReason = detectGameEnd(nextEng);
  if (endReason) nextEng = applyEndGameAdjustment(nextEng, endReason, null);

  let next = fromEngine(state, nextEng, { initialMoveDone: true });
  if (endReason) {
    next.endedReason = endReason;
    next.winnerSide = nextEng.winner ?? null;
  }
  const summary = {
    kind: 'play',
    words: allWords.map(w => w.text),
    scoreDelta,
  };
  return {
    state: next,
    ended: !!endReason,
    scoreDelta: { [side]: scoreDelta, [side === 'a' ? 'b' : 'a']: 0 },
    summary,
  };
}

function doPass(state, side) {
  const eng = toEngine(state);
  let nextEng = applyMove(eng, { playerId: side, kind: 'pass' });
  let endReason = detectGameEnd(nextEng);
  if (endReason) nextEng = applyEndGameAdjustment(nextEng, endReason, null);
  let next = fromEngine(state, nextEng);
  if (endReason) {
    next.endedReason = endReason;
    next.winnerSide = nextEng.winner ?? null;
  }
  return { state: next, ended: !!endReason, summary: { kind: 'pass' } };
}

function doSwap(state, payload, side, rng) {
  const tiles = payload?.tiles;
  if (!Array.isArray(tiles) || tiles.length === 0) return { error: 'tiles required' };
  if (state.bag.length < 7) return { error: 'bag-too-small' };
  // Verify rack contents
  const rack = state.racks[side].slice();
  for (const letter of tiles) {
    const i = rack.indexOf(letter);
    if (i === -1) return { error: `tile not in rack: ${letter}` };
    rack.splice(i, 1);
  }
  const eng = toEngine(state);
  let nextEng = applyMove(eng, { playerId: side, kind: 'swap', swapTiles: tiles });

  // Shuffle the bag after swap to prevent the just-returned tiles from being
  // drawn back in known order. The engine's swap returns swapped tiles to the
  // END of the bag — caller may shuffle later.
  if (rng) {
    nextEng.bag = nextEng.bag.slice();
    for (let i = nextEng.bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [nextEng.bag[i], nextEng.bag[j]] = [nextEng.bag[j], nextEng.bag[i]];
    }
  }

  let endReason = detectGameEnd(nextEng);
  if (endReason) nextEng = applyEndGameAdjustment(nextEng, endReason, null);
  let next = fromEngine(state, nextEng);
  if (endReason) {
    next.endedReason = endReason;
    next.winnerSide = nextEng.winner ?? null;
  }
  return { state: next, ended: !!endReason, summary: { kind: 'swap', count: tiles.length } };
}

function doResign(state, side) {
  const eng = toEngine(state);
  const nextEng = applyEndGameAdjustment(eng, 'resigned', side);
  const next = fromEngine(state, nextEng);
  next.endedReason = 'resign';
  next.winnerSide = nextEng.winner;
  return { state: next, ended: true, summary: { kind: 'resign' } };
}
