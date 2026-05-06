# Gamebox

A self-hosted plugin host for two-player turn-based games. Adding a new game
is one folder plus one registry line.

Not a SaaS. Not multi-tenant. Personal-use only — runs on a small Tailscale
network for a curated roster of friends and family.

## Quick start

```bash
npm install
npm run fetch-dict        # downloads ENABLE2K (~3 MB) → data/enable2k.txt
DEV_USER=you@example.com npm start
                          # no CF Access needed locally
                          # http://localhost:3000
```

| var        | default          | purpose                                      |
| ---------- | ---------------- | -------------------------------------------- |
| `PORT`     | `3000`           | HTTP listen port                             |
| `DB_PATH`  | `./game.db`      | SQLite file (roster + game state)            |
| `NODE_ENV` | (unset)          | `production` enables strict header-only auth |
| `DEV_USER` | (unset)          | dev-only email override; ignored in prod     |

## Architecture

The **host** (this repo) owns authentication, the roster, lobby routing, and
per-game state storage. **Plugins** own rules and client UI.

```
public/
  lobby/              lobby SPA (host-served)
    lobby.html
    lobby.js
    lobby.css
  lockout.html        static "not on roster" page

src/server/
  server.js           entry point — env, routes, static serving
  routes.js           /api/* — see API section below
  identity.js         CF Access header → req.user (or DEV_USER)
  users.js            user CRUD + color palette
  games.js            game lifecycle (Words legacy helpers)
  db.js               better-sqlite3 schema + open/migrate
  plugins.js          registry builder + getPlugin helper
  plugin-clients.js   serves each plugin's client dir at /play/:type/:id/
  sse.js              per-game SSE broadcaster

plugins/
  words/              Words With Friends clone (ships with the host)
    plugin.js         plugin contract implementation
    server/           engine, dictionary, aux routes
    client/           browser JS/CSS

src/shared/dice/      shared <dice-tray> Web Component (Vite-built)
                      → public/shared/dice.js (bundle, .gitignored)
                      → public/shared/dice-assets/ (font + texture)
                      Plugins use it via `<script type="module" src="/shared/dice.js">`
                      and a `<dice-tray dice="2d6">` element.

src/plugins/index.js  registers all plugins into the host registry
```

Each game's state is stored as a single JSON column in SQLite. The host is
single-process; better-sqlite3 is synchronous, so there are no race
conditions on state writes.

## Plugin contract

A plugin is a plain JS object (ESM default export) with these fields:

| field          | type       | required | description                                           |
| -------------- | ---------- | -------- | ----------------------------------------------------- |
| `id`           | string     | yes      | unique slug, e.g. `"words"`                           |
| `displayName`  | string     | yes      | shown in lobby, e.g. `"Words"`                        |
| `players`      | number     | yes      | always `2` for now                                    |
| `clientDir`    | string     | yes      | absolute path to the plugin's browser bundle          |
| `initialState` | function   | yes      | `({ participants, rng }) => state`                    |
| `applyAction`  | function   | yes      | `({ state, action, actorId, rng }) => { state, ended, error?, scoreDelta? }` |
| `publicView`   | function   | yes      | `({ state, viewerId }) => redacted_state`             |
| `auxRoutes`    | object     | no       | `{ [name]: { method, handler } }` — mounted under `/api/games/:gameId/<name>` |

`participants` is `[{ userId, side }]` where side is `'a'` or `'b'`.

The host always assigns `playerAId = min(userA, userB)` and
`playerBId = max(...)` so game pairs are canonical and a UNIQUE constraint
prevents duplicate active games between the same pair for the same type.

## Adding a plugin

1. Create `plugins/<name>/plugin.js` exporting the contract object above.
2. Place browser assets in `plugins/<name>/client/` (or a subdirectory).
3. Register in `src/plugins/index.js`:
   ```js
   import myGame from '../../plugins/my-game/plugin.js';
   export const plugins = [wordsPlugin, myGame];
   ```

The host auto-mounts the client at `/play/<id>/:gameId/` and exposes the
plugin in `GET /api/plugins`.

> **Note (client-side shared files):** The static server only serves files
> from the plugin's `clientDir`. If your plugin shares validation logic with
> the server (e.g. `validate.js`, `sets.js`, `multiset.js`, `tiles.js`),
> copy those files into `client/` — they cannot be imported from the server
> tree. Rummikub does this to run the same set/multiset checks in-browser.

## Shipped plugins

| plugin   | id         | description                                                         |
| -------- | ---------- | ------------------------------------------------------------------- |
| Words    | `words`    | Words With Friends clone, ENABLE2K dict                             |
| Rummikub | `rummikub` | Sabra rules, 2 jokers, 30-pt initial meld, structured-rows table UI |

- **Rummikub** (`plugins/rummikub/`) — Sabra rules, 2 jokers, 30-pt initial
  meld, structured-rows table UI. Player commits a turn-end state via
  `commit-turn`; server validates multiset balance + set legality + initial
  meld + joker harvest atomically.

## API surface

All `/api/*` routes require a valid identity. Game-scoped routes additionally
require the caller to be one of the two participants.

| method | path                         | description                                    |
| ------ | ---------------------------- | ---------------------------------------------- |
| GET    | `/api/me`                    | `{user, games}` — current user + Words list    |
| GET    | `/api/users`                 | `[{id, friendlyName, color}]` — full roster    |
| GET    | `/api/plugins`               | `{plugins: [{id, displayName}]}`               |
| GET    | `/api/games`                 | `{games: [...]}` — active games for caller     |
| POST   | `/api/games`                 | `{opponentId, gameType}` → `{id, gameType}`    |
| GET    | `/api/games/:id`             | game snapshot (plugin's publicView)            |
| POST   | `/api/games/:id/action`      | `{type, payload}` → `{state, ended}`           |
| GET    | `/api/games/:id/events`      | SSE stream, fires `{type:"update"}` on change  |

Plugin aux routes are mounted at `/api/games/:id/<name>` with the method
declared in `auxRoutes`.

## Auth

In production, put Cloudflare Access (or any proxy that injects
`Cf-Access-Authenticated-User-Email`) in front of the app. The app trusts
that header. Requests from emails not in the roster receive a 403; the client
redirects to `/lockout`.

For local dev, set `DEV_USER=you@example.com` — the header check is bypassed
and that email is used as the identity.

## Roster management

```bash
node bin/add-user.js mom@example.com "Mom"
node bin/list-users.js
node bin/rename-user.js mom@example.com "Mama"

# Or via justfile:
just add-user mom@example.com Mom
just list-users
```

## Operations (Tailscale host)

```bash
just install    # materialize launchd plists into ~/Library/LaunchAgents
just up         # start server + tunnel
just status     # show launchd state + URL reachability
just logs       # tail both log streams
just down       # stop both
just dev        # run server in foreground (kills launchd copy first)
just backup     # timestamped copy of game.db
```

## Tests

```bash
npm test        # node --test, runs test/**/*.test.js
```

## Reference

- Spec: `docs/superpowers/specs/2026-05-05-multiplayer-design.md`
- Plan: `docs/superpowers/plans/2026-05-05-multiplayer-implementation.md`
- Hosting bootstrap: `infra/README.md`
