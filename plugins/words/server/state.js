import { BOARD_SIZE, getRules, DEFAULT_VARIANT } from './board.js';

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildInitialState({ participants, rng, variant = DEFAULT_VARIANT }) {
  const rules = getRules(variant);
  const bag = shuffle([...rules.tileBag], rng);
  const racks = { a: bag.splice(0, 7), b: bag.splice(0, 7) };
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  const a = participants.find(p => p.side === 'a')?.userId;
  const b = participants.find(p => p.side === 'b')?.userId;
  const startSide = rng() < 0.5 ? 'a' : 'b';
  return {
    variant: rules.variant,
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
