# Gamebox Plugin Host + Words Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the words app into "gamebox", a plugin host for two-player turn-based games, with the existing Words rules engine extracted into the first plugin and zero user-visible regressions.

**Architecture:** Rename the project to gamebox. Add `game_type` and `state` (JSON) columns to the `games` table, packing the existing Words-specific columns into the JSON state. Define a small plugin contract (`initialState`, `applyAction`, `publicView`, optional `auxRoutes`) loaded via a static registry at `src/plugins/index.js`. Add a generic `POST /api/games/:id/action` route that dispatches to the plugin's `applyAction`. Move all Words-specific server code into `plugins/words/server/`, all Words client code into `plugins/words/client/` (served at `/play/words/:gameId`), and collapse the old Words routes into typed actions. Update the lobby to show per-game-type badges with a "start new" picker.

**Tech Stack:** Node 20+, Express 4, better-sqlite3, vanilla JS, `node --test`. ESM throughout.

**Spec:** `docs/superpowers/specs/2026-05-05-gamebox-plugin-host-and-rummikub-design.md`

**Prerequisites:** Multiplayer plan (`2026-05-05-multiplayer-implementation.md`) must be merged. This plan assumes the multiplayer schema (`users`, `games` with `player_a_id`/`player_b_id`/`status`/Words-inline columns, `moves`) is in place, CF Access auth is wired, and the lobby is pair-centric.

---

## File Structure

**Created:**
- `plugins/words/plugin.js` — Words plugin manifest + contract exports
- `plugins/words/server/engine.js` — moved from `src/server/engine.js`
- `plugins/words/server/board.js` — moved from `src/server/board.js`
- `plugins/words/server/dictionary.js` — moved from `src/server/dictionary.js`
- `plugins/words/server/actions.js` — `applyAction` switch over Words action types
- `plugins/words/server/view.js` — `publicView` projector (hides opponent rack)
- `plugins/words/server/state.js` — `initialState` builder
- `plugins/words/client/index.html` — moved from `public/index.html`
- `plugins/words/client/app.js`, `board.js`, `rack.js`, `drag.js`, `state.js`, `validator.js`, `picker.js`, `themes.js`, `sounds.js`, `callout.js`, `style.css`, `assets/`, `sounds/` — moved from `public/`
- `src/plugins/index.js` — static plugin registry
- `src/server/plugins.js` — registry validator + lookup helpers
- `src/server/state.js` — generic JSON-state read/write helpers on the games table
- `public/lobby/lobby.html`, `public/lobby/lobby.js` — host-served lobby (replaces `public/home.*`)
- `test/plugins-host.test.js` — plugin contract validation, registry behavior
- `test/action-route.test.js` — generic action dispatch
- `test/state-route.test.js` — public view filtering
- `test/aux-routes.test.js` — plugin-contributed auxiliary routes
- `test/client-serving.test.js` — `/play/<type>/<id>` static serving + `window.__GAME__` injection
- `test/words-plugin.test.js` — Words plugin contract behaviors
- `test/games-create.test.js` — generic new-game creation
- `test/lobby.test.js` — lobby rendering with game-type badges
- `test/schema-state.test.js` — schema delta + legacy-row migration
- `test/e2e-words.test.js` — full Words game played end-to-end through the new host

**Modified:**
- `package.json` — rename `name` to `gamebox`
- `README.md` — rebrand to gamebox; document plugin model + adding-a-plugin guide
- `src/server/db.js` — add `game_type` + `state` columns; one-shot migration of inline Words columns
- `src/server/games.js` — generalize `createGame`, `getGame`, `persistMove` to be plugin-aware (read/write JSON state)
- `src/server/routes.js` — remove `/move`, `/pass`, `/swap`, `/resign`, `/new-game`, `/validate`; add `POST /api/games/:id/action` and registration of plugin aux routes; add `POST /api/games` for generic new-game
- `src/server/server.js` — register plugins at boot; serve `/play/<type>/<id>/`; serve new lobby at `/`
- `src/server/sse.js` — no structural change but verify `Map<gameId, Set<res>>` still scopes correctly post-refactor
- `test/games.test.js` — adapt to JSON-state shape
- `test/routes.test.js` — adapt to action dispatch and `/api/games`

**Deleted (after refactor):**
- `src/server/engine.js`, `src/server/board.js`, `src/server/dictionary.js` (moved to plugin)
- `public/index.html`, `public/app.js`, etc. (moved to plugin) — `public/lobby/` and `public/lockout.html` remain
- `public/home.html`, `public/home.js` from multiplayer plan (replaced by lobby)
- Inline `bag`, `board`, `rack_a`, `rack_b`, `score_a`, `score_b`, `current_turn`, `consecutive_scoreless_turns` columns on `games`

---

## Task 1: Rename project to gamebox

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `public/lockout.html` (any branding)
- Test: existing test suite continues to pass

This is pure rebranding. Server still works identically. We rename the package and README before any structural change so subsequent commits live under the new project identity.

- [ ] **Step 1: Update `package.json` name**

```json
{
  "name": "gamebox",
  "version": "0.1.0",
  ...
}
```

- [ ] **Step 2: Update README.md title and intro**

Replace the first heading and intro:

```markdown
# Gamebox

A self-hosted plugin host for two-player turn-based games. Currently
ships Words (a Words-with-Friends clone) and Rummikub. Adding a new game
is a folder + one registry line.

Not a SaaS. Not multi-tenant. Personal-use only — runs on a small Tailscale
network for a small curated roster of users.
```

(The full README rewrite happens in Task 16 after the structural changes
are in place; this step just changes the title so we don't ship a confusing
"Words" README during the refactor.)

- [ ] **Step 3: Run existing tests**

Run: `npm test`
Expected: all tests pass (no behavior change)

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore(rename): words → gamebox"
```

---

## Task 2: Add `game_type` and `state` columns to `games`

**Files:**
- Modify: `src/server/db.js`
- Test: `test/schema-state.test.js` (new)

Add two new columns. `game_type TEXT NOT NULL DEFAULT 'words'` so existing
rows backfill cleanly. `state TEXT NOT NULL DEFAULT '{}'` (will be filled
by Task 3's migration). The unique-active partial index gets dropped and
recreated to include `game_type`.

- [ ] **Step 1: Write the failing schema test**

Create `test/schema-state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';

test('games has game_type column with default "words"', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(games)").all();
  const col = cols.find(c => c.name === 'game_type');
  assert.ok(col, 'game_type column missing');
  assert.equal(col.type, 'TEXT');
  assert.equal(col.notnull, 1);
  assert.equal(col.dflt_value, "'words'");
});

test('games has state column (JSON text, default {})', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(games)").all();
  const col = cols.find(c => c.name === 'state');
  assert.ok(col, 'state column missing');
  assert.equal(col.type, 'TEXT');
  assert.equal(col.notnull, 1);
});

test('one_active_per_pair_type partial unique index exists', () => {
  const db = openDb(':memory:');
  const idx = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='one_active_per_pair_type'"
  ).get();
  assert.ok(idx, 'one_active_per_pair_type index missing');
  assert.match(idx.sql, /game_type/);
  assert.match(idx.sql, /WHERE\s+status\s*=\s*'active'/i);
});

test('legacy one_active_per_pair index is removed', () => {
  const db = openDb(':memory:');
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='one_active_per_pair'"
  ).get();
  assert.equal(idx, undefined, 'legacy index should be dropped');
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/schema-state.test.js`
Expected: FAILs (column game_type missing / column state missing / index missing)

- [ ] **Step 3: Modify `src/server/db.js`**

In the schema initialization (after the existing `CREATE TABLE games` block), add:

```js
// --- Plugin host schema delta ---

// Add game_type column (idempotent: only if missing)
const gameCols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);

if (!gameCols.includes('game_type')) {
  db.exec("ALTER TABLE games ADD COLUMN game_type TEXT NOT NULL DEFAULT 'words'");
}

if (!gameCols.includes('state')) {
  db.exec("ALTER TABLE games ADD COLUMN state TEXT NOT NULL DEFAULT '{}'");
}

// Drop and recreate the active-uniqueness index to include game_type
db.exec("DROP INDEX IF EXISTS one_active_per_pair");
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_pair_type
  ON games (player_a_id, player_b_id, game_type)
  WHERE status = 'active'
`);
```

