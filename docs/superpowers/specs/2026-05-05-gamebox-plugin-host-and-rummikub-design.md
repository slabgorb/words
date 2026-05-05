# Gamebox plugin host + Rummikub plugin — design

Status: brainstorm complete, pending implementation plan.
Date: 2026-05-05.

## Summary

Generalize the current single-game `words` app into **gamebox**, a plugin host
for two-player turn-based games. Words becomes the first plugin; Rummikub
becomes the second. Future plugins (cribbage, buraco, etc.) slot in by adding a
folder and one registry line.

The plugin host inherits the just-shipped multiplayer roster + Cloudflare
Access auth + multi-game-per-pair substrate. It adds a `game_type` axis: a
pair may have **at most one active game per `(pair, game_type)`**, but may
have multiple active games of different types concurrently.

Rummikub ships as the inaugural non-Words plugin: standard Sabra rules,
2 jokers, 30-point initial meld, full manipulation, structured-rows table UI,
no turn timer.

## Goals

- Words and Rummikub run side-by-side on the same host, same auth, same
  identity, same SSE plumbing.
- Adding a third game (cribbage, buraco, …) is a folder + a registry line.
- Per-plugin code stays self-contained: rules, state shape, client UI, scoring
  all live inside the plugin folder.
- The host stays small, generic, and unaware of any specific game's rules.

## Non-goals

- Not multi-tenant beyond the existing curated roster.
- Not >2-player. **2-player only, forever, plugin-wide.** Games that don't fit
  this constraint (Catan, Hearts, …) are out of scope; we'll reconsider only
  if a desired plugin genuinely demands it.
- No turn timers, ever — for any plugin.
- No spectators, no notifications, no per-game theming, no chat.
- No client-side framework, no bundler. Plugins ship vanilla HTML/CSS/JS.
- No real-time / sub-turn observation. Only committed turn-end state is
  broadcast.
- No mobile-app: browser-only, mobile-web friendly.

## Concepts

- **Plugin**: a self-contained game module living at `plugins/<id>/`,
  registered explicitly in `src/plugins/index.js`.
- **Manifest**: a small JS object exported by the plugin describing its
  identity and player count.
- **Game** (a.k.a. match): a row in `games` keyed by `(pair, game_type,
  created_at)`. The `state` column is a JSON blob the plugin writes through.
- **Action**: a typed message the client sends to the server to mutate game
  state. Shape is `{ type, payload }`; type meanings are plugin-defined.
- **Public view**: a per-viewer projection of the state that strips hidden
  information (opponent's hand, the crib, etc.).

## Repository identity

- Rename `words` → **`gamebox`**:
  - `package.json` `name` field
  - `README.md` title and prose
  - splash header / page title
- Folder path `g-2` is incidental; not renamed (would break local bookmarks).
- Existing Words client moves from `public/` into `plugins/words/client/`.
- Existing `src/server/engine.js`, `dictionary.js`, `board.js` move into
  `plugins/words/server/`.

## Architecture

### Top-level layout

```
gamebox/
  src/
    server/
      server.js          host: express boot, static serving, SSE, identity
      routes.js          host routes: /api/games, /api/games/:id, …
      db.js              host schema: users, games (extends multiplayer's)
      sse.js             host SSE broadcaster
      identity.js        host: CF Access header / DEV_USER → req.user
      plugins.js         loads + validates the registry
    plugins/
      index.js           static registry: { words, rummikub }
  plugins/
    words/
      plugin.js          manifest + module exports
      server/
        engine.js        rules, scoring, end-game (existing code, moved)
        actions.js       applyAction switch
        view.js          publicView projector
        dictionary.js    (Words-specific)
        board.js         (Words-specific)
      client/
        index.html
        app.js, board.js, rack.js, drag.js, …  (existing code, moved)
    rummikub/
      plugin.js
      server/
        engine.js        validation: multiset, set legality, initial meld, jokers
        actions.js       applyAction (commit-turn, draw-tile, resign, new-game)
        view.js          publicView (hide opponent's rack)
      client/
        index.html
        app.js, table.js, rack.js, drag.js, …
  public/
    lobby/               host-served lobby page (vanilla, like words)
    assets/              shared favicon, themes, sounds
  data/
    enable2k.txt         (gitignored, words plugin uses it)
  game.db                host db (extends multiplayer schema)
```

### Plugin loading

`src/plugins/index.js` is an explicit registry:

```js
import words from '../../plugins/words/plugin.js';
import rummikub from '../../plugins/rummikub/plugin.js';
export const plugins = { words, rummikub };
```

The host's `plugins.js` validates each manifest at boot (required fields,
function signatures present). A failed validation crashes the boot — loud and
explicit, never silently un-registered.

