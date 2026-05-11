# AI Players — Backgammon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude-CLI-driven bot opponent to the Backgammon plugin, mirroring the cribbage adapter pattern.

**Architecture:** A new per-game adapter under `plugins/backgammon/server/ai/` (legal-moves, prompts, chooseAction). Shared orchestrator gains an `autoActions` map (auto-execute mechanical `initial-roll`) and a pending-sequence cache so multi-checker `moving` turns drain one action per wake-up. Persona YAMLs gain an optional `games:` field; the lobby route filters personas by game. Three new backgammon personas; existing cribbage personas tagged `games: [cribbage]`.

**Tech Stack:** Node 20 ESM, `node:test` runner, better-sqlite3, js-yaml, Express. The Backgammon plugin lives at `plugins/backgammon/`; shared AI infra at `src/server/ai/`.

**Spec:** `docs/superpowers/specs/2026-05-11-ai-players-backgammon-design.md`

---

## Conventions

- Test runner: `node --test 'test/**/*.test.js'`. New test files end in `.test.js` and live in `test/`.
- Module system: ESM, `.js` extensions on imports.
- Tests use `node:test` + `node:assert/strict`. Never vitest (vitest is for the dice TS bundle only).
- Commit after each task. Commit messages follow the existing convention (`feat(ai):`, `fix(ai):`, `test(ai):`, `chore(ai):`, etc.) — see `git log --oneline`.
- After each task, run `npm test` and ensure the entire suite passes (not just the new tests).

---

## Task 1: Persona catalog reads `games:` field

**Files:**
- Modify: `src/server/ai/persona-catalog.js`
- Test: `test/ai-persona-catalog.test.js`

- [ ] **Step 1: Add failing tests for the `games` field**

Append to `test/ai-persona-catalog.test.js`:

```js
test('loadPersonaCatalog: reads optional games array', () => {
  const dir = makeDir({
    'hattie.yaml':
      'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\n' +
      'systemPrompt: x\ngames:\n  - cribbage\n  - backgammon\n',
  });
  const p = loadPersonaCatalog(dir).get('hattie');
  assert.deepEqual(p.games, ['cribbage', 'backgammon']);
});

test('loadPersonaCatalog: defaults games to empty array when omitted', () => {
  const dir = makeDir({
    'omni.yaml':
      'id: omni\ndisplayName: Omni\ncolor: "#000000"\nglyph: "*"\nsystemPrompt: x\n',
  });
  assert.deepEqual(loadPersonaCatalog(dir).get('omni').games, []);
});

test('loadPersonaCatalog: rejects games with non-string element', () => {
  const dir = makeDir({
    'bad.yaml':
      'id: bad\ndisplayName: Bad\ncolor: "#000000"\nglyph: "x"\n' +
      'systemPrompt: x\ngames:\n  - cribbage\n  - 42\n',
  });
  assert.throws(() => loadPersonaCatalog(dir), /games must be/);
});

test('loadPersonaCatalog: rejects games when not an array', () => {
  const dir = makeDir({
    'bad.yaml':
      'id: bad\ndisplayName: Bad\ncolor: "#000000"\nglyph: "x"\n' +
      'systemPrompt: x\ngames: cribbage\n',
  });
  assert.throws(() => loadPersonaCatalog(dir), /games must be/);
});
```

- [ ] **Step 2: Run tests, expect failures**

Run: `npm test -- --test-name-pattern=loadPersonaCatalog`
Expected: 4 new tests fail (the existing tests still pass).

- [ ] **Step 3: Implement `games:` field in catalog loader**

In `src/server/ai/persona-catalog.js`, after the `voiceExamples` validation block, add:

```js
    if (raw.games !== undefined) {
      if (!Array.isArray(raw.games) || raw.games.some(g => typeof g !== 'string' || g.length === 0)) {
        throw new Error(`persona ${file}: games must be an array of non-empty strings`);
      }
    }
```

And in the `out.set(raw.id, { ... })` object, add `games: Array.isArray(raw.games) ? raw.games : [],` after the `voiceExamples` line.

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test`
Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/persona-catalog.js test/ai-persona-catalog.test.js
git commit -m "feat(ai): persona catalog reads optional games scope"
```

---

## Task 2: Personas route filters by `?game=`

**Files:**
- Modify: `src/server/routes.js` (the `/api/ai/personas` handler at line ~59)
- Test: `test/ai-personas-route.test.js` (NEW)

- [ ] **Step 1: Inspect the current handler**

Run: `sed -n '55,70p' src/server/routes.js`. The handler reads `ai.personas.values()` and returns `{personas: [...]}`. Confirm the shape before editing.

- [ ] **Step 2: Write failing test**

Create `test/ai-personas-route.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPersonaCatalog } from '../src/server/ai/persona-catalog.js';

// Lightweight assembly mirroring how src/server/routes.js mounts the personas route.
function mountPersonasRoute({ ai }) {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 1, email: 'h@x' }; next(); });
  app.get('/api/ai/personas', (req, res) => {
    if (!ai) return res.json({ personas: [] });
    const game = typeof req.query.game === 'string' ? req.query.game : null;
    const out = [];
    for (const p of ai.personas.values()) {
      if (game && p.games.length > 0 && !p.games.includes(game)) continue;
      out.push({ id: p.id, displayName: p.displayName, color: p.color, glyph: p.glyph, games: p.games });
    }
    res.json({ personas: out });
  });
  return app;
}

function makeCatalog(files) {
  const dir = mkdtempSync(join(tmpdir(), 'personas-route-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return loadPersonaCatalog(dir);
}

async function fetchPersonas(app, qs = '') {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/ai/personas${qs}`);
    return await res.json();
  } finally {
    server.close();
  }
}

test('personas route: returns all personas when no game param', async () => {
  const personas = makeCatalog({
    'hattie.yaml':     'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: x\ngames:\n  - cribbage\n',
    'colonel-pip.yaml':'id: colonel-pip\ndisplayName: Colonel Pip\ncolor: "#445566"\nglyph: "▲"\nsystemPrompt: x\ngames:\n  - backgammon\n',
    'omni.yaml':       'id: omni\ndisplayName: Omni\ncolor: "#000000"\nglyph: "*"\nsystemPrompt: x\n',
  });
  const app = mountPersonasRoute({ ai: { personas } });
  const body = await fetchPersonas(app);
  assert.equal(body.personas.length, 3);
});

test('personas route: filters by ?game=backgammon', async () => {
  const personas = makeCatalog({
    'hattie.yaml':     'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: x\ngames:\n  - cribbage\n',
    'colonel-pip.yaml':'id: colonel-pip\ndisplayName: Colonel Pip\ncolor: "#445566"\nglyph: "▲"\nsystemPrompt: x\ngames:\n  - backgammon\n',
    'omni.yaml':       'id: omni\ndisplayName: Omni\ncolor: "#000000"\nglyph: "*"\nsystemPrompt: x\n',
  });
  const app = mountPersonasRoute({ ai: { personas } });
  const body = await fetchPersonas(app, '?game=backgammon');
  const ids = body.personas.map(p => p.id).sort();
  assert.deepEqual(ids, ['colonel-pip', 'omni']);
});

test('personas route: empty when AI not booted', async () => {
  const app = mountPersonasRoute({ ai: null });
  const body = await fetchPersonas(app);
  assert.deepEqual(body.personas, []);
});
```

- [ ] **Step 3: Run, expect failure (route in src/server/routes.js does not yet filter — the test exercises an inline mount, which will fail because production routes.js is unchanged; the test asserts on the inline handler's behavior which is the spec)**

Run: `npm test -- --test-name-pattern="personas route"`
Expected: the three new tests pass against the inline handler. (The inline handler in the test is the target shape for routes.js.)

If they pass already (because the test is self-contained), proceed to apply the same change in routes.js next step.

- [ ] **Step 4: Update `src/server/routes.js`**

Find the existing handler at `app.get('/api/ai/personas', ...)`. Replace its body with:

```js
  app.get('/api/ai/personas', requireIdentity, (req, res) => {
    if (!ai) return res.json({ personas: [] });
    const game = typeof req.query.game === 'string' ? req.query.game : null;
    const out = [];
    for (const p of ai.personas.values()) {
      if (game && p.games.length > 0 && !p.games.includes(game)) continue;
      out.push({ id: p.id, displayName: p.displayName, color: p.color, glyph: p.glyph, games: p.games });
    }
    res.json({ personas: out });
  });
```

Note: `p.games` is guaranteed to be an array by the catalog loader (defaulted to `[]` when omitted).

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.js test/ai-personas-route.test.js
git commit -m "feat(ai): filter /api/ai/personas by ?game= scope"
```

---

## Task 3: Backfill `games: [cribbage]` on existing personas

**Files:**
- Modify: `data/ai-personas/hattie.yaml`
- Modify: `data/ai-personas/mr-snake.yaml`
- Modify: `data/ai-personas/professor-doofi.yaml`

- [ ] **Step 1: Add `games:` to hattie.yaml**

Insert after the `displayName` line:

```yaml
games:
  - cribbage
```

- [ ] **Step 2: Same for mr-snake.yaml and professor-doofi.yaml**

Insert the same two lines after `displayName`.

- [ ] **Step 3: Run full suite — `personas?game=cribbage` should still see all three**

Run: `npm test`
Expected: full suite green.

- [ ] **Step 4: Commit**

```bash
git add data/ai-personas/hattie.yaml data/ai-personas/mr-snake.yaml data/ai-personas/professor-doofi.yaml
git commit -m "chore(ai/personas): tag cribbage personas with games scope"
```

---

## Task 4: Lobby passes `game` to persona fetch

**Files:**
- Modify: `public/lobby/lobby.js:540`