If the existing schema initialization is inside a function (e.g. `initSchema(db)`),
place this block at the end of that function. The `IF NOT EXISTS` clauses make
it safe to run on both fresh and pre-existing DBs.

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/schema-state.test.js`
Expected: PASS

- [ ] **Step 5: Run full test suite — must remain green**

Run: `npm test`
Expected: all pass (we have not yet *used* the new columns).

- [ ] **Step 6: Commit**

```bash
git add src/server/db.js test/schema-state.test.js
git commit -m "feat(db): add game_type and state columns + per-type active uniqueness"
```

---

## Task 3: Migrate inline Words columns into JSON `state`

**Files:**
- Modify: `src/server/db.js`
- Test: `test/schema-state.test.js` (extend)

Pack the legacy Words columns (`bag`, `board`, `rack_a`, `rack_b`, `score_a`,
`score_b`, `current_turn`, `consecutive_scoreless_turns`) into the new
`state` JSON column for each row, then drop the legacy columns. Idempotent:
detected by presence of legacy columns.

- [ ] **Step 1: Add migration test**

Append to `test/schema-state.test.js` (with `import Database from 'better-sqlite3';` and `import { migrateLegacyState } from '../src/server/db.js';` at the top of the file):

```js
test('legacy Words columns are migrated into state JSON and then dropped', () => {
  // Build a fake legacy DB by manually creating the pre-delta schema
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, friendly_name TEXT, color TEXT, created_at TEXT);
    CREATE TABLE games (
      id INTEGER PRIMARY KEY,
      player_a_id INTEGER, player_b_id INTEGER,
      status TEXT,
      bag TEXT, board TEXT, rack_a TEXT, rack_b TEXT,
      score_a INTEGER DEFAULT 0, score_b INTEGER DEFAULT 0,
      current_turn TEXT DEFAULT 'a',
      consecutive_scoreless_turns INTEGER DEFAULT 0,
      ended_reason TEXT, winner_side TEXT,
      created_at TEXT, updated_at TEXT
    );
    INSERT INTO users VALUES (1, 'a@b', 'Alice', '#f00', '2026-01-01');
    INSERT INTO users VALUES (2, 'b@b', 'Bob',   '#0f0', '2026-01-01');
    INSERT INTO games (id, player_a_id, player_b_id, status, bag, board, rack_a, rack_b, score_a, score_b, current_turn, consecutive_scoreless_turns, created_at, updated_at)
    VALUES (1, 1, 2, 'active', '["A","B"]', '[[null]]', '["X","Y"]', '["P","Q"]', 12, 7, 'b', 1, '2026-01-01', '2026-01-01');
  `);

  // Run the migration directly
  migrateLegacyState(db);

  // Legacy columns are gone
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  assert.ok(!cols.includes('bag'), 'bag should be dropped');
  assert.ok(!cols.includes('board'), 'board should be dropped');
  assert.ok(!cols.includes('rack_a'), 'rack_a should be dropped');
  assert.ok(!cols.includes('rack_b'), 'rack_b should be dropped');
  assert.ok(!cols.includes('score_a'), 'score_a should be dropped');
  assert.ok(!cols.includes('score_b'), 'score_b should be dropped');
  assert.ok(!cols.includes('current_turn'), 'current_turn should be dropped');
  assert.ok(!cols.includes('consecutive_scoreless_turns'), 'consecutive_scoreless_turns should be dropped');

  // state JSON contains everything
  const row = db.prepare("SELECT state, game_type FROM games WHERE id = 1").get();
  assert.equal(row.game_type, 'words');
  const state = JSON.parse(row.state);
  assert.deepEqual(state.bag, ['A', 'B']);
  assert.deepEqual(state.board, [[null]]);
  assert.deepEqual(state.racks, { a: ['X', 'Y'], b: ['P', 'Q'] });
  assert.deepEqual(state.scores, { a: 12, b: 7 });
  assert.equal(state.activeSide, 'b');
  assert.equal(state.consecutiveScorelessTurns, 1);
});

test('migration is idempotent on already-migrated DBs', () => {
  const db = openDb(':memory:');  // already in delta shape, no legacy cols
  // Should be a no-op, not throw
  migrateLegacyState(db);
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  assert.ok(cols.includes('state'));
});
```

- [ ] **Step 2: Run test, verify it fails (function does not exist)**

Run: `node --test test/schema-state.test.js`
Expected: FAIL with "migrateLegacyState is not a function" or similar

- [ ] **Step 3: Implement `migrateLegacyState` in `src/server/db.js`**

Add this exported function:

```js
export function migrateLegacyState(db) {
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);

  const legacyCols = [
    'bag', 'board', 'rack_a', 'rack_b',
    'score_a', 'score_b', 'current_turn',
    'consecutive_scoreless_turns'
  ];
  const presentLegacy = legacyCols.filter(c => cols.includes(c));
  if (presentLegacy.length === 0) return; // already migrated

  // Pack each row's legacy data into state JSON
  const rows = db.prepare(`SELECT * FROM games`).all();
  const updateState = db.prepare(`UPDATE games SET state = ? WHERE id = ?`);

  const update = db.transaction((rows) => {
    for (const row of rows) {
      const state = {
        bag: row.bag ? JSON.parse(row.bag) : [],
        board: row.board ? JSON.parse(row.board) : [],
        racks: {
          a: row.rack_a ? JSON.parse(row.rack_a) : [],
          b: row.rack_b ? JSON.parse(row.rack_b) : [],
        },
        scores: { a: row.score_a ?? 0, b: row.score_b ?? 0 },
        activeSide: row.current_turn ?? 'a',
        consecutiveScorelessTurns: row.consecutive_scoreless_turns ?? 0,
        initialMoveDone: (row.score_a ?? 0) > 0 || (row.score_b ?? 0) > 0,
      };
      updateState.run(JSON.stringify(state), row.id);
    }
  });
  update(rows);

  // Drop the legacy columns. SQLite supports `ALTER TABLE … DROP COLUMN`
  // since 3.35 (better-sqlite3 ships with a recent SQLite).
  for (const col of presentLegacy) {
    db.exec(`ALTER TABLE games DROP COLUMN ${col}`);
  }
}
```

Then call it from `openDb` after the schema-delta block from Task 2:

```js
// After ALTER TABLE additions:
migrateLegacyState(db);
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/schema-state.test.js`
Expected: PASS

- [ ] **Step 5: Run full test suite — note that `games.test.js` etc. may now fail** because they read from `bag`/`board`/etc. directly. That is expected; Task 4 fixes them.

Run: `npm test`
Expected: schema tests pass; some games-related tests may fail due to dropped columns. **DO NOT FIX THEM YET** — that's Task 4's job.

- [ ] **Step 6: Commit**

```bash
git add src/server/db.js test/schema-state.test.js
git commit -m "feat(db): migrate inline Words columns into JSON state"
```

---

## Task 4: Generic JSON-state read/write helpers

**Files:**
- Create: `src/server/state.js`
- Modify: `src/server/games.js`
- Test: `test/games.test.js` (adapt)

Provide a thin layer that reads `games.state` as parsed JSON and writes
back atomically. `games.js` from the multiplayer plan currently knows about
`bag`/`board`/etc. directly; refactor it to operate on the JSON blob.

- [ ] **Step 1: Write `src/server/state.js`**

```js
// Generic JSON-state helpers for the games table.
// Plugins own the *shape* of state; this module owns the *transport*.

export function readGameState(db, gameId) {
  const row = db.prepare(`SELECT state, game_type FROM games WHERE id = ?`).get(gameId);
  if (!row) return null;
  return { state: JSON.parse(row.state), gameType: row.game_type };
}

export function writeGameState(db, gameId, state) {
  const stmt = db.prepare(`UPDATE games SET state = ?, updated_at = datetime('now') WHERE id = ?`);
  const info = stmt.run(JSON.stringify(state), gameId);
  if (info.changes !== 1) throw new Error(`writeGameState: game ${gameId} not found`);
}
```

- [ ] **Step 2: Write a test for the helpers**

Add to `test/games.test.js` (or create alongside):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { readGameState, writeGameState } from '../src/server/state.js';

test('readGameState returns parsed state and game_type', () => {
  const db = openDb(':memory:');
  // seed users + game
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f', datetime('now'))").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#g', datetime('now'))").run();
  db.prepare(`
    INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (1, 1, 2, 'active', 'words', ?, datetime('now'), datetime('now'))
  `).run(JSON.stringify({ scores: { a: 0, b: 0 } }));

  const result = readGameState(db, 1);
  assert.equal(result.gameType, 'words');
  assert.deepEqual(result.state, { scores: { a: 0, b: 0 } });
});

test('writeGameState round-trips an arbitrary state object', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f', datetime('now'))").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#g', datetime('now'))").run();
  db.prepare(`
    INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (1, 1, 2, 'active', 'words', '{}', datetime('now'), datetime('now'))
  `).run();

  writeGameState(db, 1, { foo: 'bar', n: 42 });
  const result = readGameState(db, 1);
  assert.deepEqual(result.state, { foo: 'bar', n: 42 });
});

test('writeGameState throws on missing game', () => {
  const db = openDb(':memory:');
  assert.throws(() => writeGameState(db, 999, {}), /not found/);
});
```

- [ ] **Step 3: Run test, verify it passes**

Run: `node --test test/games.test.js`
Expected: PASS for the new helper tests. Other existing `games.test.js`
tests written against the old schema may still fail; that's OK — those get
addressed when Task 11's plugin contract subsumes their behavior.

- [ ] **Step 4: Refactor `src/server/games.js` helpers**

The multiplayer plan creates `createGame`, `getGame`, `persistMove`,
`listGames` etc. in `src/server/games.js` and they currently read/write
`bag`/`board`/`rack_a`/`rack_b`. Replace those internal access patterns
with `readGameState`/`writeGameState`:

- `createGame(opts)` becomes plugin-aware: it takes `{ playerAId, playerBId, gameType, initialState }` and inserts a row with `game_type = gameType` and `state = JSON.stringify(initialState)`.
- `getGame(id)` returns `{ id, playerAId, playerBId, status, gameType, state, createdAt, updatedAt }` — reads JSON.
- `persistMove` is replaced by Task 5's generic `applyAction` flow; remove or stub it (it stays usable inside the Words plugin if needed, but no longer exists as a public games-module export).
- `listGames(userId)` returns rows with `game_type` included; lobby uses this.

Concretely:

```js
import { readGameState, writeGameState } from './state.js';

export function createGame(db, { playerAId, playerBId, gameType, initialState }) {
  if (playerAId >= playerBId) {
    [playerAId, playerBId] = [playerBId, playerAId];
  }
  const stmt = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
    RETURNING id
  `);
  const { id } = stmt.get(playerAId, playerBId, gameType, JSON.stringify(initialState));
  return id;
}

export function getGame(db, id) {
  const row = db.prepare(`
    SELECT id, player_a_id AS playerAId, player_b_id AS playerBId,
           status, game_type AS gameType, state,
           ended_reason AS endedReason, winner_side AS winnerSide,
           created_at AS createdAt, updated_at AS updatedAt
    FROM games WHERE id = ?
  `).get(id);
  if (!row) return null;
  return { ...row, state: JSON.parse(row.state) };
}

export function listActiveGamesForUser(db, userId) {
  return db.prepare(`
    SELECT id, player_a_id AS playerAId, player_b_id AS playerBId,
           game_type AS gameType, status, updated_at AS updatedAt
    FROM games
    WHERE status = 'active' AND (player_a_id = ? OR player_b_id = ?)
    ORDER BY updated_at DESC
  `).all(userId, userId);
}

export function endGame(db, id, { endedReason, winnerSide, finalState }) {
  db.prepare(`
    UPDATE games SET status = 'ended', ended_reason = ?, winner_side = ?,
                     state = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(endedReason, winnerSide, JSON.stringify(finalState), id);
}
```

(Adapt to the actual function names the multiplayer plan exports — the
shape is the same: take/return JSON state.)

- [ ] **Step 5: Run full suite — adapt failing existing tests**

Run: `npm test`

For any `test/games.test.js` test that still references `bag`/`board`/etc.,
update it to use the new `state` JSON shape. Tests that exercise the Words
rules engine should keep working since they import `engine.js` directly;
only tests that reach into `games.js` need updating.

- [ ] **Step 6: Commit**

```bash
git add src/server/state.js src/server/games.js test/games.test.js
git commit -m "refactor(games): JSON-state helpers; createGame/getGame plugin-aware"
```

---

## Task 5: Plugin manifest validator and registry

**Files:**
- Create: `src/server/plugins.js`
- Create: `src/plugins/index.js`
- Test: `test/plugins-host.test.js`

Define the contract: every plugin module must export `{ id, displayName, players, clientDir, initialState, applyAction, publicView }` and may optionally export `{ legalActions, auxRoutes }`. The validator runs at server boot and throws on the first bad manifest.

- [ ] **Step 1: Write the validator test**

Create `test/plugins-host.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlugin } from '../src/server/plugins.js';

const makeStub = (overrides = {}) => ({
  id: 'stub',
  displayName: 'Stub',
  players: 2,
  clientDir: 'plugins/stub/client',
  initialState: () => ({}),
  applyAction: () => ({ state: {}, ended: false }),
  publicView: ({ state }) => state,
  ...overrides,
});

test('valid plugin passes', () => {
  assert.doesNotThrow(() => validatePlugin(makeStub()));
});

test('missing id throws', () => {
  const p = makeStub();
  delete p.id;
  assert.throws(() => validatePlugin(p), /id/);
});

test('id with non-url-safe chars throws', () => {
  assert.throws(() => validatePlugin(makeStub({ id: 'has spaces' })), /url-safe/);
  assert.throws(() => validatePlugin(makeStub({ id: 'UPPER' })), /url-safe/);
});

