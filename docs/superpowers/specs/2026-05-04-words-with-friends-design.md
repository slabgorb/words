# Words — Words with Friends Clone (Design Spec)

**Date:** 2026-05-04
**Author:** Architect (Sméagol)
**Status:** Approved (brainstorming) — pending implementation plan

## Purpose

A faithful, ad-free Words with Friends clone for personal use by two players (Keith and Sonia). Async play (take turns whenever, like real WwF), self-hosted on Keith's machine and reachable via an existing Cloudflare tunnel.

The goal is a small, boring, maintainable single-process app — not a platform. Two players, one game at a time, no chat, no accounts, no analytics, no ads.

## Settled Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Turn cadence | **Async** | Both players rarely online simultaneously; correctness must not depend on liveness. |
| Hosting | **Self-host on Keith's machine + Cloudflare tunnel** | User has tunnel set up; zero ongoing cloud cost. |
| Ruleset | **Words with Friends** (not classic Scrabble) | Replacing the WwF experience specifically; tile values, bag size (104), premium-square layout all WwF-flavored. |
| Game scope | **Single ongoing game** at a time | Two-player simplicity; no lobby/game-list UI needed. |
| Dictionary | **ENABLE2K** (~173k words) | Public-domain, closest open approximation to WwF's proprietary dictionary. |
| Stack | **Node + Express + SQLite + plain HTML/CSS/JS** | Boring, well-trodden, no build step; user preference. |
| Live validation | **Yes — server-side debounced** | As tiles are placed, browser POSTs candidate placement; server checks geometry + dictionary; UI highlights green/red before submit. |
| Update propagation | **Server-Sent Events** (Approach 2) | Server-authoritative; SSE pushes `state-changed` notifications when both online. Plain HTTP, ~30 lines of server code. |

## Architecture

```
[browser: Keith]                 [browser: Sonia]
    │  HTTPS via Cloudflare           │  HTTPS via Cloudflare
    │  (cookie/localStorage = identity)│
    └──────────┬──────────────────────┘
               │
        ┌──────▼─────────────────────────────────┐
        │  Node + Express server (single process)│
        │  ┌──────────────┐  ┌─────────────────┐ │
        │  │ HTTP routes  │  │ SSE broadcaster │ │
        │  └──────┬───────┘  └────────┬────────┘ │
        │         │                   │          │
        │  ┌──────▼─────────┐  ┌──────▼────────┐ │
        │  │ Game engine    │  │ Dictionary    │ │
        │  │ (pure: rules,  │  │ (in-memory Set│ │
        │  │  scoring, ai)  │  │  from ENABLE) │ │
        │  └──────┬─────────┘  └───────────────┘ │
        │         │                              │
        │  ┌──────▼─────────────────┐            │
        │  │ SQLite (game, moves,   │            │
        │  │  players, history)     │            │
        │  └────────────────────────┘            │
        └────────────────────────────────────────┘
```

- Single Node process. Express serves static client files, JSON HTTP routes (`/api/...`), and the SSE stream (`/api/events`).
- **State is server-authoritative.** Every move is re-validated server-side; the client cannot be trusted as a source of truth.
- Dictionary is loaded into a `Set<string>` at startup (~173k entries, ~3 MB heap). O(1) lookup.
- SQLite holds canonical state. The DB file lives next to the binary; backup is `cp game.db backup.db`.
- No build step. Vanilla HTML/CSS/JS served as static files.

### Identity model

Simplest viable: on first visit, the browser shows a 2-button picker — "I'm Keith" / "I'm Sonia". The choice is written to `localStorage` and a server-signed cookie. No password, no signup. Cloudflare Access can wrap the app later if a hard auth layer is wanted; the app itself trusts the cookie.

## Components

### Server (`src/server/`)

| Module | Purpose |
|--------|---------|
| `server.js` | Bootstrap — load dictionary, open DB, mount routes, start listening. |
| `routes.js` | Express route definitions; thin layer that delegates to engine/db. |
| `sse.js` | SSE broadcaster — registers connected clients, fans out events. |
| `engine.js` | **Pure** game logic: validate placement, score move, draw tiles, end-game detection. No DB, no IO. |
| `dictionary.js` | Loads ENABLE2K word list at boot into a `Set`; exposes `isWord(s)`. |
| `board.js` | Constants: premium-square map, WwF letter values, WwF tile distribution. |
| `db.js` | SQLite open/migrate; CRUD wrappers. |
| `identity.js` | Cookie sign/verify; "who am I" middleware. |

### Client (`public/`, plain ES modules)

