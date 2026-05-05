# Game History (Words & Rummikub)

**Date:** 2026-05-05
**Status:** Spec — awaiting user review before plan is written

## Summary

Add a turn-by-turn history drawer to both the Words and Rummikub plugin clients,
backed by a single shared `turn_log` table on the server. History is
forward-only (no backfill), lightweight (one summary row per turn), live (new
entries arrive over SSE), and rendered in a toggleable side drawer with newest
entries at the top.

This work also fixes an incidental but related bug: the Words client SSE
handlers don't match the events the server emits, so opponent moves currently
never trigger a live refresh on Words. Restoring live updates is required for
the history drawer to work, so the fix is bundled into this change.

## Goals

- Players can review every turn played in the current game.
- Each turn is a single short line (no detailed move replay).
- New turns appear without a page reload.
- Mechanism is shared between game types so adding a third game later is
  trivial.

## Non-goals

- No retroactive history for games started before this ships.
- No turn-by-turn replay or board-state reconstruction.
- No server-rendered HTML for history (client renders from JSON).
- No persisted client preferences for drawer state across reloads.
- No editing, deleting, or annotating history entries.

## Storage

New table:

```sql
CREATE TABLE turn_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  turn_number INTEGER NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('a','b')),
  kind        TEXT NOT NULL,
  summary     TEXT NOT NULL,           -- JSON, plugin-defined shape
  created_at  INTEGER NOT NULL
);
CREATE INDEX turn_log_by_game ON turn_log(game_id, id);
```

`turn_number` is the per-game ordinal (1, 2, 3, …) of this entry — assigned by
the host at write time as `max(turn_number) + 1` for the game (defaulting to 1
on first entry). It increments for every entry including `game-ended`. `side`
is always the side that took the action; for the synthetic `game-ended` row,
`side` is the side that took the action which ended the game (every end path
in both plugins is action-driven, so this is always defined as `'a'` or
`'b'`). The authoritative `winnerSide` is in the summary, not the row's
`side` column.

The dormant `moves` table — created by the legacy migration but never written
or read by current code — is dropped in the same migration. The associated
unique index `moves_nonce_per_game` is dropped first.

## Plugin contract

Plugins keep their existing `applyAction` shape and gain one optional return
field:

```js
applyAction({ state, action, actorId, rng }) → {
  state,                // existing
  ended,                // existing
  scoreDelta,           // existing (optional)
  summary?: {           // NEW (optional)
    kind: string,       // e.g. 'play', 'commit-turn', 'draw-tile'
    ...payload          // plugin-defined shape
  }
}
```

