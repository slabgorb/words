# Words-as-plugin cleanup (medium scope)

**Date:** 2026-05-07
**Status:** Approved (in conversation), awaiting written-spec sign-off

## Goal

Make the `words` game consume the same generic API surface as `backgammon` and `rummikub`, and remove the words-shape projection that `rowToGame` hangs onto every game row. After this work the plugin host has no remaining game-specific code paths.

## Non-goals

- Schema migrations (the legacy columns are already auto-dropped at startup by `migrateLegacyState` in `src/server/db.js`).
- Cleaning up the misleading `CHECK` constraints in the `CREATE TABLE` statement, or dropping the `ended_reason` / `winner_side` columns now that state JSON carries them. That's a bigger ("C") effort tracked separately.
- Promoting variant declarations into the plugin contract (today the lobby hardcodes `PLUGIN_VARIANTS` for words). Out of scope.
- Changing `wordsPublicView` to expose viewer identity. Identity stays in the identity layer.

## Background

`plugins/words/` already follows the plugin layout: `plugin.js` exports `initialState`, `applyAction`, `publicView`, plus an `auxRoutes` entry for the `/validate` endpoint. The plugin host already mounts those routes generically (`src/server/routes.js:251-265`).

Two things still leak the old, words-only shape into shared code:

1. **`GET /api/games/:gameId/state`** (`src/server/routes.js:130-156`) — a Words-shape state endpoint that bypasses `publicView` and folds in viewer-identity fields (`you`, `opponent`, `yourFriendlyName`, `yourColor`, `currentTurn`). Its only consumer is `plugins/words/client/state.js:33`.
2. **`rowToGame`** (`src/server/games.js:1-29`) — decorates every game row with `bag`, `board`, `rackA`, `rackB`, `scoreA`, `scoreB`, `consecutiveScorelessTurns` lifted from `state` JSON. Backgammon and rummikub rows carry these fields too even though no one reads them in those contexts.

State JSON for all three plugins uses the same `{ sides, activeUserId, scores: { a, b }, endedReason, winnerSide }` shape, so collapsing the projection is safe.

## Architecture

### Identity vs game-state split

`/api/games/:gameId` already returns `{ id, gameType, status, playerAId, playerBId, state }`, where `state` comes from `plugin.publicView({ state, viewerId })`. That's everything the words client needs *about the game*.

Viewer identity (`me`, opponent's friendlyName/color) belongs to `/api/me` + `/api/users` — both already exist. The words client composes the view-model it used to receive in one shot from those two sources plus the generic game payload.

### `rowToGame` becomes generic

After the cleanup, `rowToGame` returns:

```
{ id, playerAId, playerBId, status, gameType, state,
  currentTurn, endedReason, winnerSide, createdAt, updatedAt }
```

`currentTurn` derivation stays — it's already plugin-agnostic (`state.sides.{a,b} === state.activeUserId`).

### Caller audit

| Caller | Change |
|--------|--------|
| `routes.js` `/api/me` (lines 35-36) | `g.scoreA / g.scoreB` → `g.state?.scores?.a / b ?? 0` |
| `routes.js` `/api/games/:gameId/state` | Deleted |
| `routes.js` action handler | No change (already generic) |
| `routes.js` param middleware | No change |
| `routes.js` `/api/games` listing | No change (raw SQL, doesn't use `rowToGame`) |

## File-by-file changes

### `src/server/routes.js`
- Delete the `GET /api/games/:gameId/state` handler (lines 130-156).
- In `/api/me`, replace `g.scoreA` / `g.scoreB` with `g.state?.scores?.a ?? 0` / `g.state?.scores?.b ?? 0`.

### `src/server/games.js`
- Slim `rowToGame` to the generic field set above. Remove `bag`, `board`, `rackA`, `rackB`, `scoreA`, `scoreB`, `consecutiveScorelessTurns`.

### `plugins/words/client/state.js`
- Add a one-time `me` cache (lazy fetch from `/api/me`; cache the `user` object).
- Add a one-time `usersById` cache (lazy fetch from `/api/users`).
- Rewrite `fetchState()`:
  1. Ensure caches.
  2. `GET /api/games/:id` → `{ id, gameType, status, playerAId, playerBId, state }`.
  3. Compose `ui.server` from `me` + caches + payload, preserving the existing shape that downstream client modules read:
     - `gameId = id`
     - `you = state.sides.a === me.id ? 'a' : 'b'`
     - `opponent = { friendlyName, color }` from `usersById[otherPlayerId]`
     - `yourFriendlyName = me.friendlyName`, `yourColor = me.color`
     - `currentTurn = state.sides.a === state.activeUserId ? 'a' : 'b'`
     - Spread state for `board`, `bag`, `racks`, `scores`, `consecutiveScorelessTurns`, `endedReason`, `winnerSide`, `sides`, `variant`.
     - Map `winnerSide → winner` (legacy field name returned by the deleted endpoint, used by client win-state code).
  4. Preserve existing 403/404 handling. 404 still redirects to `/`; 403 still falls through to lockout (server returns 403 from the param middleware via the unauthenticated/non-participant checks).

No other client modules need changes — the composed `ui.server` matches the shape `board.js`, `picker.js`, `rack.js`, `history.js`, etc. already consume.

## Tests

### Unchanged (should still pass)
- `test/words-plugin.test.js`
- `test/board.test.js`
- `test/engine.test.js`

### To add or extend
- `/api/me` test — assert correct `yourScore` / `theirScore` for words, backgammon, and rummikub games using only `state.scores`.
- Route-removal test — `GET /api/games/:gameId/state` returns 404.
- `/api/games/:gameId` shape test for words — confirm the publicView fields cover what the new client composer reads.

### Manual smoke (post-merge)
1. Lobby — scores correct for active words / backgammon / rummikub games.
2. Open a words game — board, rack, scores, opponent name + color all render.
3. Validate (auxRoute) and submit work.
4. Mid-game refresh hydrates correctly.
5. Game-over banner renders correctly.

## Sequencing

Each step leaves the app shippable — no flag-day cutover.

1. Update `plugins/words/client/state.js` to compose its view-model from the generic `/api/games/:id` endpoint plus `/api/me` + `/api/users` while the legacy route still exists. Verify words end-to-end.
2. Delete `GET /api/games/:gameId/state`.
3. Switch `/api/me` to read `state.scores`.
4. Slim `rowToGame`.
5. Run full test suite + manual smoke.

## Risks & mitigations

- **In-flight game data:** Existing words rows already have canonical state JSON shape (`migrateLegacyState` enforced this on startup). No data work needed.
- **Cached client JS post-deploy:** A tab loaded before the deploy could 404 on the (deleted) legacy endpoint. Same risk profile as any other deploy; mitigated by sequencing — step 1 lands the new client first.
- **`/api/users` extra request:** Adds one initial round-trip per game-page load (cached thereafter). Negligible.