| File | Purpose |
|------|---------|
| `index.html` | Single page — board, racks, sidebar, controls. |
| `app.js` | Boot: pick identity if missing, fetch state, open SSE, wire UI. |
| `board.js` | Board renderer + drag/drop tile placement, premium-square highlighting. |
| `rack.js` | Player's 7-tile rack with reorder/shuffle. |
| `validator.js` | POSTs candidate placement to `/api/validate` (debounced) for live word check. |
| `state.js` | Holds local UI state (tentative placement, selection); reconciles with server state. |
| `style.css` | All styling, no framework. |

### Why this split

- `engine.js` is pure — easy to unit-test (give it a state and a move, assert the result).
- `dictionary.js` is single-method — swapping word lists later is trivial.
- Client has no framework. `app.js` orchestrates; the others are dumb renderers/handlers.

## Data Flow

### A move's life — Sonia plays QUIRK through Keith's K

1. **Tile placement.** Sonia drags Q,U,I,R from her rack onto the board, leaving Keith's K untouched. Client `state.js` accumulates a tentative placement: `[(r,c,letter), ...]`.

2. **Live validation (debounced ~150ms after each drop).**
   `Client → POST /api/validate { placement: [...] }`
   Server:
   - `engine.validateMove()` — contiguous? aligned to one row/col? touches existing tiles or center on first move? what words does it form (main + crosswords)?
   - `dictionary.isWord()` for each formed word
   - Returns `{ valid: true, words: [{word:"QUIRK", ok:true}], score: 31 }`
   Client highlights tiles green and shows `+31`.

3. **Submit.**
   `Client → POST /api/move { placement: [...], clientNonce }`
   Server:
   - **Re-validates** (trust nothing from client)
   - Applies move to DB in a single transaction
   - Draws replacement tiles for Sonia
   - Advances turn to Keith
   - Inserts a `moves` row
   - Broadcasts SSE event `{ type:"move", by:"sonia", word:"QUIRK", score:31 }`
   - Returns `{ ok:true, newRack, newState }`

4. **Keith's tab (if open) receives SSE event.** Client re-fetches `/api/state` (or merges from event payload), animates the new tiles onto the board, shows "Sonia played QUIRK +31", updates score and turn indicator.

5. **If Keith's tab is closed:** no problem. On his next visit, `GET /api/state` returns canonical state including Sonia's move. SSE only powers the "feels live when both online" experience; correctness does not depend on it.

### Other flows (briefer)

- **Pass turn:** `POST /api/pass` → engine increments the consecutive-scoreless-turn counter, broadcasts. **Six consecutive scoreless turns** (3 per player; passes and zero-score swaps both count) end the game per WwF/Scrabble rules.
- **Swap tiles:** `POST /api/swap { tiles:[...] }` → engine validates bag has ≥7 tiles, returns new ones, doesn't change score, advances turn.
- **Resign:** `POST /api/resign` → ends game; opponent wins.
- **New game:** `POST /api/new-game` → requires both players to confirm (each clicks once; server records both before resetting). Final state is archived to `game_history` before the active `game` row is reinitialized.

### Concurrency

- All state mutations go through SQLite transactions.
- `client_nonce` on `POST /api/move` is checked via a UNIQUE constraint to make submission idempotent (handles double-submit on flaky network).
- Only one player has the active turn; server rejects moves from the wrong player with `409 Conflict`. Client greys out the Submit button accordingly as a UX backstop.

## Data Model

### SQLite schema

```sql
-- Two players, fixed identities. Inserted once at first boot.
CREATE TABLE players (
  id        TEXT PRIMARY KEY,            -- 'keith' | 'sonia'
  name      TEXT NOT NULL,
  color     TEXT NOT NULL                -- for UI tile tint
);

-- Exactly one row, ever. The active game.
CREATE TABLE game (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  status          TEXT NOT NULL,         -- 'active' | 'ended'
  current_turn    TEXT NOT NULL REFERENCES players(id),
  bag             TEXT NOT NULL,         -- JSON array of remaining tile letters
  board           TEXT NOT NULL,         -- JSON 15x15 array of {letter, byPlayer, fromMoveId}
  rack_keith      TEXT NOT NULL,         -- JSON array of 7 letters (or fewer near end)
  rack_sonia      TEXT NOT NULL,
  score_keith     INTEGER NOT NULL DEFAULT 0,
  score_sonia     INTEGER NOT NULL DEFAULT 0,
  consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
  ended_reason    TEXT,                  -- 'rack-empty' | 'six-scoreless' | 'resigned' | NULL
  winner          TEXT REFERENCES players(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Append-only move log. Every committed move, in order.
CREATE TABLE moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     TEXT NOT NULL REFERENCES players(id),
  kind          TEXT NOT NULL,           -- 'play' | 'pass' | 'swap'
  placement     TEXT,                    -- JSON [{r,c,letter,blank?}] for 'play', null otherwise
  words_formed  TEXT,                    -- JSON ['QUIRK','QI']
  score_delta   INTEGER NOT NULL DEFAULT 0,
  client_nonce  TEXT UNIQUE,             -- idempotency key
  created_at    INTEGER NOT NULL
);

-- Past games, for the inevitable "remember when..." moment.
CREATE TABLE game_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ended_at    INTEGER NOT NULL,
  winner      TEXT,
  score_keith INTEGER NOT NULL,
  score_sonia INTEGER NOT NULL,
  snapshot    TEXT NOT NULL              -- full final game JSON for replay
);
```

