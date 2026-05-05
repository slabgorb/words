# Multiplayer (friends & family) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded Keith-vs-Sonia model with an admin-curated user roster (email + friendly name) and one active game per unordered pair, gated by Cloudflare Access at the perimeter.

**Architecture:** SQLite schema migration introduces `users` and `games` tables; rebuilds `moves` to be game-scoped. Identity is read from the `Cf-Access-Authenticated-User-Email` header (with a `DEV_USER` env override for dev). Routes scope to `:gameId`. Client gets a pair-centric home screen plus a parameterized game shell at `/game/:id`. The pure rules engine is untouched.

**Tech Stack:** Node 20+, Express 4, better-sqlite3, vanilla JS, `node --test`. ESM throughout.

**Spec:** `docs/superpowers/specs/2026-05-05-multiplayer-design.md`

---

## File Structure

**Created:**
- `src/server/users.js` — user CRUD helpers
- `src/server/games.js` — game lifecycle helpers (create, list, persistMove, etc.)
- `src/server/migrate.js` — one-shot legacy → multiplayer migration
- `bin/add-user.js`, `bin/list-users.js`, `bin/rename-user.js` — admin CLI
- `public/home.html`, `public/home.js` — pair-centric landing page
- `public/lockout.html` — static "you're not on the roster" page
- `test/users.test.js`, `test/games.test.js`, `test/migrate.test.js`, `test/identity.test.js`, `test/cli.test.js` — new test suites

**Modified:**
- `src/server/db.js` — replace singleton schema with new tables; delegate user/game ops to new modules
- `src/server/identity.js` — rewrite around CF header / `DEV_USER`; remove cookie code
- `src/server/routes.js` — re-shape around `/api/games/:id/*` plus new top-level routes
- `src/server/sse.js` — `Map<gameId, Set<res>>` per-game scoping
- `src/server/server.js` — drop `cookie-parser`, add `/`, `/game/:id`, `/lockout` static routes
- `public/index.html` — friendly-name labels, back arrow, no identity picker
- `public/app.js`, `public/state.js` — read gameId from `location.pathname`, friendly-name labels
- `public/picker.js` — keep blank-letter & swap pickers, delete identity-picker
- `test/routes.test.js` — rewrite to use header-based identity and `:gameId` routes
- `package.json` — no dep changes; remove `cookie-parser` if unused

**Deleted (after refactor):**
- `cookie-parser` middleware in `server.js`
- `loadOrCreateSecret`, `setIdentityCookie`, `COOKIE` exports in `identity.js`

---

## Task 1: New schema in `db.js` (users + games + moves rebuild)

**Files:**
- Modify: `src/server/db.js`
- Test: `test/db-schema.test.js` (new)

This task lays down the new tables but does **not** wire migration of legacy data — that is Task 3. After this task, an empty new DB has the right shape; an existing legacy DB still works because we don't drop the old tables yet.

- [ ] **Step 1: Write the failing schema test**

Create `test/db-schema.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';

test('openDb creates users table with email/friendly_name/color', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  assert.deepEqual(cols.sort(), ['color', 'created_at', 'email', 'friendly_name', 'id']);
});

test('openDb creates games table with pair canonicalization check', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  for (const expected of ['id', 'player_a_id', 'player_b_id', 'status',
    'current_turn', 'bag', 'board', 'rack_a', 'rack_b', 'score_a', 'score_b',
    'consecutive_scoreless_turns', 'ended_reason', 'winner_side',
    'created_at', 'updated_at']) {
    assert.ok(cols.includes(expected), `games missing column ${expected}`);
  }
});

test('one_active_per_pair partial unique index exists', () => {
  const db = openDb(':memory:');
  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name='one_active_per_pair'").get();
  assert.ok(idx, 'index missing');
  assert.match(idx.sql, /WHERE\s+status\s*=\s*'active'/i);
});

test('moves table has game_id and side columns; client_nonce unique per game', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(moves)").all().map(c => c.name);
  for (const expected of ['id', 'game_id', 'side', 'kind', 'placement',
    'words_formed', 'score_delta', 'client_nonce', 'created_at']) {
    assert.ok(cols.includes(expected), `moves missing ${expected}`);
  }
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='moves_nonce_per_game'").get();
  assert.ok(idx, 'moves_nonce_per_game index missing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern='openDb creates users'`
Expected: FAIL — `users` table does not exist.

- [ ] **Step 3: Replace schema in `src/server/db.js`**

Replace the entire `SCHEMA` constant and `openDb` body with the new shape. Keep `freshGameRow` & `shuffle` helpers (they'll be reused by `games.js` in Task 2 — for now they stay here):

```js
import Database from 'better-sqlite3';
import { TILE_BAG, BOARD_SIZE } from './board.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  friendly_name TEXT NOT NULL,
  color         TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_a_id     INTEGER NOT NULL REFERENCES users(id),
  player_b_id     INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL,
  current_turn    TEXT NOT NULL,
  bag             TEXT NOT NULL,
  board           TEXT NOT NULL,
  rack_a          TEXT NOT NULL,
  rack_b          TEXT NOT NULL,
  score_a         INTEGER NOT NULL DEFAULT 0,
  score_b         INTEGER NOT NULL DEFAULT 0,
  consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
  ended_reason    TEXT,
  winner_side     TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CHECK (player_a_id < player_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_pair
  ON games(player_a_id, player_b_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id),
  side          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  placement     TEXT,
  words_formed  TEXT,
  score_delta   INTEGER NOT NULL DEFAULT 0,
  client_nonce  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS moves_nonce_per_game
  ON moves(game_id, client_nonce) WHERE client_nonce IS NOT NULL;
`;

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function emptyBoardJSON() {
  return JSON.stringify(Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)));
}

export function freshGameDeal() {
  const bag = shuffle(TILE_BAG);
  const rackA = bag.splice(0, 7);
  const rackB = bag.splice(0, 7);
  return { bag, rackA, rackB };
}

export function openDb(filePath = 'game.db') {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
```

Remove the old `getGameState`, `persistMove`, `resetGame` exports for now — Task 2 will replace them with game-scoped equivalents. Tests that import those will fail and be fixed in Tasks 2 / 7.

- [ ] **Step 4: Run schema tests to verify they pass**

Run: `node --test test/db-schema.test.js`
Expected: all 4 schema tests PASS.

Note: existing `test/routes.test.js` will be broken at this point. That is expected — it gets rewritten in Task 7. To run only this task's tests: `node --test test/db-schema.test.js test/board.test.js test/dictionary.test.js test/engine.test.js test/drag.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/server/db.js test/db-schema.test.js
git commit -m "refactor(db): add users/games schema and rebuild moves; legacy state still readable"
```

---

## Task 2: User & game helpers (`users.js`, `games.js`)

**Files:**
- Create: `src/server/users.js`, `src/server/games.js`
- Test: `test/users.test.js`, `test/games.test.js`
- Modify: `src/server/db.js` (re-export helpers)

- [ ] **Step 1: Write failing user-helper tests**

Create `test/users.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { createUser, getUserByEmail, getUserById, listUsers, renameUser, PALETTE } from '../src/server/users.js';

test('createUser inserts and returns row', () => {
  const db = openDb(':memory:');
  const u = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  assert.equal(u.email, 'a@x.com');
  assert.equal(u.friendlyName, 'Alice');
  assert.ok(PALETTE.includes(u.color));
  assert.ok(typeof u.id === 'number');
});

test('createUser auto-picks the next unused palette color', () => {
  const db = openDb(':memory:');
  const colors = [];
  for (let i = 0; i < PALETTE.length; i++) {
    colors.push(createUser(db, { email: `u${i}@x.com`, friendlyName: `U${i}` }).color);
  }
  assert.deepEqual(colors, PALETTE);
});

test('createUser throws on duplicate email (case-insensitive)', () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  assert.throws(() => createUser(db, { email: 'A@X.COM', friendlyName: 'Alice2' }));
});

test('getUserByEmail is case-insensitive', () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const u = getUserByEmail(db, 'A@X.COM');
  assert.equal(u.email, 'a@x.com');
});

test('listUsers returns rows ordered by friendly_name', () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const xs = listUsers(db);
  assert.deepEqual(xs.map(u => u.friendlyName), ['Alice', 'Bob']);
});

test('renameUser updates friendly_name', () => {
  const db = openDb(':memory:');
  const u = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  renameUser(db, 'a@x.com', 'Allison');
  assert.equal(getUserById(db, u.id).friendlyName, 'Allison');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test test/users.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/users.js`**

```js
export const PALETTE = [
  '#3b82f6', // blue
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#ef4444'  // red
];

function rowToUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, friendlyName: row.friendly_name, color: row.color, createdAt: row.created_at };
}

function nextPaletteColor(db) {
  const used = new Set(db.prepare('SELECT color FROM users').all().map(r => r.color));
  return PALETTE.find(c => !used.has(c)) ?? PALETTE[0];
}

export function createUser(db, { email, friendlyName, color }) {
  const c = color ?? nextPaletteColor(db);
  const info = db.prepare(
    'INSERT INTO users (email, friendly_name, color, created_at) VALUES (?, ?, ?, ?)'
  ).run(email, friendlyName, c, Date.now());
  return getUserById(db, info.lastInsertRowid);
}

export function getUserByEmail(db, email) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email));
}

export function getUserById(db, id) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function listUsers(db) {
  return db.prepare('SELECT * FROM users ORDER BY friendly_name COLLATE NOCASE').all().map(rowToUser);
}

export function renameUser(db, email, newName) {
  const info = db.prepare('UPDATE users SET friendly_name = ? WHERE email = ? COLLATE NOCASE').run(newName, email);
  return info.changes;
}
```

- [ ] **Step 4: Run user tests to verify they pass**

Run: `node --test test/users.test.js`
Expected: all 6 PASS.

- [ ] **Step 5: Write failing game-helper tests**

Create `test/games.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import {
  createGame, getGameById, listGamesForUser, persistMove, resetGameForPair, sideForUser
} from '../src/server/games.js';

