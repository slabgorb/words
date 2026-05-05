# Game History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-turn history drawer to the Words and Rummikub clients, backed by a single shared `turn_log` table on the server, with live SSE updates. Bundle the fix for the Words client's broken SSE handlers in the same change.

**Architecture:** Plugins gain an optional `summary` field on `applyAction` returns; the host writes a row to a new `turn_log` table inside the existing action transaction and broadcasts a `turn` SSE event with the row payload. A new `GET /api/games/:id/history` endpoint returns the chronological log. Each client renders a slide-in right-side drawer with a plugin-specific text formatter; both subscribe to the new `turn` event.

**Tech Stack:** Node 20, Express, better-sqlite3, vanilla JS clients, `node:test` for tests, SSE for live updates.

**Spec:** `docs/superpowers/specs/2026-05-05-game-history-design.md`

---

## File Structure

**Server (new files):**
- `src/server/history.js` — `appendTurnEntry`, `listTurnEntries` over `turn_log`

**Server (modified):**
- `src/server/db.js` — add `turn_log` schema + index, drop `moves` table & index
- `src/server/routes.js` — write `turn_log` row in action txn, broadcast `turn` event, add `GET /api/games/:gameId/history`

**Plugins (modified):**
- `plugins/words/server/actions.js` — return `summary` from each action
- `plugins/rummikub/server/actions.js` — return `summary` from each action

**Words client (new):**
- `plugins/words/client/history.js` — drawer state, fetch, render, SSE append, format

**Words client (modified):**
- `plugins/words/client/app.js` — replace dead `move`/`pass`/`swap`/`resign` SSE handlers with `update` + `turn`; mount drawer button; call `history.appendEntry` on `turn`
- `plugins/words/client/index.html` — add drawer DOM scaffolding
- `plugins/words/client/style.css` — drawer styles

**Rummikub client (new):**
- `plugins/rummikub/client/history.js` — same shape as Words counterpart, with Rummikub formatter

**Rummikub client (modified):**
- `plugins/rummikub/client/app.js` — add `turn` SSE handler; mount drawer button
- `plugins/rummikub/client/index.html` — drawer DOM scaffolding
- `plugins/rummikub/client/style.css` — drawer styles

**Tests (new):**
- `test/history.test.js` — `appendTurnEntry`/`listTurnEntries` over `:memory:` DB

**Tests (modified):**
- `test/db-schema.test.js` — assert `moves` is gone, `turn_log` exists with the expected columns/index
- `test/action-route.test.js` — assert action writes a `turn_log` row and broadcasts `turn` event; assert `GET /api/games/:id/history` returns entries oldest-first
- `test/words-plugin.test.js` — assert each action returns the documented `summary` shape
- `test/rummikub-actions.test.js` — assert each action returns the documented `summary` shape

---

## Conventions

- **Test runner:** `node --test 'test/**/*.test.js'`. Run a single file with `node --test test/<file>`.
- **Commits:** one per task; format `feat(scope): description` or `fix(scope): description`. The conversation has prior examples (`feat(rummikub/client): ...`).
- **TDD:** every task starts with the failing test, then the minimal implementation, then verify pass, then commit.
- **No partial commits:** each task ends with a green test run before committing.

---

## Task 1: Add `turn_log` table and drop `moves`

**Files:**
- Modify: `src/server/db.js`
- Modify: `test/db-schema.test.js`

- [ ] **Step 1: Update the schema test for the new shape**

Open `test/db-schema.test.js`. Replace the existing `'moves table has game_id and side columns; client_nonce unique per game'` test with these two tests:

```js
test('turn_log table exists with expected columns', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(turn_log)").all().map(c => c.name);
  for (const expected of ['id', 'game_id', 'turn_number', 'side', 'kind', 'summary', 'created_at']) {
    assert.ok(cols.includes(expected), `turn_log missing ${expected}`);
  }
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='turn_log_by_game'").get();
  assert.ok(idx, 'turn_log_by_game index missing');
});

test('legacy moves table is dropped', () => {
  const db = openDb(':memory:');
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='moves'").get();
  assert.equal(row, undefined, 'moves table should not exist after migration');
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='moves_nonce_per_game'").get();
  assert.equal(idx, undefined, 'moves_nonce_per_game index should be dropped');
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --test test/db-schema.test.js
```

Expected: two new failures (`turn_log` does not exist; `moves` table still exists).

- [ ] **Step 3: Add `turn_log` creation and drop `moves` in `openDb`**

In `src/server/db.js`, after the line `migrateStateShape(db);` and before `return db;` (i.e., last step inside `openDb`), insert:

```js
  // History log — single shared table across game types.
  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id     INTEGER NOT NULL REFERENCES games(id),
      turn_number INTEGER NOT NULL,
      side        TEXT NOT NULL CHECK (side IN ('a','b')),
      kind        TEXT NOT NULL,
      summary     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS turn_log_by_game ON turn_log(game_id, id);
  `);

  // Drop the dormant legacy moves table — never read or written by current code.
  db.exec('DROP INDEX IF EXISTS moves_nonce_per_game');
  db.exec('DROP TABLE IF EXISTS moves');
```

This sits *after* `migrateLegacy` and the post-schema work, so the legacy migration path that rebuilds `moves` still runs first on legacy DBs — then we drop it.

- [ ] **Step 4: Run all schema-related tests to confirm green**

```bash
node --test test/db-schema.test.js test/migrate.test.js test/migrate-state.test.js test/schema-state.test.js
```

Expected: all pass.

- [ ] **Step 5: Run the full test suite as a sanity check**

```bash
node --test 'test/**/*.test.js'
```

Expected: all pass. (If any unrelated suite touched `moves`, it must be updated; current grep shows none do.)

- [ ] **Step 6: Commit**

```bash
git add src/server/db.js test/db-schema.test.js
git commit -m "feat(db): add turn_log table; drop dormant moves table"
```

---

## Task 2: `history.js` — append and list

**Files:**
- Create: `src/server/history.js`
- Create: `test/history.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/history.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { appendTurnEntry, listTurnEntries } from '../src/server/history.js';

