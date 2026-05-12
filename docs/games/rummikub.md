# Rummikub

> Number-tile rummy. Lay down sets from your rack, manipulate sets already on the table, empty your rack to win.

| | |
|---|---|
| Plugin id | `rummikub` |
| Players | 2 |
| Variant | 1998 Pressman American Edition |
| Win condition | First to empty rack |
| Plugin dir | `plugins/rummikub/` |

## Lineage

Implements the rules from the 1998 Pressman American Edition (the standard set sold under the Rummikub brand in North America). Reference: *Rummikub* — Wikipedia.

## Components

- **106 tiles total** — 4 colors (black, blue, orange, red) × 13 numbers (1–13) × 2 copies each = 104 numbered tiles, plus **2 jokers**.
- **Two racks**, 14 tiles each at deal.
- **Pool** — remaining tiles, face-down on the table.

## Setup

1. Shuffle all 106 tiles.
2. Deal 14 tiles to each rack.
3. Pool: the remaining 78 tiles.
4. Starting player is chosen by a coin flip (digital substitute for the canonical "highest-value tile draw").

## Turn structure

A turn is either:

1. **Commit a turn-end state** — rearrange the table and play tiles from your rack so the resulting table is composed entirely of valid sets. At minimum one rack tile must be played.
2. **Draw a tile** — if you cannot or choose not to play, draw one tile from the pool. Turn ends.

Sets that exist on the table at the start of your turn may be split, merged, shifted, or substituted as long as every set on the table is valid when you commit.

### The initial meld

Before your first play, your initial meld must:

- Be composed **only of tiles from your rack** (no harvesting from the table).
- **Leave existing sets unchanged** (no table manipulation on the initial-meld turn).
- Score **≥ 30 points**, counting each tile at face value. A joker counts as the value of the tile it represents.

If you cannot meet the threshold, draw one tile.

## Sets

- **Run** — 3 or more **same-color** tiles in consecutive number order. 1 is always low: `1-2-3` is legal; `12-13-1` is not.
- **Group** — 3 or 4 **same-value** tiles in distinct colors. Maximum size 4 (one per color).

## Jokers

- A joker substitutes for any tile in any set.
- A joker may not be retrieved from the table before the player has made their initial meld. (Enforced indirectly: the initial-meld turn cannot modify existing sets.)
- After the initial meld, a joker can be retrieved by replacing it with the natural tile it represents — from your rack or from the table. A harvested joker **must be replayed in a new set during the same turn**; it may not be kept on your rack.
- A set containing a joker may be added to, split, or shortened (the joker's representation may shift accordingly) as long as the set remains valid.
- In a group of 3, the joker represents either of the two missing colors; in any set, the joker's color/value is inferred from context if it has not been declared.

## Scoring

Game ends when a player empties their rack. They are the winner. The other player's leftover tiles are summed at face value, jokers counting **30**. The winner scores `+sum`, the loser scores `–sum`.

If the pool runs out and no player can make a valid play, the player with fewer tiles remaining wins; scoring proceeds as above.

## Implementation

### Files

| File | Responsibility |
|---|---|
| `plugin.js` | Plugin contract (id, displayName, action/view wiring). |
| `server/state.js` | Initial state, deal, coin-flip first player. |
| `server/tiles.js` | Tile factory (`buildBag`), tile-value helper, joker predicate. |
| `server/sets.js` | Set classification (`run` vs `group`), validity check, joker inference. |
| `server/multiset.js` | Multiset equality used to enforce tile conservation across a turn. |
| `server/validate.js` | Turn-end validation: multiset balance, rack subset, initial meld, joker harvest. |
| `server/actions.js` | Dispatches `commit-turn`, `draw-tile`, `resign`. |
| `server/scoring.js` | Final score from leftover tiles. |
| `server/view.js` | Per-viewer state redaction (hide opponent rack). |

### Action types

| Action | Payload | Effect |
|---|---|---|
| `commit-turn` | `{ rack, table }` — the proposed end state | Validated and applied atomically; turn ends. |
| `draw-tile` | — | Draws one tile from the pool; turn ends. |
| `resign` | — | Current player concedes. |

The plugin exposes **no aux routes** — table manipulation happens client-side and is committed as a single end-state.

### State shape

| Key | Description |
|---|---|
| `pool` | Face-down tile array (the pool). |
| `racks` | `{ a, b }` — each player's tiles. |
| `table` | Array of sets; each set is an array of tiles. |
| `initialMeldComplete` | `{ a, b }` booleans. |
| `sides` | `{ a, b }` — userId per side. |
| `activeUserId` | Whose turn it is. |
| `scores` | `{ a, b }` running scores (set on game end). |
| `consecutiveDraws` | Counts forced draws; used to detect dead-state end. |
| `endedReason`, `winnerSide` | Set when the game ends. |

## Alignment notes

- **Opener selection** — engine uses a coin flip rather than the highest-drawn-tile method. Same outcome distribution.
- **Initial meld using table tiles** — Pressman rule says new sets must use only rack tiles; the engine enforces this strictly by requiring all existing sets to remain unchanged on the initial-meld turn.
- **Joker retrieval before initial meld** — blocked because the initial-meld turn cannot modify existing sets, which is where any joker would live.
- **End on pool exhaustion** — engine tracks `consecutiveDraws` to detect deadlock; the player with fewer rack tiles is awarded the win (canonical "lowest tile count wins").