function withTwoUsers() {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  return { db, a, b };
}

test('createGame canonicalizes pair (a < b regardless of arg order)', () => {
  const { db, a, b } = withTwoUsers();
  const g = createGame(db, b.id, a.id);
  assert.equal(g.playerAId, Math.min(a.id, b.id));
  assert.equal(g.playerBId, Math.max(a.id, b.id));
  assert.equal(g.status, 'active');
  assert.match(g.currentTurn, /^[ab]$/);
  assert.equal(g.rackA.length, 7);
  assert.equal(g.rackB.length, 7);
  assert.equal(g.bag.length, 100 - 14);
});

test('createGame rejects duplicate active pair', () => {
  const { db, a, b } = withTwoUsers();
  createGame(db, a.id, b.id);
  assert.throws(() => createGame(db, a.id, b.id), /one[_ ]active[_ ]per[_ ]pair|UNIQUE/i);
});

test('createGame rejects self-pairing', () => {
  const { db, a } = withTwoUsers();
  assert.throws(() => createGame(db, a.id, a.id), /self/i);
});

test('sideForUser returns a or b correctly', () => {
  const { db, a, b } = withTwoUsers();
  const g = createGame(db, a.id, b.id);
  assert.equal(sideForUser(g, a.id), 'a');
  assert.equal(sideForUser(g, b.id), 'b');
  assert.equal(sideForUser(g, 999), null);
});

test('listGamesForUser returns games where user is a or b', () => {
  const { db, a, b } = withTwoUsers();
  const g = createGame(db, a.id, b.id);
  const xs = listGamesForUser(db, a.id);
  assert.equal(xs.length, 1);
  assert.equal(xs[0].id, g.id);
});

test('persistMove updates game and inserts moves row', () => {
  const { db, a, b } = withTwoUsers();
  const g = createGame(db, a.id, b.id);
  const next = { ...g, scoreA: 12, currentTurn: 'b' };
  const r = persistMove(db, g.id, next, { side: 'a', kind: 'play', placement: [], wordsFormed: ['HI'], scoreDelta: 12, clientNonce: 'n1' });
  assert.equal(r.idempotent, false);
  const replay = persistMove(db, g.id, next, { side: 'a', kind: 'play', placement: [], wordsFormed: ['HI'], scoreDelta: 12, clientNonce: 'n1' });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.moveId, r.moveId);
});

test('resetGameForPair marks current ended game and creates a fresh active game for the same pair', () => {
  const { db, a, b } = withTwoUsers();
  const g = createGame(db, a.id, b.id);
  // Simulate ended state
  db.prepare("UPDATE games SET status='ended', ended_reason='resigned' WHERE id = ?").run(g.id);
  const fresh = resetGameForPair(db, g.id);
  assert.notEqual(fresh.id, g.id);
  assert.equal(fresh.status, 'active');
  assert.equal(getGameById(db, g.id).status, 'ended');
});
```

- [ ] **Step 6: Run game tests to verify failure**

Run: `node --test test/games.test.js`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/server/games.js`**

```js
import { BOARD_SIZE } from './board.js';
import { freshGameDeal, emptyBoardJSON } from './db.js';

function rowToGame(row) {
  if (!row) return null;
  return {
    id: row.id,
    playerAId: row.player_a_id,
    playerBId: row.player_b_id,
    status: row.status,
    currentTurn: row.current_turn,
    bag: JSON.parse(row.bag),
    board: JSON.parse(row.board),
    rackA: JSON.parse(row.rack_a),
    rackB: JSON.parse(row.rack_b),
    scoreA: row.score_a,
    scoreB: row.score_b,
    consecutiveScorelessTurns: row.consecutive_scoreless_turns,
    endedReason: row.ended_reason,
    winnerSide: row.winner_side,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function sideForUser(game, userId) {
  if (game.playerAId === userId) return 'a';
  if (game.playerBId === userId) return 'b';
  return null;
}

export function createGame(db, userId1, userId2) {
  if (userId1 === userId2) throw new Error('cannot start a game with self');
  const aId = Math.min(userId1, userId2);
  const bId = Math.max(userId1, userId2);
  const { bag, rackA, rackB } = freshGameDeal();
  const startSide = Math.random() < 0.5 ? 'a' : 'b';
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, current_turn, bag, board,
      rack_a, rack_b, score_a, score_b, consecutive_scoreless_turns,
      ended_reason, winner_side, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, ?, ?)
  `).run(aId, bId, startSide, JSON.stringify(bag), emptyBoardJSON(),
         JSON.stringify(rackA), JSON.stringify(rackB), now, now);
  return getGameById(db, info.lastInsertRowid);
}

export function getGameById(db, id) {
  return rowToGame(db.prepare('SELECT * FROM games WHERE id = ?').get(id));
}

export function listGamesForUser(db, userId) {
  return db.prepare(
    'SELECT * FROM games WHERE player_a_id = ? OR player_b_id = ? ORDER BY updated_at DESC'
  ).all(userId, userId).map(rowToGame);
}

export function findActiveGameForPair(db, userId1, userId2) {
  const aId = Math.min(userId1, userId2);
  const bId = Math.max(userId1, userId2);
  return rowToGame(db.prepare(
    "SELECT * FROM games WHERE player_a_id = ? AND player_b_id = ? AND status = 'active'"
  ).get(aId, bId));
}

export function persistMove(db, gameId, nextState, moveRecord) {
  const tx = db.transaction(() => {
    if (moveRecord.clientNonce) {
      const existing = db.prepare(
        'SELECT id FROM moves WHERE game_id = ? AND client_nonce = ?'
      ).get(gameId, moveRecord.clientNonce);
      if (existing) return { moveId: existing.id, idempotent: true };
    }
    db.prepare(`UPDATE games SET
      status = ?, current_turn = ?, bag = ?, board = ?,
      rack_a = ?, rack_b = ?, score_a = ?, score_b = ?,
      consecutive_scoreless_turns = ?, ended_reason = ?, winner_side = ?,
      updated_at = ? WHERE id = ?`).run(
      nextState.status ?? (nextState.endedReason ? 'ended' : 'active'),
      nextState.currentTurn,
      JSON.stringify(nextState.bag),
      JSON.stringify(nextState.board),
      JSON.stringify(nextState.rackA),
      JSON.stringify(nextState.rackB),
      nextState.scoreA,
      nextState.scoreB,
      nextState.consecutiveScorelessTurns,
      nextState.endedReason ?? null,
      nextState.winnerSide ?? null,
      Date.now(),
      gameId
    );
    const info = db.prepare(`INSERT INTO moves
      (game_id, side, kind, placement, words_formed, score_delta, client_nonce, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      gameId,
      moveRecord.side,
      moveRecord.kind,
      moveRecord.placement ? JSON.stringify(moveRecord.placement) : null,
      moveRecord.wordsFormed ? JSON.stringify(moveRecord.wordsFormed) : null,
      moveRecord.scoreDelta ?? 0,
      moveRecord.clientNonce ?? null,
      Date.now()
    );
    return { moveId: info.lastInsertRowid, idempotent: false };
  });
  return tx();
}

export function resetGameForPair(db, prevGameId) {
  const prev = getGameById(db, prevGameId);
  if (!prev) throw new Error('game not found');
  return createGame(db, prev.playerAId, prev.playerBId);
}
```

- [ ] **Step 8: Run game tests to verify they pass**

Run: `node --test test/games.test.js test/users.test.js test/db-schema.test.js`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/server/users.js src/server/games.js src/server/db.js test/users.test.js test/games.test.js
git commit -m "feat(db): user and game helpers with pair canonicalization"
```

---

## Task 3: Legacy data migration

**Files:**
- Create: `src/server/migrate.js`
- Test: `test/migrate.test.js`
- Modify: `src/server/db.js` (call `migrateLegacy` from `openDb`)

This task migrates an existing legacy `game.db` (with `players`, singleton `game`, old `moves`, `game_history`) to the new shape, preserving the in-progress Keith/Sonia game.

- [ ] **Step 1: Write the failing migration test**

Create `test/migrate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateLegacy } from '../src/server/migrate.js';
import { openDb } from '../src/server/db.js';
import { listUsers, getUserByEmail } from '../src/server/users.js';
import { listGamesForUser } from '../src/server/games.js';

// Build a fixture DB shaped like the legacy schema with one in-progress game.
function buildLegacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
    CREATE TABLE game (
      id INTEGER PRIMARY KEY CHECK (id=1),
      status TEXT NOT NULL, current_turn TEXT NOT NULL,
      bag TEXT NOT NULL, board TEXT NOT NULL,
      rack_keith TEXT NOT NULL, rack_sonia TEXT NOT NULL,
      score_keith INTEGER NOT NULL DEFAULT 0, score_sonia INTEGER NOT NULL DEFAULT 0,
      consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
      ended_reason TEXT, winner TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT NOT NULL, kind TEXT NOT NULL,
      placement TEXT, words_formed TEXT,
      score_delta INTEGER NOT NULL DEFAULT 0,
      client_nonce TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ended_at INTEGER NOT NULL, winner TEXT,
      score_keith INTEGER NOT NULL, score_sonia INTEGER NOT NULL,
      snapshot TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO players VALUES ('keith','Keith','#3b82f6')").run();
  db.prepare("INSERT INTO players VALUES ('sonia','Sonia','#ec4899')").run();
  db.prepare(`INSERT INTO game VALUES
    (1,'active','keith',?,?,?,?,42,17,0,NULL,NULL,?,?)`).run(
    JSON.stringify(['A','B','C']),
    JSON.stringify(Array.from({length:15}, () => Array(15).fill(null))),
    JSON.stringify(['E','I','O','U','Y','Z','_']),
    JSON.stringify(['T','S','R','N','L','D','P']),
    1700000000000, 1700000001000
  );
  db.prepare(`INSERT INTO moves (player_id, kind, score_delta, client_nonce, created_at)
              VALUES ('keith', 'pass', 0, 'nonce-1', 1700000000500)`).run();
  return db;
}

test('migrateLegacy creates Keith and Sonia users with the configured emails', () => {
  const db = buildLegacyDb();
  // Apply new schema first (this is what openDb would do before calling migrate)
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      friendly_name TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_a_id INTEGER NOT NULL REFERENCES users(id),
      player_b_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL, current_turn TEXT NOT NULL,
      bag TEXT NOT NULL, board TEXT NOT NULL,
      rack_a TEXT NOT NULL, rack_b TEXT NOT NULL,
      score_a INTEGER NOT NULL DEFAULT 0, score_b INTEGER NOT NULL DEFAULT 0,
      consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
      ended_reason TEXT, winner_side TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      CHECK (player_a_id < player_b_id));
    CREATE UNIQUE INDEX one_active_per_pair ON games(player_a_id, player_b_id) WHERE status='active';
  `);
  migrateLegacy(db);
  const users = listUsers(db);
  assert.equal(users.length, 2);
  assert.ok(getUserByEmail(db, 'slabgorb@gmail.com'));
  assert.ok(getUserByEmail(db, 'sonia.ramosdarocha@gmail.com'));
});

test('migrateLegacy preserves the active game with mapped racks/scores', () => {
  const db = buildLegacyDb();
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      friendly_name TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_a_id INTEGER NOT NULL REFERENCES users(id),
      player_b_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL, current_turn TEXT NOT NULL,
      bag TEXT NOT NULL, board TEXT NOT NULL,
      rack_a TEXT NOT NULL, rack_b TEXT NOT NULL,
      score_a INTEGER NOT NULL DEFAULT 0, score_b INTEGER NOT NULL DEFAULT 0,
      consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
      ended_reason TEXT, winner_side TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      CHECK (player_a_id < player_b_id));
  `);
  migrateLegacy(db);
  const keith = getUserByEmail(db, 'slabgorb@gmail.com');
  const games = listGamesForUser(db, keith.id);
  assert.equal(games.length, 1);
  const g = games[0];
  assert.equal(g.status, 'active');
  assert.equal(g.scoreA, 42);
  assert.equal(g.scoreB, 17);
  assert.equal(g.currentTurn, 'a'); // 'keith' → 'a' since keith is the lower id
  assert.deepEqual(g.rackA, ['E','I','O','U','Y','Z','_']);
});

test('migrateLegacy rebuilds moves with game_id and side', () => {
  const db = buildLegacyDb();
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      friendly_name TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_a_id INTEGER NOT NULL REFERENCES users(id),
      player_b_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL, current_turn TEXT NOT NULL,
      bag TEXT NOT NULL, board TEXT NOT NULL,
      rack_a TEXT NOT NULL, rack_b TEXT NOT NULL,
      score_a INTEGER NOT NULL DEFAULT 0, score_b INTEGER NOT NULL DEFAULT 0,
      consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
      ended_reason TEXT, winner_side TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      CHECK (player_a_id < player_b_id));`);
  migrateLegacy(db);
  const cols = db.prepare('PRAGMA table_info(moves)').all().map(c => c.name);
  assert.ok(cols.includes('game_id'));
  assert.ok(cols.includes('side'));
  assert.equal(cols.includes('player_id'), false);
  const row = db.prepare('SELECT * FROM moves').get();
  assert.equal(row.game_id, 1);
  assert.equal(row.side, 'a');
});

test('migrateLegacy is idempotent', () => {
  const db = buildLegacyDb();
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      friendly_name TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_a_id INTEGER NOT NULL REFERENCES users(id),
      player_b_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL, current_turn TEXT NOT NULL,
      bag TEXT NOT NULL, board TEXT NOT NULL,
      rack_a TEXT NOT NULL, rack_b TEXT NOT NULL,
      score_a INTEGER NOT NULL DEFAULT 0, score_b INTEGER NOT NULL DEFAULT 0,
      consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
      ended_reason TEXT, winner_side TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      CHECK (player_a_id < player_b_id));`);
  migrateLegacy(db);
  migrateLegacy(db); // second call is a no-op
  assert.equal(listUsers(db).length, 2);
});