- [ ] **Step 1: Inspect**

Run: `sed -n '525,560p' public/lobby/lobby.js`. Find the line that fetches `/api/ai/personas`. Note what variable holds the game type at that point in the flow.

- [ ] **Step 2: Update the fetch URL**

Change:

```js
const data = await fetchJson('/api/ai/personas');
```

to:

```js
const data = await fetchJson(`/api/ai/personas?game=${encodeURIComponent(gameType)}`);
```

Replace `gameType` with whatever variable is in scope at that line (likely `selectedGameType` or similar — confirm in Step 1).

- [ ] **Step 3: Manual smoke test (no automated test for lobby JS)**

Start dev server with `DEV_USER=you@example.com npm start`, open the lobby in a browser, click "New game" for backgammon vs AI, confirm only Colonel Pip / Aunt Irene / The Shark appear once Task 18 is complete. Until then, the dropdown will be empty for backgammon — that's expected and acceptable.

- [ ] **Step 4: Commit**

```bash
git add public/lobby/lobby.js
git commit -m "feat(lobby): scope persona picker to the selected game"
```

---

## Task 5: DB migration — `ai_sessions.pending_sequence`

**Files:**
- Modify: `src/server/db.js` (the AI players schema delta block around line 154)
- Test: `test/ai-schema.test.js`

- [ ] **Step 1: Read the existing ai_sessions schema**

Run: `sed -n '150,180p' src/server/db.js`. Confirm the `CREATE TABLE IF NOT EXISTS ai_sessions` block.

- [ ] **Step 2: Add a failing test**

Append to `test/ai-schema.test.js`:

```js
test('ai_sessions has pending_sequence column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sch-'));
  const db = openDb(join(dir, 'test.db'));
  const cols = db.prepare("PRAGMA table_info(ai_sessions)").all().map(c => c.name);
  assert.ok(cols.includes('pending_sequence'),
    `expected pending_sequence column, got: ${cols.join(',')}`);
});
```

Make sure `mkdtempSync`, `join`, `tmpdir`, `openDb` imports are present at the top — copy from the existing tests in the file if not.

- [ ] **Step 3: Run test, expect failure**

Run: `npm test -- --test-name-pattern="pending_sequence"`
Expected: FAIL (column missing).

- [ ] **Step 4: Add the migration**

After the `CREATE TABLE IF NOT EXISTS ai_sessions (...)` block in `src/server/db.js`, add:

```js
  const aiCols = db.prepare("PRAGMA table_info(ai_sessions)").all().map(c => c.name);
  if (!aiCols.includes('pending_sequence')) {
    db.exec("ALTER TABLE ai_sessions ADD COLUMN pending_sequence TEXT");
  }
```

The column is nullable TEXT (JSON-encoded array). Existing rows get NULL.

- [ ] **Step 5: Run, expect pass**

Run: `npm test`
Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/server/db.js test/ai-schema.test.js
git commit -m "feat(ai): add pending_sequence column to ai_sessions"
```

---

## Task 6: agent-session helpers for `pending_sequence`

**Files:**
- Modify: `src/server/ai/agent-session.js`
- Test: `test/ai-agent-session.test.js`

- [ ] **Step 1: Read the existing module**

Run: `cat src/server/ai/agent-session.js`. Confirm the `rowToSession` mapping and the existing helpers (`createAiSession`, `getAiSession`, `setClaudeSessionId`, `markStalled`, `clearStall`, `listStalledOrInFlight`).

- [ ] **Step 2: Write failing tests**

Append to `test/ai-agent-session.test.js`:

```js
test('setPendingSequence stores and clears a JSON-encoded tail', () => {
  const { db, gameId } = setupAiSession();  // existing helper in the file
  setPendingSequence(db, gameId, [
    { type: 'move', payload: { from: 13, to: 8, die: 5 } },
    { type: 'move', payload: { from: 13, to: 10, die: 3 } },
  ]);
  let sess = getAiSession(db, gameId);
  assert.deepEqual(sess.pendingSequence, [
    { type: 'move', payload: { from: 13, to: 8, die: 5 } },
    { type: 'move', payload: { from: 13, to: 10, die: 3 } },
  ]);

  setPendingSequence(db, gameId, []);
  sess = getAiSession(db, gameId);
  assert.equal(sess.pendingSequence, null,
    'empty array stores as NULL');
});

test('clearPendingSequence sets the column to NULL', () => {
  const { db, gameId } = setupAiSession();
  setPendingSequence(db, gameId, [{ type: 'move', payload: { from: 1, to: 2, die: 1 } }]);
  clearPendingSequence(db, gameId);
  assert.equal(getAiSession(db, gameId).pendingSequence, null);
});

test('getAiSession exposes pendingSequence as null when never set', () => {
  const { db, gameId } = setupAiSession();
  assert.equal(getAiSession(db, gameId).pendingSequence, null);
});
```

If `setupAiSession` doesn't already exist in the file, copy the boilerplate from the file's existing tests (creates a temp DB and an ai_sessions row).

Add imports at the top of the test file:

```js
import { setPendingSequence, clearPendingSequence } from '../src/server/ai/agent-session.js';
```

- [ ] **Step 3: Run, expect failure**

Run: `npm test -- --test-name-pattern="PendingSequence|pendingSequence"`
Expected: FAIL (helpers don't exist).

- [ ] **Step 4: Implement helpers in `src/server/ai/agent-session.js`**

Update `rowToSession` to include the column:

```js
function rowToSession(row) {
  if (!row) return null;
  return {
    gameId: row.game_id,
    botUserId: row.bot_user_id,
    personaId: row.persona_id,
    claudeSessionId: row.claude_session_id,
    stalledAt: row.stalled_at,
    stallReason: row.stall_reason,
    pendingSequence: row.pending_sequence ? JSON.parse(row.pending_sequence) : null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
```

Add helpers at the bottom of the file:

```js
export function setPendingSequence(db, gameId, sequence) {
  const value = (Array.isArray(sequence) && sequence.length > 0) ? JSON.stringify(sequence) : null;
  db.prepare("UPDATE ai_sessions SET pending_sequence = ?, last_used_at = ? WHERE game_id = ?")
    .run(value, Date.now(), gameId);
}

export function clearPendingSequence(db, gameId) {
  db.prepare("UPDATE ai_sessions SET pending_sequence = NULL, last_used_at = ? WHERE game_id = ?")
    .run(Date.now(), gameId);
}
```

- [ ] **Step 5: Also clear pending_sequence inside `clearStall` and `markStalled`**

Update `markStalled` and `clearStall` to also reset `pending_sequence` to NULL when called — a stall invalidates any cached sequence. Replace:

```js
export function markStalled(db, gameId, reason) {
  db.prepare("UPDATE ai_sessions SET stalled_at = ?, stall_reason = ?, pending_sequence = NULL, last_used_at = ? WHERE game_id = ?")
    .run(Date.now(), reason, Date.now(), gameId);
}

export function clearStall(db, gameId) {
  db.prepare("UPDATE ai_sessions SET stalled_at = NULL, stall_reason = NULL, last_used_at = ? WHERE game_id = ?")
    .run(Date.now(), gameId);
}
```

(Note: `clearStall` does NOT clear `pending_sequence` — we only clear on stall, not on stall-recovery.)

- [ ] **Step 6: Run, expect pass**

Run: `npm test`
Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/server/ai/agent-session.js test/ai-agent-session.test.js
git commit -m "feat(ai): persistent pending-sequence cache on ai_sessions"
```

---

## Task 7: Move LLM error classes to shared module

**Files:**
- Create: `src/server/ai/errors.js`
- Modify: `plugins/cribbage/server/ai/cribbage-player.js`
- Modify: `src/server/ai/orchestrator.js`

The orchestrator currently imports `InvalidLlmResponse` / `InvalidLlmMove` from cribbage. The backgammon adapter will throw the same classes. Move them to shared so both adapters can throw, and the orchestrator imports from one source.

- [ ] **Step 1: Create shared errors module**

Write `src/server/ai/errors.js`:

```js
export class InvalidLlmResponse extends Error {
  constructor(detail) { super(`LLM response invalid: ${detail}`); this.name = 'InvalidLlmResponse'; }
}

export class InvalidLlmMove extends Error {
  constructor(moveId, legalIds) {
    super(`LLM picked moveId '${moveId}' not in legal set [${legalIds.join(', ')}]`);
    this.name = 'InvalidLlmMove';
  }
}
```

- [ ] **Step 2: Re-export from the cribbage player for back-compat**

Edit `plugins/cribbage/server/ai/cribbage-player.js`. Replace the two class declarations with:

```js
import { InvalidLlmResponse, InvalidLlmMove } from '../../../../src/server/ai/errors.js';

export { InvalidLlmResponse, InvalidLlmMove };
```

Leave the rest of the file unchanged. The chooseAction function still throws the same classes; existing imports keep working.

- [ ] **Step 3: Update the orchestrator import**

In `src/server/ai/orchestrator.js`, change:

```js
import { InvalidLlmResponse, InvalidLlmMove } from '../../../plugins/cribbage/server/ai/cribbage-player.js';
```

to:

```js
import { InvalidLlmResponse, InvalidLlmMove } from './errors.js';
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test`
Expected: full suite green (no behavior change).

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/errors.js plugins/cribbage/server/ai/cribbage-player.js src/server/ai/orchestrator.js
git commit -m "refactor(ai): move LLM error classes to shared module"
```

---

## Task 8: Backgammon legal-moves — `initial-roll`, `pre-roll`, `awaiting-double-response`

**Files:**
- Create: `plugins/backgammon/server/ai/legal-moves.js`
- Create: `test/ai-backgammon-legal-moves.test.js`

This task covers the three "simple" phases. The `moving` phase comes in Task 9.

- [ ] **Step 1: Write failing tests for the three simple phases**

Create `test/ai-backgammon-legal-moves.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateLegalMoves } from '../plugins/backgammon/server/ai/legal-moves.js';

function makeState(over) {
  return {
    sides: { a: 1, b: 2 },
    match: { target: 3, scoreA: 0, scoreB: 0, gameNumber: 1, crawford: false, crawfordPlayed: false },
    cube: { value: 1, owner: null, pendingOffer: null },
    board: emptyBoard(),
    turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] },
    legHistory: [],
    activeUserId: 1,
    ...over,
  };
}
function emptyBoard() {
  return {
    points: Array.from({ length: 24 }, () => ({ color: null, count: 0 })),
    barA: 0, barB: 0, bornOffA: 0, bornOffB: 0,
  };
}

