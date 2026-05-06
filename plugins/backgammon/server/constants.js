export const BOARD_SIZE = 24;

// Home boards by side. A moves toward higher indices; B toward lower.
export const HOME_INDICES = {
  a: [18, 19, 20, 21, 22, 23],
  b: [0, 1, 2, 3, 4, 5],
};

// Phases (see spec §4.2)
export const PHASE = Object.freeze({
  INITIAL_ROLL: 'initial-roll',
  PRE_ROLL: 'pre-roll',
  MOVING: 'moving',
  AWAITING_DOUBLE_RESPONSE: 'awaiting-double-response',
});

export const SIDES = Object.freeze(['a', 'b']);

export function opponent(side) {
  return side === 'a' ? 'b' : 'a';
}

// Cube cap (spec §4.5)
export const CUBE_CAP = 64;