If `summary` is present, the host writes a `turn_log` row in the **same
transaction** as the state update — history is strictly consistent with state.
If `summary` is absent (e.g. an internal action that shouldn't be logged), no
row is written.

When `ended` is true, the host appends a synthetic `game-ended` row after the
plugin's row, with `kind: 'game-ended'` and `summary: { reason, winnerSide }`.
This is also inside the same transaction.

## Per-game summary shapes

### Words

| Action     | Summary                                                       |
| ---------- | ------------------------------------------------------------- |
| `move`     | `{ kind: 'play', words: ['PRIZE','OX'], scoreDelta: 26 }`     |
| `pass`     | `{ kind: 'pass' }`                                            |
| `swap`     | `{ kind: 'swap', count: 3 }` *(no letters — swap is private)* |
| `resign`   | `{ kind: 'resign' }`                                          |

`words` is the list of all words formed (main word + cross-words), uppercase,
in the order `engine.extractWords` returns them. `scoreDelta` is the integer
points earned (matches the existing `scoreDelta` already returned by `doMove`).

### Rummikub

| Action        | Summary                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `commit-turn` | `{ kind: 'commit-turn', meldPoints, tilesPlayed, openedInitialMeld }`    |
| `draw-tile`   | `{ kind: 'draw-tile' }`                                                  |
| `resign`      | `{ kind: 'resign' }`                                                     |

- `meldPoints`: integer — sum of `setValue(set)` for sets in the proposed
  table that are not in the snapshot table (same computation the client
  already does in `refreshMeldIndicator`).
- `tilesPlayed`: integer — count of tiles in the actor's snapshot rack minus
  count in the proposed rack (i.e. tiles that left the rack and went to the
  table this turn).
- `openedInitialMeld`: boolean — `true` iff `initialMeldComplete[actorSide]`
  was `false` before this turn and `true` after.

### Game-ended (synthetic)

```js
{ kind: 'game-ended', reason: state.endedReason, winnerSide: state.winnerSide }
```

`winnerSide` is `'a'`, `'b'`, or `null` (tie/no winner).

## API

### `GET /api/games/:gameId/history`

Auth: existing `requireIdentity` middleware. Membership: existing `:gameId`
param middleware.

Response:

```json
{
  "entries": [
    {
      "turnNumber": 1,
      "side": "a",
      "kind": "play",
      "summary": { "kind": "play", "words": ["PRIZE"], "scoreDelta": 24 },
      "createdAt": 1714929600000
    },
    ...
  ]
}
```

Entries are ordered **oldest first** (chronological by `id`). The client
reverses for display — keeping the wire format chronological keeps the route
trivial and lets future use cases (audit, replay) consume it naturally.

### SSE: new `turn` event

The action route currently broadcasts only `{ type: 'update' }`. After this
change, when the action wrote a history row, the route additionally broadcasts:

```js
sse.broadcast(gameId, {
  type: 'turn',
  payload: {
    turnNumber, side, kind, summary, createdAt
  }
});
```

If the action also ended the game, a second broadcast follows for the
synthetic `game-ended` row. Order: state-changed event first (`update`), then
each `turn` event in `turn_number` order.

The pre-existing `update` event remains — clients that just want a "refetch
state" signal continue to work without parsing payloads.

## Server changes

- **Schema delta** in `src/server/db.js`: add the `CREATE TABLE turn_log` and
  index, drop `moves_nonce_per_game` and `moves`. Idempotent (`IF EXISTS` /
  `IF NOT EXISTS`).
- **New module** `src/server/history.js`:
  - `appendTurnEntry(db, gameId, side, kind, summary)` → returns the row
    (assigns `turn_number` from `max+1`, sets `created_at = Date.now()`).
  - `listTurnEntries(db, gameId)` → array of plain objects, oldest first.
- **`src/server/routes.js`** action handler:
  - Inside the existing transaction, after `writeGameState`, if
    `result.summary` is present call `appendTurnEntry` and remember the row.
  - If `result.ended`, call `appendTurnEntry` again with the `game-ended`
    summary and remember that row.
  - After `txn()` succeeds: broadcast `update`, then broadcast one `turn`
    event per row written.
- **New route** `GET /api/games/:gameId/history` (uses existing param
  middleware) → calls `listTurnEntries` and returns `{ entries }`.

## Plugin changes

### `plugins/words/server/actions.js`

Each of `doMove`, `doPass`, `doSwap`, `doResign` returns a `summary` field
alongside its existing return value:

- `doMove`: build `words` from `[mainWord, ...crossWords].map(w => w.text)`,
  use the existing `scoreDelta` for `scoreDelta`.
- `doPass`: `{ kind: 'pass' }`.
- `doSwap`: `{ kind: 'swap', count: tiles.length }`.
- `doResign`: `{ kind: 'resign' }`.

### `plugins/rummikub/server/actions.js`

- `doCommitTurn`: compute `meldPoints` (using existing `setValue` from
  `sets.js`), `tilesPlayed` (`snapshotRack.length - proposedRack.length`),
  `openedInitialMeld` (delta on `initialMeldComplete[actorSide]`).
- `doDrawTile`: `{ kind: 'draw-tile' }`.
- `doResign`: `{ kind: 'resign' }`.

The Rummikub server `sets.js` is currently used only by the validator; the
`setValue` import path is already exported. Move it or re-export if needed.

## Client changes

### Shared drawer pattern

Each plugin's client gets a thin `history.js` module:

- `openDrawer()` / `closeDrawer()` / `toggleDrawer()` — manage open state and
  CSS class on a `#history-drawer` element.
- `loadHistory()` — `GET /api/games/:id/history`, replace the rendered list.
- `appendEntry(entry)` — prepend to the in-memory list (newest at top), update
  the DOM if the drawer is open.
- `formatEntry(entry, names)` — plugin-specific text rendering. Returns a
  string like `"Sonia played PRIZE for 26"`.

The CSS for the drawer (overlay, slide-in animation, list styles) lives in
each plugin's `style.css`. They share visual conventions but are not literally
shared files — each plugin owns its UI. Drawer is a right-side panel,
`transform: translateX(100%)` when closed, `0` when open, with a button in
the existing controls row labeled "History".

### `plugins/words/client/app.js`

- Replace the four broken typed-event handlers (`move`/`pass`/`swap`/`resign`)
  with **two** handlers:
  - `update`: `await fetchState(); refresh();` — restores opponent-move live
    refresh that's currently broken.
  - `turn`: parse payload, dispatch on `entry.kind`:
    - `play`: `showMoveCallout({ by, score, words })`, `playForScore`,
      `appendEntry`, `captureTurnTransition` chime as before.
    - `pass`: `showPassCallout`, `appendEntry`.
    - `swap`: `showSwapCallout`, `appendEntry`.
    - `resign`: `appendEntry`.
    - `game-ended`: `appendEntry` (the existing `maybeOfferNewGame` flow
      handles the end-screen on the next state refresh).
- The existing your-turn chime logic (`captureTurnTransition`) wraps the
  `update` handler so it fires on the actual state transition.
- The history drawer button is added to the existing controls row alongside
  Recall / Shuffle / Submit.

### `plugins/rummikub/client/app.js`

- Existing `update` and `ended` handlers stay.
- Add a `turn` handler that calls `appendEntry` with the payload.
- Add the history drawer button to the existing controls row alongside
  Sort / Reset / Draw / End / Resign.

### Format functions (text rendering)

Both plugins format with the actor's friendly name (already on
`window.__GAME__` / fetched state):

