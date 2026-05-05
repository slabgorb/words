import { buildBag } from './tiles.js';

export function buildInitialState({ participants, rng }) {
  const a = participants.find(p => p.side === 'a').userId;
  const b = participants.find(p => p.side === 'b').userId;

  const all = shuffle(buildBag(), rng);
  const rackA = all.slice(0, 14);
  const rackB = all.slice(14, 28);
  const pool = all.slice(28);

  const startSide = rng() < 0.5 ? 'a' : 'b';

  return {
    pool,
    racks: { a: rackA, b: rackB },
    table: [],
    initialMeldComplete: { a: false, b: false },
    sides: { a, b },
    activeUserId: startSide === 'a' ? a : b,
    scores: { a: 0, b: 0 },
    consecutiveDraws: 0,
    endedReason: null,
    winnerSide: null,
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