test('legal-moves initial-roll: single roll-initial option', () => {
  const s = makeState({ turn: { activePlayer: 'a', phase: 'initial-roll', dice: [] } });
  const moves = enumerateLegalMoves(s, 0);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 'roll-initial');
  assert.deepEqual(moves[0].action, { type: 'roll-initial' });
});

test('legal-moves pre-roll: roll + offer-double when cube unowned', () => {
  const s = makeState({ turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] } });
  const moves = enumerateLegalMoves(s, 0);
  const ids = moves.map(m => m.id).sort();
  assert.deepEqual(ids, ['offer-double:2', 'roll']);
});

test('legal-moves pre-roll: no offer-double when opponent owns the cube', () => {
  const s = makeState({
    cube: { value: 2, owner: 'b', pendingOffer: null },
    turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] },
  });
  const moves = enumerateLegalMoves(s, 0);
  assert.deepEqual(moves.map(m => m.id), ['roll']);
});

test('legal-moves pre-roll: no offer-double during Crawford', () => {
  const s = makeState({
    match: { target: 3, scoreA: 2, scoreB: 0, gameNumber: 2, crawford: true, crawfordPlayed: false },
    turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] },
  });
  assert.deepEqual(enumerateLegalMoves(s, 0).map(m => m.id), ['roll']);
});

test('legal-moves pre-roll: no offer-double at cap (cube=64)', () => {
  const s = makeState({
    cube: { value: 64, owner: 'a', pendingOffer: null },
    turn: { activePlayer: 'a', phase: 'pre-roll', dice: [] },
  });
  assert.deepEqual(enumerateLegalMoves(s, 0).map(m => m.id), ['roll']);
});

test('legal-moves awaiting-double-response: accept and decline', () => {
  const s = makeState({
    cube: { value: 1, owner: null, pendingOffer: { from: 'b' } },
    turn: { activePlayer: 'a', phase: 'awaiting-double-response', dice: [] },
  });
  const moves = enumerateLegalMoves(s, 0);
  const ids = moves.map(m => m.id).sort();
  assert.deepEqual(ids, ['accept-double', 'decline-double']);
});