function setupDb() {
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f00', ?)").run(now);
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#0f0', ?)").run(now);
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
              VALUES (1, 1, 2, 'active', 'words', '{}', ?, ?)`).run(now, now);
  return db;
}

test('appendTurnEntry assigns turn_number 1 for the first row', () => {
  const db = setupDb();
  const row = appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['HI'], scoreDelta: 5 });
  assert.equal(row.turnNumber, 1);
  assert.equal(row.side, 'a');
  assert.equal(row.kind, 'play');
  assert.deepEqual(row.summary, { kind: 'play', words: ['HI'], scoreDelta: 5 });
  assert.equal(typeof row.createdAt, 'number');
  assert.ok(row.createdAt > 0);
});

test('appendTurnEntry increments turn_number per game', () => {
  const db = setupDb();
  appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['HI'], scoreDelta: 5 });
  const second = appendTurnEntry(db, 1, 'b', 'pass', { kind: 'pass' });
  assert.equal(second.turnNumber, 2);
});

test('listTurnEntries returns rows oldest-first', () => {
  const db = setupDb();
  appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['ONE'], scoreDelta: 3 });
  appendTurnEntry(db, 1, 'b', 'pass', { kind: 'pass' });
  appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['TWO'], scoreDelta: 4 });
  const entries = listTurnEntries(db, 1);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(e => e.turnNumber), [1, 2, 3]);
  assert.equal(entries[0].summary.words[0], 'ONE');
  assert.equal(entries[2].summary.words[0], 'TWO');
});

test('appendTurnEntry isolates turn_number across games', () => {
  const db = setupDb();
  const now = Date.now();
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
              VALUES (2, 1, 2, 'active', 'rummikub', '{}', ?, ?)`).run(now, now);
  appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['A'], scoreDelta: 1 });
  appendTurnEntry(db, 1, 'b', 'pass', { kind: 'pass' });
  const first2 = appendTurnEntry(db, 2, 'a', 'draw-tile', { kind: 'draw-tile' });
  assert.equal(first2.turnNumber, 1);
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --test test/history.test.js
```

Expected: import error — `history.js` does not exist.

- [ ] **Step 3: Implement `src/server/history.js`**

```js
// Generic helpers for the shared turn_log table. Plugins own the shape of
// `summary`; this module owns persistence and ordering.

export function appendTurnEntry(db, gameId, side, kind, summary) {
  const now = Date.now();
  const max = db.prepare(
    'SELECT COALESCE(MAX(turn_number), 0) AS m FROM turn_log WHERE game_id = ?'
  ).get(gameId).m;
  const turnNumber = max + 1;
  const info = db.prepare(`
    INSERT INTO turn_log (game_id, turn_number, side, kind, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(gameId, turnNumber, side, kind, JSON.stringify(summary), now);
  return {
    id: info.lastInsertRowid,
    gameId,
    turnNumber,
    side,
    kind,
    summary,
    createdAt: now,
  };
}

export function listTurnEntries(db, gameId) {
  const rows = db.prepare(`
    SELECT id, game_id AS gameId, turn_number AS turnNumber, side, kind, summary, created_at AS createdAt
    FROM turn_log WHERE game_id = ? ORDER BY id ASC
  `).all(gameId);
  return rows.map(r => ({ ...r, summary: JSON.parse(r.summary) }));
}
```

- [ ] **Step 4: Run the test and confirm green**

```bash
node --test test/history.test.js
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/history.js test/history.test.js
git commit -m "feat(server): turn_log persistence helpers"
```

---

## Task 3: Host writes `turn_log` and broadcasts `turn` event

**Files:**
- Modify: `src/server/routes.js`
- Modify: `test/action-route.test.js`

- [ ] **Step 1: Add a failing test for the `turn_log` write and `turn` broadcast**

Open `test/action-route.test.js`. Find the `setupApp` function. **Replace** the existing setup so the stub plugin returns a `summary`, and so we capture broadcast calls. Apply this diff in two places:

(a) Replace the `stubPlugin.applyAction` body with:

```js
  applyAction: ({ state, action, actorId }) => {
    if (action.type === 'inc') {
      return {
        state: { ...state, count: state.count + 1, activeUserId: actorId === 1 ? 2 : 1 },
        ended: false,
        summary: { kind: 'inc', count: state.count + 1 },
      };
    }
    if (action.type === 'finish') {
      return {
        state: { ...state, ended: true, endedReason: 'done', winnerSide: 'a' },
        ended: true,
        scoreDelta: { a: 5, b: 0 },
        summary: { kind: 'finish' },
      };
    }
    return { error: 'unknown action' };
  },
```

(b) Replace the `mountRoutes(...)` call in `setupApp` with:

```js
  const broadcasts = [];
  mountRoutes(app, { db, registry: { stub: stubPlugin }, sse: { broadcast: (gameId, event) => broadcasts.push({ gameId, event }) } });
  return { app, db, broadcasts };
```

(c) **Add** these new tests at the bottom of the file:

```js
test('action writes a turn_log row and broadcasts a turn event', async () => {
  const { app, db, broadcasts } = setupApp();
  const server = await startServer(app);
  try {
    const r = await call(server, 'POST', '/api/games/1/action', { type: 'inc' }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    const rows = db.prepare("SELECT * FROM turn_log WHERE game_id = 1 ORDER BY id").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].turn_number, 1);
    assert.equal(rows[0].side, 'a');
    assert.equal(rows[0].kind, 'inc');
    assert.deepEqual(JSON.parse(rows[0].summary), { kind: 'inc', count: 1 });

    const turnEvents = broadcasts.filter(b => b.event.type === 'turn');
    assert.equal(turnEvents.length, 1);
    assert.equal(turnEvents[0].event.payload.turnNumber, 1);
    assert.equal(turnEvents[0].event.payload.side, 'a');
    assert.deepEqual(turnEvents[0].event.payload.summary, { kind: 'inc', count: 1 });

    const updateEvents = broadcasts.filter(b => b.event.type === 'update');
    assert.equal(updateEvents.length, 1, 'update event still emitted');
  } finally { server.close(); }
});

test('ending action writes synthetic game-ended row after the action row', async () => {
  const { app, db, broadcasts } = setupApp();
  const server = await startServer(app);
  try {
    await call(server, 'POST', '/api/games/1/action', { type: 'finish' }, { 'x-test-user-id': '1' });
    const rows = db.prepare("SELECT * FROM turn_log WHERE game_id = 1 ORDER BY id").all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, 'finish');
    assert.equal(rows[1].kind, 'game-ended');
    assert.equal(rows[1].turn_number, 2);
    assert.equal(rows[1].side, 'a');
    assert.deepEqual(JSON.parse(rows[1].summary), { kind: 'game-ended', reason: 'done', winnerSide: 'a' });

    const turnEvents = broadcasts.filter(b => b.event.type === 'turn');
    assert.equal(turnEvents.length, 2);
    assert.equal(turnEvents[1].event.payload.summary.kind, 'game-ended');
  } finally { server.close(); }
});

```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --test test/action-route.test.js
```

Expected: the new tests fail (no `turn_log` rows being written, no `turn` event in broadcasts).

- [ ] **Step 3: Update `src/server/routes.js` to write rows and broadcast**

In `src/server/routes.js`, add an import at the top:

```js
import { appendTurnEntry, listTurnEntries } from './history.js';
```

Find the action handler (`app.post('/api/games/:gameId/action', ...)`), and in the `txn` transaction body (currently ends with `return { http: 200, body: ... }`), add `turn_log` writes inside the transaction and bubble the rows out:

Replace the transaction body with:

```js
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

      const turnRows = [];
      if (result.summary) {
        const actorSide = newState.sides?.a === req.user.id ? 'a'
                        : newState.sides?.b === req.user.id ? 'b'
                        : (req.game.state.sides?.a === req.user.id ? 'a' : 'b');
        turnRows.push(appendTurnEntry(db, req.game.id, actorSide, result.summary.kind, result.summary));
      }

      if (result.ended) {
        endGame(db, req.game.id, {
          endedReason: newState.endedReason ?? 'plugin',
          winnerSide: newState.winnerSide ?? null,
          finalState: newState,
        });
        // Synthetic game-ended row uses the actor's side (every end path is action-driven).
        const actorSide = newState.sides?.a === req.user.id ? 'a'
                        : newState.sides?.b === req.user.id ? 'b'
                        : (req.game.state.sides?.a === req.user.id ? 'a' : 'b');
        const endedSummary = {
          kind: 'game-ended',
          reason: newState.endedReason ?? 'plugin',
          winnerSide: newState.winnerSide ?? null,
        };
        turnRows.push(appendTurnEntry(db, req.game.id, actorSide, 'game-ended', endedSummary));
      }

      const view = plugin.publicView({ state: newState, viewerId: req.user.id });
      return {
        http: 200,
        body: { state: view, ended: !!result.ended, scoreDelta: result.scoreDelta ?? null },
        turnRows,
      };
    });

    const out = txn();
    if (out.http === 200) {
      sse.broadcast(req.game.id, { type: 'update' });
      for (const row of out.turnRows ?? []) {
        sse.broadcast(req.game.id, {
          type: 'turn',
          payload: {
            turnNumber: row.turnNumber,
            side: row.side,
            kind: row.kind,
            summary: row.summary,
            createdAt: row.createdAt,
          },
        });
      }
    }
    res.status(out.http).json(out.body);
