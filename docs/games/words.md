# Words

> Words With Friends clone (with a Scrabble variant). Place letter tiles to build interlocking words on a 15×15 grid.

| | |
|---|---|
| Plugin id | `words` |
| Players | 2 |
| Variants | `wwf` (default), `scrabble` |
| Board | 15 × 15 |
| Dictionary | ENABLE2K |
| Plugin dir | `plugins/words/` |

## Lineage

Two rule sets ship in the same plugin, selectable per game via the `variant` field:

- **`wwf`** — Words With Friends tile distribution, point values, premium-square layout, and 35-point bingo bonus. Source: *Words With Friends* — Wikipedia.
- **`scrabble`** — classic Scrabble tile distribution, premium-square layout, and 50-point bingo bonus.

Both variants share the engine, dictionary, board geometry, and turn flow.

## Components

### Board

15 × 15 cells. The center cell (7, 7) is a Double-Word square in both variants and serves as the start star.

Premium-square types: **DL** (double letter), **TL** (triple letter), **DW** (double word), **TW** (triple word). Layouts differ between `wwf` and `scrabble`; both are defined in `server/board.js`.

### Tiles

| Variant | Total tiles | Bingo bonus |
|---|---|---|
| `wwf` | 104 | 35 |
| `scrabble` | 100 | 50 |

WwF letter values (representative):

| Letter | Value | | Letter | Value |
|---|---|---|---|---|
| A, E, I, O, R, S, T | 1 | | F, M, P, W | 4 |
| D, L, N, U | 2 | | K, V | 5 |
| G, H, Y | 3 | | X | 8 |
| B, C | 4 | | J, Q, Z | 10 |
| blank | 0 | | | |

Distribution and Scrabble values are in `plugins/words/server/board.js`.

### Rack

7 tiles per player.

## Setup

1. Build the tile bag for the chosen variant; shuffle.
2. Deal 7 tiles to each rack.
3. Choose the starting side by coin flip.

## Turn structure

A player may take one of:

- **`move`** — place one or more tiles in a single line (row or column).
- **`pass`** — play nothing, draw nothing.
- **`swap`** — exchange some or all rack tiles for new ones from the bag.
- **`resign`** — concede.

### Move validation

A placement is legal when:

1. All tiles are inside the 15×15 grid and land on empty cells.
2. All tiles share a single row or column.
3. The span from min to max position along that axis is fully filled by new tiles plus existing tiles (no gaps).
4. **First move:** the placement must cover the center star (7, 7).
5. **Subsequent moves:** at least one new tile must be orthogonally adjacent to an existing tile.

The placement's words — the main word plus all crosswords formed — are then extracted and each is checked against the dictionary. If any word is not in the dictionary, the move is rejected.

### Scoring a move

For each word formed:

- Sum the value of each tile.
- Apply DL/TL multipliers to letter values for tiles newly placed on those premium cells.
- Apply DW/TW multipliers to the whole word for each new tile on those squares (multiplied compoundly if the word covers more than one).
- Premium squares only apply once: on the turn a tile is placed.
- Blank tiles contribute 0.

If the placement uses all 7 rack tiles, add the variant's **bingo bonus** (35 for WwF, 50 for Scrabble).

After a successful move, the rack is refilled from the bag up to 7 tiles (or as many as remain).

## End conditions

The game ends when either:

1. The bag is empty **and** one player empties their rack, **or**
2. Both players play scoreless turns (pass or swap) some number of times in succession (tracked by `consecutiveScorelessTurns`).

On end-of-game adjustment, leftover rack tile values are subtracted from each player's score. If one player emptied their rack, the opponent's leftover total is awarded to them.

## Implementation

### Files

| File | Responsibility |
|---|---|
| `plugin.js` | Plugin contract; wires `validate` aux route. |
| `server/state.js` | Initial state, deal, bag, racks. |
| `server/board.js` | Both variants' letter values, tile counts, premium layouts. |
| `server/engine.js` | Placement validation, word extraction, scoring, end-of-game adjustment. |
| `server/actions.js` | Dispatches `move`, `pass`, `swap`, `resign`. |
| `server/dictionary.js` | Loads ENABLE2K word list from `data/enable2k.txt`. |
| `server/view.js` | Per-viewer state redaction (hide opponent rack + bag tiles). |

### Action types

| Action | Payload | Effect |
|---|---|---|
| `move` | `{ placement: [{ r, c, letter, blank? }, ...] }` | Validate + score + apply; refill rack. |
| `pass` | — | Forfeit turn; increments scoreless counter. |
| `swap` | `{ tiles: [...] }` | Exchange tiles with bag; turn ends. |
| `resign` | — | Current player concedes. |

### Aux routes

| Route | Method | Purpose |
|---|---|---|
| `/api/games/:id/validate` | POST | Lets the client dry-run a placement: checks geometry, all formed words, and previewed score, without committing. |

### State shape

