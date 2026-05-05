# Multiplayer (friends & family) — design

Status: approved (brainstorm), pending implementation plan.
Date: 2026-05-05.

## Summary

Replace the hardcoded two-player Keith-vs-Sonia model with a small,
admin-curated roster of users (email + friendly name) and support multiple
concurrent games — at most one **active** game per unordered pair of users.
Authentication is delegated to Cloudflare Access; the app reads the
`Cf-Access-Authenticated-User-Email` header and trusts it. Local development
keeps working via a `DEV_USER` env override. The home screen becomes
pair-centric: one tile per other roster member, click → your game with them.

The existing in-progress game between `keith` and `sonia` migrates intact
and becomes the game between `slabgorb@gmail.com` ("Keith") and
`sonia.ramosdarocha@gmail.com` ("Sonia").

## Goals

- More than two people can play, on a personal-use scale (a handful).
- The admin (Keith) controls who can play, by adding rows to the roster.
- The active in-progress game is preserved across the migration.
- The visible behavior of an individual game does not change — the
  rules engine, scoring, drag UX, end-of-game flow are all untouched.

## Non-goals

- Not a SaaS, not multi-tenant, not invite-by-link. Keith curates manually.
- No notifications (email, push, badges-on-the-tab). Players visit when they
  want to play.
- No spectators or 3+-player games — strictly two-player.
- No self-service rename. The admin sets the friendly name via CLI.
- No per-game theming. Colors are per-user.

## Concepts

- **User**: a row in `users` with a unique email and a friendly name.
- **Pair**: an unordered set of two distinct user IDs. Canonicalized as
  `(min, max)` whenever stored or queried.
- **Game**: a row in `games`. At most one game per pair has
  `status = 'active'`; any number may have `status = 'ended'`.
- **Side**: within a game, `'a'` is the player with the lower user ID and
  `'b'` is the player with the higher. (Choice is independent of who started
  — the first turn is randomly assigned at game-creation time.)

## Authentication & authorization

### Identity source

- **Production:** trust the `Cf-Access-Authenticated-User-Email` request
  header. Cloudflare Access is the perimeter; if the header is present, the
  request is authenticated.
- **Development (`NODE_ENV !== 'production'`):** if the header is absent and
  the `DEV_USER` env var is set, treat its value as the authenticated email.
  This is the only sanctioned way to bypass the header. No query-string
  override, no cookie. Production never honors `DEV_USER`.
- **Cookies:** the existing `wf_id` signed cookie and `/api/whoami` endpoints
  are removed. CF Access provides its own session cookie.

### Roster gate (lockout)

After identity is established, look up the email in `users` (case-insensitive).

- Found → attach `req.user = { id, email, friendlyName, color }`. Continue.
- Missing → render the **lockout page**: a static HTML page that says
  "Hi `<email>`, you're not on the roster yet — ask Keith." with a `mailto:`
  link. No game data is exposed. HTTP 403 on API routes.

The roster gate is enforced by middleware on every `/api/*` route except a
small set of always-public routes (the lockout page itself, static assets).

### Per-game authorization

For routes scoped to a game (`/api/games/:id/*`), additionally verify that
`req.user.id` is either `player_a_id` or `player_b_id` of game `:id`. 403
otherwise. This is the only place where game-level access control lives.

### Admin

- The admin role is implicit and tied to roster membership: anyone with an
  app shell on the host can run `bin/add-user.js`. There is no `/admin` route.