test('openDb on a fresh empty file leaves users table empty (no auto-seed without legacy data)', () => {
  const db = openDb(':memory:');
  assert.equal(listUsers(db).length, 0);
});
```

- [ ] **Step 2: Run migration tests, expect failures**

Run: `node --test test/migrate.test.js`
Expected: FAIL — `migrate.js` not found.

- [ ] **Step 3: Implement `src/server/migrate.js`**

```js
const KEITH_EMAIL = 'slabgorb@gmail.com';
const SONIA_EMAIL = 'sonia.ramosdarocha@gmail.com';

function tableExists(db, name) {
  return !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(name);
}

function tableHasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

// One-shot migration: legacy singleton-game schema → users/games schema.
// Idempotent; safe to call on every boot.
export function migrateLegacy(db) {
  const tx = db.transaction(() => {
    const hasLegacyGame = tableExists(db, 'game');
    const hasLegacyPlayers = tableExists(db, 'players');
    const usersEmpty = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    const gamesEmpty = db.prepare('SELECT COUNT(*) AS n FROM games').get().n === 0;

    // Nothing to migrate.
    if (!hasLegacyGame && !hasLegacyPlayers) return;

    // Already migrated.
    if (!usersEmpty && !gamesEmpty) {
      // Drop legacy artifacts if they're still hanging around.
      dropLegacy(db);
      return;
    }

    // 1. Seed Keith and Sonia.
    const insUser = db.prepare(
      'INSERT INTO users (email, friendly_name, color, created_at) VALUES (?, ?, ?, ?)'
    );
    const now = Date.now();
    if (usersEmpty) {
      insUser.run(KEITH_EMAIL, 'Keith', '#3b82f6', now);
      insUser.run(SONIA_EMAIL, 'Sonia', '#ec4899', now);
    }
    const keithId = db.prepare('SELECT id FROM users WHERE email = ?').get(KEITH_EMAIL).id;
    const soniaId = db.prepare('SELECT id FROM users WHERE email = ?').get(SONIA_EMAIL).id;
    const aId = Math.min(keithId, soniaId);
    const bId = Math.max(keithId, soniaId);
    const keithSide = keithId === aId ? 'a' : 'b';
    const soniaSide = soniaId === aId ? 'a' : 'b';

    // 2. Migrate the singleton game.
    if (gamesEmpty && hasLegacyGame) {
      const g = db.prepare('SELECT * FROM game WHERE id = 1').get();
      if (g) {
        const sideMap = (id) => (id === 'keith' ? keithSide : soniaSide);
        const rackA = keithSide === 'a' ? g.rack_keith : g.rack_sonia;
        const rackB = keithSide === 'a' ? g.rack_sonia : g.rack_keith;
        const scoreA = keithSide === 'a' ? g.score_keith : g.score_sonia;
        const scoreB = keithSide === 'a' ? g.score_sonia : g.score_keith;
        db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, current_turn,
          bag, board, rack_a, rack_b, score_a, score_b, consecutive_scoreless_turns,
          ended_reason, winner_side, created_at, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          aId, bId, g.status, sideMap(g.current_turn),
          g.bag, g.board, rackA, rackB, scoreA, scoreB,
          g.consecutive_scoreless_turns, g.ended_reason,
          g.winner ? sideMap(g.winner) : null,
          g.created_at, g.updated_at
        );
      }
    }

    // 3. Rebuild moves with game_id + side; drop player_id.
    if (tableExists(db, 'moves') && tableHasColumn(db, 'moves', 'player_id')) {
      db.exec(`
        CREATE TABLE moves_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id INTEGER NOT NULL REFERENCES games(id),
          side TEXT NOT NULL,
          kind TEXT NOT NULL,
          placement TEXT,
          words_formed TEXT,
          score_delta INTEGER NOT NULL DEFAULT 0,
          client_nonce TEXT,
          created_at INTEGER NOT NULL
        );
      `);
      db.prepare(`
        INSERT INTO moves_v2 (id, game_id, side, kind, placement, words_formed, score_delta, client_nonce, created_at)
        SELECT id, 1,
          CASE player_id WHEN 'keith' THEN ? ELSE ? END,
          kind, placement, words_formed, score_delta, client_nonce, created_at
        FROM moves
      `).run(keithSide, soniaSide);
      db.exec('DROP TABLE moves;');
      db.exec('ALTER TABLE moves_v2 RENAME TO moves;');
      db.exec(`CREATE UNIQUE INDEX moves_nonce_per_game
               ON moves(game_id, client_nonce) WHERE client_nonce IS NOT NULL;`);
    }

    // 4. Stash legacy_game_history if present.
    if (tableExists(db, 'game_history')) {
      db.exec('ALTER TABLE game_history RENAME TO legacy_game_history;');
    }

    dropLegacy(db);
  });
  tx();
}

function dropLegacy(db) {
  if (tableExists(db, 'game')) db.exec('DROP TABLE game;');
  if (tableExists(db, 'players')) db.exec('DROP TABLE players;');
}
```

- [ ] **Step 4: Wire `migrateLegacy` into `openDb`**

In `src/server/db.js`, import and call after schema creation:

```js
import { migrateLegacy } from './migrate.js';

export function openDb(filePath = 'game.db') {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrateLegacy(db);
  return db;
}
```

- [ ] **Step 5: Run migration tests to verify they pass**

Run: `node --test test/migrate.test.js test/db-schema.test.js test/users.test.js test/games.test.js`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/migrate.js src/server/db.js test/migrate.test.js
git commit -m "feat(db): one-shot legacy → multiplayer migration"
```

---