The order of keys in this map is the order plugins appear in any list / picker
UI.

### Plugin contract

Every plugin module exports:

```js
export default {
  // Manifest
  id: 'rummikub',                  // url-safe; matches folder name
  displayName: 'Rummikub',
  players: 2,                      // must be 2; enforced at boot
  clientDir: 'plugins/rummikub/client',

  // Rules engine (pure functions)
  initialState({ participants, rng }) { /* … */ },
  applyAction({ state, action, actorId, rng }) { /* … */ },
  publicView({ state, viewerId }) { /* … */ },
  legalActions({ state, viewerId }) { /* optional */ },
};
```

**`initialState({ participants, rng })`** returns the starting state. `participants`
is `[{ userId, side }, …]` with side ∈ `{'a','b'}`. `rng` is a seeded RNG injected
by the host (so tests can replay deals).

**`applyAction({ state, action, actorId, rng })`** returns
`{ state, ended, scoreDelta?, error? }`. Pure: no I/O, no side effects. If the
action is illegal, return `{ error }` and the host responds 422; otherwise the
new state is persisted and broadcast. `ended: true` triggers end-of-game
ceremony in the host.

**`publicView({ state, viewerId })`** returns a projection of the state with
hidden information removed for that viewer. The host calls this on every send
(state fetch, SSE push). Words example: opponent's rack tiles → null. Rummikub
example: opponent's rack count visible, tiles hidden.

**`legalActions`** is optional; clients can call it to render affordances
(e.g., "draw" enabled, "end-turn" disabled).

The host never knows the *content* of states or actions — only that they're
JSON-serializable.

### Action route

Every plugin shares one route for state-changing turns:

```
POST /api/games/:id/action
body: { type, payload }
```

Host responsibilities (in order):
1. Auth: `req.user` set by identity middleware.
2. Membership: `req.user.id` must be a participant of game `:id`.
3. Look up the game's plugin from `game_type`.
4. Call `plugin.applyAction({ state, action, actorId, rng })` inside a DB
   transaction.
5. On success: persist new state, increment turn counter, broadcast SSE
   `update` to both participants, return new public view.
6. On `error`: 422 with reason; do not commit.
7. On `ended: true`: mark `status = 'ended'`, write final scores, broadcast
   `ended` event.

The host's `applyAction` wrapper enforces: it is the actor's turn (per
`state.activeUserId`, which every plugin must expose). Plugins do not
re-check this.

#### Plugin auxiliary routes

A plugin **may** contribute additional read-only or hot-path endpoints under
`/api/games/:id/<plugin-route>`. Words uses this for live placement
validation (`/api/games/:id/validate`), called as the user drags tiles.
Auxiliary routes are mounted by the host on the plugin's behalf:

```js
// in plugins/words/plugin.js
auxRoutes: {
  validate: { method: 'POST', handler: validateMove },
}
```

The host wraps each handler with the same auth + membership middleware as
the action route. Auxiliary routes are *read-only by convention* — they
never mutate `state`. (Enforced by code review, not the framework.)

### Schema delta