### Why JSON blobs for board/bag/racks

The board is a 15×15 fixed-size structure that's always read whole and written whole. Normalized "tile" rows would be pure overhead for two players. JSON keeps the engine code dead simple — load state, mutate, save back, all in one transaction.

### In-memory data

- `dictionarySet: Set<string>` — ~173k entries, ~3 MB heap, populated once at boot from `data/enable2k.txt`.
- Constants in `board.js`:
  - `LETTER_VALUE` (WwF values; e.g., Q=10, Z=10, J=10, X=8, blank=0)
  - `TILE_BAG` — initial 104-tile WwF distribution
  - `BOARD_PREMIUMS` — 15×15 matrix of `'TW' | 'DW' | 'TL' | 'DL' | null`

### Wire format

Plain JSON over HTTP. Client receives the same shape that DB blobs unwrap to — no custom serialization layer. SSE events carry `{type, payload}` deltas; the client knows when to re-fetch full state.

### Migrations

None for now. If schema changes during development, blow away the DB and start a new game. Revisit if `game_history` ever accumulates sentimental value.

## Error Handling

The threats are small (two trusted players, no internet randos). This is mostly about **honest feedback**, not defense.

| Failure mode | Where caught | Response |
|---|---|---|
| **Invalid placement geometry** (not in line, gap, doesn't touch existing, first move not on center) | `engine.validateMove()` | `400 { error:"placement-invalid", reason:"..." }`. UI shows red toast; tiles stay where placed so user can fix. |
| **Word not in dictionary** | `dictionary.isWord()` after geometry passes | **`200 { valid:false, words:[{word, ok:false}] }`** from `/api/validate` — note: validation endpoint always returns 200; only commit returns 4xx. UI highlights bad word in red. |
| **Tile not in your rack** (client tampered or stale) | `engine.validateMove()` | `400 { error:"rack-mismatch" }`. Client refetches state. |
| **Wrong player's turn** | `engine.validateMove()` | `409 { error:"not-your-turn" }`. Client refetches; UI greys submit anyway as backstop. |
| **Double-submit** (network retry) | UNIQUE constraint on `moves.client_nonce` | `200` with the original move's response. Idempotent. |
| **Bag too small for swap** | `engine.applySwap()` | `400 { error:"bag-too-small" }`. Client disables swap when bag <7. |
| **SSE stream drops** | client `EventSource.onerror` | Browser auto-reconnects; on reconnect, immediately `GET /api/state` to catch up. |
| **Browser closed mid-placement** | client `state.js` | Tentative placement saved to localStorage; restored on reload (still uncommitted, not on server). |
| **Dictionary file missing at boot** | `dictionary.js` load | Server **refuses to start** — fatal log, exit. Better than silently accepting any word. |
| **DB corruption / disk full** | top-level Express error handler | `500 { error:"server" }`. Operator restores from backup. |
| **Identity cookie missing/invalid** | `requireIdentity` middleware | `401`. Client redirects to "Who are you?" picker. |

### Logging

`console.log` to stdout for moves and SSE connects, `console.error` for refusals. No log framework, no rotation — `journalctl` (or wherever Node runs) handles persistence. Two-player traffic is approximately zero log volume.

### Client-side error UX

- Toasts for transient errors ("not your turn", "word not found").
- Banner for the "we lost connection, reconnecting" state.
- A "Refresh" button next to the score that re-runs `GET /api/state` — manual escape hatch.

### Out of scope

- Rate limiting (two friends behind a tunnel — irrelevant).
- CSRF tokens (cookie is signed; same-site default is enough).
- XSS escaping for player-typed content (there is no player-typed content — no chat, no names beyond fixed `Keith`/`Sonia`).
- A separate audit log (the `moves` table is the audit log).

## Testing

Test surface, ordered by leverage:

### 1. `engine.js` — heavy unit tests

Pure functions, dependency-free. Use `node:test` (built-in). No Jest, no Mocha, no config.

Coverage:
- **`validateMove`** — first-move-must-touch-center, tiles-in-line, no-gaps, must-touch-existing, rack-has-tiles, blank-tile-handling. ~15 cases.
- **`scoreMove`** — premium squares (TW/DW/TL/DL) on right tiles, premiums consumed (don't apply on subsequent plays over them), 7-letter "bingo" +35 bonus (WwF), crossword scoring, blanks count as 0.
- **`applyMove`** — rack refilled from bag, tiles removed from rack, board updated, turn advanced.
- **`endGameAdjust`** — rack-empty path: out-player gets `+sum(opponent rack values)`, opponent gets `−sum(own rack values)` (the standard 2× swing); six-scoreless path: each player gets `−sum(own rack values)`; resigned path: opponent wins regardless of score; final winner determined after adjustment.

Fixture-based: describe a starting state in JSON, the move, and the expected resulting state. Diff. ~40 tests, runs in <1s.

### 2. `dictionary.js` — smoke test

"ENABLE2K loads, contains `HELLO`, does not contain `XYZZY`."

### 3. `board.js` — table-driven assertions

Premium-square layout matches the WwF reference. Tile bag has 104 entries with the right letter distribution. Letter values match WwF.

### 4. HTTP routes — thin integration tests

Run against in-memory SQLite (`:memory:`); no fixture cleanup.
- `POST /api/move` valid → 200, state updates, SSE event broadcasts.
- `POST /api/move` from wrong player → 409.
- `POST /api/move` same `client_nonce` twice → second is idempotent.
- `GET /api/state` → matches DB.
- `POST /api/validate` with bad word → `valid:false`.

~10 tests.

### 5. SSE — one test

Open an `EventSource`, submit a move, assert the event arrives. Don't go deeper.

### 6. Client JS — manual

No framework, no build step → no unit-test rig that wouldn't itself be more code than the client. **Test the UI by playing a game.**

### Test commands

- `npm test` → runs engine + dictionary + board + routes via `node --test`.
- No watch mode, no coverage tool, no CI config (yet).

### Explicitly not testing

- Cross-browser compatibility (you and Sonia each pick one).
- Performance / load (it's two players).
- Visual regression.
- Cloudflare tunnel integration (operator concern, not the app's).

## Acceptance Criteria

- [ ] You can open the app at the Cloudflare URL, pick "I'm Keith" or "I'm Sonia", and see the board.
- [ ] First move must touch the center star; subsequent moves must touch an existing tile.
- [ ] Live validator highlights candidate words green when valid, red when not in dictionary, and shows the would-be score.
- [ ] Submitting a valid move advances the turn, refills your rack from the bag, and updates the score.
- [ ] Words with Friends premium-square layout, tile distribution (104 tiles), letter values (Q=10, J=10, X=8, blank=0, etc.), and 7-letter bingo bonus (+35) all match the reference.
- [ ] If the other player's tab is open when you submit, their board updates within a second (SSE).
- [ ] Closing your browser preserves a tentative (uncommitted) placement so you can resume.
- [ ] Pass / swap tiles / resign all work and end the game per WwF rules: six consecutive scoreless turns; one player empties their rack with the bag also empty; or a resign.
- [ ] Final score includes the standard end-game rack-value adjustments (out-player gets `+sum(opponent rack)` and opponent gets `−sum(own rack)` on rack-empty; both players get `−sum(own rack)` on six-scoreless).
- [ ] Game ends → archived to `game_history` → either player can start a new game (after both confirm).
- [ ] Refusing a move with the wrong dictionary surfaces a clear "not a word" indicator, not a generic error.

## Out of Scope (v1)

- Multiple concurrent games / a lobby.
- Chat between players.
- AI opponent.
- Mobile-specific layout work beyond what falls out of CSS reasonable defaults.
- Visual tile animations beyond simple drop / land.
- Tournament / ranked play / ELO.
- Standalone dictionary lookup widget (trivial to add later — `GET /api/word/:s`).
- Rack assistant / anagram solver.
- Multi-language dictionaries.

## Open Questions

None blocking. Items to revisit during implementation:

- Visual style direction (modern minimal vs WwF-faithful look) — defer to the implementation plan; not architectural.
- Whether to ship a manual `swap-dictionary` admin endpoint; cheap to add later.

## Project Structure (anticipated)

```
words/
├── data/
│   └── enable2k.txt              # word list, ~173k lines
├── public/
│   ├── index.html
│   ├── app.js
│   ├── board.js
│   ├── rack.js
│   ├── validator.js
│   ├── state.js
│   └── style.css
├── src/
│   └── server/
│       ├── server.js
│       ├── routes.js
│       ├── sse.js
│       ├── engine.js
│       ├── dictionary.js
│       ├── board.js
│       ├── db.js
│       └── identity.js
├── test/
│   ├── engine.test.js
│   ├── dictionary.test.js
│   ├── board.test.js
│   └── routes.test.js
├── docs/superpowers/specs/
│   └── 2026-05-04-words-with-friends-design.md
├── game.db                       # gitignored
├── package.json
└── README.md
```