## Task 4: Identity middleware (CF header + DEV_USER + lockout)

**Files:**
- Modify: `src/server/identity.js` (rewrite)
- Test: `test/identity.test.js` (new)

- [ ] **Step 1: Write failing identity middleware tests**

Create `test/identity.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import { attachIdentity, requireIdentity } from '../src/server/identity.js';

function buildApp(opts) {
  const app = express();
  app.use(attachIdentity(opts));
  app.get('/me', requireIdentity, (req, res) => res.json({ email: req.user.email, id: req.user.id }));
  return app;
}

async function listen(app) {
  return new Promise(r => { const s = app.listen(0, () => r(s)); });
}

test('attachIdentity reads CF-Access header in production', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const app = buildApp({ db, isProd: true });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`, { headers: { 'cf-access-authenticated-user-email': 'a@x.com' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).email, 'a@x.com');
  server.close();
});

test('requireIdentity returns 401 when no header in prod', async () => {
  const db = openDb(':memory:');
  const app = buildApp({ db, isProd: true });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`);
  assert.equal(r.status, 401);
  server.close();
});

test('requireIdentity returns 403 when header email is not in users (lockout)', async () => {
  const db = openDb(':memory:');
  const app = buildApp({ db, isProd: true });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`, { headers: { 'cf-access-authenticated-user-email': 'unknown@x.com' } });
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.equal(body.error, 'not-on-roster');
  assert.equal(body.email, 'unknown@x.com');
  server.close();
});

test('DEV_USER fallback works in dev when header is missing', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const app = buildApp({ db, isProd: false, devUser: 'a@x.com' });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).email, 'a@x.com');
  server.close();
});

test('DEV_USER is ignored in production', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const app = buildApp({ db, isProd: true, devUser: 'a@x.com' });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`);
  assert.equal(r.status, 401);
  server.close();
});

test('email lookup is case-insensitive', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const app = buildApp({ db, isProd: true });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`, { headers: { 'cf-access-authenticated-user-email': 'A@X.COM' } });
  assert.equal(r.status, 200);
  server.close();
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `node --test test/identity.test.js`
Expected: FAIL — `attachIdentity` API mismatch / cookie code path.

- [ ] **Step 3: Rewrite `src/server/identity.js`**

```js
import { getUserByEmail } from './users.js';

const HEADER = 'cf-access-authenticated-user-email';

// Reads identity from the CF Access header (or DEV_USER in dev).
// Attaches req.user (or null) and req.authEmail (the email from the header,
// even if not on the roster — used by the lockout path).
export function attachIdentity({ db, isProd, devUser } = {}) {
  return (req, _res, next) => {
    const headerEmail = req.headers[HEADER];
    let email = typeof headerEmail === 'string' ? headerEmail.trim() : null;
    if (!email && !isProd && devUser) email = devUser;
    req.authEmail = email;
    req.user = email ? getUserByEmail(db, email) : null;
    next();
  };
}

export function requireIdentity(req, res, next) {
  if (!req.authEmail) return res.status(401).json({ error: 'unauthenticated' });
  if (!req.user) return res.status(403).json({ error: 'not-on-roster', email: req.authEmail });
  next();
}
```

Delete the previous file content entirely. The exports `loadOrCreateSecret`, `setIdentityCookie`, `COOKIE` are gone.

- [ ] **Step 4: Run identity tests to verify they pass**

Run: `node --test test/identity.test.js`
Expected: all 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/identity.js test/identity.test.js
git commit -m "feat(identity): trust CF Access header; DEV_USER for local dev"
```

---

## Task 5: Per-game SSE

**Files:**
- Modify: `src/server/sse.js`
- Test: `test/sse.test.js` (new)

- [ ] **Step 1: Write failing SSE test**

Create `test/sse.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { subscribe, broadcast, subscriberCount } from '../src/server/sse.js';

function buildApp() {
  const app = express();
  app.get('/events/:id', (req, res) => subscribe(Number(req.params.id), req, res));
  return app;
}

async function listen(app) {
  return new Promise(r => { const s = app.listen(0, () => r(s)); });
}

test('subscribers are scoped per gameId', async () => {
  const app = buildApp();
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const c1 = new AbortController(), c2 = new AbortController();
  const r1 = fetch(`${url}/events/1`, { signal: c1.signal });
  const r2 = fetch(`${url}/events/2`, { signal: c2.signal });
  // Yield long enough for the connections to register.
  await new Promise(r => setTimeout(r, 50));
  assert.equal(subscriberCount(1), 1);
  assert.equal(subscriberCount(2), 1);
  c1.abort(); c2.abort();
  await Promise.allSettled([r1, r2]);
  server.close();
});

test('broadcast(gameId) only fans out to that game', async () => {
  const app = buildApp();
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const c1 = new AbortController();
  const r1 = fetch(`${url}/events/7`, { signal: c1.signal });
  await new Promise(r => setTimeout(r, 50));
  let chunks = '';
  r1.then(async resp => {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks += dec.decode(value);
    }
  }).catch(() => {});

  broadcast(7, { type: 'move', payload: { hi: 1 } });
  broadcast(8, { type: 'move', payload: { hi: 2 } });
  await new Promise(r => setTimeout(r, 50));
  c1.abort();
  await new Promise(r => setTimeout(r, 50));
  assert.match(chunks, /event: move/);
  assert.match(chunks, /"hi":1/);
  assert.equal(/"hi":2/.test(chunks), false);
  server.close();
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test test/sse.test.js`
Expected: FAIL — `subscribe` only takes `(req, res)`, not `gameId`.

- [ ] **Step 3: Rewrite `src/server/sse.js`**

```js
const subscribers = new Map(); // gameId -> Set<res>

export function subscribe(gameId, req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
  let set = subscribers.get(gameId);
  if (!set) { set = new Set(); subscribers.set(gameId, set); }
  set.add(res);

  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch { /* socket dead */ }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    set.delete(res);
    if (set.size === 0) subscribers.delete(gameId);
  });
}

export function broadcast(gameId, event) {
  const set = subscribers.get(gameId);
  if (!set) return;
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event.payload ?? {})}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { set.delete(res); }
  }
}

export function subscriberCount(gameId) {
  return subscribers.get(gameId)?.size ?? 0;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `node --test test/sse.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/sse.js test/sse.test.js
git commit -m "feat(sse): per-game scoping (Map<gameId, Set<res>>)"
```

---

## Task 6: Routes — top-level (`/api/me`, `/api/users`, `POST /api/games`)

**Files:**
- Modify: `src/server/routes.js`
- Test: `test/routes-top.test.js` (new)

This task creates the new top-level routes. The legacy game routes (`/state`, `/move`, etc.) are deleted in this task; their game-scoped replacements come in Task 7. The existing `test/routes.test.js` is left broken until Task 7.

- [ ] **Step 1: Write failing top-level route tests**

Create `test/routes-top.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import { buildRoutes } from '../src/server/routes.js';
import { loadDictionary } from '../src/server/dictionary.js';

function buildApp(db, devUser = null) {
  const dict = loadDictionary();
  const app = express();
  app.use(express.json());
  app.use('/api', buildRoutes({ db, dict, isProd: false, devUser }));
  return app;
}
async function listen(app) { return new Promise(r => { const s = app.listen(0, () => r(s)); }); }
function urlOf(server) { return `http://localhost:${server.address().port}`; }

test('GET /api/me returns user and games list', async () => {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/me`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.user.email, 'a@x.com');
  assert.equal(body.user.friendlyName, 'Alice');
  assert.deepEqual(body.games, []);
  server.close();
});

test('GET /api/users returns roster without emails', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/users`);
  assert.equal(r.status, 200);
  const xs = await r.json();
  assert.equal(xs.length, 2);
  assert.ok(xs[0].id);
  assert.ok(xs[0].friendlyName);
  assert.ok(xs[0].color);
  assert.equal(xs[0].email, undefined);
  server.close();
});

test('POST /api/games creates a game between two users', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ otherUserId: b.id })
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.ok(body.gameId);
  server.close();
});

test('POST /api/games returns 409 if active pair already exists', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const url = urlOf(server);
  await fetch(`${url}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ otherUserId: b.id }) });
  const r = await fetch(`${url}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ otherUserId: b.id }) });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'pair-active');
  server.close();
});

test('POST /api/games returns 400 on self-pairing', async () => {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ otherUserId: a.id })
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /api/games returns 404 on unknown user', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ otherUserId: 999 })
  });
  assert.equal(r.status, 404);
  server.close();
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test test/routes-top.test.js`
Expected: FAIL — `buildRoutes` signature is wrong.

- [ ] **Step 3: Rewrite `src/server/routes.js` (top-level routes only for now)**

```js
import { Router } from 'express';
import { attachIdentity, requireIdentity } from './identity.js';
import { listUsers, getUserById } from './users.js';
import {
  createGame, listGamesForUser, sideForUser, getGameById
} from './games.js';