```

(The duplicated `actorSide` derivation is intentional — each branch needs it independently; the second branch runs after `endGame`, which doesn't change `sides`, but keeping the derivation local makes the branches independent and readable.)

- [ ] **Step 4: Run the test to confirm green**

```bash
node --test test/action-route.test.js
```

Expected: all tests pass, including the two new ones.

- [ ] **Step 5: Run the full test suite to confirm no regression**

```bash
node --test 'test/**/*.test.js'
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.js test/action-route.test.js
git commit -m "feat(server): write turn_log rows and broadcast turn events"
```

---

## Task 4: `GET /api/games/:gameId/history` endpoint

**Files:**
- Modify: `src/server/routes.js`
- Modify: `test/action-route.test.js`

- [ ] **Step 1: Add a failing test**

Append to `test/action-route.test.js`:

```js
test('GET /api/games/:id/history returns entries oldest-first', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  try {
    await call(server, 'POST', '/api/games/1/action', { type: 'inc' }, { 'x-test-user-id': '1' });
    await call(server, 'POST', '/api/games/1/action', { type: 'inc' }, { 'x-test-user-id': '2' });
    const r = await call(server, 'GET', '/api/games/1/history', null, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.entries));
    assert.equal(r.body.entries.length, 2);
    assert.equal(r.body.entries[0].turnNumber, 1);
    assert.equal(r.body.entries[1].turnNumber, 2);
    assert.equal(r.body.entries[0].summary.kind, 'inc');
  } finally { server.close(); }
});