Extends the multiplayer schema, which currently has Words-specific columns
inlined on the `games` table (`bag`, `board`, `rack_a`, `rack_b`,
`consecutive_scoreless_turns`). These move into a generic JSON `state`
column owned by the plugin.

Concretely:

- `games` gains `game_type TEXT NOT NULL` column (backfill `'words'` on
  existing rows).
- `games` gains `state TEXT NOT NULL` column (JSON; plugin-owned shape).
- The unique-active constraint changes from `(player_a_id, player_b_id)
  WHERE status='active'` to `(player_a_id, player_b_id, game_type)
  WHERE status='active'`. Drop and recreate the partial index.
- Words plugin state shape: `{ bag, board, racks: {a, b}, scores: {a, b},
  activeUserId, consecutiveScorelessTurns, initialMoveDone }` — packs the
  existing inline columns.
- One-shot migration: read each row's old columns, pack them into a `state`
  JSON, write back. Then drop `bag`, `board`, `rack_a`, `rack_b`,
  `consecutive_scoreless_turns`, `score_a`, `score_b`, `current_turn`
  columns. (`score_a`/`score_b`/`current_turn` move into state too — they
  are 2-player generic but cleaner to keep all live state in one JSON blob,
  and they aren't queried by the lobby.)
- Columns that stay on the row (host-generic): `id`, `player_a_id`,
  `player_b_id`, `game_type`, `status`, `ended_reason`, `winner_side`,
  `created_at`, `updated_at`.
- `moves` table is unchanged structurally (still references `game_id`), but
  the host stops writing to it for plugins that don't want a per-action audit
  trail. Words may keep writing to it via plugin code; Rummikub doesn't use
  it. (Audit-log policy is per-plugin, not host-mandated.)
- No per-plugin tables. All plugin live state lives in the JSON `state`
  column. (If a future plugin genuinely needs a side table, we revisit;
  YAGNI for now.)

### Client serving

Each plugin's `client/` directory is served as static files at
`/play/<type>/<game-id>/`. The host injects context via a server-rendered
script tag in the plugin's `index.html`:

```html
<script>
  window.__GAME__ = {
    gameId: 'abc123',
    userId: 42,
    gameType: 'rummikub',
    sseUrl: '/api/games/abc123/events',
    actionUrl: '/api/games/abc123/action',
    stateUrl: '/api/games/abc123/state'
  };
</script>
```

Plugin client JS reads `window.__GAME__`, fetches initial state, opens SSE,
renders. **No client-side routing.** Switching games = full page navigation
back to `/`. Plugin client code never imports from the host or from another
plugin — full isolation.

### Lobby

Host serves the lobby at `/`. It renders:

- One **pair tile** per other roster member (preserves multiplayer's design).
- Inside each tile: badges for each currently-active game with that opponent
  (e.g., `📝 Words` `🟦 Rummikub`). Clicking a badge → `/play/<type>/<id>`.
- A "**+ Start new game**" affordance per tile that opens a small picker:
  list of plugins not currently active with this opponent. Selecting one
  creates a new game (`POST /api/games` with `{ opponentId, gameType }`)
  and navigates to its play page.

Pair-tile order, color, and friendly-name behavior are all unchanged from
the multiplayer spec.

## Plugin: words

Mechanical refactor only. Existing rules engine, dictionary, board geometry,
client code all move into `plugins/words/`. Existing routes (`/api/move`,
`/api/pass`, `/api/swap`, `/api/resign`, `/api/new-game`) collapse into
typed actions:

- `POST /api/games/:id/action { type: 'move', payload: { placements } }`
- `… { type: 'pass' }`
- `… { type: 'swap', payload: { tiles } }`
- `… { type: 'resign' }`
- New games are created via the host's `POST /api/games`, not a plugin
  action; the existing `/api/new-game` path goes away.

Game state shape, scoring, end-of-game flow, drag UX — all unchanged from a
player's perspective. The migration is invisible.

`/api/validate` becomes a Words-plugin auxiliary route at
`/api/games/:id/validate`, declared via the plugin's `auxRoutes` manifest
field (see Plugin auxiliary routes above).

## Plugin: rummikub

### Rules (Sabra, per Wikipedia)

- **Tiles**: 106 total. 104 numbered (values 1–13, four colors {red, blue,
  orange, black}, two of each). 2 jokers.
- **Rack**: 14 tiles starting; grows by 1 every "no valid play" turn.
- **Initial meld**: ≥30 points from rack tiles in *new* sets only. No
  manipulation of existing sets allowed on the meld turn.
- **Sets**:
  - **Run**: ≥3 same-colored tiles in consecutive number order. No wrap
    (1 cannot follow 13). Max length 13 (the full color).
  - **Group**: 3 or 4 same-value tiles in distinct colors. Max length 4.
- **Manipulation** (post-initial-meld only):
  - Shift a run: append + remove from far end.
  - Split a run: insert a tile in the middle, splitting into two sub-runs
    (each must remain length ≥3).
  - Substitute in a group: swap a color in a 3-group by adding the fourth
    color and removing one of the originals.
  - Remove from end of run / either end of 4-group, provided remainder is
    valid.
- **Jokers**:
  - 30-point penalty if held at game end.
  - Cannot be retrieved before initial meld.
  - To retrieve: replace with a tile of the joker's represented value+color
    (from rack or table). Replaced joker **must** be played in a *new* set
    this turn.
  - In a group of 3, a joker can represent either missing color.
  - A set containing a joker can be split, extended, or have tiles removed,
    so long as it remains a valid set of length ≥3.
- **Drawing**: if you cannot or choose not to play, draw 1 tile from the
  pool. Turn ends.
- **Winning**: first to clear their rack calls Rummikub. If pool exhausted
  and no legal play possible, fewest tiles wins; ties resolved by score sum.
- **Scoring**:
  - Loser's remaining tile values are summed (joker = 30).
  - Winner gets +sum; loser gets −sum.
  - Score is per-game (final scoreDelta on the ended game). Cumulative
    pair-history scoreboards are out of scope (see Out of scope).

### State shape (sketch)

```js
{
  pool: [tile, …],                // remaining tiles, hidden order
  racks: { a: [tile, …], b: [tile, …] },
  table: [[tile, tile, tile], [tile, tile, tile, tile], …],   // ordered sets
  initialMeldComplete: { a: false, b: false },
  activeUserId: <user id>,
  startOfTurnSnapshot: { rack, table, jokerLocations },        // for validation
  passes: 0,
  scoreDelta: { a: 0, b: 0 },     // accumulated within game
  ended: false,
  winner: null,
}

// tile = { id, kind: 'numbered'|'joker', color?, value?, jokerRepresents? }
```

`startOfTurnSnapshot` is captured at the start of every turn and used by the
server to validate the proposed end-state.

### Action: `commit-turn`

Payload: the player's proposed end-of-turn `(rack, table)` plus
`jokerRepresents` annotations for any jokers on the table.

Server validation (in order; first failure aborts):

1. **Multiset balance**: tiles in (rack_end ⊎ table_end) ==
   tiles in (rack_start ⊎ table_start). No tiles invented or vanished.
2. **Rack subset**: rack_end ⊂ rack_start (player only *removed* tiles
   from their rack; never added).
3. **Set legality**: every set in `table_end` is a valid run or group of
   length ≥3, with `jokerRepresents` annotations consistent.
4. **Initial-meld constraint** (if `!initialMeldComplete[actor]`): the player
   played ≥30 points entirely in *new* sets (no element of `table_start`
   appears in any modified form), AND played at least one rack tile.
5. **Joker harvest**: for every joker in `table_start` not present in any
   "preserved" set of `table_end`, that joker must appear in a set that is
   "new" to `table_end`. ("Preserved" and "new" are computed by a structural
   diff between start and end tables — implementation detail, addressed in
   the implementation plan.)
6. **At least one rack tile played**: `rack_end.length < rack_start.length`.

If all pass: persist new state, flip `activeUserId`, broadcast. If
`rack_end.length == 0`: end the game, actor wins. If
`initialMeldComplete[actor]` was false and meld was valid: set it true.

### Action: `draw-tile`

No payload. Legal only when no rack-tile changes are pending (client enforces;
server too: `rack_end.length === rack_start.length` AND `table_end == table_start`).
Server pulls a tile from `pool`, appends to actor's rack, flips turn. If pool
is empty before drawing, end-of-game evaluation runs.

### Action: `resign`

Standard. Opponent wins. No score deltas.

### Action: `new-game` (host-level)

Creating a new Rummikub game with the same opponent uses the host's `POST
/api/games`, not a plugin action. The Rummikub plugin's `initialState`
shuffles, deals 14 tiles to each rack, randomly picks `activeUserId`, and
returns the starting state.

### UX

- **Table layout**: structured rows. Each set is a horizontal row. New sets
  append below. Sets reorder vertically by drag (cosmetic; not persisted as
  meaningful order).
- **Drop zones**: each existing set has insert/append/replace zones
  highlighted on tile pickup. A persistent "+ New set" zone appears at the
  bottom of the table during a turn.
- **Drag**: single tile at a time. Existing Words drag system extends
  naturally.
- **Reset turn**: button reverts (rack, table) to start-of-turn snapshot.
  Local-only. Disabled if no pending changes.
- **End turn**: button enabled iff (a) at least one rack tile played, AND
  (b) proposed state passes a *client-side* dry-run of the server's
  validation (so error feedback is immediate). Final authority is the server.
  Hover/tap reveals the specific reason if disabled.
- **Draw tile**: button enabled iff no pending rack/table changes.
- **Initial meld indicator**: while `!initialMeldComplete[me]`, show
  "Initial meld: X / 30 pts" — counts only points from rack tiles in
  brand-new sets.
- **Rack**: 14 tiles initially, grows on each draw. **Sort** button toggles
  between "by color then number" and "by number then color." Manual rearrange
  always allowed.
- **Jokers**: render with a joker face + a small overlay badge showing what
  tile they currently represent (e.g., "♦7"). Bare jokers (rack) show no
  badge.
- **Hidden info**: opponent's rack tiles hidden; rack count and pool count
  visible. On game end, both racks reveal for scoring.
- **Game end**: on Rummikub! (rack empty) or pool-exhausted-no-play, freeze
  game, show score summary, "Start new game?" CTA.

## SSE

No change from the host's existing model. One SSE stream per game at
`/api/games/:id/events`. Events: `update` (state changed; client refetches
public view), `ended` (game completed; final state included).

## Migration

1. Land multiplayer (in flight, expected complete before this work begins).
2. Rename `words` → `gamebox`: `package.json`, `README.md`, splash header.
3. Move existing server code into `plugins/words/server/`.
4. Move existing client code into `plugins/words/client/`.
5. Refactor `routes.js`: existing Words routes become plugin actions on the
   generic `/api/games/:id/action` route.
6. Add `game_type` column to `games`; migrate existing in-progress game to
   `game_type = 'words'`.
7. Build host shell: lobby, plugin loader, generic action route.
8. Build Rummikub plugin: rules engine, validator, client, sounds.
9. Update README to describe gamebox + plugins + adding-a-plugin guide.

## Out of scope (future)

- A third plugin (cribbage, buraco). The contract was designed with these
  in mind, but they aren't in this work.
- Per-game-type scoreboards / cumulative across games.
- Rematch flow / "play again with same opponent" CTA.
- Rummikub variants (4-joker, American rules, alternate scoring).
- Plugin hot-reload in dev. Server restart on plugin change is fine.
