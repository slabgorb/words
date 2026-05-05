# Words

A two-player Words with Friends clone for personal use. Self-hosted, ad-free,
turn-based, with real-time board sync over SSE. One running instance hosts a
single ongoing game between two named players (Keith and Sonia).

Not a SaaS. Not multi-game. Not multi-tenant. The whole thing fits in one
SQLite file and ~2.3k lines of vanilla JS.

## Quick start

```bash
npm install
npm run fetch-dict     # downloads ENABLE2K (~3 MB) → data/enable2k.txt
npm start              # http://localhost:3000
```

Open the URL in two browsers (or share via tunnel/Tailscale/LAN). Each browser
picks an identity from the splash screen — Keith or Sonia — and the choice is
remembered in a signed cookie. The other browser must pick the other identity.

Default env vars (override as needed):

| var           | default          | purpose                       |
| ------------- | ---------------- | ----------------------------- |
| `PORT`        | `3000`           | HTTP listen port              |
| `DB_PATH`     | `./game.db`      | SQLite file with game state   |
| `SECRET_PATH` | `./.secret`      | cookie HMAC key (auto-created)|

## Playing

Standard Scrabble/WWF rules: 15×15 board, two 7-tile racks, 100-tile bag,
center-square first move, words must connect, blanks score zero. The dictionary
is [ENABLE2K] (~173k words). The server is the source of truth — the client
only proposes placements, and `/api/validate` is called live as you drag tiles
so you see your score before submitting.

Controls: drag tiles from rack to board, **Submit move**, **Recall tiles**,
**Shuffle rack**. The `⋯` menu hides Pass, Swap, Resign, and New Game.

When the game ends (bag empty + a player goes out, or both pass twice in a
row), the loser's remaining tile values are deducted and added to the
opponent's score, per WWF rules. Pressing **Pass** at the end-of-game state
opens a "start a new game?" confirmation.

[ENABLE2K]: https://norvig.com/ngrams/enable1.txt

## Architecture

```
public/                 vanilla JS client — no framework, no bundler
  app.js                wiring: fetches state, renders, owns the move queue
  board.js, rack.js     DOM rendering for the 15×15 grid and the 7-tile rack
  drag.js               pointer-events drag manager (works on touch + mouse)
  validator.js          debounced calls to /api/validate as the user drags
  state.js              client-side game state cache, SSE subscription
  picker.js             identity splash screen
  themes.js, sounds.js  visual themes + audio cues
  callout.js            transient toast/score callouts

src/server/             Node 20 + Express, ESM
  server.js             entry point, env wiring
  routes.js             /api/* — see "API" below
  engine.js             pure rules: placement validation, scoring, end-game
  board.js              board geometry helpers
  dictionary.js         loads ENABLE2K into a Set (~3 MB in memory)
  db.js                 better-sqlite3 schema + state read/write
  sse.js                /api/events broadcaster (no fan-out larger than 2)
  identity.js           HMAC-signed cookie identity

data/enable2k.txt       word list, gitignored, fetched on demand
game.db                 active game state, gitignored, safe to delete
.secret                 32-byte cookie key, gitignored, regenerated if removed
```

The server is single-process and synchronous: better-sqlite3 is a blocking
driver and the rules engine has no I/O, so a move is one transaction with no
locking gymnastics. SSE pushes a "state changed" ping; clients re-fetch
`/api/state` and diff against their cache.

## API

All routes are under `/api`. All except `/whoami` require a valid identity
cookie.

| method | path        | purpose                                              |
| ------ | ----------- | ---------------------------------------------------- |
| GET    | `/whoami`   | returns `{ playerId }` or `{ playerId: null }`       |
| POST   | `/whoami`   | sets identity cookie; body `{ playerId }`            |
| GET    | `/state`    | full game snapshot (board, racks, scores, turn)      |
| POST   | `/validate` | scores a hypothetical placement; never 4xx for typos |
| POST   | `/move`     | submits a move (canonical write path)                |
| POST   | `/pass`     | passes the turn                                      |
| POST   | `/swap`     | swaps tiles back into the bag                        |
| POST   | `/resign`   | ends the game; opponent wins                         |
| POST   | `/new-game` | archives the current game and starts fresh          |
| GET    | `/events`   | SSE stream — emits `update` events on state change   |

## Tests

```bash
npm test     # node --test, runs test/**/*.test.js
```

Coverage focuses on the engine (placement, scoring, end-game), routes
(end-to-end happy path + error cases), board geometry, dictionary loading,
and the drag manager.

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
just reset-game # DESTRUCTIVE — wipes game.db and restarts
```

`just install` is idempotent. `just reset-game` is not — prefer the in-app
**New Game** button, which archives the prior game in SQLite.

## Files of note

- `data/enable2k.txt` — word list (gitignored; `npm run fetch-dict`)
- `game.db` — active game (gitignored; safe to delete to reset)
- `.secret` — cookie signing key (gitignored; regenerated on next start)
- `infra/launchd/*.plist` — launchd templates with `__HOME__` /
  `__PROJECT_DIR__` placeholders substituted by `just install`
- `infra/cloudflared/words-config.yml.example` — tunnel config template

## Reference

- Spec: `docs/superpowers/specs/2026-05-04-words-with-friends-design.md`
- Plan: `docs/superpowers/plans/2026-05-04-words-with-friends-implementation.md`
- Hosting bootstrap: `infra/README.md`