export function buildRoutes({ db, dict, isProd, devUser }) {
  const r = Router();
  r.use(attachIdentity({ db, isProd, devUser }));

  r.get('/me', requireIdentity, (req, res) => {
    const games = listGamesForUser(db, req.user.id).map(g => {
      const otherId = g.playerAId === req.user.id ? g.playerBId : g.playerAId;
      const other = getUserById(db, otherId);
      const you = sideForUser(g, req.user.id);
      const yourScore = you === 'a' ? g.scoreA : g.scoreB;
      const theirScore = you === 'a' ? g.scoreB : g.scoreA;
      return {
        id: g.id,
        opponent: { id: other.id, friendlyName: other.friendlyName, color: other.color },
        status: g.status,
        yourTurn: g.status === 'active' && g.currentTurn === you,
        yourScore, theirScore,
        endedReason: g.endedReason,
        winnerSide: g.winnerSide,
        updatedAt: g.updatedAt
      };
    });
    res.json({
      user: { id: req.user.id, email: req.user.email, friendlyName: req.user.friendlyName, color: req.user.color },
      games
    });
  });

  r.get('/users', requireIdentity, (_req, res) => {
    res.json(listUsers(db).map(u => ({ id: u.id, friendlyName: u.friendlyName, color: u.color })));
  });

  r.post('/games', requireIdentity, (req, res) => {
    const { otherUserId } = req.body ?? {};
    if (typeof otherUserId !== 'number') return res.status(400).json({ error: 'bad-request' });
    if (otherUserId === req.user.id) return res.status(400).json({ error: 'self-pairing' });
    const other = getUserById(db, otherUserId);
    if (!other) return res.status(404).json({ error: 'unknown-user' });
    try {
      const g = createGame(db, req.user.id, otherUserId);
      res.status(201).json({ gameId: g.id });
    } catch (e) {
      const msg = String(e?.message ?? '');
      if (/UNIQUE|one_active_per_pair/i.test(msg)) {
        return res.status(409).json({ error: 'pair-active' });
      }
      throw e;
    }
  });

  // Game-scoped routes added in Task 7.

  return r;
}
```

Note: the legacy `/state`, `/move`, `/pass`, `/swap`, `/resign`, `/new-game`, `/whoami`, `/validate`, `/events` routes are absent. The existing `test/routes.test.js` will fail until Task 7 — that's expected. Run only `routes-top.test.js` for verification.

- [ ] **Step 4: Run, expect pass**

Run: `node --test test/routes-top.test.js`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.js test/routes-top.test.js
git commit -m "feat(routes): /api/me, /api/users, POST /api/games"
```

---

## Task 7: Routes — game-scoped (`/api/games/:id/*`)

**Files:**
- Modify: `src/server/routes.js` (extend with `:id` routes)
- Modify: `src/server/engine.js` only if needed (likely not — see below)
- Test: `test/routes-game.test.js` (new), and rewrite `test/routes.test.js` (or delete and rely on the new file)

The pure engine functions in `engine.js` operate on a state shape that uses `state.racks[playerId]`, `state.scores`, etc. Adapt by **wrapping** at the route boundary: convert the `games`-row shape (`rackA`, `scoreA`, `currentTurn: 'a'|'b'`) into the engine's shape (`{racks: {a, b}, scores: {a, b}, currentTurn: 'a'|'b'}`) and back. The engine doesn't care whether keys are 'keith'/'sonia' or 'a'/'b', so no engine changes are needed — the keys just have to match.

- [ ] **Step 1: Verify engine works on side keys**

Read `src/server/engine.js` `applyMove` and `applyEndGameAdjustment`. They reference `state.racks[playerId]`, `state.scores[playerId]`, `state.currentTurn`, and `otherPlayer(playerId)`. As long as we pass `'a'`/`'b'` consistently, they work. `otherPlayer` should return `'b'` given `'a'` — verify the existing impl:

```bash
grep -n 'export function otherPlayer' src/server/engine.js
```

If `otherPlayer` is hard-coded to `keith`/`sonia`, change it to:

```js
export function otherPlayer(p) { return p === 'a' ? 'b' : 'a'; }
```

(This is a small, safe edit — tests for engine should still pass since engine tests use whichever key shape they pass in. If existing engine tests use `'keith'`/`'sonia'` literals, update those tests to `'a'`/`'b'` in this same step. They're internal labels.)

- [ ] **Step 2: Write failing game-route tests**

Delete `test/routes.test.js` and create `test/routes-game.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import { createGame, getGameById } from '../src/server/games.js';
import { buildRoutes } from '../src/server/routes.js';
import { loadDictionary } from '../src/server/dictionary.js';

function buildApp(db, devUser) {
  const dict = loadDictionary();
  const app = express();
  app.use(express.json());
  app.use('/api', buildRoutes({ db, dict, isProd: false, devUser }));
  return app;
}
async function listen(app) { return new Promise(r => { const s = app.listen(0, () => r(s)); }); }
function urlOf(s) { return `http://localhost:${s.address().port}`; }

function setup() {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const c = createUser(db, { email: 'c@x.com', friendlyName: 'Charlie' });
  const g = createGame(db, a.id, b.id);
  return { db, a, b, c, g };
}

test('GET /api/games/:id/state returns snapshot for a participant', async () => {
  const { db, g } = setup();
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/state`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.you, sideForA(g));
  assert.ok(body.opponent.friendlyName);
  assert.ok(Array.isArray(body.board));
  server.close();
});

function sideForA(g) { return g.playerAId < g.playerBId ? 'a' : 'b'; /* always 'a' under canonicalization */ }

test('GET /api/games/:id/state returns 403 for non-participant', async () => {
  const { db, g } = setup();
  const server = await listen(buildApp(db, 'c@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/state`);
  assert.equal(r.status, 403);
  server.close();
});

test('GET /api/games/:id/state returns 404 for missing game', async () => {
  const { db } = setup();
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/9999/state`);
  assert.equal(r.status, 404);
  server.close();
});

test('POST /api/games/:id/pass advances the turn', async () => {
  const { db, g } = setup();
  // Force currentTurn = 'a' so Alice can pass.
  db.prepare("UPDATE games SET current_turn='a' WHERE id=?").run(g.id);
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/pass`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientNonce: 'n1' })
  });
  assert.equal(r.status, 200);
  assert.equal(getGameById(db, g.id).currentTurn, 'b');
  server.close();
});