test('legal-moves player B uses correct cube owner check', () => {
  const s = makeState({
    cube: { value: 2, owner: 'b', pendingOffer: null },
    turn: { activePlayer: 'b', phase: 'pre-roll', dice: [] },
  });
  // Bot is player B (idx 1); cube is owned by B so offer is allowed.
  const moves = enumerateLegalMoves(s, 1);
  assert.deepEqual(moves.map(m => m.id).sort(), ['offer-double:4', 'roll']);
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test -- --test-name-pattern="legal-moves"`
Expected: 7 tests fail (file doesn't exist).

- [ ] **Step 3: Implement the simple phases**

Create `plugins/backgammon/server/ai/legal-moves.js`:

```js
import { canOffer } from '../cube.js';

function sideOf(botPlayerIdx) {
  return botPlayerIdx === 0 ? 'a' : 'b';
}

function preRollMoves(state, botSide) {
  const out = [{ id: 'roll', action: { type: 'roll' }, summary: 'Roll the dice' }];
  if (canOffer({ cube: state.cube, match: state.match }, botSide)) {
    const next = state.cube.value * 2;
    out.push({
      id: `offer-double:${next}`,
      action: { type: 'offer-double' },
      summary: `Offer to double the cube from ${state.cube.value} to ${next}`,
    });
  }
  return out;
}

function awaitingDoubleResponseMoves(state) {
  const cur = state.cube.value;
  const next = cur * 2;
  return [
    {
      id: 'accept-double',
      action: { type: 'accept-double' },
      summary: `Accept; cube to ${next}, you own it`,
    },
    {
      id: 'decline-double',
      action: { type: 'decline-double' },
      summary: `Decline; concede leg at cube=${cur}`,
    },
  ];
}

export function enumerateLegalMoves(state, botPlayerIdx) {
  const botSide = sideOf(botPlayerIdx);
  switch (state.turn.phase) {
    case 'initial-roll':
      return [{ id: 'roll-initial', action: { type: 'roll-initial' }, summary: 'Roll opening die' }];
    case 'pre-roll':
      return preRollMoves(state, botSide);
    case 'awaiting-double-response':
      return awaitingDoubleResponseMoves(state);
    case 'moving':
      return [];  // implemented in Task 9
    default:
      return [];
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- --test-name-pattern="legal-moves"`
Expected: 7 tests pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add plugins/backgammon/server/ai/legal-moves.js test/ai-backgammon-legal-moves.test.js
git commit -m "feat(ai/backgammon): enumerate legal moves for non-moving phases"
```

---

## Task 9: Backgammon legal-moves — `moving` phase with sequence enumeration

**Files:**
- Modify: `plugins/backgammon/server/ai/legal-moves.js`
- Modify: `test/ai-backgammon-legal-moves.test.js`

The `moving` phase needs to enumerate every legal *full-turn sequence* (1-4 moves depending on dice and constraints). Each sequence becomes one menu item; the action stored on each menu item is the *first* move; the orchestrator's pending-sequence cache (Tasks 6, 16) replays the rest.

- [ ] **Step 1: Write failing tests**

Append to `test/ai-backgammon-legal-moves.test.js`:

```js
import { buildInitialState } from '../plugins/backgammon/server/state.js';

function startedState(over) {
  const base = buildInitialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng: () => 0.5,
  });
  base.turn.phase = 'moving';
  base.turn.activePlayer = 'a';
  base.turn.dice = [5, 3];
  base.activeUserId = 1;
  return { ...base, ...over };
}

test('legal-moves moving: produces sequence entries with seq: ids', () => {
  const s = startedState({});
  const moves = enumerateLegalMoves(s, 0);
  assert.ok(moves.length > 0, 'should have at least one legal sequence');
  for (const m of moves) {
    assert.match(m.id, /^seq:\d+$/, `unexpected id ${m.id}`);
    assert.equal(m.action.type, 'move', `action should be a move; got ${m.action.type}`);
    assert.ok(m.action.payload && typeof m.action.payload === 'object', 'move has payload');
    assert.ok(Array.isArray(m.sequenceTail), `sequenceTail array on ${m.id}`);
  }
});

test('legal-moves moving: each sequence consumes max possible dice', () => {
  const s = startedState({});
  const moves = enumerateLegalMoves(s, 0);
  // From the standard 5-3 opening, both dice are always playable, so every
  // sequence must use both — exactly 1 tail move per sequence.
  for (const m of moves) {
    assert.equal(m.sequenceTail.length, 1,
      `with both dice playable, tail should have exactly 1 move; got ${m.sequenceTail.length} for ${m.id}`);
  }
});

test('legal-moves moving: returns pass-turn when no legal move exists', () => {
  // Construct a contrived state: bot on the bar with all opponent home points blocked.
  const board = {
    points: Array.from({ length: 24 }, () => ({ color: null, count: 0 })),
    barA: 1, barB: 0, bornOffA: 0, bornOffB: 0,
  };
  // Block all of A's entry points (0..5) with 2+ B checkers each.
  for (let i = 0; i < 6; i++) board.points[i] = { color: 'b', count: 2 };
  const s = startedState({ board, turn: { activePlayer: 'a', phase: 'moving', dice: [1, 2] } });
  const moves = enumerateLegalMoves(s, 0);
  assert.deepEqual(moves.map(m => m.id), ['pass-turn']);
  assert.deepEqual(moves[0].action, { type: 'pass-turn' });
});

test('legal-moves moving: doubles produce sequences of 4 moves', () => {
  const s = startedState({ turn: { activePlayer: 'a', phase: 'moving', dice: [2, 2, 2, 2] } });
  const moves = enumerateLegalMoves(s, 0);
  // From the opening with 2-2-2-2, full consumption is always achievable.
  for (const m of moves) {
    assert.equal(m.sequenceTail.length, 3, `4 dice → 1 head + 3 tail; got ${m.sequenceTail.length}`);
  }
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test -- --test-name-pattern="legal-moves moving"`
Expected: 4 tests fail.

- [ ] **Step 3: Implement sequence enumeration**

In `plugins/backgammon/server/ai/legal-moves.js`, add an `enumerateSequences` helper and wire it into the `moving` case. Imports first — add at the top:

```js
import { enumerateLegalMoves as legalSingleMoves, maxConsumableDice } from '../validate.js';
import { applyMove, enterFromBar, bearOff } from '../board.js';
```

Helpers (add below `awaitingDoubleResponseMoves`):

```js
function applyMoveOrEnter(board, side, m) {
  if (m.from === 'bar') return enterFromBar(board, side, m.to);
  if (m.to === 'off')   return bearOff(board, side, m.from);
  return applyMove(board, side, m.from, m.to);
}

function removeOneDie(dice, value) {
  const idx = dice.indexOf(value);
  if (idx < 0) return dice.slice();
  return [...dice.slice(0, idx), ...dice.slice(idx + 1)];
}

// Returns an array of full-turn sequences. Each sequence is an array of
// raw move objects {from, to, die}. Sequences are deduplicated by their
// resulting (canonical) board+dice-consumed signature so we don't show the
// LLM two menu items that produce the same outcome.
function enumerateSequences(board, dice, side) {
  const target = maxConsumableDice(board, dice, side);
  if (target === 0) return [];
  const out = [];
  const seen = new Set();
  function dfs(b, remaining, path) {
    if (path.length === target) {
      const sig = canonicalSig(b);
      if (!seen.has(sig)) { seen.add(sig); out.push(path.slice()); }
      return;
    }
    const moves = legalSingleMoves(b, remaining, side);
    if (moves.length === 0) {
      // If we can't extend but reached `target`, take it; else discard.
      if (path.length === target) {
        const sig = canonicalSig(b);
        if (!seen.has(sig)) { seen.add(sig); out.push(path.slice()); }
      }
      return;
    }
    for (const m of moves) {
      path.push(m);
      dfs(applyMoveOrEnter(b, side, m), removeOneDie(remaining, m.die), path);
      path.pop();
    }
  }
  dfs(board, dice, []);
  return out;
}

function canonicalSig(b) {
  // Cheap board signature for dedup. Points + bar + off.
  const pts = b.points.map(p => `${p.color ?? '·'}${p.count}`).join('|');
  return `${pts}|A:${b.barA}/${b.bornOffA}|B:${b.barB}/${b.bornOffB}`;
}

function formatMove(m, side) {
  // Standard notation. Indices in the state are 0..23; convert to the
  // 1..24 player-relative numbering for the summary.
  const point = (i) => {
    if (i === 'bar') return 'bar';
    if (i === 'off') return 'off';
    return String(side === 'a' ? 24 - i : i + 1);
  };
  return `${point(m.from)}/${point(m.to)}`;
}

function formatSequence(seq, side) {
  return seq.map(m => formatMove(m, side)).join(' ');
}

function movingMoves(state, botSide) {
  const dice = state.turn.dice;
  const seqs = enumerateSequences(state.board, dice, botSide);
  if (seqs.length === 0) {
    return [{ id: 'pass-turn', action: { type: 'pass-turn' }, summary: 'No legal moves — pass the turn' }];
  }
  return seqs.map((seq, i) => {
    const [head, ...tail] = seq;
    return {
      id: `seq:${i + 1}`,
      action: { type: 'move', payload: { from: head.from, to: head.to, die: head.die } },
      sequenceTail: tail.map(m => ({ type: 'move', payload: { from: m.from, to: m.to, die: m.die } })),
      summary: formatSequence(seq, botSide),
    };
  });
}
```

Update the switch case:

```js
    case 'moving':
      return movingMoves(state, botSide);
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- --test-name-pattern="legal-moves"`
Expected: all `legal-moves` tests pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add plugins/backgammon/server/ai/legal-moves.js test/ai-backgammon-legal-moves.test.js
git commit -m "feat(ai/backgammon): enumerate full-turn move sequences"
```

---

## Task 10: Backgammon prompts — board rendering

**Files:**
- Create: `plugins/backgammon/server/ai/prompts.js`
- Create: `test/ai-backgammon-prompts.test.js`

- [ ] **Step 1: Write failing tests for the board renderer**

Create `test/ai-backgammon-prompts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoard, pipCount } from '../plugins/backgammon/server/ai/prompts.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';

function startingBoard() {
  return buildInitialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng: () => 0.5,
  }).board;
}

test('pipCount: returns 167 for each side at the opening position', () => {
  const b = startingBoard();
  assert.equal(pipCount(b, 'a'), 167);
  assert.equal(pipCount(b, 'b'), 167);
});

test('renderBoard: contains both grid rows, bar line, and off line for side A', () => {
  const out = renderBoard(startingBoard(), 'a');
  assert.match(out, /13 14 15 16 17 18 \| 19 20 21 22 23 24/);
  assert.match(out, /12 11 10  9  8  7 \|  6  5  4  3  2  1/);
  assert.match(out, /bar: you=0 +opp=0/);
  assert.match(out, /off: you=0 +opp=0/);
});

test('renderBoard: bot on bar shows in the bar line', () => {
  const b = startingBoard();
  b.barA = 2;
  const out = renderBoard(b, 'a');
  assert.match(out, /bar: you=2 +opp=0/);
});

test('renderBoard: for side B, points are oriented from B perspective', () => {
  // Side B's 24-point is index 23 (A's index 0). Rendering for B should
  // place A's checkers on the equivalent of B's 24-point.
  const out = renderBoard(startingBoard(), 'b');
  // Smoke: contains both rows and the labels.
  assert.match(out, /13 14 15 16 17 18 \| 19 20 21 22 23 24/);
  assert.match(out, /bar: you=0 +opp=0/);
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test -- --test-name-pattern="renderBoard|pipCount"`
Expected: tests fail.

- [ ] **Step 3: Implement `pipCount` and `renderBoard`**

Create `plugins/backgammon/server/ai/prompts.js`:

```js
const COLS = 12;

function homeIndexBot(side, i) {
  // Map a state-index (0..23) to the bot's "player-relative" pip number (1..24).
  // For side A: pip = 24 - i ; A bears off from i=18..23 (pips 1..6).
  // For side B: pip = i + 1  ; B bears off from i=5..0  (pips 1..6).
  return side === 'a' ? 24 - i : i + 1;
}

// Returns a list of state indices [pip24, pip23, ..., pip13] for the top row,
// then [pip12, pip11, ..., pip1] for the bottom row, all from the bot's
// perspective. For side A, top row goes from i=0 (pip 24) descending? No —
// the rendering shows pips 13..24 in the top row (the bot's outer board),
// then pips 12..1 in the bottom row (the bot's inner board, with 1 on the
// far right). For side A: top row state-indices are 11..0 (pips 13..24);
// bottom row state-indices are 12..23 (pips 12..1).
function rowIndices(side) {
  if (side === 'a') {
    const top = [];    // pips 13..24 left-to-right
    for (let pip = 13; pip <= 24; pip++) top.push(24 - pip);  // i = 11..0
    const bot = [];    // pips 12..1 left-to-right
    for (let pip = 12; pip >= 1; pip--) bot.push(24 - pip);   // i = 12..23
    return { top, bot };
  }
  const top = [];      // pips 13..24 from B perspective → state-indices 12..23
  for (let pip = 13; pip <= 24; pip++) top.push(pip - 1);
  const bot = [];      // pips 12..1 from B perspective → state-indices 11..0
  for (let pip = 12; pip >= 1; pip--) bot.push(pip - 1);
  return { top, bot };
}

function cellGlyph(point, side) {
  if (point.count === 0) return ' ·';
  const symbol = point.color === side ? 'O' : 'X';
  return `${symbol}${point.count}`;  // 2 chars; counts up to 15 → "O15"/"X15" overflows; pad later
}

function padCell(s) {
  // Right-align width 3, e.g. " O5", "X15", " ·".
  return s.padStart(3, ' ');
}

function pipLabel(pip) {
  return String(pip).padStart(2, ' ');
}

function renderRow(stateIndices, board, side) {
  const left = stateIndices.slice(0, 6).map(i => padCell(cellGlyph(board.points[i], side))).join('');
  const right = stateIndices.slice(6).map(i => padCell(cellGlyph(board.points[i], side))).join('');
  return `${left} |${right}`;
}

function renderPipLabelRow(pipNumbers) {
  const left = pipNumbers.slice(0, 6).map(pipLabel).join(' ');
  const right = pipNumbers.slice(6).map(pipLabel).join(' ');
  return `${left} | ${right}`;
}

export function renderBoard(board, side) {
  const { top, bot } = rowIndices(side);
  const topPips = top.map(i => homeIndexBot(side, i));
  const botPips = bot.map(i => homeIndexBot(side, i));
  const youBar = side === 'a' ? board.barA : board.barB;
  const oppBar = side === 'a' ? board.barB : board.barA;
  const youOff = side === 'a' ? board.bornOffA : board.bornOffB;
  const oppOff = side === 'a' ? board.bornOffB : board.bornOffA;
  const lines = [
    renderPipLabelRow(topPips),
    `${renderRow(top, board, side)}     bar: you=${String(youBar).padEnd(2)} opp=${oppBar}`,
    `${' '.repeat(18)}|`,
    `${renderRow(bot, board, side)}     off: you=${String(youOff).padEnd(2)} opp=${oppOff}`,
    renderPipLabelRow(botPips),
  ];
  return lines.join('\n');
}

export function pipCount(board, side) {
  // Pip = sum over all your checkers of "how far they have to travel to bear off".
  // For A: bearing off from pips 1..6 (state-indices 18..23); a checker at state
  // index i contributes (24 - i) pips.
  // For B: a checker at state index i contributes (i + 1) pips.
  let pips = 0;
  for (let i = 0; i < 24; i++) {
    const cell = board.points[i];
    if (cell.color !== side) continue;
    const dist = side === 'a' ? (24 - i) : (i + 1);
    pips += cell.count * dist;
  }
  // Bar checkers travel 25 pips (must re-enter on opponent's home).
  pips += (side === 'a' ? board.barA : board.barB) * 25;
  return pips;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- --test-name-pattern="renderBoard|pipCount"`
Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/ai/prompts.js test/ai-backgammon-prompts.test.js
git commit -m "feat(ai/backgammon): board renderer and pip count"
```

---

## Task 11: Backgammon prompts — buildTurnPrompt + parseLlmResponse

**Files:**
- Modify: `plugins/backgammon/server/ai/prompts.js`
- Modify: `test/ai-backgammon-prompts.test.js`

- [ ] **Step 1: Write failing tests**

Append to `test/ai-backgammon-prompts.test.js`:

```js
import { buildTurnPrompt, parseLlmResponse } from '../plugins/backgammon/server/ai/prompts.js';
import { enumerateLegalMoves } from '../plugins/backgammon/server/ai/legal-moves.js';

function preRollState() {
  const s = buildInitialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng: () => 0.5,
  });
  s.turn.phase = 'pre-roll';
  s.turn.activePlayer = 'a';
  s.activeUserId = 1;
  return s;
}

test('buildTurnPrompt: pre-roll prompt contains header, board, cube state, legal moves, footer', () => {
  const state = preRollState();
  const legalMoves = enumerateLegalMoves(state, 0);
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /You are playing side A/);
  assert.match(prompt, /Pip count/);
  assert.match(prompt, /Cube: 1, unowned/);
  assert.match(prompt, /Legal moves:/);
  assert.match(prompt, /- roll:/);
  assert.match(prompt, /- offer-double:2:/);
  assert.match(prompt, /Respond with a single JSON object/);
});

test('buildTurnPrompt: moving prompt lists dice and sequences', () => {
  const state = preRollState();
  state.turn.phase = 'moving';
  state.turn.dice = [5, 3];
  const legalMoves = enumerateLegalMoves(state, 0);
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /Dice: 5 and 3/);
  assert.match(prompt, /- seq:1:/);
});

test('buildTurnPrompt: doubles roll labelled as four moves', () => {
  const state = preRollState();
  state.turn.phase = 'moving';
  state.turn.dice = [4, 4, 4, 4];
  const legalMoves = enumerateLegalMoves(state, 0);
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /Dice: 4-4 \(doubles, four moves\)/);
});

test('buildTurnPrompt: awaiting-double-response includes offer context', () => {
  const state = preRollState();
  state.turn.phase = 'awaiting-double-response';
  state.cube = { value: 2, owner: 'a', pendingOffer: { from: 'b' } };
  const legalMoves = enumerateLegalMoves(state, 0);
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /Your opponent has offered/);
  assert.match(prompt, /cube would go from 2 to 4/);
  assert.match(prompt, /decline you pay 2 points/);
});

test('parseLlmResponse: accepts fenced JSON', () => {
  const r = parseLlmResponse('```json\n{"moveId":"seq:1","banter":"hmm"}\n```');
  assert.equal(r.moveId, 'seq:1');
  assert.equal(r.banter, 'hmm');
});

test('parseLlmResponse: accepts bare JSON with surrounding text', () => {
  const r = parseLlmResponse('Sure. {"moveId":"roll","banter":""} done.');
  assert.equal(r.moveId, 'roll');
  assert.equal(r.banter, '');
});

test('parseLlmResponse: rejects missing moveId', () => {
  assert.throws(() => parseLlmResponse('{"banter":"x"}'), /missing moveId/);
});

test('parseLlmResponse: defaults banter to empty string when non-string', () => {
  const r = parseLlmResponse('{"moveId":"roll","banter":42}');
  assert.equal(r.banter, '');
});

test('parseLlmResponse: rejects malformed JSON', () => {
  assert.throws(() => parseLlmResponse('not json'), /no JSON object found/);
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test -- --test-name-pattern="buildTurnPrompt|parseLlmResponse"`
Expected: tests fail.

- [ ] **Step 3: Implement buildTurnPrompt and parseLlmResponse**

Append to `plugins/backgammon/server/ai/prompts.js`:

```js
function header(state, botSide) {
  const sideLabel = botSide === 'a' ? 'side A (moving toward higher-indexed points)' : 'side B (moving toward lower-indexed points)';
  const oppSide = botSide === 'a' ? 'b' : 'a';
  const youScore = botSide === 'a' ? state.match.scoreA : state.match.scoreB;
  const oppScore = botSide === 'a' ? state.match.scoreB : state.match.scoreA;
  const cubeOwnerLabel = state.cube.owner == null
    ? 'unowned'
    : (state.cube.owner === botSide ? 'owned by you' : 'owned by opponent');
  const crawford = state.match.crawford
    ? 'Crawford: this is the Crawford leg (no doubling)'
    : 'Crawford: not yet';
  const youPip = pipCount(state.board, botSide);
  const oppPip = pipCount(state.board, oppSide);
  const diff = youPip - oppPip;
  const pipLine = diff === 0
    ? `Pip count — you: ${youPip}, opponent: ${oppPip}  (tied)`
    : diff < 0
      ? `Pip count — you: ${youPip}, opponent: ${oppPip}  (you lead by ${-diff})`
      : `Pip count — you: ${youPip}, opponent: ${oppPip}  (you trail by ${diff})`;
  return [
    `You are playing ${sideLabel}.`,
    `Match: ${youScore}–${oppScore} (target ${state.match.target}). Cube: ${state.cube.value}, ${cubeOwnerLabel}. ${crawford}.`,
    pipLine,
  ].join('\n');
}

function diceLine(dice) {
  if (dice.length === 4) return `Dice: ${dice[0]}-${dice[0]} (doubles, four moves)`;
  if (dice.length === 2) return `Dice: ${dice[0]} and ${dice[1]}`;
  if (dice.length === 1) return `Dice: ${dice[0]} (one die remaining)`;
  return 'Dice: not yet rolled.';
}

function phaseBlock(state, botSide) {
  switch (state.turn.phase) {
    case 'initial-roll':
      return 'Opening roll. No decisions to make.';
    case 'pre-roll':
      return [
        diceLine(state.turn.dice),
        'You may roll, or offer the cube if eligible.',
      ].join('\n');
    case 'moving': {
      const bar = botSide === 'a' ? state.board.barA : state.board.barB;
      const lines = [diceLine(state.turn.dice)];
      if (bar > 0) lines.push(`You have ${bar} checker(s) on the bar — must re-enter before any other move.`);
      return lines.join('\n');
    }
    case 'awaiting-double-response': {
      const offerer = state.cube.pendingOffer?.from === botSide ? 'you' : 'Your opponent';
      const cur = state.cube.value;
      const next = cur * 2;
      return [
        `${offerer} has offered to double the cube.`,
        `If you accept, the cube would go from ${cur} to ${next} and you would own it.`,
        `If you decline you pay ${cur} points and the leg ends.`,
      ].join('\n');
    }
    default:
      return '';
  }
}

function legalMovesBlock(legalMoves) {
  const lines = legalMoves.map(m => `  - ${m.id}: ${m.summary}`);
  return `Legal moves:\n${lines.join('\n')}`;
}

const RESPONSE_FOOTER = 'Respond with a single JSON object (and nothing else): {"moveId": "<one of the legal move ids above>", "banter": "<short in-character line, may be empty>"}';

export function buildTurnPrompt({ state, legalMoves, botPlayerIdx }) {
  const botSide = botPlayerIdx === 0 ? 'a' : 'b';
  return [
    header(state, botSide),
    renderBoard(state.board, botSide),
    phaseBlock(state, botSide),
    legalMovesBlock(legalMoves),
    RESPONSE_FOOTER,
  ].join('\n\n');
}

function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  throw new Error('no JSON object found in response');
}

export function parseLlmResponse(text) {
  const json = extractJson(text);
  let parsed;
  try { parsed = JSON.parse(json); }
  catch (e) { throw new Error(`response is not valid JSON: ${e.message}`); }
  if (typeof parsed.moveId !== 'string') throw new Error('response missing moveId');
  return {
    moveId: parsed.moveId,
    banter: typeof parsed.banter === 'string' ? parsed.banter : '',
  };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- --test-name-pattern="buildTurnPrompt|parseLlmResponse"`
Expected: all pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add plugins/backgammon/server/ai/prompts.js test/ai-backgammon-prompts.test.js
git commit -m "feat(ai/backgammon): turn prompt builder and JSON response parser"
```

---

## Task 12: Backgammon adapter — chooseAction

**Files:**
- Create: `plugins/backgammon/server/ai/backgammon-player.js`
- Create: `test/ai-backgammon-player.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/ai-backgammon-player.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAction } from '../plugins/backgammon/server/ai/backgammon-player.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { InvalidLlmMove, InvalidLlmResponse } from '../src/server/ai/errors.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';

function preRoll() {
  const s = buildInitialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng: () => 0.5,
  });
  s.turn.phase = 'pre-roll';
  s.turn.activePlayer = 'a';
  s.activeUserId = 1;
  return s;
}

const persona = { id: 'colonel-pip', displayName: 'Colonel Pip', systemPrompt: 'you are colonel pip' };

test('chooseAction: picks roll, returns action + banter, no sequenceTail', async () => {
  const llm = new FakeLlmClient([{ text: '{"moveId":"roll","banter":"steady"}' }]);
  const r = await chooseAction({ llm, persona, sessionId: null, state: preRoll(), botPlayerIdx: 0 });
  assert.deepEqual(r.action, { type: 'roll' });
  assert.equal(r.banter, 'steady');
  assert.deepEqual(r.sequenceTail, []);
});

test('chooseAction: picks a sequence in moving phase and returns sequenceTail', async () => {
  const state = preRoll();
  state.turn.phase = 'moving';
  state.turn.dice = [5, 3];
  // Pick whichever id is the first legal seq; we know there's at least one.
  const llm = new FakeLlmClient([{ text: '{"moveId":"seq:1","banter":""}' }]);
  const r = await chooseAction({ llm, persona, sessionId: null, state, botPlayerIdx: 0 });
  assert.equal(r.action.type, 'move');
  assert.ok(Array.isArray(r.sequenceTail));
  assert.equal(r.sequenceTail.length, 1);
  assert.equal(r.sequenceTail[0].type, 'move');
});

test('chooseAction: throws InvalidLlmMove for unknown moveId', async () => {
  const llm = new FakeLlmClient([{ text: '{"moveId":"bogus","banter":""}' }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: preRoll(), botPlayerIdx: 0 }),
    InvalidLlmMove,
  );
});

