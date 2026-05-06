// Deterministic LCG used across all backgammon tests.
export function det(seed = 0) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export const PARTICIPANTS = [
  { userId: 1, side: 'a' },
  { userId: 2, side: 'b' },
];