test('POST /api/games/:id/pass returns 409 when not your turn', async () => {
  const { db, g } = setup();
  db.prepare("UPDATE games SET current_turn='b' WHERE id=?").run(g.id);
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/pass`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientNonce: 'n1' })
  });
  assert.equal(r.status, 409);
  server.close();
});

test('POST /api/games/:id/new-game requires both players to confirm', async () => {
  const { db, g } = setup();
  db.prepare("UPDATE games SET status='ended', ended_reason='resigned', winner_side='a' WHERE id=?").run(g.id);
  const server = await listen(buildApp(db, 'a@x.com'));
  const url = urlOf(server);
  let r = await fetch(`${url}/api/games/${g.id}/new-game`, { method: 'POST' });
  assert.equal(r.status, 200);
  let body = await r.json();
  assert.equal(body.started, false);
  assert.ok(body.waitingFor);
  // Same caller pressing twice does not start a game.
  r = await fetch(`${url}/api/games/${g.id}/new-game`, { method: 'POST' });
  body = await r.json();
  assert.equal(body.started, false);
  server.close();

  // Bob now confirms.
  const server2 = await listen(buildApp(db, 'b@x.com'));
  const r2 = await fetch(`${urlOf(server2)}/api/games/${g.id}/new-game`, { method: 'POST' });
  const body2 = await r2.json();
  assert.equal(body2.started, true);
  assert.ok(body2.newGameId);
  assert.notEqual(body2.newGameId, g.id);
  server2.close();
});
```

- [ ] **Step 3: Run, expect failure**

Run: `node --test test/routes-game.test.js`
Expected: FAIL — game-scoped routes don't exist.

- [ ] **Step 4: Add game-scoped routes to `src/server/routes.js`**

Add these imports at the top of `routes.js`:

```js
import {
  validatePlacement, extractWords, scoreMove, applyMove,
  detectGameEnd, applyEndGameAdjustment
} from './engine.js';
import { persistMove, resetGameForPair } from './games.js';
import { broadcast, subscribe } from './sse.js';
```

Inside `buildRoutes`, after the existing top-level routes, add a sub-router for game-scoped routes:

```js
  // -- Per-game authorization --
  function loadGameForUser(req, res, next) {
    const gameId = Number(req.params.id);
    if (!Number.isInteger(gameId)) return res.status(400).json({ error: 'bad-game-id' });
    const game = getGameById(db, gameId);
    if (!game) return res.status(404).json({ error: 'game-not-found' });
    const side = sideForUser(game, req.user.id);
    if (!side) return res.status(403).json({ error: 'not-a-participant' });
    req.game = game;
    req.side = side;
    next();
  }

  // Engine adapter — converts a games row into the shape engine expects.
  function toEngineState(g) {
    return {
      status: g.status,
      currentTurn: g.currentTurn,
      bag: g.bag,
      board: g.board,
      racks: { a: g.rackA, b: g.rackB },
      scores: { a: g.scoreA, b: g.scoreB },
      consecutiveScorelessTurns: g.consecutiveScorelessTurns,
      endedReason: g.endedReason,
      winner: g.winnerSide
    };
  }
  function fromEngineState(es) {
    return {
      status: es.status,
      currentTurn: es.currentTurn,
      bag: es.bag,
      board: es.board,
      rackA: es.racks.a,
      rackB: es.racks.b,
      scoreA: es.scores.a,
      scoreB: es.scores.b,
      consecutiveScorelessTurns: es.consecutiveScorelessTurns,
      endedReason: es.endedReason ?? null,
      winnerSide: es.winner ?? null
    };
  }

  const pendingNewGame = new Map(); // gameId -> Set<userId>

  r.get('/games/:id/state', requireIdentity, loadGameForUser, (req, res) => {
    const g = req.game;
    const otherId = g.playerAId === req.user.id ? g.playerBId : g.playerAId;
    const other = getUserById(db, otherId);
    res.json({
      gameId: g.id,
      you: req.side,
      opponent: { friendlyName: other.friendlyName, color: other.color },
      yourFriendlyName: req.user.friendlyName,
      yourColor: req.user.color,
      status: g.status,
      currentTurn: g.currentTurn,
      board: g.board,
      bag: g.bag,
      racks: { a: g.rackA, b: g.rackB },
      scores: { a: g.scoreA, b: g.scoreB },
      consecutiveScorelessTurns: g.consecutiveScorelessTurns,
      endedReason: g.endedReason,
      winner: g.winnerSide
    });
  });

  r.post('/games/:id/validate', requireIdentity, loadGameForUser, (req, res) => {
    const state = toEngineState(req.game);
    const { placement } = req.body ?? {};
    if (!Array.isArray(placement)) return res.status(400).json({ error: 'bad-placement' });
    const isFirstMove = state.board.every(row => row.every(c => c === null));
    const geo = validatePlacement(state.board, placement, isFirstMove);
    if (!geo.valid) return res.json({ valid: false, words: [], score: 0, reason: geo.reason });
    const { mainWord, crossWords } = extractWords(state.board, placement, geo.axis);
    const allWords = [mainWord, ...crossWords].filter(Boolean);
    const wordResults = allWords.map(w => ({ word: w.text, ok: dict.isWord(w.text) }));
    const allValid = wordResults.every(w => w.ok);
    const score = allValid ? scoreMove(state.board, placement, mainWord, crossWords) : 0;
    res.json({ valid: allValid, words: wordResults, score });
  });

  r.post('/games/:id/move', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (game.currentTurn !== req.side) return res.status(409).json({ error: 'not-your-turn' });
    const { placement, clientNonce } = req.body ?? {};
    if (!Array.isArray(placement) || !clientNonce) return res.status(400).json({ error: 'bad-request' });

    const state = toEngineState(game);
    const isFirstMove = state.board.every(row => row.every(c => c === null));
    const geo = validatePlacement(state.board, placement, isFirstMove);
    if (!geo.valid) return res.status(400).json({ error: 'placement-invalid', reason: geo.reason });

    const rack = state.racks[req.side].slice();
    for (const t of placement) {
      const key = t.blank ? '_' : t.letter;
      const idx = rack.indexOf(key);
      if (idx === -1) return res.status(400).json({ error: 'rack-mismatch', missing: key });
      rack.splice(idx, 1);
    }
    const { mainWord, crossWords } = extractWords(state.board, placement, geo.axis);
    const allWords = [mainWord, ...crossWords].filter(Boolean);
    if (allWords.length === 0) return res.status(400).json({ error: 'no-word-formed' });
    for (const w of allWords) {
      if (!dict.isWord(w.text)) return res.status(400).json({ error: 'invalid-word', word: w.text });
    }
    const scoreDelta = scoreMove(state.board, placement, mainWord, crossWords);

    let nextEs = applyMove(state, { playerId: req.side, kind: 'play', placement, scoreDelta });
    const endReason = detectGameEnd(nextEs);
    if (endReason) nextEs = applyEndGameAdjustment(nextEs, endReason, null);
    const next = fromEngineState(nextEs);

    const result = persistMove(db, game.id, next, {
      side: req.side, kind: 'play', placement,
      wordsFormed: allWords.map(w => w.text), scoreDelta, clientNonce
    });
    broadcast(game.id, { type: 'move', payload: { by: req.side, words: allWords.map(w => w.text), score: scoreDelta, ended: !!endReason } });
    res.json({ ok: true, moveId: result.moveId, idempotent: result.idempotent, ended: endReason });
  });

  r.post('/games/:id/pass', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (game.currentTurn !== req.side) return res.status(409).json({ error: 'not-your-turn' });
    const { clientNonce } = req.body ?? {};
    if (!clientNonce) return res.status(400).json({ error: 'bad-request' });
    const state = toEngineState(game);
    let nextEs = applyMove(state, { playerId: req.side, kind: 'pass' });
    const endReason = detectGameEnd(nextEs);
    if (endReason) nextEs = applyEndGameAdjustment(nextEs, endReason, null);
    const next = fromEngineState(nextEs);
    persistMove(db, game.id, next, { side: req.side, kind: 'pass', scoreDelta: 0, clientNonce });
    broadcast(game.id, { type: 'pass', payload: { by: req.side, ended: !!endReason } });
    res.json({ ok: true, ended: endReason });
  });

  r.post('/games/:id/swap', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (game.currentTurn !== req.side) return res.status(409).json({ error: 'not-your-turn' });
    const { tiles, clientNonce } = req.body ?? {};
    if (!Array.isArray(tiles) || tiles.length === 0 || !clientNonce) return res.status(400).json({ error: 'bad-request' });
    if (game.bag.length < 7) return res.status(400).json({ error: 'bag-too-small' });
    const state = toEngineState(game);
    const rack = state.racks[req.side].slice();
    for (const letter of tiles) {
      const idx = rack.indexOf(letter);
      if (idx === -1) return res.status(400).json({ error: 'rack-mismatch', missing: letter });
      rack.splice(idx, 1);
    }
    let nextEs = applyMove(state, { playerId: req.side, kind: 'swap', swapTiles: tiles });
    const endReason = detectGameEnd(nextEs);
    if (endReason) nextEs = applyEndGameAdjustment(nextEs, endReason, null);
    const next = fromEngineState(nextEs);
    persistMove(db, game.id, next, { side: req.side, kind: 'swap', scoreDelta: 0, clientNonce });
    broadcast(game.id, { type: 'swap', payload: { by: req.side, count: tiles.length, ended: !!endReason } });
    res.json({ ok: true, ended: endReason });
  });

  r.post('/games/:id/resign', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    const { clientNonce } = req.body ?? {};
    if (!clientNonce) return res.status(400).json({ error: 'bad-request' });
    const state = toEngineState(game);
    const nextEs = applyEndGameAdjustment(state, 'resigned', req.side);
    const next = fromEngineState(nextEs);
    persistMove(db, game.id, next, { side: req.side, kind: 'pass', scoreDelta: 0, clientNonce });
    broadcast(game.id, { type: 'resign', payload: { by: req.side } });
    res.json({ ok: true, ended: 'resigned' });
  });

  r.post('/games/:id/new-game', requireIdentity, loadGameForUser, (req, res) => {
    const game = req.game;
    if (game.status !== 'ended') return res.status(409).json({ error: 'game-not-ended' });
    let pending = pendingNewGame.get(game.id);
    if (!pending) { pending = new Set(); pendingNewGame.set(game.id, pending); }
    pending.add(req.user.id);
    if (pending.size === 2) {
      pendingNewGame.delete(game.id);
      const fresh = resetGameForPair(db, game.id);
      broadcast(game.id, { type: 'new-game', payload: { newGameId: fresh.id } });
      return res.json({ ok: true, started: true, newGameId: fresh.id });
    }
    const otherId = game.playerAId === req.user.id ? game.playerBId : game.playerAId;
    const other = getUserById(db, otherId);
    res.json({ ok: true, started: false, waitingFor: other.friendlyName });
  });

  r.get('/games/:id/events', requireIdentity, loadGameForUser, (req, res) => {
    subscribe(req.game.id, req, res);
  });
```

- [ ] **Step 5: Run tests, expect pass**

Run: `node --test test/routes-game.test.js test/routes-top.test.js test/identity.test.js test/sse.test.js test/migrate.test.js test/games.test.js test/users.test.js test/db-schema.test.js`
Expected: all PASS.

Run the full suite (engine, dict, board, drag must still pass):

Run: `npm test`
Expected: all PASS. If `engine.test.js` references `'keith'`/`'sonia'` literals, update them to `'a'`/`'b'`.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.js src/server/engine.js test/routes-game.test.js test/engine.test.js
git rm test/routes.test.js
git commit -m "feat(routes): /api/games/:id/* with per-game auth, SSE, and adapter to engine"
```

---

## Task 8: Server wiring (drop cookies, static routes for /, /game/:id, /lockout)

**Files:**
- Modify: `src/server/server.js`
- Modify: `package.json` (no longer need `cookie-parser`)

- [ ] **Step 1: Rewrite `src/server/server.js`**

```js
import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { loadDictionary } from './dictionary.js';
import { buildRoutes } from './routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const isProd = process.env.NODE_ENV === 'production';
const devUser = process.env.DEV_USER || null;

const dict = loadDictionary();
console.log(`[startup] dictionary loaded (${dict.size} words)`);
const db = openDb(dbPath);
console.log(`[startup] database opened at ${dbPath}`);
if (!isProd && devUser) {
  console.log(`[startup] DEV_USER override active: ${devUser}`);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api', buildRoutes({ db, dict, isProd, devUser }));

const PUBLIC = resolve(PROJECT_ROOT, 'public');
app.get('/', (_req, res) => res.sendFile(resolve(PUBLIC, 'home.html')));
app.get('/game/:id(\\d+)', (_req, res) => res.sendFile(resolve(PUBLIC, 'index.html')));
app.get('/lockout', (_req, res) => res.sendFile(resolve(PUBLIC, 'lockout.html')));
app.use(express.static(PUBLIC));

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'server' });
});

app.listen(port, () => console.log(`[startup] listening on http://localhost:${port}`));
```

- [ ] **Step 2: Drop cookie-parser dependency**

Edit `package.json` to remove `"cookie-parser": "^1.4.7"` from `dependencies`. Then:

```bash
npm install
```

Expected: package-lock.json updates, no errors.

- [ ] **Step 3: Verify server boots**

```bash
DEV_USER=slabgorb@gmail.com npm start
```

Expected: `[startup] listening on http://localhost:3000` and `DEV_USER override active`. Hit `curl http://localhost:3000/api/me` — should return JSON with the user. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add src/server/server.js package.json package-lock.json
git commit -m "refactor(server): drop cookies, add /, /game/:id, /lockout static routes"
```

---

## Task 9: Lockout page

**Files:**
- Create: `public/lockout.html`
- Modify: `src/server/routes.js` (add a lockout-page redirect path)

The CF header is set on every request including the static `/`. If the user is authenticated but not on the roster, the API returns 403 — but the home page itself is just a static HTML file. The cleanest approach: when a user hits `/` and the API returns 403 from `/api/me`, the home-page JS redirects to `/lockout?email=...`. The lockout page itself is static and reads the email from the query string.

- [ ] **Step 1: Create `public/lockout.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Words — not on the roster</title>
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main class="lockout">
    <h1>You're not on the roster yet.</h1>
    <p>Hi <span id="who"></span> — Keith hasn't added you to the roster yet.
       Drop him a line and he'll set you up.</p>
    <p><a id="mailto" href="mailto:slabgorb@gmail.com">Email Keith</a></p>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const email = params.get('email') || 'friend';
    document.getElementById('who').textContent = email;
    document.getElementById('mailto').href = `mailto:slabgorb@gmail.com?subject=Words access for ${encodeURIComponent(email)}`;
  </script>