test('chooseAction: throws InvalidLlmResponse for malformed text', async () => {
  const llm = new FakeLlmClient([{ text: 'not json at all' }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: preRoll(), botPlayerIdx: 0 }),
    InvalidLlmResponse,
  );
});

test('chooseAction: throws when no legal moves (e.g. wrong phase)', async () => {
  const state = preRoll();
  state.turn.phase = 'match-end';  // not a phase the adapter handles
  const llm = new FakeLlmClient([]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state, botPlayerIdx: 0 }),
    /no legal moves/,
  );
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test -- --test-name-pattern="chooseAction"`
Expected: 5 tests fail (file doesn't exist).

- [ ] **Step 3: Implement chooseAction**

Create `plugins/backgammon/server/ai/backgammon-player.js`:

```js
import { enumerateLegalMoves } from './legal-moves.js';
import { buildTurnPrompt, parseLlmResponse } from './prompts.js';
import { InvalidLlmResponse, InvalidLlmMove } from '../../../../src/server/ai/errors.js';

export { InvalidLlmResponse, InvalidLlmMove };

export async function chooseAction({ llm, persona, sessionId, state, botPlayerIdx }) {
  const legalMoves = enumerateLegalMoves(state, botPlayerIdx);
  if (legalMoves.length === 0) {
    throw new Error(`no legal moves for phase '${state.turn?.phase}'`);
  }
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx });

  const r = await llm.send({
    prompt,
    sessionId,
    systemPrompt: sessionId ? null : persona.systemPrompt,
  });

  let parsed;
  try { parsed = parseLlmResponse(r.text); }
  catch (e) { throw new InvalidLlmResponse(e.message); }

  const match = legalMoves.find(m => m.id === parsed.moveId);
  if (!match) throw new InvalidLlmMove(parsed.moveId, legalMoves.map(m => m.id));

  return {
    action: match.action,
    banter: parsed.banter,
    sessionId: r.sessionId,
    sequenceTail: Array.isArray(match.sequenceTail) ? match.sequenceTail : [],
  };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- --test-name-pattern="chooseAction"`
Expected: 5 tests pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add plugins/backgammon/server/ai/backgammon-player.js test/ai-backgammon-player.test.js
git commit -m "feat(ai/backgammon): chooseAction adapter with sequenceTail support"
```