**Words:**
- `play`: `"<Name> played <words.join(', ')> for <scoreDelta>"`
- `pass`: `"<Name> passed"`
- `swap`: `"<Name> swapped <count> tile<s>"`
- `resign`: `"<Name> resigned"`
- `game-ended`: `"Game over — <winnerName | 'tie'> (<reason>)"`

**Rummikub:**
- `commit-turn`:
  - normal: `"<Name> played <tilesPlayed> tile<s> (+<meldPoints>)"`
  - on opening: same line, with `" — opened initial meld"` appended
  - if `tilesPlayed === 0` (rearrangement only): `"<Name> rearranged the table"`
- `draw-tile`: `"<Name> drew a tile"`
- `resign`: `"<Name> resigned"`
- `game-ended`: `"Game over — <winnerName | 'no winner'> (<reason>)"`

Each line is timestamped on hover (`title` attribute, ISO local time).

## Testing

Tests live flat under `test/` and use `node:test`. New / extended tests:

- **New** `test/history.test.js` — `appendTurnEntry` / `listTurnEntries` unit
  tests over an in-memory DB.
- **Extend** `test/action-route.test.js` — assert that an action writes the
  expected `turn_log` row, that the new `GET /api/games/:id/history` route
  returns entries oldest-first, and that an action which ends the game writes
  the synthetic `game-ended` row in the same transaction.
- **Extend** `test/words-plugin.test.js` (or add `test/words-actions.test.js`
  if the existing file doesn't cover all four action paths) — assert each
  Words action returns the documented `summary` shape.
- **Extend** `test/rummikub-actions.test.js` — assert the `summary` shape for
  `commit-turn`, `draw-tile`, and `resign`, including `meldPoints` /
  `tilesPlayed` / `openedInitialMeld` for the initial-meld and normal-play
  cases.
- **Extend** `test/sse.test.js` — assert that an action emits both an
  `update` event and a `turn` event with the new entry payload, in that
  order, and that an ending action emits a second `turn` event for the
  synthetic row.

## Migration & rollout

- Forward-only. In-progress games show an empty drawer until their next turn.
- Ship the schema delta and the bundled SSE fix together. Words clients on an
  old build will continue to behave as they currently do (broken live updates
  — no regression).
- No feature flag.

## Open questions / risks

- **Drop `moves` table:** verified no current code reads or writes it. If a
  reviewer disagrees, gate the drop behind a separate migration step.
- **Rummikub "rearrange only" turn:** Rummikub rules don't strictly allow
  ending a turn without playing at least one tile post-initial-meld. The
  existing `validateEndState` enforces this. The `tilesPlayed === 0` text
  variant in the format function exists only as a defensive fallback.
- **SSE event ordering:** the new code broadcasts `update` then `turn` (then
  optionally a second `turn` for `game-ended`). The Words client's `update`
  handler triggers a `fetchState`, which is async; the `turn` handler that
  appends the entry runs in parallel. Both are independent and order-safe
  because the history list is its own state, not derived from game state.
