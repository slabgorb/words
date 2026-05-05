# Words

A self-hosted Words With Friends clone for friends and family. One running
instance hosts multiple concurrent games, with at most one active game per
unordered pair of players. Authentication is delegated to Cloudflare Access
at the perimeter; the app reads the authenticated email from the request
header.

Not a SaaS, not multi-tenant, no notifications, no spectators. The whole
thing fits in one SQLite file and ~2.5k lines of vanilla JS.

## Quick start

```bash
npm install
npm run fetch-dict     # downloads ENABLE2K (~3 MB) → data/enable2k.txt
DEV_USER=you@example.com npm start
                       # local dev — no CF Access needed
                       # http://localhost:3000
```

In production, put Cloudflare Access (or anything that injects the
`Cf-Access-Authenticated-User-Email` request header) in front of the app.
The app trusts that header.

| var          | default            | purpose                                     |
| ------------ | ------------------ | ------------------------------------------- |
| `PORT`       | `3000`             | HTTP listen port                            |
| `DB_PATH`    | `./game.db`        | SQLite file with roster + games             |
| `NODE_ENV`   | (unset)            | `production` enables strict header-only auth |
| `DEV_USER`   | (unset)            | dev-only override; ignored in production    |

## Roster

Friends and family are added by the host via CLI. Each user is stored as
(email, friendly name, color). Email is the identity that Cloudflare Access
forwards.

```bash
node bin/add-user.js mom@example.com "Mom"
node bin/list-users.js
node bin/rename-user.js mom@example.com "Mama"

# Or via justfile:
just add-user mom@example.com Mom
just list-users
```

Each user must also be on the Cloudflare Access policy. The two are managed
separately.

If someone authenticates through Cloudflare Access but isn't on the app's
roster, they see a static lockout page asking them to message the host.

## Playing

The home page (`/`) shows one tile per other person on the roster. If you
have an active game with them, the tile shows whose turn it is, the score,
and the time of the last move; click to play. If you don't, click "Start a
game" to begin one. Game pairs are uniquely keyed: you cannot have two
active games with the same person.

Standard Scrabble/WWF rules: 15×15 board, two 7-tile racks, 100-tile bag,
center-square first move, words must connect, blanks score zero. The
dictionary is [ENABLE2K] (~173k words). The server is the source of truth;
the client only proposes placements, and the server's `/validate` endpoint
is called live so you see your score before submitting.

Controls: drag tiles from rack to board, **Submit move**, **Recall
tiles**, **Shuffle rack**. The `⋯` menu hides Pass, Swap, Resign, and New
Game.

[ENABLE2K]: https://norvig.com/ngrams/enable1.txt

## Architecture

```
public/                 vanilla JS — no framework, no bundler
  home.html / home.js   pair-centric landing page
  index.html / app.js   the game shell (served at /game/:id)
  state.js              SSE-aware game state cache
  board.js, rack.js     DOM rendering
  drag.js               pointer-events drag manager (touch + mouse)
  validator.js          debounced calls to /api/games/:id/validate
  picker.js             blank-letter, swap, more-actions pickers
  themes.js, sounds.js  visual themes + audio cues
  callout.js            transient toast/score callouts
  lockout.html          static "you're not on the roster" page

src/server/             Node 20 + Express, ESM
  server.js             entry point — wires env, mounts routes, serves static
  routes.js             /api/* — see "API" below
  identity.js           reads CF Access header (or DEV_USER) → req.user
  users.js              user CRUD + palette of accent colors
  games.js              game lifecycle, pair canonicalization, persistMove
  migrate.js            one-shot legacy → multiplayer migration
  db.js                 better-sqlite3 schema + helpers
  engine.js             pure rules: placement validation, scoring, end-game
  board.js              board geometry helpers
  dictionary.js         loads ENABLE2K into a Set (~3 MB in memory)
  sse.js                /api/games/:id/events broadcaster, per-game scoping

bin/                    admin CLI (no auth, host-only)
  add-user.js           insert (email, friendly name, color) into roster
  list-users.js         print roster
  rename-user.js        update a friendly name
  fetch-dictionary.js   download ENABLE2K once

data/enable2k.txt       word list, gitignored, fetched on demand
game.db                 active games + roster + history, gitignored
```

The server is single-process and synchronous; better-sqlite3 is a blocking
driver and the rules engine has no I/O. SSE pushes a "state changed" ping
scoped to the game; clients re-fetch `/api/games/:id/state` and diff
against their cache.

## API

All routes are under `/api`. Every route requires a valid identity (CF
header or DEV_USER fallback) and a roster row. Game-scoped routes
additionally require that the caller is one of the two participants.

| method | path                              | purpose                                     |
| ------ | --------------------------------- | ------------------------------------------- |
| GET    | `/me`                             | current user + their game list              |
| GET    | `/users`                          | roster (no emails — friendly name + color)  |
| POST   | `/games`                          | start a new game with another roster member |
| GET    | `/games/:id/state`                | full snapshot                               |
| POST   | `/games/:id/validate`             | scores a hypothetical placement             |
| POST   | `/games/:id/move`                 | submits a move                              |
| POST   | `/games/:id/pass`                 | passes the turn                             |
| POST   | `/games/:id/swap`                 | swaps tiles back into the bag               |
| POST   | `/games/:id/resign`               | ends the game; opponent wins                |
| POST   | `/games/:id/new-game`             | both-player confirm to start a fresh game   |
| GET    | `/games/:id/events`               | SSE stream — `update` events on state change|

A request whose authenticated email is not in the `users` table gets a 403
`{error: 'not-on-roster', email}`. The home-page client redirects that to
`/lockout?email=...` for a friendly UI.

## Tests

```bash
npm test     # node --test, runs test/**/*.test.js
```

Coverage: schema, helpers, migration, identity, per-game SSE, top-level
routes, game-scoped routes, engine (placement, scoring, end-game), board
geometry, dictionary loading, drag manager, CLI scripts.

## Operations (host machine)

A `justfile` wraps macOS launchd + Cloudflare Tunnel for always-on hosting.
See `infra/README.md` for the one-time bootstrap (`brew install`, tunnel
creation, DNS route, Cloudflare Access policy).

```bash
just install    # materialize launchd plists into ~/Library/LaunchAgents
just up         # start server + tunnel
just status     # show launchd state + reachability of local & public URLs
just logs       # tail both log streams
just down       # stop both
just dev        # run server in foreground (kills the launchd copy first)
just backup     # timestamped copy of game.db
just add-user EMAIL NAME    # add to roster
just list-users             # print roster
```

`just install` is idempotent. There is no `just reset-game` anymore —
games end when they end (or via the in-app **Resign** button), and a new
one is started from the home page.

## Files of note

- `data/enable2k.txt` — word list (gitignored; `npm run fetch-dict`)
- `game.db` — active state (gitignored; safe to delete to reset everything)
- `infra/launchd/*.plist` — launchd templates with `__HOME__` /
  `__PROJECT_DIR__` placeholders substituted by `just install`
- `infra/cloudflared/words-config.yml.example` — tunnel config template

## Reference

- Spec: `docs/superpowers/specs/2026-05-05-multiplayer-design.md`
- Plan: `docs/superpowers/plans/2026-05-05-multiplayer-implementation.md`
- Hosting bootstrap: `infra/README.md`