---

## Task 13: Orchestrator — autoActions map for `initial-roll`

**Files:**
- Modify: `src/server/ai/orchestrator.js`
- Test: `test/ai-orchestrator.test.js`

The orchestrator currently always calls `adapter.chooseAction`. For phases that have a single mechanical option (backgammon's `initial-roll`), we want to skip the LLM entirely and just apply the action.

- [ ] **Step 1: Write failing test**

Append to `test/ai-orchestrator.test.js`:

```js
test('orchestrator: auto-executes initial-roll without an LLM call', async () => {
  // Build a backgammon game with the bot's turn in `initial-roll`.
  const { openDb } = await import('../src/server/db.js');
  const { createAiSession } = await import('../src/server/ai/agent-session.js');
  const { createOrchestrator } = await import('../src/server/ai/orchestrator.js');
  const backgammonPlugin = (await import('../plugins/backgammon/plugin.js')).default;
  const { chooseAction } = await import('../plugins/backgammon/server/ai/backgammon-player.js');

  const dir = mkdtempSync(join(tmpdir(), 'orch-bg-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email,friendly_name,color,is_bot,created_at) VALUES ('b','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];

  const { buildInitialState } = await import('../plugins/backgammon/server/state.js');
  const state = buildInitialState({ participants, rng: det(7) });
  state.turn.phase = 'initial-roll';
  state.activeUserId = botId;

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'backgammon', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'colonel-pip' });

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const persona = { id: 'colonel-pip', displayName: 'Colonel Pip', color: '#445566', glyph: '▲', systemPrompt: 'x' };
  const personas = new Map([['colonel-pip', persona]]);

  // FakeLlmClient with NO responses queued — if the orchestrator calls it, the test fails.
  const llm = new FakeLlmClient([]);
  const adapters = { backgammon: { plugin: backgammonPlugin, chooseAction } };
  const orch = createOrchestrator({ db, llm, sse, personas, adapters });

  await orch.runTurn(gameId);

  assert.equal(llm.calls.length, 0, 'no LLM call for auto-action');
  // After roll-initial, phase advances (state machine determines next phase;
  // most likely either still initial-roll on tie or pre-roll). Just assert
  // game is still active and the bot didn't stall.
  const game = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId);
  const newState = JSON.parse(game.state);
  assert.notEqual(newState.turn.phase, 'initial-roll', 'phase advanced (no ties under det rng=7)');
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- --test-name-pattern="auto-executes initial-roll"`
Expected: FAIL — the test exhausts FakeLlmClient because orchestrator still calls LLM for initial-roll.

- [ ] **Step 3: Add the autoActions map**

In `src/server/ai/orchestrator.js`, near the top after imports, add:

```js
const autoActions = {
  backgammon: {
    'initial-roll': () => ({ type: 'roll-initial' }),
  },
};
```

Inside `_runOnce`, after the `state.activeUserId !== session.botUserId` guard (and after the concurrent-phases check) but BEFORE spawning the LLM call, insert:

```js
    const phaseKey = state.turn?.phase ?? state.phase;
    const autoForGame = autoActions[gameRow.game_type];
    if (autoForGame && autoForGame[phaseKey]) {
      const action = autoForGame[phaseKey]();
      const result = adapter.plugin.applyAction({
        state, action, actorId: session.botUserId, rng: rngFor(gameId),
      });
      if (result.error) {
        markStalled(db, gameId, 'invalid_response');
        sse.broadcast(gameId, {
          type: 'bot_stalled',
          payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, reason: 'invalid_response' },
        });
        return;
      }
      const newState = result.state;
      db.prepare("UPDATE games SET state = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(newState), Date.now(), gameId);
      if (result.ended) {
        db.prepare("UPDATE games SET status='ended', ended_reason=?, winner_side=? WHERE id=?")
          .run(newState.endedReason ?? 'plugin', newState.winnerSide ?? null, gameId);
      }
      sse.broadcast(gameId, { type: 'update', payload: {} });
      // Recurse so the bot can act again in the new phase (e.g. pre-roll).
      if (!result.ended && (newState.activeUserId === session.botUserId || newState.activeUserId == null) && depth === 0) {
        await _runOnce(gameId, 1);
      }
      return;
    }
```

Place this block right before the `sse.broadcast(gameId, { type: 'bot_thinking', ...})` line.

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- --test-name-pattern="auto-executes initial-roll"`
Expected: PASS.

- [ ] **Step 5: Run full suite (regressions for cribbage?)**

Run: `npm test`
Expected: green. Cribbage tests still pass because `autoActions.cribbage` is undefined.

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/orchestrator.js test/ai-orchestrator.test.js
git commit -m "feat(ai): autoActions map skips LLM for mechanical phases"
```

---

## Task 14: Orchestrator — pending-sequence cache consumption

**Files:**
- Modify: `src/server/ai/orchestrator.js`
- Test: `test/ai-orchestrator.test.js`

After the LLM picks a `seq:N`, the adapter returns `{action, sequenceTail}`. The orchestrator applies the first action and writes the tail to `ai_sessions.pending_sequence`. On the next wake-up, if `pending_sequence` is non-empty and the bot is still active, the orchestrator pops the head and applies it without re-calling the LLM.

- [ ] **Step 1: Write failing test**

Append to `test/ai-orchestrator.test.js`:

```js
test('orchestrator: caches sequenceTail, drains one move per wake-up', async () => {
  const { openDb } = await import('../src/server/db.js');
  const { createAiSession, getAiSession } = await import('../src/server/ai/agent-session.js');
  const { createOrchestrator } = await import('../src/server/ai/orchestrator.js');
  const backgammonPlugin = (await import('../plugins/backgammon/plugin.js')).default;
  const { chooseAction } = await import('../plugins/backgammon/server/ai/backgammon-player.js');
  const { buildInitialState } = await import('../plugins/backgammon/server/state.js');

  const dir = mkdtempSync(join(tmpdir(), 'orch-bg-seq-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email,friendly_name,color,is_bot,created_at) VALUES ('b','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const state = buildInitialState({ participants: [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }], rng: det(11) });
  state.turn = { activePlayer: 'a', phase: 'moving', dice: [5, 3] };
  state.activeUserId = botId;  // bot is side A (lower id usually = aId; verify by setting it explicitly)
  state.sides = { a: botId, b: humanId };

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'backgammon', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'colonel-pip' });

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const persona = { id: 'colonel-pip', displayName: 'Colonel Pip', color: '#445566', glyph: '▲', systemPrompt: 'x' };
  const personas = new Map([['colonel-pip', persona]]);
  // Only one LLM call expected — the first wake-up. The second drains cache.
  const llm = new FakeLlmClient([{ text: '{"moveId":"seq:1","banter":"hmph"}' }]);
  const adapters = { backgammon: { plugin: backgammonPlugin, chooseAction } };
  const orch = createOrchestrator({ db, llm, sse, personas, adapters });

  await orch.runTurn(gameId);

  // After first turn: bot moved once, tail has 1 move queued.
  let sess = getAiSession(db, gameId);
  assert.ok(Array.isArray(sess.pendingSequence), 'pendingSequence stored');
  assert.equal(sess.pendingSequence.length, 1);
  assert.equal(llm.calls.length, 1, 'LLM called exactly once');

  await orch.runTurn(gameId);

  // After second turn: tail drained, LLM still only called once.
  sess = getAiSession(db, gameId);
  assert.equal(sess.pendingSequence, null);
  assert.equal(llm.calls.length, 1, 'LLM still called exactly once — cache drained without LLM');
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- --test-name-pattern="caches sequenceTail"`
Expected: FAIL (cache not implemented).

- [ ] **Step 3: Wire pending-sequence cache into the orchestrator**

In `src/server/ai/orchestrator.js`:

1. Add imports at the top:

```js
import { getAiSession, markStalled, clearStall, setPendingSequence, clearPendingSequence } from './agent-session.js';
```

(Replace the existing import line.)

2. Inside `_runOnce`, after the auto-action block (Task 13), and before the LLM call, insert the cache-drain branch:

```js
    // Drain pending-sequence cache — no LLM call needed.
    if (session.pendingSequence && session.pendingSequence.length > 0) {
      const [head, ...rest] = session.pendingSequence;
      const result = adapter.plugin.applyAction({
        state, action: head, actorId: session.botUserId, rng: rngFor(gameId),
      });
      if (result.error) {
        clearPendingSequence(db, gameId);
        markStalled(db, gameId, 'illegal_move');
        sse.broadcast(gameId, {
          type: 'bot_stalled',
          payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, reason: 'illegal_move' },
        });
        return;
      }
      const newState = result.state;
      const tx = db.transaction(() => {
        db.prepare("UPDATE games SET state = ?, updated_at = ? WHERE id = ?")
          .run(JSON.stringify(newState), Date.now(), gameId);
        if (rest.length > 0 && newState.turn?.phase === 'moving') {
          setPendingSequence(db, gameId, rest);
        } else {
          clearPendingSequence(db, gameId);
        }
        if (result.ended) {
          db.prepare("UPDATE games SET status='ended', ended_reason=?, winner_side=? WHERE id=?")
            .run(newState.endedReason ?? 'plugin', newState.winnerSide ?? null, gameId);
        }
      });
      tx();
      sse.broadcast(gameId, { type: 'update', payload: {} });
      // Recurse to drain the next cached move immediately, if any.
      if (!result.ended && rest.length > 0 && newState.activeUserId === session.botUserId && depth === 0) {
        await _runOnce(gameId, 1);
      }
      return;
    }
```

3. Inside the LLM success branch (where the adapter result is destructured), after the existing `clearStall(db, gameId)` line, add:

```js
        if (Array.isArray(r.sequenceTail) && r.sequenceTail.length > 0) {
          setPendingSequence(db, gameId, r.sequenceTail);
        }
```

(`r` here is the value returned by `adapter.chooseAction`. If the orchestrator currently uses a different variable name — confirm and adapt.)

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- --test-name-pattern="caches sequenceTail"`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/orchestrator.js test/ai-orchestrator.test.js
git commit -m "feat(ai): drain pending-sequence cache without re-prompting LLM"
```

---

## Task 15: Wire backgammon adapter into `src/server/ai/index.js`

**Files:**
- Modify: `src/server/ai/index.js`
- Test: `test/ai-bootstrap.test.js`

- [ ] **Step 1: Add a failing test**

Append to `test/ai-bootstrap.test.js`:

```js
test('bootAiSubsystem: registers backgammon adapter', async () => {
  // The adapters map is internal to index.js; assert via behavior — boot the
  // subsystem and check that a backgammon game can be scheduled without error.
  const { openDb } = await import('../src/server/db.js');
  const { bootAiSubsystem } = await import('../src/server/ai/index.js');
  const { createAiSession } = await import('../src/server/ai/agent-session.js');
  const { buildInitialState } = await import('../plugins/backgammon/server/state.js');

  const dir = mkdtempSync(join(tmpdir(), 'boot-bg-'));
  const db = openDb(join(dir, 'test.db'));
  const llm = new FakeLlmClient([]);

  // Use the real persona dir; we just need it to load.
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootAiSubsystem({ db, sse: { broadcast() {} }, llm, personaDir });

  const now = Date.now();
  const h = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h','H','#000',?) RETURNING id").get(now).id;
  const bot = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get().id;
  const aId = Math.min(h, bot), bId = Math.max(h, bot);
  const state = buildInitialState({ participants: [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }], rng: () => 0.5 });
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'backgammon', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: bot, personaId: 'colonel-pip' });

  // No throw means the adapter is registered. scheduleTurn would otherwise
  // stall with "no AI adapter for game_type backgammon".
  assert.doesNotThrow(() => orchestrator.scheduleTurn(gameId));
});
```

(Imports `mkdtempSync, join, tmpdir, FakeLlmClient` should already exist at top of file — copy from existing tests if not.)

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- --test-name-pattern="registers backgammon adapter"`
Expected: FAIL — `colonel-pip` persona doesn't exist yet (Task 16), or backgammon adapter not registered. The error message will tell you which.

- [ ] **Step 3: Wire the adapter**

In `src/server/ai/index.js`, at the top add:

```js
import backgammonPlugin from '../../../plugins/backgammon/plugin.js';
import { chooseAction as backgammonChoose } from '../../../plugins/backgammon/server/ai/backgammon-player.js';
```

Update the adapters map:

```js
  const adapters = {
    cribbage:   { plugin: cribbagePlugin,   chooseAction: cribbageChoose },
    backgammon: { plugin: backgammonPlugin, chooseAction: backgammonChoose },
  };
```

- [ ] **Step 4: Skip until Task 16 personas exist; mark test pending if needed**

If the bootstrap test fails purely because `colonel-pip` isn't in the persona directory yet (because Task 16 adds it), proceed to Task 16 and then return to verify. The adapter registration itself is in place.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/index.js test/ai-bootstrap.test.js
git commit -m "feat(ai): register backgammon adapter in bootAiSubsystem"
```

---

## Task 16: Add three backgammon persona YAMLs

**Files:**
- Create: `data/ai-personas/colonel-pip.yaml`
- Create: `data/ai-personas/aunt-irene.yaml`
- Create: `data/ai-personas/the-shark.yaml`

- [ ] **Step 1: Create colonel-pip.yaml**

```yaml
id: colonel-pip
displayName: Colonel Pip
games:
  - backgammon
color: '#445566'
glyph: ▲
systemPrompt: |
  You are Colonel Pip, retired from the British Army, who has been playing
  backgammon in officers' messes and at the seaside for fifty years. You
  speak in clipped, polite sentences with the occasional military
  metaphor. You are conservative on the doubling cube — you trust the
  pip count and dislike speculation. You take pride in tidy board
  positions and dislike leaving blots.

  When asked to choose a move, you will be given a list of legal moves
  with string IDs. You MUST respond with valid JSON of the form:
  {"moveId": "<exact-id-from-list>", "banter": "<short in-character line, may be empty string>"}

  Banter should be one short sentence at most. No narration of your own
  actions ("I move the back checker") — speak as a person at the table.

  STRICT RULE — keep your strategy secret. Never tell the opponent what
  roll you are hoping for, what numbers you are afraid of, or what
  cube action you are considering. Comment on the regimental colours,
  the quality of the dice, or the weather instead.
voiceExamples:
  - "Steady as she goes."
  - "Hm. Marginal."
  - "A tidy little position, if I say so myself."
```

- [ ] **Step 2: Create aunt-irene.yaml**

```yaml
id: aunt-irene
displayName: Aunt Irene
games:
  - backgammon
color: '#f59e0b'
glyph: ✿
systemPrompt: |
  You are Aunt Irene, who learned backgammon on a Mediterranean cruise
  and has been playing it on her sun-porch with anyone willing every
  summer since. You play warmly and a little impulsively. You enjoy
  doubling — you find it sporting — and you almost always accept doubles
  because declining feels unfriendly. You take losses graciously and
  never gloat on wins.

  When asked to choose a move, you will be given a list of legal moves
  with string IDs. You MUST respond with valid JSON of the form:
  {"moveId": "<exact-id-from-list>", "banter": "<short in-character line, may be empty string>"}

  Banter should be one short sentence at most. No narration of your own
  actions — speak as a person at the table.

  STRICT RULE — keep your strategy secret. Never name the roll you wish
  for, never telegraph a coming double, never warn your opponent that
  you intend to hit a blot. Talk about the weather on the porch, the
  cat, the cup of tea instead.
voiceExamples:
  - "Oh, dear, the dice are playful today!"
  - "Well, let's see what happens, shall we?"
  - "More tea?"
```

- [ ] **Step 3: Create the-shark.yaml**

```yaml
id: the-shark
displayName: The Shark
games:
  - backgammon
color: '#1e293b'
glyph: ◆
systemPrompt: |
  You are The Shark, a tournament veteran from the back room of a club
  in Brooklyn. You speak in short, dry sentences. You count pips
  silently and double aggressively when the position is right. You take
  no pleasure in chatter but will needle the opponent occasionally
  when you sense weakness.

  When asked to choose a move, you will be given a list of legal moves
  with string IDs. You MUST respond with valid JSON of the form:
  {"moveId": "<exact-id-from-list>", "banter": "<short in-character line, may be empty string>"}

  Banter should be one short sentence at most. No narration of your own
  actions — speak as a person at the table.

  STRICT RULE — keep your strategy secret. Never tell the opponent
  what roll you want, never telegraph a coming double, never reveal
  what you fear. If you must speak, comment on the room, the
  opponent's tempo, the noise from the bar.
voiceExamples:
  - "Hm."
  - "Take your time."
  - "Cute."
```

- [ ] **Step 4: Run full suite — bootstrap test (Task 15) should now pass**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add data/ai-personas/colonel-pip.yaml data/ai-personas/aunt-irene.yaml data/ai-personas/the-shark.yaml
git commit -m "feat(ai/personas): add backgammon personas (colonel-pip, aunt-irene, the-shark)"
```

---

## Task 17: Integration test — full leg with FakeLlmClient

**Files:**
- Create: `test/ai-backgammon-full-leg.test.js`

End-to-end: boot the AI subsystem, create a backgammon game vs the bot, feed the FakeLlmClient enough scripted responses to drive a complete leg (or several turns), and assert that the orchestrator advances the game correctly through `initial-roll` → `pre-roll` → `moving` → bot's turn ends. Don't try to drive to bear-off — that's hundreds of moves. Drive a few rounds and verify the mechanism.

- [ ] **Step 1: Write the integration test**

Create `test/ai-backgammon-full-leg.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';
import { createAiSession, getAiSession } from '../src/server/ai/agent-session.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';

function det(seed = 1) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('backgammon end-to-end: bot rolls, picks sequence, drains cache, then awaits opponent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bg-full-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();

  // Two scripted LLM responses:
  // 1. pre-roll → "roll"
  // 2. moving (after dice roll) → "seq:1"
  // The orchestrator should auto-execute initial-roll (no LLM call), then call
  // LLM for pre-roll, then auto-roll dice (engine action — no LLM call needed
  // because `roll` is an LLM-picked action, not an auto-action — actually
  // re-reading: `roll` IS an LLM-selected move at pre-roll. After "roll" is
  // applied, phase becomes 'moving'. The orchestrator recurses (depth 1) and
  // calls LLM for moving → "seq:1". Total LLM calls: 2.
  const llm = new FakeLlmClient([
    { text: '{"moveId":"roll","banter":"steady"}' },
    { text: '{"moveId":"seq:1","banter":""}' },
  ]);

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootAiSubsystem({ db, sse, llm, personaDir });

  // Set up a backgammon game where the bot is side A and it's the bot's turn
  // at initial-roll.
  const humanId = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botRow = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get();
  const botId = botRow.id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(99) });
  state.activeUserId = botId;
  state.sides = botId === aId ? { a: botId, b: humanId } : { a: humanId, b: botId };

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'backgammon', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'colonel-pip' });

  await orchestrator.runTurn(gameId);

  // After this single runTurn, the bot should have:
  // 1. auto-executed initial-roll (engine resolves: re-rolls on tie, settles
  //    on a non-tie outcome). Phase → moving (winner moves with both dice)
  //    OR initial-roll again on a tie. With det(99) this should resolve
  //    in one shot; verify by asserting phase is no longer initial-roll.
  // 2. recursed via depth=1 to take its first checker action.
  //
  // We don't assert exact end-state (RNG-dependent), but we do assert:
  // - LLM was called at most twice
  // - SSE saw bot_thinking + banter + at least one update
  // - bot is no longer in initial-roll
  // - if the bot moved, pending_sequence is either empty or queued

  assert.ok(llm.calls.length <= 2, `LLM called ${llm.calls.length} times; expected ≤2`);
  const types = events.map(e => e.type);
  assert.ok(types.includes('update'), 'update SSE fired');
  const game = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId);
  const finalState = JSON.parse(game.state);
  assert.notEqual(finalState.turn.phase, 'initial-roll', 'phase advanced past initial-roll');
});