- The CLI is the **only** way to add or rename users. Removal is also CLI-only
  (and rare; in practice you'd just leave them in the table).

## Data model

### `users`

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  friendly_name TEXT NOT NULL,
  color         TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
```

Email comparisons are case-insensitive (`COLLATE NOCASE`). `color` is a hex
string used for the score panel and tile-back accents. The CLI auto-assigns
from a small palette if omitted.

### `games`

```sql
CREATE TABLE games (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_a_id     INTEGER NOT NULL REFERENCES users(id),
  player_b_id     INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL,            -- 'active' | 'ended'
  current_turn    TEXT NOT NULL,            -- 'a' | 'b'
  bag             TEXT NOT NULL,            -- JSON array
  board           TEXT NOT NULL,            -- JSON 15x15
  rack_a          TEXT NOT NULL,            -- JSON array
  rack_b          TEXT NOT NULL,
  score_a         INTEGER NOT NULL DEFAULT 0,
  score_b         INTEGER NOT NULL DEFAULT 0,
  consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
  ended_reason    TEXT,
  winner_side     TEXT,                     -- 'a' | 'b' | 'draw' | NULL
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CHECK (player_a_id < player_b_id)
);

CREATE UNIQUE INDEX one_active_per_pair
  ON games(player_a_id, player_b_id) WHERE status = 'active';
```

Pair canonicalization (`player_a_id < player_b_id`) happens in the
`createGame` helper before insert. The partial unique index allows multiple
ended games per pair while enforcing at-most-one active.

### `moves`

The legacy `moves` table has an inline `client_nonce TEXT UNIQUE` constraint
(global) and a `player_id TEXT REFERENCES players(id)` column that must
become `side TEXT` (`'a'`/`'b'`) plus a new `game_id` FK. Because SQLite
cannot drop a UNIQUE constraint or change a column's references without
rebuilding the table, the migration creates `moves_v2`, copies rows in,
drops the old table, and renames:

```sql
CREATE TABLE moves_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id),
  side          TEXT NOT NULL,            -- 'a' | 'b'
  kind          TEXT NOT NULL,
  placement     TEXT,
  words_formed  TEXT,
  score_delta   INTEGER NOT NULL DEFAULT 0,
  client_nonce  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX moves_nonce_per_game ON moves_v2(game_id, client_nonce)
  WHERE client_nonce IS NOT NULL;
```

The copy step maps `player_id='keith' → side='a'`, `'sonia' → 'b'`, and
sets `game_id = 1` for all legacy rows (since legacy state had exactly
one game). Then `DROP TABLE moves; ALTER TABLE moves_v2 RENAME TO moves`.

### `game_history`

Dropped. Ended games stay in `games` with `status = 'ended'`. The board
snapshot is the row itself. If the legacy `game_history` table contains rows
on first migration, they are renamed to `legacy_game_history` and left in
place untouched (no UI surface; available via SQL if anyone ever wants them).

### Removed

- `players` table (Keith/Sonia static seed) — dropped after data migration.
- Singleton `game` table — dropped after data migration.

## Migration

Runs once on boot, in a single transaction, idempotent (a no-op if `games`
already has rows). Steps:

1. Take a backup: copy `game.db` to `game.db.pre-multiplayer.backup` before
   any DDL. Skip if backup file already exists.
2. Create the new tables (`users`, `games`) and indexes if missing.
3. If `users` is empty:
   - Insert `slabgorb@gmail.com` / "Keith" / `#3b82f6` (id 1 by autoinc).
   - Insert `sonia.ramosdarocha@gmail.com` / "Sonia" / `#ec4899` (id 2).
4. If the legacy `game` table exists and has a row, and `games` is empty:
   - Read the legacy row.
   - Insert one `games` row with `player_a_id=1, player_b_id=2`, mapping
     `rack_keith → rack_a`, `rack_sonia → rack_b`, `score_keith → score_a`,
     `score_sonia → score_b`, `current_turn='keith' → 'a'`,
     `'sonia' → 'b'`, `winner='keith' → winner_side='a'`,
     `'sonia' → 'b'`, `NULL → NULL`. Status, ended_reason,
     consecutive_scoreless_turns, board, bag, timestamps copy directly.
5. Rebuild `moves` per the `moves_v2` recipe above: create `moves_v2`,
   `INSERT INTO moves_v2 SELECT id, 1 AS game_id,
   CASE player_id WHEN 'keith' THEN 'a' ELSE 'b' END AS side,
   kind, placement, words_formed, score_delta, client_nonce, created_at
   FROM moves;` then drop the old table and rename.
6. Rename `game_history` to `legacy_game_history` if present.
7. Drop the `game` and `players` tables.

The migration is wrapped in `BEGIN IMMEDIATE; ... COMMIT;` so a crash mid-way
leaves the file untouched. The backup in step 1 is the belt to that braces.

## API

### Routes