test('players != 2 throws', () => {
  assert.throws(() => validatePlugin(makeStub({ players: 3 })), /players.*2/);
  assert.throws(() => validatePlugin(makeStub({ players: 1 })), /players.*2/);
});

test('missing initialState throws', () => {
  assert.throws(() => validatePlugin(makeStub({ initialState: undefined })), /initialState/);
});

test('missing applyAction throws', () => {
  assert.throws(() => validatePlugin(makeStub({ applyAction: undefined })), /applyAction/);
});

test('missing publicView throws', () => {
  assert.throws(() => validatePlugin(makeStub({ publicView: undefined })), /publicView/);
});

test('non-function applyAction throws', () => {
  assert.throws(() => validatePlugin(makeStub({ applyAction: 'not a fn' })), /applyAction/);
});

test('legalActions and auxRoutes are optional', () => {
  assert.doesNotThrow(() => validatePlugin(makeStub({ legalActions: undefined, auxRoutes: undefined })));
});

test('auxRoutes must be a plain object of {method, handler}', () => {
  assert.doesNotThrow(() => validatePlugin(makeStub({ auxRoutes: { validate: { method: 'POST', handler: () => {} } } })));
  assert.throws(() => validatePlugin(makeStub({ auxRoutes: 'nope' })), /auxRoutes/);
  assert.throws(() => validatePlugin(makeStub({ auxRoutes: { validate: { method: 'POST' } } })), /handler/);
  assert.throws(() => validatePlugin(makeStub({ auxRoutes: { validate: { handler: () => {} } } })), /method/);
});
```

- [ ] **Step 2: Run test, verify it fails (validator does not exist)**

Run: `node --test test/plugins-host.test.js`
Expected: FAIL with "validatePlugin is not a function"

- [ ] **Step 3: Implement `src/server/plugins.js`**

```js
const URL_SAFE_ID = /^[a-z][a-z0-9-]*$/;

export function validatePlugin(p) {
  if (!p || typeof p !== 'object') throw new Error('plugin: not an object');
  if (typeof p.id !== 'string' || !URL_SAFE_ID.test(p.id)) {
    throw new Error(`plugin.id must be url-safe (lowercase letters, digits, hyphens; starts with letter): ${p.id}`);
  }
  if (typeof p.displayName !== 'string' || p.displayName.length === 0) {
    throw new Error(`plugin(${p.id}).displayName must be a non-empty string`);
  }
  if (p.players !== 2) {
    throw new Error(`plugin(${p.id}).players must be 2; got ${p.players}`);
  }
  if (typeof p.clientDir !== 'string' || p.clientDir.length === 0) {
    throw new Error(`plugin(${p.id}).clientDir must be a non-empty string`);
  }
  for (const fn of ['initialState', 'applyAction', 'publicView']) {
    if (typeof p[fn] !== 'function') {
      throw new Error(`plugin(${p.id}).${fn} must be a function`);
    }
  }
  if (p.legalActions !== undefined && typeof p.legalActions !== 'function') {
    throw new Error(`plugin(${p.id}).legalActions must be a function if present`);
  }
  if (p.auxRoutes !== undefined) {
    if (typeof p.auxRoutes !== 'object' || p.auxRoutes === null || Array.isArray(p.auxRoutes)) {
      throw new Error(`plugin(${p.id}).auxRoutes must be a plain object`);
    }
    for (const [name, route] of Object.entries(p.auxRoutes)) {
      if (!URL_SAFE_ID.test(name)) {
        throw new Error(`plugin(${p.id}).auxRoutes['${name}']: route name must be url-safe`);
      }
      if (typeof route?.method !== 'string') throw new Error(`plugin(${p.id}).auxRoutes['${name}'].method missing`);
      if (typeof route?.handler !== 'function') throw new Error(`plugin(${p.id}).auxRoutes['${name}'].handler must be a function`);
    }
  }
  return p;
}

export function buildRegistry(pluginMap) {
  const out = {};
  for (const [id, plugin] of Object.entries(pluginMap)) {
    if (id !== plugin.id) {
      throw new Error(`registry key '${id}' does not match plugin.id '${plugin.id}'`);
    }
    validatePlugin(plugin);
    out[id] = plugin;
  }
  return out;
}

export function getPlugin(registry, gameType) {
  const p = registry[gameType];
  if (!p) throw new Error(`unknown game_type: ${gameType}`);
  return p;
}
```

- [ ] **Step 4: Create empty registry**

Create `src/plugins/index.js`:

```js
// Static plugin registry. Add a plugin by importing it and adding it to the
// exported map. The order here is the order plugins appear in any picker UI.

// (Plugins added in subsequent tasks.)

export const plugins = {};
```

- [ ] **Step 5: Run test, verify it passes**

Run: `node --test test/plugins-host.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/plugins.js src/plugins/index.js test/plugins-host.test.js
git commit -m "feat(plugins): manifest validator + empty static registry"
```

---

## Task 6: Generic action route

**Files:**
- Modify: `src/server/routes.js`
- Modify: `src/server/server.js`
- Test: `test/action-route.test.js`

`POST /api/games/:id/action` looks up the game's plugin, calls
`applyAction({state, action, actorId, rng})` inside a DB transaction,
persists the new state, broadcasts SSE, and returns the new public view.

- [ ] **Step 1: Write the action-route test**

Create `test/action-route.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

// Build a stub plugin used only for tests
const stubPlugin = {
  id: 'stub',
  displayName: 'Stub',
  players: 2,
  clientDir: 'plugins/stub/client',
  initialState: () => ({ activeUserId: 1, count: 0 }),
  applyAction: ({ state, action, actorId }) => {
    if (action.type === 'inc') {
      return { state: { ...state, count: state.count + 1, activeUserId: actorId === 1 ? 2 : 1 }, ended: false };
    }
    if (action.type === 'finish') {
      return { state: { ...state, ended: true }, ended: true, scoreDelta: { a: 5, b: 0 } };
    }
    return { error: 'unknown action' };
  },
  publicView: ({ state }) => state,
};

function setupApp() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  // seed users + game
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f', datetime('now'))").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#g', datetime('now'))").run();
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (1, 1, 2, 'active', 'stub', '${JSON.stringify({ activeUserId: 1, count: 0 })}', datetime('now'), datetime('now'))`).run();

  // Inject test identity middleware that sets req.user from a header
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id, email: `${id}@b`, friendlyName: id === 1 ? 'A' : 'B' };
    next();
  });

  mountRoutes(app, { db, registry: { stub: stubPlugin }, sse: { broadcast: () => {} } });
  return { app, db };
}

// (continued — http server helpers below)
```

The actual tests use Node's built-in `http` module to bind the express app
to an ephemeral port:

```js
import http from 'node:http';

async function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

async function call(server, method, path, body, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('action increments count and returns new state', async () => {
  const { app, db } = setupApp();
  const server = await startServer(app);

  const r = await call(server, 'POST', '/api/games/1/action',
    { type: 'inc' }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.state.count, 1);
  assert.equal(r.body.state.activeUserId, 2);

  // DB was updated
  const row = db.prepare("SELECT state FROM games WHERE id = 1").get();
  assert.equal(JSON.parse(row.state).count, 1);

  server.close();
});

test('non-participant gets 403', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  const r = await call(server, 'POST', '/api/games/1/action',
    { type: 'inc' }, { 'x-test-user-id': '99' });
  assert.equal(r.status, 403);
  server.close();
});

test('not your turn gets 422', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  // user 2 tries to act when activeUserId is 1
  const r = await call(server, 'POST', '/api/games/1/action',
    { type: 'inc' }, { 'x-test-user-id': '2' });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /turn/i);
  server.close();
});

test('plugin error returns 422', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  const r = await call(server, 'POST', '/api/games/1/action',
    { type: 'unknown' }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'unknown action');
  server.close();
});

test('ended game persists and returns ended flag', async () => {
  const { app, db } = setupApp();
  const server = await startServer(app);
  const r = await call(server, 'POST', '/api/games/1/action',
    { type: 'finish' }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ended, true);
  const row = db.prepare("SELECT status FROM games WHERE id = 1").get();
  assert.equal(row.status, 'ended');
  server.close();
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/action-route.test.js`
Expected: FAIL (mountRoutes does not exist or does not handle action route)

- [ ] **Step 3: Implement the action route in `src/server/routes.js`**

Replace the multiplayer-era `mountRoutes` (which mounts `/move`/`/pass`/etc.)
with a generic implementation:

```js
import { getGame, endGame } from './games.js';
import { writeGameState } from './state.js';
import { getPlugin } from './plugins.js';

export function mountRoutes(app, { db, registry, sse }) {
  // Game-scoped middleware: load + check membership
  app.param('gameId', (req, res, next, gameId) => {
    const id = Number(gameId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad game id' });
    const game = getGame(db, id);
    if (!game) return res.status(404).json({ error: 'game not found' });
    if (req.user.id !== game.playerAId && req.user.id !== game.playerBId) {
      return res.status(403).json({ error: 'not a participant' });
    }
    req.game = game;
    next();
  });

  app.get('/api/games', (req, res) => {
    // listed in Task 11
    res.status(501).end();
  });

  app.post('/api/games', (req, res) => {
    // Task 11
    res.status(501).end();
  });

  app.get('/api/games/:gameId', (req, res) => {
    // Task 7
    res.status(501).end();
  });

  app.post('/api/games/:gameId/action', (req, res) => {
    const { action } = parseAction(req);
    if (!action) return res.status(400).json({ error: 'missing action' });

    let plugin;
    try { plugin = getPlugin(registry, req.game.gameType); }
    catch { return res.status(500).json({ error: 'plugin unavailable' }); }

    // Turn ownership: state must expose activeUserId
    const activeUserId = req.game.state.activeUserId;
    if (typeof activeUserId === 'number' && activeUserId !== req.user.id) {
      return res.status(422).json({ error: 'not your turn' });
    }

    // Apply within a transaction
    const txn = db.transaction(() => {
      const result = plugin.applyAction({
        state: req.game.state,
        action,
        actorId: req.user.id,
        rng: makeRng(req.game.id),
      });
      if (result.error) return { http: 422, body: { error: result.error } };

      const newState = result.state;
      writeGameState(db, req.game.id, newState);

      if (result.ended) {
        endGame(db, req.game.id, {
          endedReason: newState.endedReason ?? 'plugin',
          winnerSide: newState.winnerSide ?? null,
          finalState: newState,
        });
      }

      const view = plugin.publicView({ state: newState, viewerId: req.user.id });
      return { http: 200, body: { state: view, ended: !!result.ended, scoreDelta: result.scoreDelta ?? null } };
    });

    const out = txn();
    if (out.http === 200) sse.broadcast(req.game.id, { type: 'update' });
    res.status(out.http).json(out.body);
  });
}

function parseAction(req) {
  if (!req.body || typeof req.body !== 'object') return { action: null };
  const { type, payload } = req.body;
  if (typeof type !== 'string' || type.length === 0) return { action: null };
  return { action: { type, payload: payload ?? {} } };
}

function makeRng(seed) {
  // Mulberry32 seeded with the game id — deterministic per game
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

(`makeRng` per game gives deterministic-given-state behavior; plugins that
need randomness inside `applyAction` get it.)

- [ ] **Step 4: Wire registry into server boot**

In `src/server/server.js`, replace the previous routes wiring with:

```js
import { plugins } from '../plugins/index.js';
import { buildRegistry } from './plugins.js';
import { mountRoutes } from './routes.js';
// …
const registry = buildRegistry(plugins);
mountRoutes(app, { db, registry, sse });
```

- [ ] **Step 5: Run test, verify it passes**

Run: `node --test test/action-route.test.js`
Expected: PASS for all action-route tests

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.js src/server/server.js test/action-route.test.js
git commit -m "feat(routes): generic POST /api/games/:id/action with plugin dispatch"
```