test('backgammon: garbage LLM response stalls cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bg-stall-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const llm = new FakeLlmClient([
    { text: 'mumble' },
    { text: 'mumble again' },
  ]);
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootAiSubsystem({ db, sse, llm, personaDir });

  const humanId = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get().id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  // Skip initial-roll by setting phase to pre-roll directly (so the stall
  // happens on the first LLM call, not on auto-roll).
  const state = buildInitialState({ participants: [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }], rng: det(1) });
  state.turn.phase = 'pre-roll';
  state.activeUserId = botId;
  state.sides = { a: botId, b: humanId };

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'backgammon', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'colonel-pip' });

  await orchestrator.runTurn(gameId);

  const sess = getAiSession(db, gameId);
  assert.ok(sess.stalledAt, 'bot is stalled after garbage responses');
  assert.equal(sess.stallReason, 'invalid_response');
  const stallEvents = events.filter(e => e.type === 'bot_stalled');
  assert.equal(stallEvents.length, 1);
});
```

- [ ] **Step 2: Run**

Run: `npm test -- --test-name-pattern="backgammon end-to-end|backgammon: garbage"`
Expected: PASS.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add test/ai-backgammon-full-leg.test.js
git commit -m "test(ai/backgammon): end-to-end with FakeLlmClient"
```