| Key | Description |
|---|---|
| `variant` | `'wwf'` or `'scrabble'`. |
| `bag` | Remaining tile letters. |
| `board` | 15 × 15 grid; each cell is `null` or `{ letter, byPlayer }`. |
| `racks` | `{ a, b }` — each player's letter array. |
| `scores` | `{ a, b }` — running scores. |
| `sides` | `{ a, b }` — userId per side. |
| `activeUserId` | Whose turn it is. |
| `consecutiveScorelessTurns` | For end-by-mutual-pass detection. |
| `initialMoveDone` | Toggles the first-move center-star rule off. |
| `endedReason`, `winnerSide` | Set when the game ends. |

## Alignment notes

- **Dictionary** — ENABLE2K is the legacy WwF/Lexulous lexicon. The plugin uses the same list for both variants; classic Scrabble's TWL/SOWPODS are not bundled.
- **Two variants in one plugin** — the host treats `variant` as game-creation metadata; UI selection lives in the client.

## AI players

A Claude-CLI-driven bot opponent is available, using the shared AI
infrastructure under `src/server/ai/` and a per-game adapter at
`plugins/words/server/ai/`.

Full design rationale: [`docs/superpowers/specs/2026-05-12-ai-players-words-design.md`](../superpowers/specs/2026-05-12-ai-players-words-design.md).

### Adapter files

| File | Responsibility |
|---|---|
| `trie.js` | Memoised ENABLE2K trie built from `data/enable2k.txt` via `@kamilmielnik/trie`. |
| `config.js` | Translates Words plugin state ↔ `@scrabble-solver/types` (Board, Config, Tile); maps WwF/Scrabble premium grids to `BONUS_CHARACTER` / `BONUS_WORD`; converts solver `ResultJson` cells back to Words `move` actions (preserving blanks). |
| `shortlist.js` | Runs the solver, dedups by placement signature, fills up to 5 diverse slots (top-score, best-bingo, best-leave, best-defense, safe-medium) plus optional pass/swap-worst. |
| `prompts.js` | Builds a 5-block prompt (header / ASCII board / rack / shortlist / JSON contract footer); parses LLM JSON replies (fenced or bare). |
| `words-player.js` | `chooseAction({ llm, persona, sessionId, state, botPlayerIdx })` — orchestrator's entry point. |

### Move generation

Uses `@scrabble-solver/solver` with an ENABLE2K trie. Both `wwf` and
`scrabble` variants are supported via `buildSolverConfig(variant)`, which
reads `state.variant`. The engine slices to the top 50 results by points
before running rack-leave and opponent-exposure heuristics; the final
shortlist passed to the LLM is 1–7 entries.

### Shortlist slots

| Slot | Selection |
|---|---|
| `top-score` | Highest-points play in the result set. |
| `best-bingo` | Highest-points play using all 7 rack tiles. |
| `best-leave` | Best rack-leave score among the top 25% by points. |
| `best-defense` | Lowest opponent-exposure score among the top 25%. |
| `safe-medium` | 60–80% of top-score, zero exposure, best leave. |
| `pass` | Included when no legal plays exist. |
| `swap-worst` | Included when the bag has ≥ 7 tiles **and** top-score is low (or the best leave is bad). |

### Variants

Both `wwf` (default — 35-point bingo, WwF premium grid, WwF letter
values) and `scrabble` (50-point bingo, standard Scrabble premium grid
and values) are supported. The variant is read from `state.variant` and
flows through to the solver config and the shortlist's bingo / score
thresholds.

### Personas

Words personas live in `data/ai-personas/` with a `games: [words]` scope.
Initial roster:

| id | flavor |
|---|---|
| `samantha` | Bingo hunter — trades short-term points for rack balance and bingo potential. |
| `suzie` | Defender — plays patiently, favors `best-defense`, avoids opening premium lanes. |
| `kurt` | Score maximizer — plays for points, favors `top-score`, takes bingos when offered. |

The lobby's persona picker filters by game via
`GET /api/ai/personas?game=words`.

### Stall behavior

Mirrors cribbage and backgammon. On an LLM parse error or unknown
`moveId`, the orchestrator retries once; on a second failure it
broadcasts a `bot_stalled` SSE with a reason code (e.g.
`invalid_response`, `illegal_move`). Words has no auto-actions and no
pending-sequence cache — every turn is a single LLM call.

### Testing

End-to-end and unit coverage lives in `test/ai-words-*.test.js`:

| File | Covers |
|---|---|
| `ai-words-trie.test.js` | ENABLE2K trie load and memoisation. |
| `ai-words-config.test.js` | State ↔ solver type conversion, premium grid mapping, blank round-trip. |
| `ai-words-shortlist.test.js` | Slot selection, dedup, pass/swap fallback. |
| `ai-words-prompts.test.js` | Prompt rendering and JSON reply parsing. |
| `ai-words-player.test.js` | `chooseAction` orchestration with a fake LLM. |
| `ai-words-deps-smoke.test.js` | Sanity check that the solver and trie deps load. |

### Limitations

- The bot reasons over the rendered board plus a shortlist of pre-scored
  candidate moves; it does not consult a probabilistic rack-evaluation
  table or simulate opponent draws.
- The shortlist is capped at 7 entries; very rich positions are not
  fully exposed to the LLM.
