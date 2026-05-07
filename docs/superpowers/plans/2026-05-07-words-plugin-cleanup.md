# Words-as-plugin cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the words-only legacy `/api/games/:gameId/state` route and the words-shape projection in `rowToGame`, so `words` consumes the same generic API as `backgammon`/`rummikub`.

**Architecture:** Move viewer-identity composition (`you`, `opponent`, `currentTurn`) into the words client; have it consume the generic `GET /api/games/:id` (which returns `publicView`) plus `/api/me` and `/api/users`. Then collapse `rowToGame` to a generic shape and switch `/api/me` to read scores directly from `state.scores`. No DB migration; legacy DB columns are already auto-dropped at startup by `migrateLegacyState`.

**Tech Stack:** Node.js (`node --test`), Express, better-sqlite3, vanilla ES-module browser client.

**Spec:** `docs/superpowers/specs/2026-05-07-words-plugin-cleanup-design.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `plugins/words/client/state.js` | Words client view-model fetcher; composes `ui.server` from generic endpoints | Modify (rewrite `fetchState`, add module-scope caches) |
| `src/server/routes.js` | Express route registration | Modify (delete legacy state route; switch `/api/me` scores derivation) |
| `src/server/games.js` | `rowToGame` and game CRUD helpers | Modify (slim `rowToGame` projection) |
| `test/routes-game.test.js` | Tests for per-game routes | Modify (drop the 3 legacy-state tests at lines 40-66) |
| `test/routes-top.test.js` | Tests for top-level routes incl. `/api/me` | Modify (add a non-default-score `/api/me` test before refactoring `/api/me`) |

No new files. No schema/migration changes.

---

## Task 1: Switch words client to consume the generic API

**Files:**
- Modify: `plugins/words/client/state.js`

**Why no automated test:** The codebase has no harness for the words client's `state.js` module (only pure utilities like `drag.js` are unit-tested in `test/drag.test.js`). End-to-end coverage for the generic `GET /api/games/:id` route already lives in `test/e2e-words.test.js:39` and runs against the same payload the new composer will read.

- [ ] **Step 1: Read the current file** so the rewrite preserves all existing behavior (gameId init, tentative-move localStorage, gameUrl helper).

Run: `cat plugins/words/client/state.js`

- [ ] **Step 2: Replace `fetchState` and add caches**

Edit `plugins/words/client/state.js`. Keep `ui`, `initGameId`, `loadTentative`, `saveTentative`, `clearTentative`, and `gameUrl` exactly as-is. Replace `fetchState` and add the module-scope caches above it. Final file:

```javascript
export const ui = {
  server: null,
  tentative: [],
  rackOrder: null,
  gameId: null
};