</body>
</html>
```

- [ ] **Step 2: Add minimal lockout styles to `public/style.css`**

Append:

```css
.lockout {
  max-width: 28rem; margin: 4rem auto; padding: 1.5rem;
  font-family: 'Source Serif 4', serif;
  text-align: center;
}
.lockout h1 { font-size: 1.5rem; margin-bottom: 1rem; }
.lockout p { line-height: 1.5; margin-bottom: 0.75rem; }
.lockout a { color: #3b82f6; text-decoration: underline; }
```

- [ ] **Step 3: Verify in a browser**

```bash
DEV_USER=unknown@x.com npm start
```

Open `http://localhost:3000/lockout?email=unknown@x.com` in a browser. Confirm you see the lockout text with the email rendered in the body and a working mailto link. Stop server.

- [ ] **Step 4: Commit**

```bash
git add public/lockout.html public/style.css
git commit -m "feat(client): static lockout page for unrostered emails"
```

---

## Task 10: Home page (pair-centric tiles)

**Files:**
- Create: `public/home.html`, `public/home.js`

- [ ] **Step 1: Create `public/home.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Words — home</title>
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main id="home">
    <header><h1 id="greeting">Words</h1></header>
    <section id="tiles" class="tiles"></section>
  </main>
  <script type="module" src="/home.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/home.js`**

```js
async function load() {
  const meR = await fetch('/api/me');
  if (meR.status === 403) {
    const email = (await meR.json()).email || '';
    location.href = `/lockout?email=${encodeURIComponent(email)}`;
    return;
  }
  if (!meR.ok) {
    document.body.textContent = 'Could not load — try refreshing.';
    return;
  }
  const me = await meR.json();
  const usersR = await fetch('/api/users');
  const users = await usersR.json();

  document.getElementById('greeting').textContent = `Hi, ${me.user.friendlyName}.`;

  const gamesByOpponentId = new Map(me.games.map(g => [g.opponent.id, g]));
  const others = users.filter(u => u.id !== me.user.id);

  const root = document.getElementById('tiles');
  for (const u of others) {
    const game = gamesByOpponentId.get(u.id);
    root.appendChild(renderTile(u, game));
  }
}

function renderTile(other, game) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.style.setProperty('--accent', other.color);
  const name = document.createElement('div');
  name.className = 'tile-name';
  name.textContent = other.friendlyName;
  tile.appendChild(name);

  if (game && game.status === 'active') {
    const badge = document.createElement('div');
    badge.className = 'tile-badge';
    badge.textContent = game.yourTurn ? 'Your turn' : 'Their turn';
    badge.dataset.state = game.yourTurn ? 'you' : 'them';
    tile.appendChild(badge);
    const score = document.createElement('div');
    score.className = 'tile-score';
    score.textContent = `${game.yourScore} — ${game.theirScore}`;
    tile.appendChild(score);
    const time = document.createElement('div');
    time.className = 'tile-time';
    time.textContent = relativeTime(game.updatedAt);
    tile.appendChild(time);
    tile.addEventListener('click', () => location.href = `/game/${game.id}`);
    tile.classList.add('tile-active');
  } else {
    const btn = document.createElement('button');
    btn.className = 'tile-start';
    btn.textContent = 'Start a game';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const r = await fetch('/api/games', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otherUserId: other.id })
      });
      if (r.status === 201) {
        const { gameId } = await r.json();
        location.href = `/game/${gameId}`;
      } else {
        btn.disabled = false;
        btn.textContent = 'Try again';
      }
    });
    tile.appendChild(btn);
  }
  return tile;
}

function relativeTime(t) {
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

load();
```

- [ ] **Step 3: Add tile styles to `public/style.css`**

Append:

```css
#home { max-width: 60rem; margin: 0 auto; padding: 1.5rem; }
#home header h1 { font-family: 'Source Serif 4', serif; font-weight: 500; }
.tiles {
  display: grid; gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
}
.tile {
  position: relative; padding: 1rem 1rem 0.75rem;
  border-radius: 0.5rem; background: #fff;
  border: 1px solid #e5e7eb;
  border-left: 4px solid var(--accent, #3b82f6);
  display: flex; flex-direction: column; gap: 0.25rem;
  cursor: default;
}
.tile-active { cursor: pointer; }
.tile-active:hover { background: #f9fafb; }
.tile-name { font-family: 'Source Serif 4', serif; font-size: 1.1rem; font-weight: 500; }
.tile-badge { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; }
.tile-badge[data-state="you"] { color: #16a34a; }
.tile-badge[data-state="them"] { color: #6b7280; }
.tile-score { font-family: 'JetBrains Mono', monospace; font-size: 0.875rem; color: #374151; }
.tile-time { font-size: 0.75rem; color: #9ca3af; }
.tile-start {
  margin-top: 0.5rem; padding: 0.4rem 0.75rem; font-family: inherit;
  border: 1px solid #d1d5db; border-radius: 0.375rem; background: #fff; cursor: pointer;
}
.tile-start:hover { background: #f3f4f6; }
@media (prefers-color-scheme: dark) {
  .tile { background: #1f2937; border-color: #374151; }
  .tile-active:hover { background: #111827; }
  .tile-score { color: #d1d5db; }
  .tile-start { background: #1f2937; color: #f3f4f6; border-color: #374151; }
}
```

- [ ] **Step 4: Verify manually**

Run:

```bash
DEV_USER=slabgorb@gmail.com npm start
```

Open `http://localhost:3000/`. Expected: greeting, one tile for "Sonia" with last-move time and active-game badge (assuming the migrated game is active). Click the tile → navigates to `/game/1`. (The game screen still works using the legacy app.js logic until Task 11 — the URL path will be `/game/1` but state.js still hits `/api/state`. That's fixed in Task 11; for now the tile click is the only verification target.)

- [ ] **Step 5: Commit**

```bash
git add public/home.html public/home.js public/style.css
git commit -m "feat(client): pair-centric home page"
```

---

## Task 11: Game-screen client updates (gameId in URL, friendly names, back arrow)

**Files:**
- Modify: `public/index.html`
- Modify: `public/state.js`
- Modify: `public/app.js`
- Delete: identity-picker block in `public/picker.js` (keep blank/swap pickers)

- [ ] **Step 1: Update `public/state.js` to use gameId from path**

Replace `state.js` with:

```js
export const ui = {
  server: null,
  tentative: [],
  rackOrder: null,
  gameId: null
};

export function initGameId() {
  const m = location.pathname.match(/^\/game\/(\d+)/);
  ui.gameId = m ? Number(m[1]) : null;
  if (!ui.gameId) location.href = '/';
}

const TENTATIVE_KEY = () => `words.tentative.${ui.gameId}`;

export function loadTentative() {
  try { ui.tentative = JSON.parse(localStorage.getItem(TENTATIVE_KEY()) || '[]'); }
  catch { ui.tentative = []; }
}
export function saveTentative() {
  localStorage.setItem(TENTATIVE_KEY(), JSON.stringify(ui.tentative));
}
export function clearTentative() {
  ui.tentative = [];
  localStorage.removeItem(TENTATIVE_KEY());
}

export async function fetchState() {
  const r = await fetch(`/api/games/${ui.gameId}/state`);
  if (r.status === 403) { location.href = '/lockout'; return null; }
  if (r.status === 404) { location.href = '/'; return null; }
  if (!r.ok) throw new Error('state-fetch-failed');
  ui.server = await r.json();
  if (!ui.rackOrder) ui.rackOrder = ui.server.racks[ui.server.you].slice();
  return ui.server;
}

export function gameUrl(suffix) {
  return `/api/games/${ui.gameId}/${suffix}`;
}
```

- [ ] **Step 2: Update `public/index.html`**

Replace `<header id="topbar">` and the identity picker. The picker `<div id="identity-picker">` block is removed entirely. Add a back-arrow link in the topbar. Replace lines 13-31 with:

```html
  <main id="game" hidden>
    <header id="topbar">
      <div class="topbar-row">
        <a id="home-link" href="/" aria-label="Back to games">←</a>
        <div id="score-a" class="score"></div>
        <div id="turn-pill" class="turn-pill"></div>
        <div id="score-b" class="score score-right"></div>
      </div>
      <div class="topbar-sub">
        <span id="bag-count"></span>
        <span id="rack-remaining"></span>
      </div>
    </header>
```

- [ ] **Step 3: Update `public/app.js` to use new API and friendly names**

Edit `public/app.js`. Concrete changes:

- Remove the `whoami()` and `chooseIdentity()` helpers (lines ~12-22) and the identity-picker bootstrap.
- Replace any `fetch('/api/state')` and `fetch('/api/move')` etc. with `fetch(gameUrl('state'))`, `fetch(gameUrl('move'))`, etc. Import `gameUrl` and `initGameId` from `./state.js`.
- In `refresh()`, replace `keithEl`/`soniaEl` lookups with `score-a`/`score-b`. Use `ui.server.you` (`'a'`|`'b'`) and the friendly names from `ui.server.opponent.friendlyName` and `ui.server.yourFriendlyName`. The label rendering becomes:

```js
const aFriendly = ui.server.you === 'a' ? ui.server.yourFriendlyName : ui.server.opponent.friendlyName;
const bFriendly = ui.server.you === 'b' ? ui.server.yourFriendlyName : ui.server.opponent.friendlyName;
const aEl = $('#score-a');
const bEl = $('#score-b');
aEl.textContent = `${aFriendly} ${ui.server.scores.a}`;
bEl.textContent = `${bFriendly} ${ui.server.scores.b}`;
aEl.classList.toggle('active', !ended && current === 'a');
bEl.classList.toggle('active', !ended && current === 'b');
```

- For the turn pill in non-`isMyTurn` branch, render `${ui.server.opponent.friendlyName}'s turn`.

- For SSE: replace `new EventSource('/api/events')` with `new EventSource(gameUrl('events'))`.

- At the top of the bootstrap (currently does `whoami()` then renders picker), instead:

```js
import { initGameId, ui, fetchState, /* … */ } from './state.js';
// remove import of `pickIdentity` from picker.js if any.

initGameId();
await fetchState();
document.querySelector('#game').hidden = false;
refresh();
attachSse();
```

(Keep `pickBlankLetter`, `pickSwapTiles`, `confirmAction`, `pickMoreActions` imports — those still exist in `picker.js`.)

- [ ] **Step 4: Remove identity-picker code from `public/picker.js`**

Delete the function(s) responsible for the identity splash (whatever is named `pickIdentity` or wired to `#identity-picker`). Leave blank-letter, swap, more-actions, confirm-action helpers intact.

- [ ] **Step 5: Manual verification**

Run:

```bash
DEV_USER=slabgorb@gmail.com npm start
```

Open `http://localhost:3000/`. Click the Sonia tile. Expected:

- URL is `/game/1`.
- Topbar shows back arrow, "Keith 42", turn pill, "Sonia 17" (or whatever the migrated scores were).
- The board renders in mid-game state.
- Drag a tile from rack to board → live validation works.
- Submit move (if valid). Watch a second browser at `/game/1` (or the home page) update via SSE.
- Click the back arrow → returns to `/`.

If anything breaks, fix in this task before committing.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/state.js public/app.js public/picker.js
git commit -m "feat(client): parameterize game screen on gameId; friendly names; back arrow"
```

---

## Task 12: Admin CLI (`bin/add-user.js`, `list-users.js`, `rename-user.js`)

**Files:**
- Create: `bin/add-user.js`, `bin/list-users.js`, `bin/rename-user.js`
- Test: `test/cli.test.js` (new) — uses `node:child_process` to invoke

- [ ] **Step 1: Write failing CLI tests**

Create `test/cli.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/server/db.js';
import { listUsers, getUserByEmail } from '../src/server/users.js';

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'words-cli-'));
  return { dir, dbPath: join(dir, 'game.db') };
}