```
GET  /api/me                     -> { user, games }
GET  /api/users                  -> roster (id, friendly_name, color) — no emails
POST /api/games                  -> create new game with body {otherUserId}
                                    201 {gameId} | 409 if active pair exists
                                                 | 400 self-pairing
                                                 | 404 unknown user

GET  /api/games/:id/state        -> full snapshot {board, racks, scores, turn,
                                                   you: 'a'|'b', opponent: {...}}
POST /api/games/:id/validate     -> {valid, words[], score}
POST /api/games/:id/move
POST /api/games/:id/pass
POST /api/games/:id/swap
POST /api/games/:id/resign
POST /api/games/:id/new-game     -> only valid when this game has
                                    status='ended'. Both players must POST
                                    before a new game is created. On the
                                    second confirm: insert a new active
                                    games row for the same pair (the prior
                                    one stays ended), respond
                                    {ok:true, started:true, newGameId}.
                                    On the first confirm:
                                    {ok:true, started:false,
                                     waitingFor: <opponent friendly name>}.
GET  /api/games/:id/events       -> SSE, scoped to this game
```

### Removed

- `GET /api/whoami`, `POST /api/whoami` — identity is header-driven.
- `public/picker.js` and the splash-screen identity selector — no longer
  needed; identity comes from the CF header. The home screen takes its
  place as the landing surface.
- `GET /api/state`, `POST /api/validate`, `POST /api/move`, `POST /api/pass`,
  `POST /api/swap`, `POST /api/resign`, `POST /api/new-game`, `GET /api/events`
  — all replaced by their `/games/:id/*` equivalents.

### Response shape changes

- `state` no longer uses `racks: { keith, sonia }` and `scores: { keith,
  sonia }`. It returns `racks: { a, b }`, `scores: { a, b }`, `currentTurn:
  'a'|'b'`, `you: 'a'|'b'`, and `opponent: { friendlyName, color }`. The
  client never needs to know the opponent's email.

### Idempotency

Move nonces become unique-per-game rather than global, via the partial
unique index above. Behaviorally unchanged: replaying a write with the same
nonce returns the existing move id.

## Client

### Routing

The Express app serves:

- `/` → `public/home.html` (new).
- `/game/:id` → `public/index.html` (the existing game shell).
- `/lockout` → `public/lockout.html` (new, static).
- `/api/*` → routes module.
- Static assets unchanged.

`index.html` reads the gameId from `location.pathname` (`/game/:id`) and
plumbs it through `app.js` into all fetches and the SSE URL.

### Home screen (`public/home.html` + `public/home.js`)

- Header: "Hi, *friendlyName*."
- Grid of tiles, one per other roster member (alphabetical by friendly name).
  Each tile shows:
  - Friendly name and a colored bar in the user's color.
  - If active game exists with this person:
    - "Your turn" / "Their turn" badge.
    - Score line "*you* 142 — 98 *them*".
    - Relative last-move time ("2h ago").
    - Click → `/game/:id`.
  - If no active game:
    - "Start a game" button.
    - Click → `POST /api/games {otherUserId}` → redirect to `/game/:id`.
- Fetches `GET /api/me` (user + games) and `GET /api/users` (roster) in
  parallel on load. No SSE on the home page in v1; the user reloads or
  navigates back to refresh. (SSE could be added later if it feels stale.)

### Game screen

Functional behavior unchanged. UI updates:

- Score panel labels show friendly names (not "Keith"/"Sonia"). Colors come
  from the users table.
- "You" and "Opponent" labels in callouts and toasts use `you`/`opponent`
  from the state response.
- A small back-arrow in the header returns to `/`.
- New-game confirmation continues to apply, scoped to this pair only.
  Wording: "Start another game with *Mom*?" instead of generic.

### Lockout page (`public/lockout.html`)

Static HTML. Reads the email from a server-rendered `<meta>` tag
(or just from a query string the server appends on redirect). Shows:

> Hi *email* — you're not on the roster yet. Ask Keith.

A `mailto:` link to `slabgorb@gmail.com` for convenience. No JS, no
references to game state.

## Server modules — concrete changes

