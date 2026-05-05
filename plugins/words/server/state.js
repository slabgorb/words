import { TILE_BAG, BOARD_SIZE } from './board.js';

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildInitialState({ participants, rng }) {
  const bag = shuffle([...TILE_BAG], rng);
  const racks = { a: bag.splice(0, 7), b: bag.splice(0, 7) };
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  const a = participants.find(p => p.side === 'a')?.userId;
  const b = participants.find(p => p.side === 'b')?.userId;
  const startSide = rng() < 0.5 ? 'a' : 'b';
  return {
    bag,
    board,
    racks,
    scores: { a: 0, b: 0 },
    sides: { a, b },
    activeUserId: startSide === 'a' ? a : b,
    consecutiveScorelessTurns: 0,
    initialMoveDone: false,
    endedReason: null,
    winnerSide: null,
  };
}