test('bin/add-user.js inserts a user', () => {
  const { dir, dbPath } = tmpDb();
  try {
    execFileSync('node', ['bin/add-user.js', 'mom@x.com', 'Mom'],
      { env: { ...process.env, DB_PATH: dbPath } });
    const db = openDb(dbPath);
    assert.equal(getUserByEmail(db, 'mom@x.com').friendlyName, 'Mom');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bin/add-user.js rejects duplicates', () => {
  const { dir, dbPath } = tmpDb();
  try {
    execFileSync('node', ['bin/add-user.js', 'mom@x.com', 'Mom'],
      { env: { ...process.env, DB_PATH: dbPath } });
    assert.throws(() => execFileSync(
      'node', ['bin/add-user.js', 'mom@x.com', 'Mom'],
      { env: { ...process.env, DB_PATH: dbPath }, stdio: 'pipe' }
    ));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bin/list-users.js prints rows', () => {
  const { dir, dbPath } = tmpDb();
  try {
    execFileSync('node', ['bin/add-user.js', 'a@x.com', 'Alice'],
      { env: { ...process.env, DB_PATH: dbPath } });
    const out = execFileSync('node', ['bin/list-users.js'],
      { env: { ...process.env, DB_PATH: dbPath } }).toString();
    assert.match(out, /a@x\.com/);
    assert.match(out, /Alice/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bin/rename-user.js updates friendly_name', () => {
  const { dir, dbPath } = tmpDb();
  try {
    execFileSync('node', ['bin/add-user.js', 'a@x.com', 'Alice'],
      { env: { ...process.env, DB_PATH: dbPath } });
    execFileSync('node', ['bin/rename-user.js', 'a@x.com', 'Allison'],
      { env: { ...process.env, DB_PATH: dbPath } });
    const db = openDb(dbPath);
    assert.equal(getUserByEmail(db, 'a@x.com').friendlyName, 'Allison');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test test/cli.test.js`
Expected: FAIL — CLI files don't exist.

- [ ] **Step 3: Create `bin/add-user.js`**

```js
#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/server/db.js';
import { createUser, getUserByEmail } from '../src/server/users.js';

const [email, friendlyName, color] = process.argv.slice(2);
if (!email || !friendlyName) {
  console.error('Usage: node bin/add-user.js <email> <friendly_name> [color]');
  process.exit(2);
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const db = openDb(dbPath);

if (getUserByEmail(db, email)) {
  console.error(`User ${email} already exists`);
  process.exit(1);
}

const u = createUser(db, { email, friendlyName, color });
console.log(`Added ${u.friendlyName} <${u.email}> (color ${u.color})`);
```

- [ ] **Step 4: Create `bin/list-users.js`**

```js
#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/server/db.js';
import { listUsers } from '../src/server/users.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const db = openDb(dbPath);

const xs = listUsers(db);
if (xs.length === 0) { console.log('(no users yet — add one with bin/add-user.js)'); process.exit(0); }
const padName = Math.max(...xs.map(u => u.friendlyName.length));
const padEmail = Math.max(...xs.map(u => u.email.length));
for (const u of xs) {
  console.log(`${u.id.toString().padStart(3)}  ${u.friendlyName.padEnd(padName)}  ${u.email.padEnd(padEmail)}  ${u.color}`);
}
```

- [ ] **Step 5: Create `bin/rename-user.js`**

```js
#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/server/db.js';
import { renameUser, getUserByEmail } from '../src/server/users.js';

const [email, newName] = process.argv.slice(2);
if (!email || !newName) {
  console.error('Usage: node bin/rename-user.js <email> <new_name>');
  process.exit(2);
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const db = openDb(dbPath);

if (!getUserByEmail(db, email)) {
  console.error(`User ${email} not found`);
  process.exit(1);
}

renameUser(db, email, newName);
console.log(`Renamed ${email} → ${newName}`);
```

- [ ] **Step 6: Run, expect pass**

Run: `node --test test/cli.test.js`
Expected: PASS (4).

- [ ] **Step 7: Commit**

```bash
git add bin/add-user.js bin/list-users.js bin/rename-user.js test/cli.test.js
git commit -m "feat(cli): add-user, list-users, rename-user admin scripts"
```

---

## Task 13: README, justfile, final integration check

**Files:**
- Modify: `README.md`
- Modify: `justfile` (add `add-user` recipe)

- [ ] **Step 1: Update `README.md`**

Replace the "Quick start" / "Playing" / "API" sections with the new flow. Key edits:

- Quick start: add `DEV_USER=you@example.com npm start` line.
- "Playing" first paragraph: replace "Each browser picks an identity from the splash screen" with "Cloudflare Access authenticates each visitor by email; the app maps the email to a friendly name. The home page shows one tile per other roster member; click a tile to play your game with that person."
- Add a "Roster" section between "Quick start" and "Playing":

  ```markdown
  ## Roster

  Friends and family are added by the host. Use the CLI:

  ```bash
  node bin/add-user.js mom@example.com "Mom"
  node bin/list-users.js
  node bin/rename-user.js mom@example.com "Mama"
  ```

  Each user also needs to be in the Cloudflare Access policy.
  ```

- API table: replace with the new routes (`/api/me`, `/api/users`, `POST /api/games`, `/api/games/:id/state`, etc.).

- Architecture section: update file list — add `users.js`, `games.js`, `migrate.js`, `home.html`, `home.js`, `lockout.html`. Remove references to `picker.js` identity selector and the old singleton `game` row.

- Env vars table: replace `SECRET_PATH` with `NODE_ENV` (set to `production` in deployment) and `DEV_USER` (dev-only override).

- [ ] **Step 2: Add a `just add-user` recipe**

Append to `justfile`:

```make
# Add a new user to the roster.
add-user EMAIL NAME:
    node bin/add-user.js {{EMAIL}} "{{NAME}}"

# List all roster users.
list-users:
    node bin/list-users.js
```

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: every test in `test/` passes.

- [ ] **Step 4: End-to-end smoke test (manual)**

```bash
just backup       # snapshot current game.db
DEV_USER=slabgorb@gmail.com npm start &
sleep 1
curl -s http://localhost:3000/api/me | jq .
node bin/add-user.js test@example.com "Test User"
node bin/list-users.js
curl -s http://localhost:3000/api/users | jq .
kill %1 || true
```

Expected: `/api/me` returns Keith with one game (vs Sonia). `add-user` adds a new row. `/api/users` lists three users including the new one.

Open the browser at `http://localhost:3000/` (with `DEV_USER` still set). Confirm: greeting "Hi, Keith.", two tiles (one for Sonia with active-game badge, one for Test User with "Start a game" button). Click "Start a game" with Test User → fails because there's no `DEV_USER` for Test User to play as, but a game row should be created. Visit `http://localhost:3000/game/2` (or whatever new ID was returned) and confirm a fresh empty board renders.

- [ ] **Step 5: Commit**

```bash
git add README.md justfile
git commit -m "docs: roster, multi-game home, justfile add-user/list-users"
```

---

## Self-review pass

After all tasks complete, the engineer should run:

- `npm test` — all suites green.
- `git log --oneline` — one commit per task, sensible messages.
- A 5-minute manual play-through of the migrated game and a freshly-created game with a new user.

Spec compliance: every section of `docs/superpowers/specs/2026-05-05-multiplayer-design.md` should map to one or more tasks above. The "Out of scope" items in the spec (notifications, spectators, self-rename, per-game theming) are intentionally absent here.
