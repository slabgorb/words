// Adapter between the Words plugin's game state and the @scrabble-solver
// upstream library. Four exports:
//
//   buildSolverConfig(variant)  → Config instance for the WwF/Scrabble ruleset
//   buildSolverBoard(state)     → Board instance populated from state.board
//   buildSolverTiles(rack)      → Tile[] from a rack of letter strings
//   placementFromResult(result) → ResultJson → Words 'move' action
//
// Notes on the upstream API (verified against
// node_modules/@scrabble-solver/types/build/*.d.ts and the Task 0 smoke
// test):
//
//   - Config is constructed with `new Config(configJson)`. The blank tile
//     is configured via `blanksCount` + `blankScore`; it must NOT appear in
//     the `tiles` array.
//   - `bonuses` items are `{ type, multiplier, x, y }` with `type` one of
//     the BONUS_CHARACTER / BONUS_WORD constants from @scrabble-solver/constants.
//     There is no 'start' bonus type — Board.center is the implicit start cell.
//   - The `game` field is the Game enum string; we use 'scrabble' for both
//     'wwf' and 'scrabble' variants since the difference is captured by
//     our tiles/bonuses/bingo config.
//
// Center-cell (7,7) bonus handling:
//   Both WwF and Scrabble mark (7,7) as DW in our premium grid. The Task 0
//   smoke test produced legal opening plays with an EMPTY bonuses array, so
//   the solver does not treat the center specially as a bonus square — it
//   only uses Board.center to know where the first play must cross. We
//   therefore INCLUDE (7,7) as a DW bonus so the opening-play double-word
//   score (standard Scrabble/WwF scoring) is applied by the solver.
//
// Cell immutability:
//   `Cell.isEmpty` is declared `readonly`. After Board.create the cells
//   have `isEmpty: true` and `tile: Tile.Null`. Mutating just `cell.tile`
//   leaves `isEmpty` stuck at true, which would confuse solve() and our
//   own consumers. We therefore replace the cell wholesale with a new Cell
//   instance in `updateCell`.

import { Board, Cell, Config, Tile } from '@scrabble-solver/types';
import { BONUS_CHARACTER, BONUS_WORD } from '@scrabble-solver/constants';
import { getRules, BOARD_SIZE } from '../board.js';

// Map our 'TW'/'DW'/'TL'/'DL' premium labels to scrabble-solver bonus shape.
const PREMIUM_TO_BONUS = {
  TW: { type: BONUS_WORD,      multiplier: 3 },
  DW: { type: BONUS_WORD,      multiplier: 2 },
  TL: { type: BONUS_CHARACTER, multiplier: 3 },
  DL: { type: BONUS_CHARACTER, multiplier: 2 },
};

export function buildSolverConfig(variant) {
  const rules = getRules(variant);

  // tileBag is a flat array of letters; count each. Exclude '_' — blanks
  // are configured via blanksCount/blankScore separately.
  const counts = {};
  for (const letter of rules.tileBag) counts[letter] = (counts[letter] ?? 0) + 1;
  const blanksCount = counts['_'] ?? 0;
  delete counts['_'];
  const tiles = Object.entries(counts).map(([character, count]) => ({
    character,
    count,
    score: rules.letterValue[character] ?? 0,
  }));

  const bonuses = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const label = rules.premiums[y][x];
      if (!label) continue;
      const mapped = PREMIUM_TO_BONUS[label];
      if (mapped) bonuses.push({ ...mapped, x, y });
    }
  }

  return new Config({
    name: `gamebox-${variant}`,
    game: 'scrabble',
    locale: 'en-US',
    boardWidth: BOARD_SIZE,
    boardHeight: BOARD_SIZE,
    rackSize: 7,
    blanksCount,
    blankScore: 0,
    bingo: { score: rules.bingoBonus },
    bonuses,
    tiles,
  });
}

export function buildSolverBoard(state) {
  const board = Board.create(BOARD_SIZE, BOARD_SIZE);
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = state.board[y][x];
      if (!cell) continue;
      board.updateCell(x, y, (c) => new Cell({
        isEmpty: false,
        tile: new Tile({ character: cell.letter, isBlank: !!cell.blank }),
        x: c.x,
        y: c.y,
      }));
    }
  }
  return board;
}

export function buildSolverTiles(rack) {
  return rack.map((letter) => {
    const isBlank = letter === '_';
    return new Tile({
      character: isBlank ? '_' : letter,
      isBlank,
    });
  });
}

// `newCells` must contain only the cells played from the rack this turn —
// the engine rejects any placement entry that lands on an occupied cell, so
// passing solver's full `result.cells` (which includes anchor tiles already
// on the board) would stall every cross-word and extension play.
export function placementFromResult(newCells) {
  return {
    type: 'move',
    payload: {
      placement: newCells.map((cell) => ({
        r: cell.y,
        c: cell.x,
        letter: cell.tile.character,
        blank: !!cell.tile.isBlank,
      })),
    },
  };
}