export function initGameId() {
  if (typeof window !== 'undefined' && window.__GAME__?.gameId) {
    ui.gameId = window.__GAME__.gameId;
    return;
  }
  // Legacy fallback (only if served the old way; should not happen in production)
  const m = location.pathname.match(/^\/play\/words\/(\d+)/) || location.pathname.match(/^\/game\/(\d+)/);
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

let _mePromise = null;
let _usersPromise = null;

function fetchMe() {
  _mePromise ??= fetch('/api/me').then(r => {
    if (!r.ok) throw new Error(`/api/me: ${r.status}`);
    return r.json();
  });
  return _mePromise;
}

function fetchUsersById() {
  _usersPromise ??= fetch('/api/users').then(r => {
    if (!r.ok) throw new Error(`/api/users: ${r.status}`);
    return r.json();
  }).then(arr => {
    const byId = new Map();
    for (const u of arr) byId.set(u.id, u);
    return byId;
  });
  return _usersPromise;
}

export async function fetchState() {
  const r = await fetch(`/api/games/${ui.gameId}`);
  if (r.status === 403) {
    const body = await r.json().catch(() => ({}));
    location.href = `/lockout?email=${encodeURIComponent(body.email || '')}`;
    return null;
  }
  if (r.status === 404) { location.href = '/'; return null; }
  if (!r.ok) throw new Error('state-fetch-failed');
  const payload = await r.json();
  const [meRes, usersById] = await Promise.all([fetchMe(), fetchUsersById()]);
  const me = meRes.user;
  const state = payload.state;
  const you = state.sides?.a === me.id ? 'a' : (state.sides?.b === me.id ? 'b' : null);
  const otherId = payload.playerAId === me.id ? payload.playerBId : payload.playerAId;
  const opp = usersById.get(otherId) ?? { friendlyName: '', color: '' };
  const currentTurn = state.sides?.a === state.activeUserId ? 'a'
                    : state.sides?.b === state.activeUserId ? 'b' : null;
  ui.server = {
    gameId: payload.id,
    you,
    opponent: { friendlyName: opp.friendlyName, color: opp.color },
    yourFriendlyName: me.friendlyName,
    yourColor: me.color,
    status: payload.status,
    currentTurn,
    board: state.board,
    bag: state.bag,
    racks: state.racks,
    scores: state.scores,
    consecutiveScorelessTurns: state.consecutiveScorelessTurns,
    endedReason: state.endedReason,
    winner: state.winnerSide,
    sides: state.sides,
    variant: state.variant,
  };
  if (!ui.rackOrder) ui.rackOrder = ui.server.racks[ui.server.you].slice();
  return ui.server;
}

export function gameUrl(suffix) {
  return `/api/games/${ui.gameId}/${suffix}`;
}
```

Notes for the implementer:
- `state.bag` from `wordsPublicView` is `{ count: N }`, not the raw array — but the *viewer's* rack array is full (`state.racks[viewerSide]`). The opponent's rack is reported as `state.opponentRack = { count: N }`. Inspect downstream callers in `plugins/words/client/` to confirm none read `ui.server.bag.length` (they should read `ui.server.bag.count`). If they do read `.length`, the publicView already provides `state.bag.count`; pass that through and update the readers to use `.count`. Capture any such consumer changes inside this same task.

- [ ] **Step 3: Audit consumers for the `bag` shape change**

Run: `grep -rn "ui\.server\.bag\|server\.bag" plugins/words/client/`

If any caller does `ui.server.bag.length`, change it to `ui.server.bag.count` in the same edit pass.

- [ ] **Step 4: Run full test suite to confirm nothing server-side broke**

Run: `npm test`
Expected: PASS for all current tests (this task only touches the words client; existing tests still rely on the legacy route which is still mounted).

- [ ] **Step 5: Manual smoke**

In one terminal: `npm start`
In a browser, open `http://localhost:<port>/` (your local server's port; check the server.js startup banner). Sign in, open an active words game from the lobby. Verify:
- Board renders with existing tiles.
- Your rack shows your tiles, opponent's rack shows just a count.
- Your name + color and opponent's name + color render on the scoreboard.
- Validate (drag a word, click validate) returns word feedback.
- Submit a turn — board updates, turn flips.
- Refresh mid-game — state hydrates correctly.

- [ ] **Step 6: Commit**

```bash
git add plugins/words/client/state.js
git commit -m "refactor(words/client): consume generic /api/games/:id endpoint

Compose ui.server from /api/games/:id (publicView) + /api/me +
/api/users instead of the words-only /api/games/:id/state endpoint.
The legacy route is still mounted; this is the first step of a
deploy-safe sequence."
```

---

## Task 2: Delete the legacy `/api/games/:gameId/state` route

**Files:**
- Modify: `src/server/routes.js` (remove lines 130-156)
- Modify: `test/routes-game.test.js` (remove the 3 legacy-state tests at lines 40-66)

- [ ] **Step 1: Delete the three legacy-route tests first**

Edit `test/routes-game.test.js` to remove lines 40-66 inclusive (the three tests beginning `test('GET /api/games/:id/state ...')`). Also remove the now-unused `getGameById` import only if no remaining test uses it; check first:

Run: `grep -n getGameById test/routes-game.test.js`

If `getGameById` is still referenced (it is — line 82 in the pass-action test), leave the import.

- [ ] **Step 2: Run the test file to confirm it still compiles and the remaining tests pass**

Run: `node --test test/routes-game.test.js`
Expected: Two tests pass (the action handler tests at lines 68-99). No reference to the deleted route.

- [ ] **Step 3: Delete the legacy state route from `src/server/routes.js`**

Remove lines 130-156 (the `// Legacy Words-shape state endpoint` comment block and the entire `app.get('/api/games/:gameId/state', ...)` handler).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: All tests PASS. No test should now reference `/api/games/:id/state`. Confirm with:

Run: `grep -rn "api/games/.*state" test/`
Expected: empty output.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.js test/routes-game.test.js
git commit -m "refactor(server): drop legacy /api/games/:id/state route

Words client now reads the generic /api/games/:id endpoint and composes
viewer identity client-side. No remaining consumers of the old route."
```

---

## Task 3: Switch `/api/me` to read scores from `state.scores`

**Files:**
- Modify: `test/routes-top.test.js` (add a regression test before changing the implementation)
- Modify: `src/server/routes.js` (`/api/me` handler at lines 25-47)

- [ ] **Step 1: Write a failing-style regression test**

Append to `test/routes-top.test.js`. This test creates a words game with non-default scores in state JSON and asserts `/api/me` reports them. It will pass today (because `rowToGame` projects `state.scores` into `g.scoreA/scoreB`), but after Task 4 slims `rowToGame` it would silently regress without this test.

```javascript
test('GET /api/me derives yourScore/theirScore from state.scores', async () => {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const aId = Math.min(a.id, b.id);
  const bId = Math.max(a.id, b.id);
  const state = {
    bag: [], board: [], racks: { a: [], b: [] },
    scores: { a: 42, b: 7 },
    sides: { a: aId, b: bId },
    activeUserId: aId,
    consecutiveScorelessTurns: 0,
    initialMoveDone: true,
    endedReason: null,
    winnerSide: null,
  };
  const now = Date.now();
  db.prepare(`INSERT INTO games
    (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'words', ?, ?, ?)`)
    .run(aId, bId, JSON.stringify(state), now, now);

  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/me`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.games.length, 1);
  assert.equal(body.games[0].yourScore, 42);
  assert.equal(body.games[0].theirScore, 7);
  server.close();
});
```

- [ ] **Step 2: Run the new test to confirm it passes against current code**

Run: `node --test test/routes-top.test.js`
Expected: PASS (including the new test).

- [ ] **Step 3: Refactor `/api/me` to read `state.scores` directly**

Edit `src/server/routes.js` lines 25-47. Replace the `g.scoreA`/`g.scoreB` references:

```javascript
  app.get('/api/me', requireIdentity, (req, res) => {
    const games = listGamesForUser(db, req.user.id).map(g => {
      const otherId = g.playerAId === req.user.id ? g.playerBId : g.playerAId;
      const other = getUserById(db, otherId);
      const you = sideForUser(g, req.user.id);
      const scoreA = g.state?.scores?.a ?? 0;
      const scoreB = g.state?.scores?.b ?? 0;
      const yourScore = you === 'a' ? scoreA : scoreB;
      const theirScore = you === 'a' ? scoreB : scoreA;
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
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: All tests PASS, including the new `/api/me` derivation test.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.js test/routes-top.test.js
git commit -m "refactor(server): /api/me reads scores from state.scores

Decouples the lobby endpoint from the words-shape projection on
rowToGame, so it works for any plugin whose state JSON carries
{ scores: { a, b } }."
```

---

## Task 4: Slim `rowToGame` to a generic shape

**Files:**
- Modify: `src/server/games.js` (`rowToGame` function at lines 1-29)

- [ ] **Step 1: Replace `rowToGame`**

Edit `src/server/games.js`. Replace the function body (lines 1-29) with the generic version:

```javascript
function rowToGame(row) {
  if (!row) return null;
  const state = JSON.parse(row.state);
  // Map activeUserId → 'a'/'b' for backwards-compat consumers (lobby, /me, SSE clients)
  const currentTurn =
    state.sides?.a === state.activeUserId ? 'a' :
    state.sides?.b === state.activeUserId ? 'b' :
    state.activeSide ?? null;  // fallback for not-yet-migrated rows
  return {
    id: row.id,
    playerAId: row.player_a_id,
    playerBId: row.player_b_id,
    status: row.status,
    gameType: row.game_type,
    state,
    currentTurn,
    endedReason: row.ended_reason,
    winnerSide: row.winner_side,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

What was removed: the `bag`, `board`, `rackA`, `rackB`, `scoreA`, `scoreB`, `consecutiveScorelessTurns` fields that projected pieces of `state` JSON onto the row object. Audit confirmed (`grep -rn "scoreA|scoreB|rackA|rackB|\.bag\b|\.board\b|consecutiveScorelessTurns" src/` after Task 3) that no remaining server caller reads these.

- [ ] **Step 2: Sanity-grep for stragglers**

Run: `grep -rn "g\.scoreA\|g\.scoreB\|g\.rackA\|g\.rackB\|g\.bag\b\|g\.board\b\|g\.consecutiveScorelessTurns" src/`
Expected: empty output.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: All tests PASS. Pay attention to `test/games.test.js`, `test/routes-top.test.js`, `test/routes-game.test.js`, `test/e2e-words.test.js`, `test/sse.test.js`, `test/lobby.test.js` — these are the most likely to surface a missed consumer.

If a test fails, the error will name the specific field; either fix the consumer in `src/server/` or, if the consumer is a test asserting on the projection itself, update the assertion to read from `g.state.scores.a` etc.

- [ ] **Step 4: Commit**

```bash
git add src/server/games.js
git commit -m "refactor(server): slim rowToGame to a generic shape

Drop the words-shape projection (bag, board, rackA, rackB, scoreA,
scoreB, consecutiveScorelessTurns) from every game row. State JSON
remains the single source of truth."
```

---

## Task 5: Final verification + manual smoke

**Files:** none.

- [ ] **Step 1: Run the full suite one more time**

Run: `npm test`
Expected: All PASS.

- [ ] **Step 2: Confirm no remaining references to the removed surface**

Run:
```
grep -rn "api/games/.*state\b" src/ plugins/ public/ test/
grep -rn "g\.scoreA\|g\.scoreB\|g\.rackA\|g\.rackB\|g\.bag\b\|g\.board\b\|g\.consecutiveScorelessTurns" src/ plugins/ public/
```
Expected: both produce no output (the legacy route is gone; the words-shape row projection is gone).

- [ ] **Step 3: Manual smoke (browser, against `npm start`)**

Run: `npm start`
Then in a browser at the printed port:
1. Lobby — score badges render correctly for each active game (words / backgammon / rummikub if you have all three).
2. Open a words game — board, rack, scoreboard (your name+color, opponent name+color), turn indicator render correctly.
3. Validate a placement (auxRoute) — word feedback shows.
4. Submit a turn — state updates and SSE broadcasts pick up.
5. Refresh mid-game — state rehydrates correctly.
6. End-of-game banner shows the winner.
7. Open a backgammon and a rummikub game — confirm their lobby scores still display correctly (regression check on the `/api/me` change).

- [ ] **Step 4: No final commit unless smoke surfaced a fix.**

If the smoke surfaced a real bug, treat it as a follow-up task (write the failing case, fix, commit). Do not rush a fix to "complete" the plan.

---

## Self-Review

Spec coverage:
- Spec §1a (retire `/api/games/:gameId/state`) → Tasks 1 + 2.
- Spec §1b (collapse `rowToGame`) → Tasks 3 + 4.
- Spec "no schema migration" non-goal → respected; no migration code in any task.
- Spec sequencing list (5 ordered steps) → Tasks 1, 2, 3, 4, 5 map directly.
- Spec test surface — Task 3 adds the `/api/me` regression test; Task 1 leaves coverage of the publicView shape to the existing `e2e-words.test.js` (which already runs against `/api/games/:id`); Task 2 deletes the legacy-route tests.

Placeholder scan: no TBD/TODO/"add appropriate" — all code blocks are concrete.

Type consistency: `ui.server` shape across Task 1 matches what existing client modules read (verified by leaving every field-name from the deleted endpoint intact). `rowToGame`'s remaining fields in Task 4 (`endedReason`, `winnerSide`, `currentTurn`, etc.) match the field names used by `/api/me` in Task 3.

One known consumer-shape risk flagged inline in Task 1 Step 2: `state.bag` from `wordsPublicView` is `{ count }` not an array, so any client caller reading `ui.server.bag.length` must switch to `ui.server.bag.count`. Task 1 Step 3 makes the implementer audit this and fix in the same commit.