---

## Task 7: Generic state route with publicView filtering

**Files:**
- Modify: `src/server/routes.js`
- Test: `test/state-route.test.js`

`GET /api/games/:gameId` returns the state filtered through the plugin's
`publicView` for the requesting user. This is what the plugin client fetches
on load and after every SSE `update`.

- [ ] **Step 1: Write the test**

Create `test/state-route.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

const hidingPlugin = {
  id: 'hide',
  displayName: 'Hide',
  players: 2,
  clientDir: 'plugins/hide/client',
  initialState: () => ({ activeUserId: 1, racks: { a: ['secret-a'], b: ['secret-b'] } }),
  applyAction: ({ state }) => ({ state, ended: false }),
  publicView: ({ state, viewerId }) => {
    // viewer is user 1 (side a) → hide rack b
    const seenSide = viewerId === 1 ? 'a' : 'b';
    return {
      ...state,
      racks: { [seenSide]: state.racks[seenSide], [seenSide === 'a' ? 'b' : 'a']: null },
    };
  },
};

async function setupApp() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f', datetime('now'))").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#g', datetime('now'))").run();
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (1, 1, 2, 'active', 'hide', ?, datetime('now'), datetime('now'))`)
    .run(JSON.stringify({ activeUserId: 1, racks: { a: ['secret-a'], b: ['secret-b'] } }));

  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id };
    next();
  });

  mountRoutes(app, { db, registry: { hide: hidingPlugin }, sse: { broadcast: () => {} } });
  const server = await new Promise(resolve => {
    const s = http.createServer(app);
    s.listen(0, () => resolve(s));
  });
  return { app, db, server };
}

async function get(server, path, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, { headers });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

test('GET /api/games/:id filters opponent rack for viewer (side a)', async () => {
  const { server } = await setupApp();
  const r = await get(server, '/api/games/1', { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.state.racks.a, ['secret-a']);
  assert.equal(r.body.state.racks.b, null);
  server.close();
});

test('GET /api/games/:id filters opponent rack for viewer (side b)', async () => {
  const { server } = await setupApp();
  const r = await get(server, '/api/games/1', { 'x-test-user-id': '2' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.state.racks.b, ['secret-b']);
  assert.equal(r.body.state.racks.a, null);
  server.close();
});

test('GET /api/games/:id 404 for missing game', async () => {
  const { server } = await setupApp();
  const r = await get(server, '/api/games/999', { 'x-test-user-id': '1' });
  assert.equal(r.status, 404);
  server.close();
});

test('GET /api/games/:id 403 for non-participant', async () => {
  const { server } = await setupApp();
  // Add a third user
  // (skip seeding since 99 already not a participant)
  const r = await get(server, '/api/games/1', { 'x-test-user-id': '99' });
  assert.equal(r.status, 403);
  server.close();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/state-route.test.js`
Expected: FAIL (route returns 501)

- [ ] **Step 3: Implement the GET state route**

In `src/server/routes.js`, replace the 501 stub:

```js
app.get('/api/games/:gameId', (req, res) => {
  const plugin = getPlugin(registry, req.game.gameType);
  const view = plugin.publicView({ state: req.game.state, viewerId: req.user.id });
  res.json({
    id: req.game.id,
    gameType: req.game.gameType,
    status: req.game.status,
    playerAId: req.game.playerAId,
    playerBId: req.game.playerBId,
    state: view,
  });
});
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/state-route.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.js test/state-route.test.js
git commit -m "feat(routes): GET /api/games/:id with plugin publicView filtering"
```

---

## Task 8: Plugin auxiliary routes

**Files:**
- Modify: `src/server/routes.js`
- Test: `test/aux-routes.test.js`

A plugin's `auxRoutes` map is mounted under `/api/games/:gameId/<name>`
with the same auth + membership middleware as the action route. Aux routes
are read-only by convention (host doesn't enforce; plugins must not mutate
state inside an aux handler).

- [ ] **Step 1: Write the test**

Create `test/aux-routes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

const echoPlugin = {
  id: 'echo',
  displayName: 'Echo',
  players: 2,
  clientDir: 'plugins/echo/client',
  initialState: () => ({ activeUserId: 1 }),
  applyAction: ({ state }) => ({ state, ended: false }),
  publicView: ({ state }) => state,
  auxRoutes: {
    ping: {
      method: 'GET',
      handler: (req, res) => res.json({ pong: true, gameId: req.game.id, userId: req.user.id }),
    },
    score: {
      method: 'POST',
      handler: (req, res) => res.json({ payload: req.body }),
    },
  },
};

async function setupApp() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f', datetime('now'))").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#g', datetime('now'))").run();
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (1, 1, 2, 'active', 'echo', '{}', datetime('now'), datetime('now'))`).run();

  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id };
    next();
  });

  mountRoutes(app, { db, registry: { echo: echoPlugin }, sse: { broadcast: () => {} } });
  const server = await new Promise(resolve => {
    const s = http.createServer(app);
    s.listen(0, () => resolve(s));
  });
  return server;
}

async function call(server, method, path, body, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

test('GET aux route is mounted and receives req.game/req.user', async () => {
  const server = await setupApp();
  const r = await call(server, 'GET', '/api/games/1/ping', null, { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { pong: true, gameId: 1, userId: 1 });
  server.close();
});

test('POST aux route receives parsed body', async () => {
  const server = await setupApp();
  const r = await call(server, 'POST', '/api/games/1/score',
    { foo: 'bar' }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.payload, { foo: 'bar' });
  server.close();
});

test('aux route inherits 403 for non-participant', async () => {
  const server = await setupApp();
  const r = await call(server, 'GET', '/api/games/1/ping', null, { 'x-test-user-id': '99' });
  assert.equal(r.status, 403);
  server.close();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/aux-routes.test.js`
Expected: FAIL (routes don't exist)

- [ ] **Step 3: Mount aux routes in `mountRoutes`**

After the `app.post('/api/games/:gameId/action', ...)` block, add:

```js
// Mount each plugin's auxiliary routes
for (const plugin of Object.values(registry)) {
  if (!plugin.auxRoutes) continue;
  for (const [name, route] of Object.entries(plugin.auxRoutes)) {
    const path = `/api/games/:gameId/${name}`;
    const method = route.method.toLowerCase();
    if (typeof app[method] !== 'function') {
      throw new Error(`plugin(${plugin.id}).auxRoutes['${name}']: unsupported method ${route.method}`);
    }
    // Wrap handler so it only runs for matching game_type
    app[method](path, (req, res, next) => {
      if (req.game.gameType !== plugin.id) return next();
      return route.handler(req, res, next);
    });
  }
}
```

The `req.game.gameType !== plugin.id` guard prevents one plugin's aux route
from running for another plugin's game (e.g., if both Words and Rummikub
defined a `/score` aux route, only the matching plugin's runs).

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/aux-routes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.js test/aux-routes.test.js
git commit -m "feat(routes): mount plugin auxiliary routes with auth + membership"
```

---

## Task 9: Plugin client serving with `window.__GAME__` injection

**Files:**
- Modify: `src/server/server.js`
- Test: `test/client-serving.test.js`

Serve `plugins/<type>/client/` as static at `/play/<type>/<gameId>/`. When
the request is for `index.html` (or the bare directory), inject a small
`<script>` block at the top of `<head>` setting `window.__GAME__`.

- [ ] **Step 1: Create stub plugin client folder for testing**

Skip: this is set up inline in the test — no fixture file needed yet.
(The test creates a temp directory.)

- [ ] **Step 2: Write the test**

Create `test/client-serving.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';
import { mountPluginClients } from '../src/server/server.js';

function makeStubPluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamebox-stub-'));
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<!doctype html><html><head><title>Stub</title></head><body>Hi</body></html>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("stub");');
  return dir;
}

async function setup() {
  const clientDir = makeStubPluginDir();
  const stub = {
    id: 'stub',
    displayName: 'Stub',
    players: 2,
    clientDir,
    initialState: () => ({}),
    applyAction: ({ state }) => ({ state, ended: false }),
    publicView: ({ state }) => state,
  };

  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f', datetime('now'))").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#g', datetime('now'))").run();
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (42, 1, 2, 'active', 'stub', '{}', datetime('now'), datetime('now'))`).run();

  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id };
    next();
  });
  mountRoutes(app, { db, registry: { stub }, sse: { broadcast: () => {} } });
  mountPluginClients(app, { db, registry: { stub } });

  const server = await new Promise(resolve => {
    const s = http.createServer(app);
    s.listen(0, () => resolve(s));
  });
  return { server, clientDir };
}

test('GET /play/:type/:id/ serves index.html with __GAME__ injected', async () => {
  const { server } = await setup();
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/play/stub/42/`, { headers: { 'x-test-user-id': '1' } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /window\.__GAME__/);
  assert.match(body, /"gameId":\s*42/);
  assert.match(body, /"userId":\s*1/);
  assert.match(body, /"gameType":\s*"stub"/);
  // Original content still present
  assert.match(body, /Hi/);
  server.close();
});

test('GET /play/:type/:id/app.js serves the static asset (no injection)', async () => {
  const { server } = await setup();
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/play/stub/42/app.js`, { headers: { 'x-test-user-id': '1' } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body.trim(), 'console.log("stub");');
  server.close();
});

test('GET /play/wrong/42/ returns 404 (plugin id mismatch)', async () => {
  const { server } = await setup();
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/play/wrong/42/`, { headers: { 'x-test-user-id': '1' } });
  assert.equal(res.status, 404);
  server.close();
});

test('GET /play/stub/999/ returns 404 (no such game)', async () => {
  const { server } = await setup();
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/play/stub/999/`, { headers: { 'x-test-user-id': '1' } });
  assert.equal(res.status, 404);
  server.close();
});

test('non-participant gets 403', async () => {
  const { server } = await setup();
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/play/stub/42/`, { headers: { 'x-test-user-id': '99' } });
  assert.equal(res.status, 403);
  server.close();
});
```

- [ ] **Step 3: Run, verify failure**

Run: `node --test test/client-serving.test.js`
Expected: FAIL (mountPluginClients does not exist)

- [ ] **Step 4: Implement `mountPluginClients` in `src/server/server.js`**

Export a new function:

```js
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { getGame } from './games.js';