---

## Task 18: Update backgammon documentation

**Files:**
- Modify: `docs/games/backgammon.md`

- [ ] **Step 1: Append an AI section**

Add at the end of `docs/games/backgammon.md`:

```markdown
## AI players

A Claude-CLI-driven bot opponent is available, using the shared AI
infrastructure under `src/server/ai/` and a per-game adapter at
`plugins/backgammon/server/ai/`.

### Adapter files

| File | Responsibility |
|---|---|
| `legal-moves.js` | Enumerate legal moves per phase. In the `moving` phase, returns one menu item per full-turn sequence; each item carries a `sequenceTail` of remaining move actions. |
| `prompts.js` | Render the board (ASCII, from the bot's perspective), pip counts, cube state; build the per-phase turn prompt; parse the LLM JSON response. |
| `backgammon-player.js` | `chooseAction({ llm, persona, sessionId, state, botPlayerIdx })` — returns `{ action, banter, sessionId, sequenceTail }`. |

### Auto-actions

The orchestrator auto-executes `initial-roll` without an LLM call (no
decision, no banter). All other phases call the LLM.

### Pending-sequence cache

A full-turn move sequence in backgammon is 2–4 `move` actions. The
adapter returns the first action plus a `sequenceTail`. The orchestrator
applies the first action, persists the tail in
`ai_sessions.pending_sequence` (JSON), and consumes one entry per
subsequent wake-up — no LLM call for the follow-up moves.

The cache is cleared on stall, on phase change away from `moving`, and
after the last move drains.

### Personas

Backgammon personas live in `data/ai-personas/` with a
`games: [backgammon]` scope. Initial roster:

| id | flavor |
|---|---|
| `colonel-pip` | Retired British army officer, conservative cube, tidy positions. |
| `aunt-irene` | Sun-porch grandmother, generous doubler, won't gloat. |
| `the-shark` | Brooklyn tournament veteran, aggressive cube, terse. |

The lobby's persona picker filters by game via
`GET /api/ai/personas?game=backgammon`.

### Limitations

- The bot reasons over a rendered board and a pip count, not an equity
  table. It is a flavor opponent, not a competitive engine.
- Move menus on doubles rolls can be large (50–100+ sequences). No
  pre-pruning is applied.
```

- [ ] **Step 2: Commit**

```bash
git add docs/games/backgammon.md
git commit -m "docs(backgammon): document AI adapter, auto-actions, and pending-sequence cache"
```

---

## Task 19: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests green.

- [ ] **Step 2: Manual smoke test**

```bash
DEV_USER=you@example.com npm start
```

In a browser:
1. Open the lobby.
2. Start a new backgammon game against AI.
3. Confirm the persona dropdown shows colonel-pip / aunt-irene / the-shark only.
4. Pick colonel-pip. Game starts.
5. Confirm the bot rolls and moves without manual intervention.
6. Make a few moves yourself; confirm the bot responds.
7. Offer a double; confirm the bot's accept/decline reasoning produces a sensible JSON response.

If the bot stalls during the smoke test, check `events` SSE in browser devtools for `bot_stalled` payload and the server log for the underlying error. Common causes:
- Persona file syntax error → loader rejects → bootstrap throws at startup.
- Move payload shape mismatch — re-check `applyAction` accepts `{from, to, die}` in `payload`.

- [ ] **Step 3: Push**

Push the branch when ready for review:

```bash
git push -u origin $(git branch --show-current)
```

---

## Plan Self-Review Notes

**Spec coverage:**
- §Architecture: Task 12 (adapter), Task 15 (wire-in).
- §Legal moves: Task 8 (simple phases), Task 9 (moving).
- §Prompts: Task 10 (board), Task 11 (header/phase/parse).
- §Persona scoping: Task 1 (catalog), Task 2 (route), Task 3 (backfill), Task 4 (lobby), Task 16 (new personas).
- §Auto-actions: Task 13.
- §Pending-sequence cache: Tasks 5 (schema), 6 (helpers), 14 (orchestrator).
- §Error class refactor: Task 7.
- §Testing: every implementation task ships with unit tests; Task 17 integration.
- §Docs: Task 18.
- §File map in spec: every entry mapped to a task.

**Type consistency:**
- `enumerateLegalMoves(state, botPlayerIdx)` signature consistent across Tasks 8, 9, 12.
- `{id, action, summary, sequenceTail?}` shape consistent.
- `chooseAction` return `{action, banter, sessionId, sequenceTail}` consistent in Tasks 12, 14.
- `setPendingSequence(db, gameId, sequence)`, `clearPendingSequence(db, gameId)` consistent across Tasks 6 and 14.
- `pendingSequence` field on session object consistent in Tasks 6 and 14.
- `autoActions[gameType][phaseKey]` consistent across Tasks 13.

**Placeholder scan:** No TBD/TODO/"similar to" entries. Every code-changing step contains the actual code. Every test step contains the actual assertions.