| Module | Change |
| --- | --- |
| `db.js` | Schema rewrite. New `users`, `games` tables. Drop singleton `game`. New helpers: `listUsers`, `getUserByEmail`, `createUser`, `createGame(pairUserIds)`, `getGameForUser(gameId, userId)`, `listGamesForUser(userId)`, `persistMove(gameId, …)`, `resetGameForPair(prevGameId)`. The migration runs in `openDb`. |
| `identity.js` | Rewrite. No more cookies. Exports `attachIdentity({ db, isProd })` middleware that reads the CF header (or `DEV_USER` in dev), looks up the user, attaches `req.user`, or 401 if no header / 403 lockout if header but no user. |
| `routes.js` | Rewrite the route table per the API section. Add per-game authorization helper `requireGameMembership`. Each handler reads `gameId` from `req.params.id`. |
| `sse.js` | `Map<gameId, Set<res>>`. `subscribe(gameId, req, res)` and `broadcast(gameId, event)`. Heartbeat unchanged. |
| `engine.js` | Untouched. The engine is pure and already references neither names nor sides — its inputs are board+rack+placement. |
| `board.js`, `dictionary.js` | Untouched. |
| `server.js` | Wire env: `NODE_ENV`, `DEV_USER`. Add `/`, `/game/:id`, `/lockout` static routes. |

## CLI: `bin/add-user.js`

```
Usage: node bin/add-user.js <email> <friendly_name> [color]

Inserts a user. Color defaults to the next unused entry from a small
palette: blue (#3b82f6), pink (#ec4899), amber (#f59e0b), emerald (#10b981),
violet (#8b5cf6), red (#ef4444). Errors if the email is already present.

Examples:
  node bin/add-user.js mom@example.com "Mom"
  node bin/add-user.js bob@example.com "Bob" "#10b981"
```

A companion `bin/list-users.js` prints the roster (email, friendly_name,
color, active-game count). A `bin/rename-user.js <email> <new_name>` updates
the friendly name. No remove command in v1.

## Testing

- **Migration:** load a fixture `game.db` produced by the current code,
  run `openDb`, assert that `users` has Keith+Sonia, that there's exactly
  one active game between them, and that the board/scores/racks survive.
- **Identity middleware:** header present → user attached; header missing
  in dev with `DEV_USER` → user attached; header missing in prod → 401;
  header present but email not in roster → 403 lockout.
- **Pair canonicalization & uniqueness:** `createGame(2, 1)` and
  `createGame(1, 2)` both produce a row with `(player_a_id=1,
  player_b_id=2)`. Second call while first is active → constraint error
  surfaced as 409 in the route layer.
- **Per-game authorization:** user not in `(a, b)` of game N gets 403 on
  every `/api/games/:N/*` route.
- **SSE scoping:** two simultaneous games each broadcast to their own
  subscribers, no cross-talk.
- **CLI:** add-user inserts; duplicate email errors out; missing args
  prints usage and exits non-zero.
- **Engine tests:** unchanged.
- **Route happy-path tests:** rewritten to take `gameId`. Coverage of
  move, pass, swap, resign, new-game, validate.

## Risks & open questions

- **CF Access header trust.** The header `Cf-Access-Authenticated-User-Email`
  is only safe to trust when the request actually came through Cloudflare.
  In production this is the case (the tunnel terminates only Cloudflare-
  origin connections). For belt-and-braces we set
  `app.set('trust proxy', 1)` and document that the bind address must not
  be exposed outside the tunnel. The launchd plist already binds to
  localhost.
- **Color collisions.** Six colors in the default palette; with more than
  six users two will share. Acceptable; admin can pass a custom hex.
- **Time skew on "their turn 2h ago".** Client renders relative times from
  `updated_at`; SQLite stores `Date.now()` server-side. No issue at this
  scale.
- **Empty roster.** First boot before any users exist: the migration seeds
  Keith and Sonia (because there's a legacy game). On a fresh install with
  no legacy data, `users` is empty and the only path to add anyone is the
  CLI. The lockout page handles unknown logins gracefully in the meantime.

## Referenced files

- `src/server/db.js`, `identity.js`, `routes.js`, `sse.js`, `server.js`
- `public/index.html`, `app.js`, `state.js`, `picker.js`, `style.css`
- `infra/launchd/*.plist`, `infra/cloudflared/words-config.yml.example`
- `bin/` (new directory)
- Prior spec: `docs/superpowers/specs/2026-05-04-words-with-friends-design.md`