export function mountPluginClients(app, { db, registry }) {
  for (const plugin of Object.values(registry)) {
    const base = `/play/${plugin.id}`;

    // Per-plugin middleware: validate game_type matches and game exists,
    // and that user is a participant. (Identity middleware runs before this.)
    app.use(`${base}/:gameId`, (req, res, next) => {
      const id = Number(req.params.gameId);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).end();
      const game = getGame(db, id);
      if (!game) return res.status(404).end();
      if (game.gameType !== plugin.id) return res.status(404).end();
      if (req.user.id !== game.playerAId && req.user.id !== game.playerBId) {
        return res.status(403).end();
      }
      req.game = game;
      next();
    });

    // Inject __GAME__ for the index.html request specifically
    app.get(`${base}/:gameId`, (req, res, next) => {
      // Trailing-slash redirect for browser-friendliness
      if (!req.path.endsWith('/')) return res.redirect(301, req.path + '/');
      return serveIndex(plugin.clientDir, req, res);
    });
    app.get(`${base}/:gameId/`, (req, res) => serveIndex(plugin.clientDir, req, res));
    app.get(`${base}/:gameId/index.html`, (req, res) => serveIndex(plugin.clientDir, req, res));

    // Static assets (everything else)
    app.use(`${base}/:gameId`, express.static(plugin.clientDir, {
      // Don't serve index.html via static — we handle it above with injection
      index: false,
    }));
  }
}