test('GET /api/games/:id/history rejects non-participants', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  try {
    const r = await call(server, 'GET', '/api/games/1/history', null, { 'x-test-user-id': '99' });
    assert.equal(r.status, 403);
  } finally { server.close(); }
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --test test/action-route.test.js
```

Expected: 404 on the `GET` route (not registered yet).

- [ ] **Step 3: Add the route to `src/server/routes.js`**

After the existing `app.get('/api/games/:gameId/state', ...)` route registration, insert:

```js
  app.get('/api/games/:gameId/history', requireIdentity, (req, res) => {
    const entries = listTurnEntries(db, req.game.id);
    res.json({ entries });
  });
```

The existing `:gameId` param middleware already enforces participant membership and game existence, so the route stays a one-liner.

- [ ] **Step 4: Run the test to confirm green**

```bash
node --test test/action-route.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.js test/action-route.test.js
git commit -m "feat(server): GET /api/games/:id/history endpoint"
```

---

## Task 5: Words actions return `summary`

**Files:**
- Modify: `plugins/words/server/actions.js`
- Modify: `test/words-plugin.test.js`

- [ ] **Step 1: Add failing tests for each action's `summary` shape**

Append to `test/words-plugin.test.js`:

```js
test('applyAction(move) returns summary with words and scoreDelta', () => {
  // Build a state where 'a' has the word 'CAT' on rack and an empty board.
  let state = wordsPlugin.initialState({ participants, rng });
  // Force a deterministic rack and turn for the test.
  state.racks.a = ['C', 'A', 'T', 'X', 'Y', 'Z', 'Q'];
  state.activeUserId = 1;
  state.initialMoveDone = false;
  // First-move placement must cross the center (board size is 15; center 7,7).
  const placement = [
    { r: 7, c: 7, letter: 'C' },
    { r: 7, c: 8, letter: 'A' },
    { r: 7, c: 9, letter: 'T' },
  ];
  const result = wordsPlugin.applyAction({
    state, action: { type: 'move', payload: { placement } }, actorId: 1, rng,
  });
  assert.equal(result.error, undefined, `unexpected error: ${result.error}`);
  assert.ok(result.summary, 'summary should be present');
  assert.equal(result.summary.kind, 'play');
  assert.ok(Array.isArray(result.summary.words));
  assert.ok(result.summary.words.includes('CAT'));
  assert.equal(typeof result.summary.scoreDelta, 'number');
  assert.ok(result.summary.scoreDelta > 0);
});

test('applyAction(pass) returns summary { kind: pass }', () => {
  let state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const result = wordsPlugin.applyAction({ state, action: { type: 'pass', payload: {} }, actorId: 1, rng });
  assert.deepEqual(result.summary, { kind: 'pass' });
});

test('applyAction(swap) returns summary { kind: swap, count }', () => {
  let state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const tiles = state.racks.a.slice(0, 2);
  const result = wordsPlugin.applyAction({
    state, action: { type: 'swap', payload: { tiles } }, actorId: 1, rng,
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.summary, { kind: 'swap', count: 2 });
});

test('applyAction(resign) returns summary { kind: resign }', () => {
  let state = wordsPlugin.initialState({ participants, rng });
  state.activeUserId = 1;
  const result = wordsPlugin.applyAction({ state, action: { type: 'resign', payload: {} }, actorId: 1, rng });
  assert.deepEqual(result.summary, { kind: 'resign' });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --test test/words-plugin.test.js
```

Expected: four failures (`summary` is undefined on every action).

- [ ] **Step 3: Update `plugins/words/server/actions.js`**

In `doMove`, change the final `return` to include `summary`:

```js
  const summary = {
    kind: 'play',
    words: allWords.map(w => w.text),
    scoreDelta,
  };
  return {
    state: next,
    ended: !!endReason,
    scoreDelta: { [side]: scoreDelta, [side === 'a' ? 'b' : 'a']: 0 },
    summary,
  };
```

In `doPass`, change the final `return` to:

```js
  return { state: next, ended: !!endReason, summary: { kind: 'pass' } };
```

In `doSwap`, change the final `return` to:

```js
  return { state: next, ended: !!endReason, summary: { kind: 'swap', count: tiles.length } };
```

In `doResign`, change the final `return` to:

```js
  return { state: next, ended: true, summary: { kind: 'resign' } };
```

- [ ] **Step 4: Run the tests to confirm green**

```bash
node --test test/words-plugin.test.js
```

Expected: all pass.

- [ ] **Step 5: Run the full suite**

```bash
node --test 'test/**/*.test.js'
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/words/server/actions.js test/words-plugin.test.js
git commit -m "feat(words): emit summary from each action"
```

---

## Task 6: Rummikub actions return `summary`

**Files:**
- Modify: `plugins/rummikub/server/actions.js`
- Modify: `test/rummikub-actions.test.js`

- [ ] **Step 1: Read existing setup helpers in the test file**

```bash
node -e "process.stdout.write(require('fs').readFileSync('test/rummikub-actions.test.js','utf8'))" | head -30
```

Note the existing `applyRummikubAction` import — we'll re-use it.

- [ ] **Step 2: Add failing tests for Rummikub `summary` shapes**

Append to `test/rummikub-actions.test.js`:

```js
import { setValue } from '../plugins/rummikub/server/sets.js';

test('commit-turn returns summary with meldPoints, tilesPlayed, openedInitialMeld', () => {
  // Build a state where the actor has an initial-meld-eligible group on rack.
  // Three 10s of distinct colors sum to 30 — meets the 30-point initial threshold.
  const tiles = [
    { id: 't1', kind: 'numbered', value: 10, color: 'red' },
    { id: 't2', kind: 'numbered', value: 10, color: 'blue' },
    { id: 't3', kind: 'numbered', value: 10, color: 'black' },
    { id: 't4', kind: 'numbered', value: 1, color: 'red' },
  ];
  const state = {
    sides: { a: 1, b: 2 },
    activeUserId: 1,
    racks: { a: tiles, b: [] },
    table: [],
    initialMeldComplete: { a: false, b: false },
    pool: [],
    consecutiveDraws: 0,
    scores: { a: 0, b: 0 },
    endedReason: null,
    winnerSide: null,
  };
  const proposed = {
    rack: [tiles[3]],
    table: [[tiles[0], tiles[1], tiles[2]]],
  };
  const result = applyRummikubAction({
    state,
    action: { type: 'commit-turn', payload: proposed },
    actorId: 1,
    rng: () => 0.5,
  });
  assert.equal(result.error, undefined, `unexpected: ${result.error}`);
  assert.equal(result.summary.kind, 'commit-turn');
  assert.equal(result.summary.meldPoints, 30);
  assert.equal(result.summary.tilesPlayed, 3);
  assert.equal(result.summary.openedInitialMeld, true);
});

test('draw-tile returns summary { kind: draw-tile }', () => {
  const state = {
    sides: { a: 1, b: 2 },
    activeUserId: 1,
    racks: { a: [], b: [] },
    table: [],
    initialMeldComplete: { a: false, b: false },
    pool: [{ id: 'p1', kind: 'numbered', value: 7, color: 'red' }],
    consecutiveDraws: 0,
    scores: { a: 0, b: 0 },
    endedReason: null,
    winnerSide: null,
  };
  const result = applyRummikubAction({
    state, action: { type: 'draw-tile', payload: {} }, actorId: 1, rng: () => 0.0,
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.summary, { kind: 'draw-tile' });
});

test('resign returns summary { kind: resign }', () => {
  const state = {
    sides: { a: 1, b: 2 },
    activeUserId: 1,
    racks: { a: [], b: [] },
    table: [],
    initialMeldComplete: { a: false, b: false },
    pool: [],
    consecutiveDraws: 0,
    scores: { a: 0, b: 0 },
    endedReason: null,
    winnerSide: null,
  };
  const result = applyRummikubAction({
    state, action: { type: 'resign', payload: {} }, actorId: 1, rng: () => 0,
  });
  assert.deepEqual(result.summary, { kind: 'resign' });
});
```

If the existing test file already imports `applyRummikubAction` and `assert`, leave those alone — only add the new `setValue` import and the three tests.

- [ ] **Step 3: Run the test to confirm it fails**

```bash
node --test test/rummikub-actions.test.js
```

Expected: three new failures (summary undefined).

- [ ] **Step 4: Update `plugins/rummikub/server/actions.js`**

Add an import at the top:

```js
import { setValue } from './sets.js';
```

In `doCommitTurn`, compute the summary right before each `return`:

After the `validateEndState` check passes and before computing `next`, capture the snapshot table for diffing. Actually, the cleanest way: compute the summary at the bottom and include it in both return paths.

Replace the body of `doCommitTurn` from after `validation.valid` check onward:

```js
  if (!validation.valid) return { error: validation.reason };

  const startKeys = new Set(state.table.map(s => s.map(t => t.id).sort().join(',')));
  let meldPoints = 0;
  for (const set of proposedTable) {
    const key = set.map(t => t.id).sort().join(',');
    if (!startKeys.has(key)) meldPoints += setValue(set);
  }
  const tilesPlayed = state.racks[actorSide].length - proposedRack.length;
  const openedInitialMeld =
    !state.initialMeldComplete[actorSide] && proposedRack !== state.racks[actorSide];
  const summary = {
    kind: 'commit-turn',
    meldPoints,
    tilesPlayed,
    openedInitialMeld,
  };

  const next = {
    ...state,
    racks: { ...state.racks, [actorSide]: proposedRack },
    table: proposedTable,
    initialMeldComplete: { ...state.initialMeldComplete, [actorSide]: true },
    activeUserId: oppUserId,
    consecutiveDraws: 0,
  };

  if (proposedRack.length === 0) {
    const final = computeFinalScores({ winnerSide: actorSide, racks: next.racks });
    return {
      state: {
        ...next,
        endedReason: 'rummikub',
        winnerSide: final.winnerSide,
        scores: addScores(state.scores, final.scoreDeltas),
      },
      ended: true,
      scoreDelta: final.scoreDeltas,
      summary,
    };
  }

  return { state: next, ended: false, summary };
```

In `doDrawTile`, add `summary: { kind: 'draw-tile' }` to both return objects:

```js
function doDrawTile(state, actorSide, oppUserId, rng) {
  if (state.pool.length === 0) {
    const final = computeFinalScores({ winnerSide: null, racks: state.racks });
    return {
      state: {
        ...state,
        endedReason: 'pool-exhausted',
        winnerSide: final.winnerSide,
        scores: addScores(state.scores, final.scoreDeltas),
      },
      ended: true,
      scoreDelta: final.scoreDeltas,
      summary: { kind: 'draw-tile' },
    };
  }
  const idx = Math.floor(rng() * state.pool.length);
  const drawn = state.pool[idx];
  const pool = [...state.pool.slice(0, idx), ...state.pool.slice(idx + 1)];
  const racks = { ...state.racks, [actorSide]: [...state.racks[actorSide], drawn] };
  return {
    state: {
      ...state,
      pool,
      racks,
      activeUserId: oppUserId,
      consecutiveDraws: state.consecutiveDraws + 1,
    },
    ended: false,
    summary: { kind: 'draw-tile' },
  };
}
```

In `doResign`:

```js
function doResign(state, actorSide) {
  const winner = actorSide === 'a' ? 'b' : 'a';
  return {
    state: { ...state, endedReason: 'resign', winnerSide: winner },
    ended: true,
    summary: { kind: 'resign' },
  };
}
```

- [ ] **Step 5: Run the tests to confirm green**

```bash
node --test test/rummikub-actions.test.js
```

Expected: all pass (existing tests + three new ones).

- [ ] **Step 6: Run the full suite**

```bash
node --test 'test/**/*.test.js'
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add plugins/rummikub/server/actions.js test/rummikub-actions.test.js
git commit -m "feat(rummikub): emit summary from each action"
```

---

## Task 7: Words client — history module + drawer DOM

**Files:**
- Create: `plugins/words/client/history.js`
- Modify: `plugins/words/client/index.html`
- Modify: `plugins/words/client/style.css`

This task is UI-only; the SSE wiring lives in Task 8. After this task, the drawer toggles open/empty.

- [ ] **Step 1: Inspect the current HTML to find the right insertion point**

```bash
node -e "process.stdout.write(require('fs').readFileSync('plugins/words/client/index.html','utf8'))"
```

Note the controls area where buttons like `#btn-recall`, `#btn-shuffle`, `#btn-submit` live, and the body element wrapping everything.

- [ ] **Step 2: Add the drawer scaffolding to `plugins/words/client/index.html`**

Inside `<body>`, just before the closing `</body>` (or at the end of the main game container — wherever overlays naturally sit), add:

```html
<aside id="history-drawer" class="history-drawer" hidden>
  <header class="history-drawer__header">
    <h2 class="history-drawer__title">History</h2>
    <button id="btn-history-close" type="button" class="history-drawer__close" aria-label="Close history">×</button>
  </header>
  <ol id="history-list" class="history-list" aria-live="polite"></ol>
</aside>
```

Then, add the open button into the existing controls row. Find the container that holds `#btn-recall` / `#btn-shuffle` / `#btn-submit` and insert after `#btn-submit`:

```html
<button id="btn-history" type="button" aria-label="Open history" aria-expanded="false">History</button>
```

- [ ] **Step 3: Add CSS to `plugins/words/client/style.css`**

Append:

```css
.history-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(360px, 90vw);
  background: var(--bg, #fff);
  color: var(--ink, #111);
  border-left: 1px solid rgba(0,0,0,0.15);
  box-shadow: -8px 0 24px rgba(0,0,0,0.18);
  transform: translateX(100%);
  transition: transform 200ms ease-out;
  display: flex;
  flex-direction: column;
  z-index: 50;
}
.history-drawer:not([hidden]).history-drawer--open {
  transform: translateX(0);
}
.history-drawer[hidden] { display: none; }
.history-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.1);
}
.history-drawer__title { margin: 0; font-size: 1rem; }
.history-drawer__close {
  background: transparent;
  border: 0;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}
.history-list {
  list-style: none;
  margin: 0;
  padding: 8px 0;
  overflow-y: auto;
  flex: 1;
}
.history-list li {
  padding: 8px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  font-size: 0.9rem;
}
.history-list li:first-child { background: rgba(255,235,0,0.18); }
```

- [ ] **Step 4: Create `plugins/words/client/history.js`**

```js
// History drawer for Words.
// - loadHistory()  : fetch /history once and replace the rendered list
// - appendEntry(e) : called by the SSE handler when a new turn arrives
// - openDrawer()/closeDrawer()/toggleDrawer()
// - formatEntry(e, names) : pure formatter, returns a string

import { gameUrl } from './state.js';

const entries = []; // newest first

export function formatEntry(entry, names) {
  const name = entry.side === 'a' ? names.a : names.b;
  const s = entry.summary ?? {};
  switch (entry.kind) {
    case 'play': {
      const words = (s.words ?? []).join(', ');
      return `${name} played ${words} for ${s.scoreDelta ?? 0}`;
    }
    case 'pass':
      return `${name} passed`;
    case 'swap':
      return `${name} swapped ${s.count ?? 0} tile${s.count === 1 ? '' : 's'}`;
    case 'resign':
      return `${name} resigned`;
    case 'game-ended': {
      const winner =
        s.winnerSide == null ? 'tie'
        : s.winnerSide === 'a' ? names.a
        : names.b;
      return `Game over — ${winner} (${s.reason ?? 'ended'})`;
    }
    default:
      return `${name} ${entry.kind}`;
  }
}

function render(getNames) {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.textContent = '';
  for (const e of entries) {
    const li = document.createElement('li');
    li.textContent = formatEntry(e, getNames());
    li.title = new Date(e.createdAt).toLocaleString();
    list.appendChild(li);
  }
}

export async function loadHistory(getNames) {
  const r = await fetch(gameUrl('history'));
  if (!r.ok) return;
  const body = await r.json();
  entries.length = 0;
  // wire format is oldest-first; we display newest-first
  for (const e of (body.entries ?? []).slice().reverse()) entries.push(e);
  render(getNames);
}

export function appendEntry(entry, getNames) {
  entries.unshift(entry);
  render(getNames);
}

export function openDrawer() {
  const el = document.getElementById('history-drawer');
  const btn = document.getElementById('btn-history');
  if (!el) return;
  el.hidden = false;
  // Force a layout flush so the transform transition runs from the off-screen state.
  void el.offsetWidth;
  el.classList.add('history-drawer--open');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

export function closeDrawer() {
  const el = document.getElementById('history-drawer');
  const btn = document.getElementById('btn-history');
  if (!el) return;
  el.classList.remove('history-drawer--open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  // Hide after transition so it's removed from the layout.
  setTimeout(() => { el.hidden = true; }, 220);
}

export function toggleDrawer() {
  const el = document.getElementById('history-drawer');
  if (!el) return;
  if (el.hidden || !el.classList.contains('history-drawer--open')) openDrawer();
  else closeDrawer();
}
```

Note: `gameUrl('history')` must produce `/api/games/<id>/history`. Verify by reading `plugins/words/client/state.js`:

```bash
grep -n "gameUrl" plugins/words/client/state.js
```

If `gameUrl` already does `/api/games/${id}/${suffix}`, no change needed. If not, fall back to building the URL inline using `window.__GAME__` (the route registration uses the same path pattern).

- [ ] **Step 5: Wire the button and initial load in `plugins/words/client/app.js`**

Add to the imports at the top:

```js
import { loadHistory, toggleDrawer, closeDrawer, appendEntry } from './history.js';
```

Define `historyNames` at module scope (place it near the other module-scope state like `selectedRackIdx` / `lastValidation`). It must be defined at module scope rather than inside `init()` because Task 8's SSE handler also calls it:

```js
function historyNames() {
  // ui.server.opponent.friendlyName always names the opponent regardless of side.
  // Map by side: when user is 'a', side 'a' is the user, side 'b' is the opponent.
  return ui.server.you === 'a'
    ? { a: ui.server.yourFriendlyName, b: ui.server.opponent.friendlyName }
    : { a: ui.server.opponent.friendlyName, b: ui.server.yourFriendlyName };
}
```

In `init()`, after `loadTentative()`, mount the buttons:

```js
  document.getElementById('btn-history').addEventListener('click', () => {
    toggleDrawer();
    loadHistory(historyNames);
  });
  document.getElementById('btn-history-close').addEventListener('click', closeDrawer);
```

- [ ] **Step 6: Manual smoke test**

```bash
node src/server/server.js &
SERVER=$!
sleep 1
echo "Open http://localhost:3000 in a browser, log in, open a Words game, click 'History'. Drawer should slide in (empty list)."
echo "Press Enter when done"
read
kill $SERVER 2>/dev/null
```

Expected: drawer opens (empty list — no SSE wiring yet); close button works.

- [ ] **Step 7: Commit**

```bash
git add plugins/words/client/history.js plugins/words/client/index.html plugins/words/client/style.css plugins/words/client/app.js
git commit -m "feat(words/client): history drawer scaffold"
```

---

## Task 8: Words client — fix SSE handlers and wire `turn`

**Files:**
- Modify: `plugins/words/client/app.js`

This task replaces the four event handlers that never fire (`move`/`pass`/`swap`/`resign`) with two that do (`update`, `turn`), restoring opponent-move live refresh and applause/callouts at the same time.

- [ ] **Step 1: Read the current `startSSE` to understand the existing handlers**

```bash
sed -n '343,381p' plugins/words/client/app.js
```

Note: each existing handler does some combination of `fetchState`, `refresh`, callout-by-kind, sound, and turn-transition chime.

- [ ] **Step 2: Replace `startSSE` with the new handlers**

In `plugins/words/client/app.js`, replace the entire `startSSE()` function with:

```js
function startSSE() {
  const es = new EventSource(gameUrl('events'));

  // Generic state-changed signal: refetch and re-render. This is what kept
  // opponent moves from updating the screen prior to this fix.
  es.addEventListener('update', async () => {
    const checkTurn = captureTurnTransition();
    await fetchState();
    if (ui.server?.racks?.[ui.server.you]) {
      ui.rackOrder = ui.server.racks[ui.server.you].slice();
    }
    refresh();
    checkTurn();
  });

  // Per-turn details: callouts, sounds, history append. Fired in addition to
  // the matching 'update' event by the server.
  es.addEventListener('turn', (e) => {
    let entry;
    try { entry = JSON.parse(e.data); } catch { return; }
    // entry has shape { turnNumber, side, kind, summary, createdAt }
    appendEntry(entry, historyNames);

    // Only react to the opponent's move with callouts/sounds.
    const isMine = entry.side === ui.server?.you;
    if (isMine) return;

    const s = entry.summary ?? {};
    if (entry.kind === 'play') {
      const oppName = ui.server?.opponent?.friendlyName ?? '';
      showMoveCallout({ by: entry.side, score: s.scoreDelta ?? 0, words: s.words ?? [], byName: oppName });
      playForScore(s.scoreDelta ?? 0);
    } else if (entry.kind === 'pass') {
      showPassCallout({ by: entry.side });
    } else if (entry.kind === 'swap') {
      showSwapCallout({ by: entry.side, count: s.count ?? 0 });
    }
    // 'resign' and 'game-ended' fall through to the 'update' handler's render
    // (which calls maybeOfferNewGame) — no callout needed.
  });

  es.onerror = () => { /* browser auto-reconnects */ };
}
```

`historyNames` is already defined at module scope (Task 7 Step 5) and `appendEntry` is already imported.

- [ ] **Step 3: Confirm the existing callout signatures match what we pass**

The handler now passes `{ by, score, words, byName }` to `showMoveCallout`. Check `callout.js` accepts these keys:

```bash
node -e "process.stdout.write(require('fs').readFileSync('plugins/words/client/callout.js','utf8'))"
```

If `showMoveCallout` reads different keys, adjust the object passed in the handler so it matches the existing API. Do **not** change `callout.js` itself unless the existing callout signature is fundamentally incompatible — the goal here is to restore previously-working behavior.

If `showMoveCallout` expects the player's friendly name under a key like `name` or `playerName` instead of `byName`, rename the field in the handler. Apply the same check to `showPassCallout` and `showSwapCallout`.

- [ ] **Step 4: Manual smoke test (two browsers)**

```bash
node src/server/server.js &
SERVER=$!
sleep 1
echo "Open the Words game as user A in one browser and user B in another."
echo "Have B make a move. Confirm:"
echo "  1. A's screen updates to show B's tiles (live refresh now works)."
echo "  2. A hears the score sound and sees the move callout."
echo "  3. A's history drawer (if open) shows the new entry at the top."
echo "  4. The 'your turn' chime plays for A."
echo "Press Enter when done."
read
kill $SERVER 2>/dev/null
```

Expected: all four behaviors fire. If any do not, capture the failing one and adjust the handler.

- [ ] **Step 5: Run the full test suite**

```bash
node --test 'test/**/*.test.js'
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/words/client/app.js
git commit -m "fix(words/client): replace dead SSE handlers with update + turn"
```

---

## Task 9: Rummikub client — history drawer

**Files:**
- Create: `plugins/rummikub/client/history.js`
- Modify: `plugins/rummikub/client/index.html`
- Modify: `plugins/rummikub/client/style.css`
- Modify: `plugins/rummikub/client/app.js`

- [ ] **Step 1: Add the drawer scaffolding to `plugins/rummikub/client/index.html`**

Inside `<body>`, before `</body>`, add:

```html
<aside id="history-drawer" class="history-drawer" hidden>
  <header class="history-drawer__header">
    <h2 class="history-drawer__title">History</h2>
    <button id="btn-history-close" type="button" class="history-drawer__close" aria-label="Close history">×</button>
  </header>
  <ol id="history-list" class="history-list" aria-live="polite"></ol>
</aside>
```

In the controls row that has `#btn-sort` / `#btn-reset` / `#btn-draw` / `#btn-end` / `#btn-resign`, add after `#btn-resign`:

```html
<button id="btn-history" type="button" aria-label="Open history" aria-expanded="false">History</button>
```

- [ ] **Step 2: Append the same drawer CSS to `plugins/rummikub/client/style.css`**

Use the exact same CSS block from Task 7, Step 3.

- [ ] **Step 3: Create `plugins/rummikub/client/history.js`**

```js
// History drawer for Rummikub. Same shape as the Words counterpart but with a
// game-specific format function.

const entries = []; // newest first

export function formatEntry(entry, names) {
  const name = entry.side === 'a' ? names.a : names.b;
  const s = entry.summary ?? {};
  switch (entry.kind) {
    case 'commit-turn': {
      if ((s.tilesPlayed ?? 0) === 0) {
        return `${name} rearranged the table`;
      }
      const tilesWord = s.tilesPlayed === 1 ? 'tile' : 'tiles';
      const base = `${name} played ${s.tilesPlayed} ${tilesWord} (+${s.meldPoints ?? 0})`;
      return s.openedInitialMeld ? `${base} — opened initial meld` : base;
    }
    case 'draw-tile':
      return `${name} drew a tile`;
    case 'resign':
      return `${name} resigned`;
    case 'game-ended': {
      const winner =
        s.winnerSide == null ? 'no winner'
        : s.winnerSide === 'a' ? names.a
        : names.b;
      return `Game over — ${winner} (${s.reason ?? 'ended'})`;
    }
    default:
      return `${name} ${entry.kind}`;
  }
}

function render(getNames) {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.textContent = '';
  for (const e of entries) {
    const li = document.createElement('li');
    li.textContent = formatEntry(e, getNames());
    li.title = new Date(e.createdAt).toLocaleString();
    list.appendChild(li);
  }
}

export async function loadHistory(getNames) {
  const ctx = window.__GAME__;
  if (!ctx) return;
  const url = ctx.historyUrl ?? `/api/games/${ctx.gameId}/history`;
  const r = await fetch(url);
  if (!r.ok) return;
  const body = await r.json();
  entries.length = 0;
  for (const e of (body.entries ?? []).slice().reverse()) entries.push(e);
  render(getNames);
}

export function appendEntry(entry, getNames) {
  entries.unshift(entry);
  render(getNames);
}

export function openDrawer() {
  const el = document.getElementById('history-drawer');
  const btn = document.getElementById('btn-history');
  if (!el) return;
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('history-drawer--open');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

export function closeDrawer() {
  const el = document.getElementById('history-drawer');
  const btn = document.getElementById('btn-history');
  if (!el) return;
  el.classList.remove('history-drawer--open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  setTimeout(() => { el.hidden = true; }, 220);
}

export function toggleDrawer() {
  const el = document.getElementById('history-drawer');
  if (!el) return;
  if (el.hidden || !el.classList.contains('history-drawer--open')) openDrawer();
  else closeDrawer();
}
```

`window.__GAME__.historyUrl` may not exist yet — the fallback `/api/games/${gameId}/history` covers that. Verify the server's plugin-client HTML rendering injects a `gameId` field on `__GAME__`:

```bash
grep -n "__GAME__\|window\.__GAME__" plugins/rummikub/client/app.js src/server/plugin-clients.js | head -20
```

If the existing context object uses a different property name for the id (e.g., `id`), substitute it in the fallback line.

- [ ] **Step 4: Wire the drawer into `plugins/rummikub/client/app.js`**

Add to the imports at the top:

```js
import { loadHistory, toggleDrawer, closeDrawer, appendEntry } from './history.js';
```

The injected `window.__GAME__` for Rummikub carries only `gameId`, `userId`, `gameType`, `sseUrl`, `actionUrl`, `stateUrl` (verified in `src/server/plugin-clients.js`). Friendly names are not available client-side without an extra fetch, so this drawer uses simple "You" / "Opponent" labels — sufficient for a 2-player game.

Add a `historyNames` helper near the top of the file (after `let state = null;`):

```js
function historyNames() {
  const myUserId = ctx.userId;
  const mySide = state?.sides?.a === myUserId ? 'a' : 'b';
  return mySide === 'a' ? { a: 'You', b: 'Opponent' } : { a: 'Opponent', b: 'You' };
}
```

In `openSSE()`, add a `turn` listener:

```js
function openSSE() {
  const es = new EventSource(ctx.sseUrl);
  es.addEventListener('update', () => fetchState());
  es.addEventListener('ended', () => fetchState());
  es.addEventListener('turn', (e) => {
    let entry;
    try { entry = JSON.parse(e.data); } catch { return; }
    appendEntry(entry, historyNames);
  });
  es.onerror = () => {/* let browser auto-reconnect */};
}
```

After the existing `setupThemeToggle()` / `setupFontToggle()` calls, mount the buttons:

```js
document.getElementById('btn-history').addEventListener('click', () => {
  toggleDrawer();
  loadHistory(historyNames);
});
document.getElementById('btn-history-close').addEventListener('click', closeDrawer);
```

- [ ] **Step 5: Manual smoke test**

```bash
node src/server/server.js &
SERVER=$!
sleep 1
echo "Open a Rummikub game in two browsers (A and B)."
echo "Have A play a turn (commit or draw). Confirm:"
echo "  1. The new entry appears at the top of A's history drawer when opened."
echo "  2. B sees the new entry live (without reload) when B's drawer is open."
echo "Press Enter when done."
read
kill $SERVER 2>/dev/null
```

Expected: live history updates.

- [ ] **Step 6: Run the full test suite**

```bash
node --test 'test/**/*.test.js'
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add plugins/rummikub/client/history.js plugins/rummikub/client/index.html plugins/rummikub/client/style.css plugins/rummikub/client/app.js
git commit -m "feat(rummikub/client): history drawer + turn SSE handler"
```

---

## Task 10: End-to-end verification

**Files:**
- Modify: `test/e2e-words.test.js`
- Modify: `test/e2e-rummikub.test.js`

- [ ] **Step 1: Read each e2e file to understand the existing pattern**

```bash
node -e "process.stdout.write(require('fs').readFileSync('test/e2e-words.test.js','utf8'))" | head -60
node -e "process.stdout.write(require('fs').readFileSync('test/e2e-rummikub.test.js','utf8'))" | head -60
```

Each e2e walks through a multi-action sequence. We will append a small assertion to confirm history is being written.

- [ ] **Step 2: Append a history check to `test/e2e-words.test.js`**

Find the test that drives at least one `move` action through to completion. After the final assertion in that test (still inside the `try` block before `server.close()`), insert:

```js
    // History was written for each turn taken.
    const hist = await call(server, 'GET', `/api/games/${gameId}/history`, null, headersFor(userIdA));
    assert.equal(hist.status, 200);
    assert.ok(hist.body.entries.length > 0, 'expected at least one history entry');
    assert.ok(['play','pass','swap','resign','game-ended'].includes(hist.body.entries[0].summary.kind));
```

(Substitute `gameId`, `userIdA`, `headersFor` with whatever names that file already uses; the assertion is the only essential part.)

- [ ] **Step 3: Same for `test/e2e-rummikub.test.js`**

```js
    const hist = await call(server, 'GET', `/api/games/${gameId}/history`, null, headersFor(userIdA));
    assert.equal(hist.status, 200);
    assert.ok(hist.body.entries.length > 0, 'expected at least one history entry');
    assert.ok(['commit-turn','draw-tile','resign','game-ended'].includes(hist.body.entries[0].summary.kind));
```

- [ ] **Step 4: Run the e2e suite**

```bash
node --test test/e2e-words.test.js test/e2e-rummikub.test.js
```

Expected: pass.

- [ ] **Step 5: Run the full suite**

```bash
node --test 'test/**/*.test.js'
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add test/e2e-words.test.js test/e2e-rummikub.test.js
git commit -m "test(e2e): assert history is recorded during full game flow"
```

---

## Done

After Task 10, the feature is complete:

- Both games persist a per-turn log to `turn_log`.
- Both clients fetch and live-update a history drawer.
- The Words client's broken SSE handlers are replaced with working `update` + `turn` listeners (live opponent refresh restored, applause/callouts restored).
- The dormant `moves` table is gone.
- All existing tests pass; new tests cover the schema, the history module, the host wiring, the per-game `summary` shapes, and end-to-end flow.