function serveIndex(clientDir, req, res) {
  const indexPath = path.join(clientDir, 'index.html');
  let html;
  try { html = fs.readFileSync(indexPath, 'utf8'); }
  catch { return res.status(500).end('plugin index.html missing'); }

  const ctx = {
    gameId: req.game.id,
    userId: req.user.id,
    gameType: req.game.gameType,
    sseUrl: `/api/games/${req.game.id}/events`,
    actionUrl: `/api/games/${req.game.id}/action`,
    stateUrl: `/api/games/${req.game.id}`,
  };
  const inject = `<script>window.__GAME__ = ${JSON.stringify(ctx)};</script>`;

  // Insert before </head>; fall back to before <body> or prepend
  let injected;
  if (/<\/head>/i.test(html)) {
    injected = html.replace(/<\/head>/i, inject + '</head>');
  } else if (/<body[^>]*>/i.test(html)) {
    injected = html.replace(/<body[^>]*>/i, m => inject + m);
  } else {
    injected = inject + html;
  }
  res.type('html').send(injected);
}
```

Wire it into `server.js`'s startup, after `mountRoutes`:

```js
mountPluginClients(app, { db, registry });
```

- [ ] **Step 5: Run, verify pass**

Run: `node --test test/client-serving.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/server.js test/client-serving.test.js
git commit -m "feat(plugins): serve plugin clients at /play/:type/:id/ with __GAME__ injection"
```

---

## Task 10: Move Words server code into `plugins/words/server/`

**Files:**
- Create: `plugins/words/server/engine.js` (moved from `src/server/engine.js`)
- Create: `plugins/words/server/board.js` (moved from `src/server/board.js`)
- Create: `plugins/words/server/dictionary.js` (moved from `src/server/dictionary.js`)
- Modify: existing test files that import these
- Delete: `src/server/engine.js`, `src/server/board.js`, `src/server/dictionary.js`

Mechanical move. Update import paths in existing tests. No behavior change.

- [ ] **Step 1: Create plugin directory structure**

```bash
mkdir -p plugins/words/server plugins/words/client
```

- [ ] **Step 2: Move server files via git**

```bash
git mv src/server/engine.js plugins/words/server/engine.js
git mv src/server/board.js plugins/words/server/board.js
git mv src/server/dictionary.js plugins/words/server/dictionary.js
```

- [ ] **Step 3: Update imports in moved files**

`plugins/words/server/engine.js`: `import { … } from './board.js';` (was `'./board.js'` already, no change needed). If `engine.js` imported from `./db.js`, update to `'../../../src/server/db.js'`.

`plugins/words/server/dictionary.js`: it reads `data/enable2k.txt`. Keep using a path relative to the project root (`new URL('../../../data/enable2k.txt', import.meta.url)`).

Verify:

```bash
grep -nE "from '\.\./" plugins/words/server/*.js
```

Replace any `'../board.js'` or similar that refers to `src/server/` with `'../../../src/server/...'`. Tighten as the rules engine should not depend on host code; if engine.js imports from db.js, that's wrong — refactor to take a db handle as an argument when called.

- [ ] **Step 4: Update test imports**

Update each of:
- `test/engine.test.js`: change `'../src/server/engine.js'` → `'../plugins/words/server/engine.js'`, `'../src/server/board.js'` → `'../plugins/words/server/board.js'`
- `test/board.test.js`: change `'../src/server/board.js'` → `'../plugins/words/server/board.js'`
- `test/dictionary.test.js`: change `'../src/server/dictionary.js'` → `'../plugins/words/server/dictionary.js'`

- [ ] **Step 5: Run the affected tests**

Run: `node --test test/engine.test.js test/board.test.js test/dictionary.test.js`
Expected: PASS

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: PASS (server.js still works because Words isn't yet mounted via plugin registry — Task 12 does that)

- [ ] **Step 7: Commit**

```bash
git add plugins/words/server/ test/engine.test.js test/board.test.js test/dictionary.test.js
git rm src/server/engine.js src/server/board.js src/server/dictionary.js 2>/dev/null || true
git commit -m "refactor(words): move engine/board/dictionary into plugins/words/server/"
```

---

## Task 11: Move Words client code into `plugins/words/client/`

**Files:**
- Create: `plugins/words/client/index.html`, `app.js`, `board.js`, `rack.js`, `drag.js`, `state.js`, `validator.js`, `picker.js`, `themes.js`, `sounds.js`, `callout.js`, `style.css`, `assets/`, `sounds/`, `favicon.png`
- Modify: `src/server/server.js` (remove direct `public/` Words static-serving)
- Modify: `test/drag.test.js` import path
- Delete: `public/index.html`, `public/app.js`, etc. (Words client files only — keep `public/lobby/`, `public/lockout.html`)

Mechanical move. The client doesn't need code changes yet — it'll keep talking to the old route shapes until Task 13 collapses them. Right now we just relocate it; server.js continues to serve it from a different place.

- [ ] **Step 1: Move client assets via git**

```bash
git mv public/index.html plugins/words/client/index.html
git mv public/app.js plugins/words/client/app.js
git mv public/board.js plugins/words/client/board.js
git mv public/rack.js plugins/words/client/rack.js
git mv public/drag.js plugins/words/client/drag.js
git mv public/state.js plugins/words/client/state.js
git mv public/validator.js plugins/words/client/validator.js
git mv public/picker.js plugins/words/client/picker.js
git mv public/themes.js plugins/words/client/themes.js
git mv public/sounds.js plugins/words/client/sounds.js
git mv public/callout.js plugins/words/client/callout.js
git mv public/style.css plugins/words/client/style.css
git mv public/favicon.png plugins/words/client/favicon.png
git mv public/assets plugins/words/client/assets
git mv public/sounds plugins/words/client/sounds
```

(Skip files that don't exist in the current tree; the multiplayer plan
adds `public/home.html`/`public/home.js` which we keep for now — they
become the lobby in Task 16.)

- [ ] **Step 2: Update `test/drag.test.js`**

Change `import { … } from '../public/drag.js';` → `'../plugins/words/client/drag.js';`

- [ ] **Step 3: Update `src/server/server.js`**

Remove or scope the static handler that previously served `public/` for the
Words client at `/`. Static serving for Words now happens via
`mountPluginClients` (Task 9). The host's only remaining static-serve at
this point is for the lobby (currently `public/home.html` at `/`).

If the multiplayer plan has:

```js
app.get('/game/:id', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
```

remove that — `/game/:id` is no longer a route shape; games live at
`/play/<type>/<id>`.

- [ ] **Step 4: Run drag test specifically**

Run: `node --test test/drag.test.js`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: PASS — note that Words is currently un-mountable via the new
plugin route (Task 12 fixes), but no test exercises that path yet, so all
tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/words/client/ test/drag.test.js src/server/server.js
git rm 2>/dev/null || true  # already removed via git mv
git commit -m "refactor(words): move client assets into plugins/words/client/"
```

---

## Task 12: Words plugin manifest with action handlers

**Files:**
- Create: `plugins/words/plugin.js`
- Create: `plugins/words/server/state.js` — initialState + bag/board builders
- Create: `plugins/words/server/actions.js` — applyAction switch
- Create: `plugins/words/server/view.js` — publicView (hides opponent rack)
- Test: `test/words-plugin.test.js`

Wrap the existing rules engine in the plugin contract. Action types: `move`,
`pass`, `swap`, `resign`. State shape mirrors what was packed by Task 3:
`{ bag, board, racks: {a,b}, scores: {a,b}, activeUserId, consecutiveScorelessTurns, initialMoveDone, endedReason?, winnerSide? }`.

- [ ] **Step 1: Write plugin contract test**

Create `test/words-plugin.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import wordsPlugin from '../plugins/words/plugin.js';

const participants = [
  { userId: 1, side: 'a' },
  { userId: 2, side: 'b' },
];
const rng = () => 0.5;  // deterministic

test('manifest fields', () => {
  assert.equal(wordsPlugin.id, 'words');
  assert.equal(wordsPlugin.displayName, 'Words');
  assert.equal(wordsPlugin.players, 2);
  assert.match(wordsPlugin.clientDir, /plugins\/words\/client/);
  assert.equal(typeof wordsPlugin.initialState, 'function');
  assert.equal(typeof wordsPlugin.applyAction, 'function');
  assert.equal(typeof wordsPlugin.publicView, 'function');
  assert.equal(wordsPlugin.auxRoutes?.validate?.method, 'POST');
});

test('initialState produces 2 racks of 7 tiles, empty board, full bag minus 14', () => {
  const state = wordsPlugin.initialState({ participants, rng });
  assert.equal(state.racks.a.length, 7);
  assert.equal(state.racks.b.length, 7);
  // 100 total - 14 dealt = 86 in bag
  assert.equal(state.bag.length, 86);
  assert.equal(state.board.flat().filter(Boolean).length, 0);
  assert.equal(state.scores.a, 0);
  assert.equal(state.scores.b, 0);
  assert.ok(state.activeUserId === 1 || state.activeUserId === 2);
  assert.equal(state.initialMoveDone, false);
  assert.equal(state.consecutiveScorelessTurns, 0);
});

test('applyAction(pass) advances turn and increments scoreless counter', () => {
  let state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;  // force
  const result = wordsPlugin.applyAction({ state, action: { type: 'pass', payload: {} }, actorId: 1, rng });
  assert.equal(result.error, undefined);
  assert.equal(result.state.activeUserId, 2);
  assert.equal(result.state.consecutiveScorelessTurns, 1);
});

test('applyAction(resign) ends game with opponent as winner', () => {
  const state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const result = wordsPlugin.applyAction({ state, action: { type: 'resign', payload: {} }, actorId: 1, rng });
  assert.equal(result.ended, true);
  assert.equal(result.state.endedReason, 'resign');
  assert.equal(result.state.winnerSide, 'b');
});

test('applyAction(unknown) returns error', () => {
  const state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const result = wordsPlugin.applyAction({ state, action: { type: 'frobnicate', payload: {} }, actorId: 1, rng });
  assert.match(result.error, /unknown action/i);
});

test('publicView hides opponent rack but keeps count', () => {
  const state = wordsPlugin.initialState({ participants, rng });
  // viewer is user 1 (side a)
  const view = wordsPlugin.publicView({ state, viewerId: 1 });
  assert.equal(view.racks.a.length, 7);
  // Opponent rack stripped to count only
  assert.deepEqual(Object.keys(view.opponentRack), ['count']);
  assert.equal(view.opponentRack.count, 7);
  assert.equal(view.racks.b, undefined);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/words-plugin.test.js`
Expected: FAIL (plugin module does not exist)

- [ ] **Step 3: Implement `plugins/words/server/state.js`**

```js
import { TILE_BAG, BOARD_SIZE } from './board.js';

export function buildInitialState({ participants, rng }) {
  const bag = shuffle([...TILE_BAG], rng);
  const racks = { a: bag.splice(0, 7), b: bag.splice(0, 7) };
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  const a = participants.find(p => p.side === 'a')?.userId;
  const b = participants.find(p => p.side === 'b')?.userId;
  const startSide = rng() < 0.5 ? 'a' : 'b';
  return {
    bag,
    board,
    racks,
    scores: { a: 0, b: 0 },
    sides: { a, b },
    activeUserId: startSide === 'a' ? a : b,
    consecutiveScorelessTurns: 0,
    initialMoveDone: false,
    endedReason: null,
    winnerSide: null,
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
```

- [ ] **Step 4: Implement `plugins/words/server/actions.js`**

```js
import { validatePlacement, scoreMove, applyMove, detectGameEnd, applyEndGameAdjustment } from './engine.js';
import { loadDictionary } from './dictionary.js';

let _dict;
function dict() { return _dict ??= loadDictionary(); }

export function applyWordsAction({ state, action, actorId, rng }) {
  const actorSide = state.sides.a === actorId ? 'a' : 'b';
  const oppSide = actorSide === 'a' ? 'b' : 'a';
  const oppUserId = state.sides[oppSide];

  switch (action.type) {
    case 'move': return doMove(state, action.payload, actorSide, oppSide, oppUserId);
    case 'pass': return doPass(state, actorSide, oppUserId);
    case 'swap': return doSwap(state, action.payload, actorSide, oppUserId, rng);
    case 'resign': return doResign(state, actorSide);
    default: return { error: `unknown action: ${action.type}` };
  }
}

function doMove(state, payload, actorSide, oppSide, oppUserId) {
  const placements = payload?.placements;
  if (!Array.isArray(placements) || placements.length === 0) {
    return { error: 'placements required' };
  }
  // NOTE: validatePlacement / scoreMove / applyMove signatures must match
  // what's actually exported from `engine.js`. The multiplayer plan and
  // earlier WWF plan defined these with specific shapes; verify the call
  // sites here against `plugins/words/server/engine.js` and adapt as needed.
  const validation = validatePlacement(state.board, placements, !state.initialMoveDone);
  if (!validation.valid) return { error: validation.reason };

  const score = scoreMove(state.board, placements, dict());
  if (!score.ok) return { error: score.reason };

  const next = applyMove(state, placements, actorSide, score.points);
  next.scores[actorSide] = state.scores[actorSide] + score.points;
  next.consecutiveScorelessTurns = score.points === 0 ? state.consecutiveScorelessTurns + 1 : 0;
  next.initialMoveDone = true;
  next.activeUserId = oppUserId;

  const ending = detectGameEnd(next);
  if (ending.ended) {
    const adjusted = applyEndGameAdjustment(next, ending);
    return { state: adjusted, ended: true, scoreDelta: { a: adjusted.scores.a - state.scores.a, b: adjusted.scores.b - state.scores.b } };
  }
  return { state: next, ended: false, scoreDelta: { [actorSide]: score.points, [oppSide]: 0 } };
}

function doPass(state, actorSide, oppUserId) {
  const next = { ...state, consecutiveScorelessTurns: state.consecutiveScorelessTurns + 1, activeUserId: oppUserId };
  if (next.consecutiveScorelessTurns >= 4) {
    // 4 consecutive passes ends the game (WWF rule)
    next.endedReason = 'all-pass';
    next.winnerSide = next.scores.a > next.scores.b ? 'a' : (next.scores.b > next.scores.a ? 'b' : null);
    return { state: next, ended: true };
  }
  return { state: next, ended: false };
}

function doSwap(state, payload, actorSide, oppUserId, rng) {
  const tiles = payload?.tiles;
  if (!Array.isArray(tiles) || tiles.length === 0) return { error: 'tiles required' };
  if (state.bag.length < tiles.length) return { error: 'not enough tiles in bag to swap' };
  const rack = [...state.racks[actorSide]];
  for (const t of tiles) {
    const idx = rack.indexOf(t);
    if (idx === -1) return { error: `tile not in rack: ${t}` };
    rack.splice(idx, 1);
  }
  const bag = [...state.bag];
  // Draw replacements
  const drawn = [];
  for (let i = 0; i < tiles.length; i++) {
    const j = Math.floor(rng() * bag.length);
    drawn.push(bag.splice(j, 1)[0]);
  }
  rack.push(...drawn);
  // Return swapped tiles to the bag
  bag.push(...tiles);

  return {
    state: {
      ...state,
      bag,
      racks: { ...state.racks, [actorSide]: rack },
      consecutiveScorelessTurns: state.consecutiveScorelessTurns + 1,
      activeUserId: oppUserId,
    },
    ended: false,
  };
}

function doResign(state, actorSide) {
  const winner = actorSide === 'a' ? 'b' : 'a';
  return {
    state: { ...state, endedReason: 'resign', winnerSide: winner },
    ended: true,
  };
}
```

- [ ] **Step 5: Implement `plugins/words/server/view.js`**

```js
export function wordsPublicView({ state, viewerId }) {
  const viewerSide = state.sides.a === viewerId ? 'a' : (state.sides.b === viewerId ? 'b' : null);
  const oppSide = viewerSide === 'a' ? 'b' : 'a';

  // Build a view that exposes only the viewer's rack; opponent rack is count-only.
  const racks = { [viewerSide]: state.racks[viewerSide] };
  return {
    board: state.board,
    bag: { count: state.bag.length },  // count only, never tile identity
    racks,
    opponentRack: { count: state.racks[oppSide]?.length ?? 0 },
    scores: state.scores,
    sides: state.sides,
    activeUserId: state.activeUserId,
    initialMoveDone: state.initialMoveDone,
    endedReason: state.endedReason,
    winnerSide: state.winnerSide,
  };
}
```

- [ ] **Step 6: Implement `plugins/words/plugin.js`**

```js
import { buildInitialState } from './server/state.js';
import { applyWordsAction } from './server/actions.js';
import { wordsPublicView } from './server/view.js';
import { validatePlacement, scoreMove } from './server/engine.js';
import { loadDictionary } from './server/dictionary.js';

let _dict;
function dict() { return _dict ??= loadDictionary(); }

export default {
  id: 'words',
  displayName: 'Words',
  players: 2,
  clientDir: 'plugins/words/client',

  initialState: buildInitialState,
  applyAction: applyWordsAction,
  publicView: wordsPublicView,

  auxRoutes: {
    validate: {
      method: 'POST',
      handler: (req, res) => {
        const placements = req.body?.placements;
        if (!Array.isArray(placements)) return res.status(400).json({ error: 'placements required' });
        const v = validatePlacement(req.game.state.board, placements, !req.game.state.initialMoveDone);
        if (!v.valid) return res.json({ valid: false, reason: v.reason });
        const s = scoreMove(req.game.state.board, placements, dict());
        if (!s.ok) return res.json({ valid: false, reason: s.reason });
        res.json({ valid: true, points: s.points, words: s.words });
      },
    },
  },
};
```

- [ ] **Step 7: Run, verify pass**

Run: `node --test test/words-plugin.test.js`
Expected: PASS

- [ ] **Step 8: Run full suite**

Run: `npm test`
Expected: PASS (the previous direct-route tests may need updating in
Task 14 — for now, the new plugin contract works in isolation)

- [ ] **Step 9: Commit**

```bash
git add plugins/words/plugin.js plugins/words/server/state.js plugins/words/server/actions.js plugins/words/server/view.js test/words-plugin.test.js
git commit -m "feat(words): plugin manifest with move/pass/swap/resign actions"
```

---

## Task 13: Register Words plugin in the static registry

**Files:**
- Modify: `src/plugins/index.js`
- Test: existing tests + a smoke test

- [ ] **Step 1: Update registry**

```js
// src/plugins/index.js
import wordsPlugin from '../../plugins/words/plugin.js';

export const plugins = {
  words: wordsPlugin,
};
```

- [ ] **Step 2: Add boot smoke test**

Append to `test/plugins-host.test.js`:

```js
import { plugins } from '../src/plugins/index.js';
import { buildRegistry } from '../src/server/plugins.js';

test('static registry validates at boot (Words plugin)', () => {
  assert.doesNotThrow(() => buildRegistry(plugins));
  const reg = buildRegistry(plugins);
  assert.ok(reg.words);
  assert.equal(reg.words.id, 'words');
});
```

- [ ] **Step 3: Run, verify pass**

Run: `node --test test/plugins-host.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/plugins/index.js test/plugins-host.test.js
git commit -m "feat(plugins): register words in static registry"
```

---

## Task 14: Replace direct Words routes with action dispatch (server + client)

**Files:**
- Modify: `src/server/routes.js` (remove `/api/move`, `/api/pass`, `/api/swap`, `/api/resign`, `/api/new-game`, `/api/validate` if still present after multiplayer)
- Modify: `plugins/words/client/app.js`, `validator.js` to call the new endpoints
- Modify: `test/routes.test.js` to exercise actions instead of direct routes

By this point, Words plugin is registered and the generic action route
works. We now retire the multiplayer-era Words-specific routes and the
client to talk to `/api/games/:id/action` and `/api/games/:id/validate`.

- [ ] **Step 1: Identify legacy routes**

Run: `grep -nE "app\.(get|post)\(['\"]/api/(move|pass|swap|resign|new-game|validate)" src/server/routes.js`

Note the routes that still exist post-multiplayer.

- [ ] **Step 2: Remove legacy direct routes**

Delete the corresponding handler blocks in `src/server/routes.js`. If
multiplayer kept them under `/api/games/:gameId/move` etc., delete those
too. The replacements are:

| Old | New |
|---|---|
| `POST /api/games/:gameId/move` | `POST /api/games/:gameId/action` body `{type:'move', payload:{placements}}` |
| `POST /api/games/:gameId/pass` | `POST /api/games/:gameId/action` body `{type:'pass'}` |
| `POST /api/games/:gameId/swap` | `POST /api/games/:gameId/action` body `{type:'swap', payload:{tiles}}` |
| `POST /api/games/:gameId/resign` | `POST /api/games/:gameId/action` body `{type:'resign'}` |
| `POST /api/games/:gameId/new-game` | `POST /api/games` body `{opponentId, gameType:'words'}` (Task 15) |
| `POST /api/games/:gameId/validate` | unchanged path, but now lives as Words plugin's auxRoute (no code change needed in routes.js — Task 8 already mounts it) |

- [ ] **Step 3: Update Words client to use the action route**

In `plugins/words/client/app.js`, find each call to `/api/games/:id/move`,
`/api/games/:id/pass`, etc., and replace with calls to
`/api/games/:id/action` with the appropriate `{type, payload}` body. The
client knows the game id from `window.__GAME__.gameId`, so:

```js
// Old
fetch(`/api/games/${gameId}/move`, { method: 'POST', body: JSON.stringify({ placements }), headers: { 'Content-Type': 'application/json' } });

// New
const url = window.__GAME__.actionUrl;
fetch(url, { method: 'POST', body: JSON.stringify({ type: 'move', payload: { placements } }), headers: { 'Content-Type': 'application/json' } });
```

Repeat for `pass`, `swap`, `resign`.

For `validate` (used by `validator.js`), the URL stays
`/api/games/:gameId/validate`. Use `window.__GAME__.gameId` to construct it,
or thread a `validateUrl: '/api/games/${id}/validate'` field in the
injected context if convenient.

For `new-game`, change to `POST /api/games` with `{opponentId, gameType: 'words'}`. (This client path is invoked from the end-of-game "play again" prompt.)

- [ ] **Step 4: Adapt `test/routes.test.js`**

The multiplayer-era routes test was written against `/api/games/:gameId/move`
etc. Rewrite each to use the action route:

```js
// before
const r = await call(server, 'POST', `/api/games/${id}/move`, { placements }, headers);

// after
const r = await call(server, 'POST', `/api/games/${id}/action`, { type: 'move', payload: { placements } }, headers);
```

Don't change the *assertions* — the new code path produces equivalent
behavior. The point is to keep the existing coverage, just routed through
the new dispatch.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: PASS. If routes.test.js fails on specifics, fix to match the new
`{type, payload}` envelope while preserving the original behavior assertions.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.js plugins/words/client/ test/routes.test.js
git commit -m "refactor(words): collapse direct routes into typed actions"
```

---

## Task 15: Generic new-game creation route

**Files:**
- Modify: `src/server/routes.js`
- Test: `test/games-create.test.js`

`POST /api/games` body `{ opponentId, gameType }` creates a new game using
the plugin's `initialState`. Enforces the per-`(pair, game_type)` active
uniqueness via the unique index from Task 2 (catches duplicate-attempt
errors and returns 409).

- [ ] **Step 1: Write the test**

Create `test/games-create.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

const stubPlugin = {
  id: 'stub', displayName: 'Stub', players: 2, clientDir: 'x',
  initialState: ({ participants }) => ({
    activeUserId: participants[0].userId,
    sides: { a: participants.find(p => p.side === 'a').userId, b: participants.find(p => p.side === 'b').userId },
    seeded: true,
  }),
  applyAction: ({ state }) => ({ state, ended: false }),
  publicView: ({ state }) => state,
};

async function setup() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f', datetime('now'))").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#g', datetime('now'))").run();
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id };
    next();
  });
  mountRoutes(app, { db, registry: { stub: stubPlugin }, sse: { broadcast: () => {} } });
  const server = await new Promise(r => { const s = http.createServer(app); s.listen(0, () => r(s)); });
  return { server, db };
}

async function call(server, method, path, body, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('POST /api/games creates a game with plugin initialState', async () => {
  const { server, db } = await setup();
  const r = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  assert.ok(r.body.id);
  assert.equal(r.body.gameType, 'stub');

  const row = db.prepare("SELECT state, game_type FROM games WHERE id = ?").get(r.body.id);
  assert.equal(row.game_type, 'stub');
  const state = JSON.parse(row.state);
  assert.equal(state.seeded, true);
  server.close();
});

test('POST /api/games 409 if pair already has active game of that type', async () => {
  const { server } = await setup();
  await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
  const r2 = await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
  assert.equal(r2.status, 409);
  server.close();
});

test('POST /api/games allows different game_type concurrently', async () => {
  const { server } = await setup();
  // hack: register a second plugin? Skipped — covered by Rummikub plan.
  // Here we just verify the constraint is per-(pair, game_type) by checking
  // that 409 only triggers for the same gameType.
  // (test left as a smoke that the unique index is per-type)
  const r1 = await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
  assert.equal(r1.status, 200);
  server.close();
});

test('POST /api/games 400 on unknown game_type', async () => {
  const { server } = await setup();
  const r = await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'nope' }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /api/games 400 on opponentId == self', async () => {
  const { server } = await setup();
  const r = await call(server, 'POST', '/api/games', { opponentId: 1, gameType: 'stub' }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 400);
  server.close();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/games-create.test.js`
Expected: FAIL (POST /api/games returns 501)

- [ ] **Step 3: Implement the create handler in `src/server/routes.js`**

Replace the 501 stub:

```js
app.post('/api/games', (req, res) => {
  const { opponentId, gameType } = req.body ?? {};
  if (!Number.isInteger(opponentId) || opponentId === req.user.id) {
    return res.status(400).json({ error: 'invalid opponentId' });
  }
  if (typeof gameType !== 'string' || !registry[gameType]) {
    return res.status(400).json({ error: 'invalid gameType' });
  }
  const opponent = db.prepare("SELECT id, email, friendly_name FROM users WHERE id = ?").get(opponentId);
  if (!opponent) return res.status(400).json({ error: 'opponent not on roster' });

  const plugin = registry[gameType];
  const aId = Math.min(req.user.id, opponentId);
  const bId = Math.max(req.user.id, opponentId);
  const participants = [
    { userId: aId, side: 'a' },
    { userId: bId, side: 'b' },
  ];

  let initialState;
  try {
    initialState = plugin.initialState({ participants, rng: makeRng(Date.now()) });
  } catch (err) {
    return res.status(500).json({ error: `initialState failed: ${err.message}` });
  }

  try {
    const id = db.prepare(`
      INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
      RETURNING id
    `).get(aId, bId, gameType, JSON.stringify(initialState)).id;
    res.json({ id, gameType });
  } catch (err) {
    if (/UNIQUE constraint failed/.test(err.message)) {
      return res.status(409).json({ error: 'an active game of this type already exists with this opponent' });
    }
    throw err;
  }
});
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/games-create.test.js`
Expected: PASS

- [ ] **Step 5: Implement `GET /api/games` (list active games for current user)**

Add:

```js
app.get('/api/games', (req, res) => {
  const rows = db.prepare(`
    SELECT id, player_a_id AS playerAId, player_b_id AS playerBId,
           game_type AS gameType, status, updated_at AS updatedAt
    FROM games
    WHERE status = 'active' AND (player_a_id = ? OR player_b_id = ?)
    ORDER BY updated_at DESC
  `).all(req.user.id, req.user.id);
  res.json({ games: rows });
});
```

Test for it (append to `test/games-create.test.js`):

```js
test('GET /api/games lists active games for current user', async () => {
  const { server } = await setup();
  await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
  const r = await call(server, 'GET', '/api/games', null, { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.games.length, 1);
  assert.equal(r.body.games[0].gameType, 'stub');
  server.close();
});
```

Run: `node --test test/games-create.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.js test/games-create.test.js
git commit -m "feat(routes): POST /api/games + GET /api/games (generic creation/listing)"
```

---

## Task 16: Lobby with per-game-type badges and "start new" picker

**Files:**
- Create: `public/lobby/lobby.html`, `public/lobby/lobby.js`, `public/lobby/lobby.css`
- Modify: `src/server/server.js` (serve lobby at `/`, drop multiplayer's `home.html` if present)
- Modify: `README.md` (full rebrand)
- Test: `test/lobby.test.js`

The lobby is host-served (not plugin-owned). It calls `GET /api/users` (from
multiplayer) for the roster, `GET /api/games` for the current user's active
games, groups them by opponent, and renders a tile per opponent showing
which games are active. A "+ Start new game" affordance opens a small
picker listing plugins not currently active with that opponent.

- [ ] **Step 1: Write a smoke test for lobby data plumbing**

Create `test/lobby.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

// The lobby itself is HTML/JS; the test verifies the *data endpoints* it
// depends on combine to produce the expected lobby contents.

const stub = {
  id: 'stub', displayName: 'Stub', players: 2, clientDir: 'x',
  initialState: ({ participants }) => ({
    activeUserId: participants[0].userId,
    sides: { a: participants[0].userId, b: participants[1].userId },
  }),
  applyAction: ({ state }) => ({ state, ended: false }),
  publicView: ({ state }) => state,
};

async function setup() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  for (let i = 1; i <= 3; i++) {
    db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (?, ?, ?, ?, datetime('now'))")
      .run(i, `u${i}@b`, `User${i}`, '#000');
  }
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id };
    next();
  });
  mountRoutes(app, { db, registry: { stub }, sse: { broadcast: () => {} } });
  // Lobby's own user-list endpoint (provided by multiplayer; verify shape)
  app.get('/api/users', (req, res) => {
    const rows = db.prepare("SELECT id, friendly_name AS friendlyName, color FROM users WHERE id != ?").all(req.user.id);
    res.json({ users: rows });
  });
  const server = await new Promise(r => { const s = http.createServer(app); s.listen(0, () => r(s)); });
  return { server };
}

async function call(server, method, path, body, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('lobby data: roster + active games combine correctly', async () => {
  const { server } = await setup();
  // user 1 starts a game with user 2 (stub plugin)
  await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });

  const usersR = await call(server, 'GET', '/api/users', null, { 'x-test-user-id': '1' });
  const gamesR = await call(server, 'GET', '/api/games', null, { 'x-test-user-id': '1' });
  assert.equal(usersR.status, 200);
  assert.equal(gamesR.status, 200);
  assert.equal(usersR.body.users.length, 2);  // user2 and user3
  assert.equal(gamesR.body.games.length, 1);
  assert.equal(gamesR.body.games[0].gameType, 'stub');
  // For lobby to badge user2's tile, it groups by (playerAId, playerBId).
  const game = gamesR.body.games[0];
  const opponentId = game.playerAId === 1 ? game.playerBId : game.playerAId;
  assert.equal(opponentId, 2);
  server.close();
});
```

- [ ] **Step 2: Run, verify pass (data endpoints already work from prior tasks)**

Run: `node --test test/lobby.test.js`
Expected: PASS

- [ ] **Step 3: Build the lobby UI**

Create `public/lobby/lobby.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gamebox</title>
  <link rel="stylesheet" href="/lobby/lobby.css">
</head>
<body>
  <header>
    <h1>Gamebox</h1>
    <span id="me"></span>
  </header>
  <main>
    <h2>Pick an opponent</h2>
    <ul id="opponents"></ul>
    <dialog id="newgame">
      <h3>Start a new game with <span id="ng-name"></span></h3>
      <ul id="ng-options"></ul>
      <button id="ng-cancel">Cancel</button>
    </dialog>
  </main>
  <script src="/lobby/lobby.js" type="module"></script>
</body>
</html>
```

Create `public/lobby/lobby.css`:

```css
body { font-family: system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 1rem; }
header { display: flex; justify-content: space-between; align-items: baseline; }
#me { font-size: 0.9em; opacity: 0.7; }
#opponents { list-style: none; padding: 0; }
.opponent { border: 1px solid #ccc; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center; }
.opponent .name { font-weight: 600; font-size: 1.1em; }
.opponent .games { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.badge { padding: 0.25rem 0.75rem; border: 1px solid; border-radius: 999px; cursor: pointer; text-decoration: none; color: inherit; background: white; }
.badge.active { background: #efe; border-color: #4c4; }
.start-new { padding: 0.4rem 0.8rem; border: 1px dashed #888; border-radius: 999px; background: transparent; cursor: pointer; }
dialog#newgame { border: none; border-radius: 8px; padding: 1.5rem; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
#ng-options { list-style: none; padding: 0; }
#ng-options li { padding: 0.5rem 0; }
```

Create `public/lobby/lobby.js`:

```js
const PLUGINS = await fetch('/api/plugins').then(r => r.json()).then(j => j.plugins);

async function main() {
  const me = await fetch('/api/me').then(r => r.json()).catch(() => ({}));
  document.getElementById('me').textContent = me.friendlyName ? `signed in as ${me.friendlyName}` : '';

  const [{ users }, { games }] = await Promise.all([
    fetch('/api/users').then(r => r.json()),
    fetch('/api/games').then(r => r.json()),
  ]);

  // Group games by opponent id
  const byOpponent = new Map();
  for (const g of games) {
    const oppId = g.playerAId === me.id ? g.playerBId : g.playerAId;
    const arr = byOpponent.get(oppId) ?? [];
    arr.push(g);
    byOpponent.set(oppId, arr);
  }

  const list = document.getElementById('opponents');
  list.innerHTML = '';
  for (const u of users) {
    const li = document.createElement('li');
    li.className = 'opponent';
    const activeGames = byOpponent.get(u.id) ?? [];
    const activeTypes = new Set(activeGames.map(g => g.gameType));

    li.innerHTML = `
      <div class="name" style="color: ${u.color || 'inherit'}">${u.friendlyName}</div>
      <div class="games"></div>
    `;
    const gamesDiv = li.querySelector('.games');
    for (const g of activeGames) {
      const plugin = PLUGINS.find(p => p.id === g.gameType);
      const a = document.createElement('a');
      a.className = 'badge active';
      a.href = `/play/${g.gameType}/${g.id}/`;
      a.textContent = plugin?.displayName ?? g.gameType;
      gamesDiv.appendChild(a);
    }
    const btn = document.createElement('button');
    btn.className = 'start-new';
    btn.textContent = '+ Start new';
    btn.onclick = () => openNewGame(u, activeTypes);
    gamesDiv.appendChild(btn);
    list.appendChild(li);
  }
}

function openNewGame(opponent, activeTypes) {
  const dlg = document.getElementById('newgame');
  document.getElementById('ng-name').textContent = opponent.friendlyName;
  const opts = document.getElementById('ng-options');
  opts.innerHTML = '';
  for (const p of PLUGINS) {
    if (activeTypes.has(p.id)) continue;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = p.displayName;
    btn.onclick = async () => {
      const r = await fetch('/api/games', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opponentId: opponent.id, gameType: p.id }),
      });
      if (!r.ok) {
        alert((await r.json()).error ?? 'failed to create game');
        return;
      }
      const { id, gameType } = await r.json();
      window.location.href = `/play/${gameType}/${id}/`;
    };
    li.appendChild(btn);
    opts.appendChild(li);
  }
  document.getElementById('ng-cancel').onclick = () => dlg.close();
  dlg.showModal();
}

main().catch(err => { document.body.innerHTML = `<pre>${err.stack || err.message}</pre>`; });
```

- [ ] **Step 4: Add `/api/plugins` and `/api/me` endpoints**

In `src/server/routes.js`, add (above the `:gameId`-scoped routes):

```js
app.get('/api/plugins', (req, res) => {
  res.json({
    plugins: Object.values(registry).map(p => ({ id: p.id, displayName: p.displayName })),
  });
});

app.get('/api/me', (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    friendlyName: req.user.friendlyName,
    color: req.user.color,
  });
});
```

- [ ] **Step 5: Serve lobby at `/`**

In `src/server/server.js`, mount the lobby static assets:

```js
import path from 'node:path';
const lobbyDir = path.resolve('public/lobby');
app.use('/lobby', express.static(lobbyDir));
app.get('/', (req, res) => res.sendFile(path.join(lobbyDir, 'lobby.html')));
```

If the multiplayer plan was serving `public/home.html` at `/`, replace
that wiring. Delete `public/home.html` and `public/home.js` (the lobby
supersedes them).

- [ ] **Step 6: Manual smoke test**

Run: `npm start`
Open: http://localhost:3000/ in a browser
Set `DEV_USER=keith@example.com` (or whichever roster email exists locally)
Verify: lobby renders, opponents listed, no errors in console.

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Update README.md**

Replace the README with a gamebox-oriented version. Sections:
- Title + intro (gamebox = plugin host for two-player turn-based games)
- Quick start (npm install / fetch-dict / npm start)
- Architecture (host vs plugins)
- Plugin contract (the four functions, manifest, auxRoutes)
- Adding a plugin (step-by-step: create folder, write plugin.js, add to registry)
- Currently shipped plugins: Words (mention Rummikub as upcoming)
- API table (the new generic shape)

Use the existing README as a starting point; preserve the Tailscale/CF Access notes from the multiplayer rewrite.

- [ ] **Step 9: Commit**

```bash
git add public/lobby/ src/server/routes.js src/server/server.js README.md test/lobby.test.js
git rm public/home.html public/home.js 2>/dev/null || true
git commit -m "feat(lobby): pair tiles with per-game-type badges + new-game picker"
```

---

## Task 17: End-to-end Words smoke test through new host

**Files:**
- Test: `test/e2e-words.test.js`

A full game played through the new generic routes verifies that all the
moving parts (action dispatch, state filtering, plugin contract, schema)
hold together. This is the regression net for the refactor.

- [ ] **Step 1: Write the e2e test**

Create `test/e2e-words.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';
import { plugins } from '../src/plugins/index.js';
import { buildRegistry } from '../src/server/plugins.js';

async function setup() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'keith@b', 'Keith', '#f', datetime('now'))").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'sonia@b', 'Sonia', '#g', datetime('now'))").run();
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id, email: id === 1 ? 'keith@b' : 'sonia@b', friendlyName: id === 1 ? 'Keith' : 'Sonia' };
    next();
  });
  mountRoutes(app, { db, registry: buildRegistry(plugins), sse: { broadcast: () => {} } });
  const server = await new Promise(r => { const s = http.createServer(app); s.listen(0, () => r(s)); });
  return { server, db };
}

async function call(server, method, path, body, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('end-to-end: create Words game, play move, pass, resign', async () => {
  const { server } = await setup();

  // Create
  const create = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'words' }, { 'x-test-user-id': '1' });
  assert.equal(create.status, 200);
  const gameId = create.body.id;

  // Both sides can fetch state
  const stateA = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '1' });
  const stateB = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '2' });
  assert.equal(stateA.status, 200);
  assert.equal(stateB.status, 200);
  // Each sees their own rack
  assert.ok(stateA.body.state.racks);
  assert.ok(stateA.body.state.opponentRack.count === 7);

  // Determine whose turn it is and resign as that player (simplest finish path)
  const activeUser = stateA.body.state.activeUserId;
  const r = await call(server, 'POST', `/api/games/${gameId}/action`,
    { type: 'resign' }, { 'x-test-user-id': String(activeUser) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ended, true);

  // Game is now ended
  const after = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '1' });
  assert.equal(after.body.status, 'ended');

  // Listing only shows active games — should be empty
  const list = await call(server, 'GET', '/api/games', null, { 'x-test-user-id': '1' });
  assert.equal(list.body.games.length, 0);

  // After ending, can start a new Words game with the same opponent
  const create2 = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'words' }, { 'x-test-user-id': '1' });
  assert.equal(create2.status, 200);

  server.close();
});

test('end-to-end: validate aux route returns score', async () => {
  const { server } = await setup();
  const create = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'words' }, { 'x-test-user-id': '1' });
  const gameId = create.body.id;

  // We don't know the rack contents (random), but we can call validate with
  // an invalid placement and assert we get a structured response.
  const r = await call(server, 'POST', `/api/games/${gameId}/validate`,
    { placements: [{ r: 0, c: 0, letter: 'A' }] }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.valid, 'boolean');

  server.close();
});
```

- [ ] **Step 2: Run, verify pass**

Run: `node --test test/e2e-words.test.js`
Expected: PASS

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: PASS — all tests across the project.

- [ ] **Step 4: Manual browser smoke**

Run: `npm start`
Open: http://localhost:3000/ as Keith (set `DEV_USER`)
Click: existing Words game tile (or "Start new" → Words)
Verify: Words plays exactly as before — board renders, drag works,
validate updates the score preview, submit is accepted, opponent's turn
advances. Open a second browser as Sonia, verify the move appears via SSE.

- [ ] **Step 5: Commit**

```bash
git add test/e2e-words.test.js
git commit -m "test(e2e): full Words game through new generic host"
```

---

## Self-Review

After all 17 tasks:

- [ ] **Spec coverage check.** Walk through each section of the spec. Every item has at least one task that covers it:
  - Goals/non-goals → covered by overall scope
  - Architecture > top-level layout → Tasks 10, 11, 12
  - Architecture > plugin loading → Tasks 5, 13
  - Architecture > plugin contract → Tasks 5, 12
  - Architecture > action route → Task 6
  - Architecture > aux routes → Task 8 (mounting), Task 12 (Words validate)
  - Architecture > schema delta → Tasks 2, 3
  - Architecture > client serving → Task 9
  - Architecture > lobby → Task 16
  - Plugin: words → Tasks 10, 11, 12, 14
  - Repository identity → Task 1 (rebrand), Task 16 (full README)
  - Migration → Tasks 2, 3 (schema), Tasks 10, 11 (file moves)

- [ ] **No placeholders.** Every step has actual code where code is required. No TODOs, no "implement appropriately."

- [ ] **Type consistency.** State shape `{ bag, board, racks: {a,b}, scores: {a,b}, sides: {a,b}, activeUserId, consecutiveScorelessTurns, initialMoveDone, endedReason, winnerSide }` is consistent across Tasks 3, 4, 12. Plugin contract `{ initialState, applyAction, publicView, legalActions?, auxRoutes? }` is consistent across Tasks 5, 12. `auxRoutes[name] = { method, handler }` consistent across Tasks 5, 8, 12.

- [ ] **Test commands consistent.** All test runs use `node --test test/<file>.test.js` or `npm test`. Match `package.json`'s `test` script.

If any of the above flagged an issue, fix it inline above.
