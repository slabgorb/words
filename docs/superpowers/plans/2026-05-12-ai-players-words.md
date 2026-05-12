# AI Players — Words Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude-CLI-driven bot to the Words plugin that plays as a solid casual opponent — real Scrabble move generation against ENABLE2K, picking among an engine-built shortlist of stylistically diverse plays. Three personas (Samantha, Suzie, Kurt) span three play archetypes: bingo hunter, defender, score maximizer.

**Architecture:** Adapter-local code under `plugins/words/server/ai/`. Move generation via `@scrabble-solver/solver` with our own ENABLE2K trie. Engine produces a 1–7 slot shortlist (`top-score`, `best-bingo`, `best-leave`, `best-defense`, `safe-medium`, optional `pass` and `swap-worst`); the LLM picks one slot and adds banter. Variants `wwf` and `scrabble` are both supported via a per-variant `Config`.

**Tech Stack:** Node 20+ ESM, `node:test`, `better-sqlite3`, existing AI orchestrator/persona-catalog/error classes. New deps: `@scrabble-solver/solver`, `@scrabble-solver/types`, `@kamilmielnik/trie`.

**Spec:** `docs/superpowers/specs/2026-05-12-ai-players-words-design.md`.

---

## File Structure

New files (all under `plugins/words/server/ai/` unless noted):

| File | Responsibility |
|---|---|
| `trie.js` | Lazy singleton: build `@kamilmielnik/trie` from `data/enable2k.txt`. Expose `getEnableTrie()`. |
| `config.js` | Translate Words plugin state ↔ `@scrabble-solver/types` Board/Tile/Config (per-variant). Translate a solver `ResultJson` back to a Words `move` action. |
| `shortlist.js` | `buildShortlist(state, botSide)` — calls solver, dedups by placement signature, fills slots, attaches summaries, prepends pass/swap when warranted. |
| `prompts.js` | `buildTurnPrompt(...)` (header + ASCII board + rack + shortlist + footer) and `parseLlmResponse(text)`. Reuse extractJson helper pattern from cribbage. |
| `words-player.js` | `chooseAction({llm, persona, sessionId, state, botPlayerIdx})` — drives the above; returns `{action, banter, sessionId}`. |
| `data/ai-personas/samantha.yaml` | Bingo-hunter persona, `games: [words]`. |
| `data/ai-personas/suzie.yaml` | Defender persona, `games: [words]`. |
| `data/ai-personas/kurt.yaml` | Score-maximizer persona, `games: [words]`. |
| `docs/games/words.md` | AI-section doc mirroring `docs/games/backgammon.md`. |

Modified files:

| File | Change |
|---|---|
| `src/server/ai/index.js` | Import `chooseAction` from `words-player.js`, register in `adapters` map. |
| `package.json` | Add three deps in `dependencies`. |
| `test/ai-bootstrap.test.js` | Add a "registers words adapter" case mirroring the existing backgammon one. |
| `test/ai-personas-route.test.js` | Add `?game=words` filter case. |

Test files (all `*.test.js`, `node:test`):

| File | Subject |
|---|---|
| `test/ai-words-deps-smoke.test.js` | Smoke-test the upstream API: trie builds, `solve(trie, config, board, tiles)` runs and returns scored results. Documents the API we depend on. |
| `test/ai-words-trie.test.js` | ENABLE2K loads; known words match; non-words reject; build is memoised. |
| `test/ai-words-config.test.js` | Round-trip: plugin board ↔ solver Board (both variants); rack with blanks; ResultJson → Words `move` action. |
| `test/ai-words-shortlist.test.js` | Slot population on curated mid-game state (`top-score`, `best-bingo`, `best-leave`, `best-defense` distinct); empty-rack → pass; weak-rack → `swap-worst`; swap omitted when bag < 7; signature dedup. |
| `test/ai-words-prompts.test.js` | Board + shortlist render; parser accepts fenced/bare JSON; rejects malformed. |
| `test/ai-words-player.test.js` | With `FakeLlmClient`: chooses requested slot's action; `InvalidLlmMove` on unknown id; `InvalidLlmResponse` on bad JSON. |
| `test/ai-words.test.js` | Boot AI with `FakeLlmClient`, drive a few bot turns (a play, a swap, a pass); assert SSE event sequence; stall on garbage LLM output. |

---

## Task 0: Discovery — install deps and validate scrabble-solver API

**Files:**
- Modify: `package.json`
- Create: `test/ai-words-deps-smoke.test.js`

This task installs the dependencies and writes a smoke test that exercises the upstream API end-to-end. We do this first because the public README is thin — the test serves as both a sanity check and live documentation for the downstream tasks. **All later tasks rely on the API signatures this test pins down.**

- [ ] **Step 1: Install deps**

```bash
npm install @scrabble-solver/solver @scrabble-solver/types @kamilmielnik/trie
```

Expected: `package.json` and `package-lock.json` updated; no errors. Verify `node_modules/@scrabble-solver/solver` exists.

- [ ] **Step 2: Write the smoke test**

Create `test/ai-words-deps-smoke.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Trie } from '@kamilmielnik/trie';
import { solve } from '@scrabble-solver/solver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENABLE_PATH = resolve(__dirname, '..', 'data', 'enable2k.txt');

test('dep smoke: trie loads ENABLE2K and recognises known words', () => {
  const trie = new Trie();
  const words = readFileSync(ENABLE_PATH, 'utf8')
    .split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(Boolean);
  // Sample-load the first 5000 words — the full set is fine but slow on
  // every smoke run. Real trie.js uses the full file.
  for (const w of words.slice(0, 5000)) trie.add(w);
  assert.ok(trie.hasWord(words[0]));
  assert.ok(!trie.hasWord('ZZZZZ'));
});

test('dep smoke: solve() returns scored plays on a one-row opening board', () => {
  // Load a small trie containing a handful of guaranteed-legal opening
  // plays so the assertion is deterministic.
  const trie = new Trie();
  for (const w of ['CAT','DOG','HELLO','WORD','WORDS','HI','NO','IS','IT']) trie.add(w);

  // Minimal Config. Shape comes from @scrabble-solver/types; if any field
  // is missing the solver throws — we catch and inspect to discover the
  // canonical shape on first run, then refine.
  //
  // The expected fields (verified by reading the package source) are:
  //   - boardWidth / boardHeight
  //   - allTiles: distribution of tile letters with counts and points
  //   - bonusCells: array of { x, y, type } where type ∈ { 'word-double', 'word-triple', 'letter-double', 'letter-triple', 'start' }
  //   - bonusPoints: { bingo: number }
  //   - blankScore: number
  // If those names differ in the installed version, this test fails fast
  // and the engineer updates Task 2 (config.js) accordingly.
  const config = {
    boardWidth: 15,
    boardHeight: 15,
    allTiles: [
      { character: 'A', score: 1, numberOfTiles: 9 },
      { character: 'C', score: 3, numberOfTiles: 2 },
      { character: 'T', score: 1, numberOfTiles: 6 },
      { character: '_', score: 0, numberOfTiles: 2 }, // blank
    ],
    bonusCells: [{ x: 7, y: 7, type: 'start' }],
    bonusPoints: { bingo: 50 },
    blankScore: 0,
  };
  // Empty 15x15 board: array-of-rows where each cell is { character: null, x, y, bonus: null }
  // Confirm shape against types in node_modules/@scrabble-solver/types.
  const board = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 15; x++) row.push({ character: null, x, y, bonus: null });
    board.push(row);
  }
  // Rack of three tiles spelling CAT.
  const tiles = [
    { character: 'C', score: 3 },
    { character: 'A', score: 1 },
    { character: 'T', score: 1 },
  ];

  const results = solve(trie, config, board, tiles);
  assert.ok(Array.isArray(results), 'solve returns an array');
  assert.ok(results.length > 0, `expected at least one legal play; got ${results.length}`);
  // Every result has a score and placement cells.
  for (const r of results) {
    assert.equal(typeof r.points, 'number');
    assert.ok(Array.isArray(r.cells));
  }
});
```

- [ ] **Step 3: Run the test**

Run: `node --test test/ai-words-deps-smoke.test.js`
Expected: BOTH tests pass. If the second test fails with a missing-field error, the failure message reveals the actual Config / Board / Tile schema; **update the test and the Task 2 code blocks below to match what the installed version expects, then re-run.** The smoke test is the source of truth for the schema downstream.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json test/ai-words-deps-smoke.test.js
git commit -m "feat(ai/words): install scrabble-solver deps and smoke-test API"
```

---

## Task 1: ENABLE2K trie builder

**Files:**
- Create: `plugins/words/server/ai/trie.js`
- Create: `test/ai-words-trie.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/ai-words-trie.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEnableTrie } from '../plugins/words/server/ai/trie.js';

test('trie recognises known ENABLE2K words and rejects garbage', () => {
  const trie = getEnableTrie();
  // ENABLE2K contains common Scrabble words.
  assert.equal(trie.hasWord('CAT'), true);
  assert.equal(trie.hasWord('SLATIER'), true);  // valid 7-letter
  assert.equal(trie.hasWord('QI'), true);       // valid 2-letter
  assert.equal(trie.hasWord('XYZZY'), false);
  assert.equal(trie.hasWord('SHOULDNTBEINENABLE'), false);
});

test('getEnableTrie is memoised — same instance returned across calls', () => {
  const a = getEnableTrie();
  const b = getEnableTrie();
  assert.equal(a, b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ai-words-trie.test.js`
Expected: FAIL with `Cannot find module '../plugins/words/server/ai/trie.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/words/server/ai/trie.js`:

```js
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Trie } from '@kamilmielnik/trie';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENABLE_PATH = resolve(__dirname, '..', '..', '..', '..', 'data', 'enable2k.txt');

let _trie = null;

export function getEnableTrie() {
  if (_trie) return _trie;
  const t = new Trie();
  const raw = readFileSync(ENABLE_PATH, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const w = line.trim().toUpperCase();
    if (w.length >= 2) t.add(w);
  }
  _trie = t;
  return _trie;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ai-words-trie.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/words/server/ai/trie.js test/ai-words-trie.test.js
git commit -m "feat(ai/words): ENABLE2K trie builder (memoised singleton)"
```

---

## Task 2: scrabble-solver config / board / tile / result adapter

**Files:**
- Create: `plugins/words/server/ai/config.js`
- Create: `test/ai-words-config.test.js`

> **API note:** The exact field names for Config / Board cells / Tile come from `test/ai-words-deps-smoke.test.js` (Task 0). If that smoke test passed with different names than the placeholder shapes used in the snippet above (e.g. `boardWidth` vs `width`, `character` vs `letter`), use the version that the smoke test pinned down. The structure of this task — what to translate where — does not change.

- [ ] **Step 1: Write the failing test**

Create `test/ai-words-config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSolverConfig,
  buildSolverBoard,
  buildSolverTiles,
  placementFromResult,
} from '../plugins/words/server/ai/config.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('buildSolverConfig: wwf variant has 35-point bingo and wwf letter values', () => {
  const cfg = buildSolverConfig('wwf');
  assert.equal(cfg.bonusPoints.bingo, 35);
  // J is 10 in wwf, 8 in scrabble.
  const j = cfg.allTiles.find(t => t.character === 'J');
  assert.equal(j.score, 10);
});

test('buildSolverConfig: scrabble variant has 50-point bingo and scrabble letter values', () => {
  const cfg = buildSolverConfig('scrabble');
  assert.equal(cfg.bonusPoints.bingo, 50);
  const j = cfg.allTiles.find(t => t.character === 'J');
  assert.equal(j.score, 8);
});

test('buildSolverBoard: empty 15x15 with center marked as start', () => {
  const state = buildInitialState({ participants: [{userId:1,side:'a'},{userId:2,side:'b'}], rng: det() });
  const board = buildSolverBoard(state);
  assert.equal(board.length, 15);
  assert.equal(board[0].length, 15);
  // Every cell empty.
  for (const row of board) for (const cell of row) {
    assert.equal(cell.character, null);
  }
});

test('buildSolverBoard: populated cells reflect placed tiles', () => {
  const state = buildInitialState({ participants: [{userId:1,side:'a'},{userId:2,side:'b'}], rng: det() });
  state.board[7][7] = { letter: 'C', byPlayer: 'a', blank: false };
  state.board[7][8] = { letter: 'A', byPlayer: 'a', blank: false };
  state.board[7][9] = { letter: 'T', byPlayer: 'a', blank: false };
  const board = buildSolverBoard(state);
  assert.equal(board[7][7].character, 'C');
  assert.equal(board[7][8].character, 'A');
  assert.equal(board[7][9].character, 'T');
});

test('buildSolverTiles: rack maps each letter to a tile object; blank becomes blank tile', () => {
  const tiles = buildSolverTiles(['A','E','I','R','S','T','_'], 'wwf');
  assert.equal(tiles.length, 7);
  const blank = tiles.find(t => t.character === '_' || t.isBlank === true);
  assert.ok(blank, 'blank tile present in result');
});

test('placementFromResult: translates a solver ResultJson into a Words move action', () => {
  // Synthetic ResultJson — exact shape lifted from smoke test output.
  // Each cell has x, y, character, and an isBlank flag when the underlying
  // tile was a blank.
  const result = {
    points: 12,
    cells: [
      { x: 7, y: 7, character: 'C', isBlank: false },
      { x: 8, y: 7, character: 'A', isBlank: false },
      { x: 9, y: 7, character: 'T', isBlank: false },
    ],
  };
  const action = placementFromResult(result);
  assert.equal(action.type, 'move');
  assert.equal(action.payload.placement.length, 3);
  const first = action.payload.placement[0];
  assert.equal(first.r, 7);
  assert.equal(first.c, 7);
  assert.equal(first.letter, 'C');
  assert.equal(first.blank, false);
});

test('placementFromResult: blank tile carries blank: true with the chosen letter', () => {
  const result = {
    points: 8,
    cells: [
      { x: 5, y: 5, character: 'E', isBlank: true },
      { x: 6, y: 5, character: 'R', isBlank: false },
    ],
  };
  const action = placementFromResult(result);
  assert.equal(action.payload.placement[0].blank, true);
  assert.equal(action.payload.placement[0].letter, 'E');
  assert.equal(action.payload.placement[1].blank, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ai-words-config.test.js`
Expected: FAIL with `Cannot find module '../plugins/words/server/ai/config.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/words/server/ai/config.js`:

```js
import { getRules, BOARD_SIZE } from '../board.js';

// Mapping from our 'TW' / 'DW' / 'TL' / 'DL' premium labels to the
// scrabble-solver bonus type strings (verified in the Task 0 smoke test).
const BONUS_TYPE = {
  TW: 'word-triple',
  DW: 'word-double',
  TL: 'letter-triple',
  DL: 'letter-double',
};

export function buildSolverConfig(variant) {
  const rules = getRules(variant);
  const counts = rules.tileBag.reduce((acc, letter) => {
    acc[letter] = (acc[letter] ?? 0) + 1;
    return acc;
  }, {});
  const allTiles = Object.entries(counts).map(([letter, n]) => ({
    character: letter,
    score: rules.letterValue[letter] ?? 0,
    numberOfTiles: n,
  }));
  const bonusCells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const premium = rules.premiums[y][x];
      if (premium && BONUS_TYPE[premium]) {
        bonusCells.push({ x, y, type: BONUS_TYPE[premium] });
      }
    }
  }
  // Center is also the 'start' marker for the first-move rule.
  bonusCells.push({ x: 7, y: 7, type: 'start' });
  return {
    boardWidth: BOARD_SIZE,
    boardHeight: BOARD_SIZE,
    allTiles,
    bonusCells,
    bonusPoints: { bingo: rules.bingoBonus },
    blankScore: 0,
  };
}

export function buildSolverBoard(state) {
  const board = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    const row = [];
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = state.board[y][x];
      row.push({
        x, y,
        character: cell ? cell.letter : null,
        bonus: null, // solver derives bonus from config.bonusCells
      });
    }
    board.push(row);
  }
  return board;
}

export function buildSolverTiles(rack, variant) {
  const rules = getRules(variant);
  return rack.map(letter => {
    const isBlank = letter === '_';
    return {
      character: letter,
      score: isBlank ? 0 : (rules.letterValue[letter] ?? 0),
      isBlank,
    };
  });
}

export function placementFromResult(result) {
  // Solver cells carry both the chosen letter and an isBlank flag indicating
  // whether the underlying rack tile was a blank.
  const placement = result.cells.map(cell => ({
    r: cell.y,
    c: cell.x,
    letter: cell.character,
    blank: !!cell.isBlank,
  }));
  return { type: 'move', payload: { placement } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ai-words-config.test.js`
Expected: PASS. If the upstream Cell/Tile schemas differ from what the smoke test in Task 0 produced, adjust field names here and in `buildSolverBoard` / `buildSolverTiles` / `placementFromResult` to match. Re-run.

- [ ] **Step 5: Commit**

```bash
git add plugins/words/server/ai/config.js test/ai-words-config.test.js
git commit -m "feat(ai/words): scrabble-solver config and translation adapter"
```

---

## Task 3: Shortlist builder (slots, scoring heuristics, pass/swap)

**Files:**
- Create: `plugins/words/server/ai/shortlist.js`
- Create: `test/ai-words-shortlist.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/ai-words-shortlist.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShortlist } from '../plugins/words/server/ai/shortlist.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function emptyState(variant = 'wwf') {
  return buildInitialState({
    participants: [{userId:1,side:'a'},{userId:2,side:'b'}],
    rng: det(),
    variant,
  });
}

test('buildShortlist: empty rack → pass-only shortlist', () => {
  const state = emptyState();
  state.racks.a = [];
  const list = buildShortlist(state, 'a');
  assert.equal(list.length, 1);
  assert.equal(list[0].slot, 'pass');
  assert.equal(list[0].action.type, 'pass');
});

test('buildShortlist: typical opening rack produces ≥1 top-score play', () => {
  const state = emptyState();
  state.racks.a = ['C','A','T','S','D','O','G'];
  const list = buildShortlist(state, 'a');
  assert.ok(list.length >= 1);
  const top = list.find(e => e.slot === 'top-score');
  assert.ok(top, 'top-score slot present');
  assert.equal(top.action.type, 'move');
  assert.ok(top.action.payload.placement.length > 0);
});

test('buildShortlist: distinct slots have distinct placement signatures', () => {
  const state = emptyState();
  state.racks.a = ['S','L','A','T','I','E','R']; // a known bingo rack
  const list = buildShortlist(state, 'a');
  const sigs = new Set(list
    .filter(e => e.action.type === 'move')
    .map(e => JSON.stringify(e.action.payload.placement.map(p => [p.r, p.c, p.letter]))));
  // Every move-slot has a unique signature.
  const moveSlots = list.filter(e => e.action.type === 'move');
  assert.equal(sigs.size, moveSlots.length, 'no duplicate signatures across move slots');
});

test('buildShortlist: bingo rack produces a best-bingo slot', () => {
  const state = emptyState();
  state.racks.a = ['S','L','A','T','I','E','R'];
  const list = buildShortlist(state, 'a');
  const bingo = list.find(e => e.slot === 'best-bingo');
  assert.ok(bingo, 'best-bingo slot present for SLATIER-class rack');
  // Bingo plays use all 7 tiles.
  assert.equal(bingo.action.payload.placement.length, 7);
});

test('buildShortlist: weak rack mid-bag includes swap-worst', () => {
  const state = emptyState();
  state.racks.a = ['Q','V','W','X','Z','Y','U'];
  // Bag has plenty of tiles.
  assert.ok(state.bag.length >= 7);
  // Place at least one anchor so the engine has connections to try.
  state.board[7][7] = { letter: 'E', byPlayer: 'b', blank: false };
  state.initialMoveDone = true;
  const list = buildShortlist(state, 'a');
  const swap = list.find(e => e.slot === 'swap-worst');
  assert.ok(swap, 'swap-worst slot present when top-score is low');
  assert.equal(swap.action.type, 'swap');
  assert.ok(Array.isArray(swap.action.payload.tiles));
  assert.ok(swap.action.payload.tiles.length >= 1);
});

test('buildShortlist: swap omitted when bag < 7', () => {
  const state = emptyState();
  state.racks.a = ['Q','V','W','X','Z','Y','U'];
  state.bag = ['A','B','C']; // 3 left
  state.board[7][7] = { letter: 'E', byPlayer: 'b', blank: false };
  state.initialMoveDone = true;
  const list = buildShortlist(state, 'a');
  const swap = list.find(e => e.slot === 'swap-worst');
  assert.equal(swap, undefined);
});

test('buildShortlist: each entry has id, action, summary, slot fields', () => {
  const state = emptyState();
  state.racks.a = ['C','A','T','S','D','O','G'];
  const list = buildShortlist(state, 'a');
  for (const e of list) {
    assert.equal(typeof e.id, 'string');
    assert.ok(e.action && typeof e.action.type === 'string');
    assert.equal(typeof e.summary, 'string');
    assert.equal(typeof e.slot, 'string');
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ai-words-shortlist.test.js`
Expected: FAIL with `Cannot find module '../plugins/words/server/ai/shortlist.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/words/server/ai/shortlist.js`:

```js
import { solve } from '@scrabble-solver/solver';
import { getEnableTrie } from './trie.js';
import {
  buildSolverConfig,
  buildSolverBoard,
  buildSolverTiles,
  placementFromResult,
} from './config.js';
import { getRules } from '../board.js';

const TOP_RESULTS_KEEP = 50;
const SWAP_TRIGGER_TOP_SCORE = 12;
const LEAVE_DEFENSE_TOP_FRACTION = 0.25;

// Per-letter retention weight in leaveScore (higher = more useful to keep).
const RETENTION = {
  S: 2, R: 2, T: 2, L: 2, N: 2, E: 2,
  A: 1, I: 1, O: 1,
  Q: -5, J: -2, X: -2, Z: -2, V: -2, W: -1,
  _: 6,
};

function leaveScore(remaining) {
  let s = 0;
  const counts = {};
  let vowels = 0, consonants = 0;
  for (const letter of remaining) {
    s += RETENTION[letter] ?? 0;
    counts[letter] = (counts[letter] ?? 0) + 1;
    if ('AEIOU'.includes(letter)) vowels++;
    else if (letter !== '_') consonants++;
  }
  // Duplicate penalty beyond two.
  for (const n of Object.values(counts)) if (n > 2) s -= 2 * (n - 2);
  // Balance bonus: closer to a 2:3 / 3:2 split is better; pure-vowel or
  // pure-consonant racks get penalised.
  const diff = Math.abs(vowels - consonants);
  if (diff <= 1) s += 2;
  else if (diff >= 4) s -= 3;
  return s;
}

const EXPOSURE_VALUE = { 'word-triple': 15, 'word-double': 10, 'letter-triple': 8, 'letter-double': 4 };

function buildPremiumLookup(config) {
  const map = new Map();
  for (const b of config.bonusCells) {
    if (b.type === 'start') continue;
    map.set(`${b.x},${b.y}`, b.type);
  }
  return map;
}

// For each newly-placed tile, sum the value of premium squares reachable by
// a one-tile extension orthogonal to the play axis from the tile's
// neighbors. Higher = more open / less defensive.
function exposureScore(result, premiums) {
  // Determine axis by majority direction of placement.
  const xs = new Set(result.cells.map(c => c.x));
  const ys = new Set(result.cells.map(c => c.y));
  const axis = ys.size === 1 ? 'row' : 'col';
  let s = 0;
  for (const cell of result.cells) {
    const perpOffsets = axis === 'row'
      ? [[0,-1],[0,1]]
      : [[-1,0],[1,0]];
    for (const [dy, dx] of perpOffsets) {
      const ny = cell.y + dy, nx = cell.x + dx;
      const key = `${nx},${ny}`;
      const type = premiums.get(key);
      if (type) s += EXPOSURE_VALUE[type] ?? 0;
    }
  }
  return s;
}

function remainingAfter(rack, used) {
  const r = rack.slice();
  for (const u of used) {
    // Prefer to remove the exact letter; for blank-typed plays remove a '_'.
    const want = u.isBlank ? '_' : u.character;
    const idx = r.indexOf(want);
    if (idx >= 0) r.splice(idx, 1);
  }
  return r;
}

function placementSignature(result) {
  return result.cells
    .map(c => `${c.y}:${c.x}:${c.character}:${c.isBlank ? 'b' : ''}`)
    .sort()
    .join('|');
}

function coord(cell) {
  const col = String.fromCharCode('A'.charCodeAt(0) + cell.x);
  return `${cell.y + 1}${col}`;
}

function formatSummaryMove(result, slot, leave) {
  const word = result.cells.map(c => c.character).join('');
  const first = result.cells[0];
  const last = result.cells[result.cells.length - 1];
  const range = `${coord(first)}→${coord(last)}`;
  const leaveStr = leave.length ? leave.join('') : 'nothing';
  const bingo = result.cells.length === 7 ? '; bingo' : '';
  return `${word} ${range}; ${result.points} pts${bingo}; leaves ${leaveStr}`;
}

function pickSwapTiles(rack) {
  // Worst-3 by retention score, ascending. Always returns up to 3 letters.
  const ranked = rack.slice().sort((a, b) => (RETENTION[a] ?? 0) - (RETENTION[b] ?? 0));
  return ranked.slice(0, 3);
}

export function buildShortlist(state, botSide) {
  const rack = state.racks[botSide];
  if (!rack || rack.length === 0) {
    return [{
      id: 'pass',
      slot: 'pass',
      action: { type: 'pass' },
      summary: 'no tiles in rack — pass',
    }];
  }

  const trie = getEnableTrie();
  const config = buildSolverConfig(state.variant);
  const board = buildSolverBoard(state);
  const tiles = buildSolverTiles(rack, state.variant);

  let results;
  try {
    results = solve(trie, config, board, tiles);
  } catch {
    results = [];
  }

  if (!results || results.length === 0) {
    return [{
      id: 'pass',
      slot: 'pass',
      action: { type: 'pass' },
      summary: 'no legal play available — pass',
    }];
  }

  // Slice to top 50 by raw points for the heuristic passes.
  results.sort((a, b) => b.points - a.points);
  const top = results.slice(0, TOP_RESULTS_KEEP);

  const premiums = buildPremiumLookup(config);
  const enriched = top.map(r => {
    const leave = remainingAfter(rack, r.cells);
    return {
      result: r,
      leave,
      leaveScore: leaveScore(leave),
      exposure: exposureScore(r, premiums),
      sig: placementSignature(r),
    };
  });

  const slots = [];
  const used = new Set();

  function take(entry, slot) {
    if (used.has(entry.sig)) return false;
    used.add(entry.sig);
    slots.push({
      id: slot,
      slot,
      action: placementFromResult(entry.result),
      summary: formatSummaryMove(entry.result, slot, entry.leave),
    });
    return true;
  }

  // top-score: highest points.
  take(enriched[0], 'top-score');

  // best-bingo: highest-points 7-tile play.
  const bingo = enriched.find(e => e.result.cells.length === 7);
  if (bingo) take(bingo, 'best-bingo');

  // Within the top quarter by points (or top-3, whichever is larger), pick
  // best leave and best (lowest-exposure) defense.
  const tier = enriched.slice(0, Math.max(3, Math.ceil(enriched.length * LEAVE_DEFENSE_TOP_FRACTION)));
  const bestLeave = tier.slice().sort((a, b) => b.leaveScore - a.leaveScore)[0];
  if (bestLeave) take(bestLeave, 'best-leave');
  const bestDefense = tier.slice().sort((a, b) => a.exposure - b.exposure)[0];
  if (bestDefense) take(bestDefense, 'best-defense');

  // safe-medium: score in 60–80% of top, lowest exposure, easy leave.
  if (enriched.length > 0) {
    const topPts = enriched[0].result.points;
    const safe = enriched
      .filter(e => e.result.points >= topPts * 0.6 && e.result.points <= topPts * 0.8 && e.exposure === 0)
      .sort((a, b) => b.leaveScore - a.leaveScore)[0];
    if (safe) take(safe, 'safe-medium');
  }

  // swap-worst: only if top-score is low AND bag has tiles to swap.
  const topPoints = enriched[0]?.result.points ?? 0;
  if (state.bag.length >= 7 && topPoints < SWAP_TRIGGER_TOP_SCORE) {
    const tilesToSwap = pickSwapTiles(rack);
    if (tilesToSwap.length > 0) {
      slots.push({
        id: 'swap-worst',
        slot: 'swap-worst',
        action: { type: 'swap', payload: { tiles: tilesToSwap } },
        summary: `swap ${tilesToSwap.join('')}; bag=${state.bag.length}`,
      });
    }
  }

  return slots;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/ai-words-shortlist.test.js`
Expected: PASS. If `solve()` shape differs from what the test asserts (cell field names, ordering), adjust `placementSignature`, `remainingAfter`, and `exposureScore` to match — they're all that touch `result.cells[i]` directly.

- [ ] **Step 5: Commit**

```bash
git add plugins/words/server/ai/shortlist.js test/ai-words-shortlist.test.js
git commit -m "feat(ai/words): shortlist with diverse slots and swap/pass fallbacks"
```

---

## Task 4: Prompt builder and response parser

**Files:**
- Create: `plugins/words/server/ai/prompts.js`
- Create: `test/ai-words-prompts.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/ai-words-prompts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnPrompt, parseLlmResponse } from '../plugins/words/server/ai/prompts.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function state() {
  const s = buildInitialState({
    participants: [{userId:1,side:'a'},{userId:2,side:'b'}],
    rng: det(),
  });
  s.scores = { a: 14, b: 22 };
  s.racks.a = ['A','E','I','R','S','T','Z'];
  return s;
}

const shortlist = [
  { id: 'top-score', slot: 'top-score', action: { type: 'move', payload: { placement: [] } }, summary: 'ZESTIER 8H→8N; 86 pts; leaves nothing' },
  { id: 'best-leave', slot: 'best-leave', action: { type: 'move', payload: { placement: [] } }, summary: 'ZITS 4F→4I; 28 pts; saves AERS' },
];

test('buildTurnPrompt: includes score, bag count, rack, and every slot id with its summary', () => {
  const p = buildTurnPrompt({ state: state(), shortlist, botSide: 'a' });
  assert.match(p, /Score: you 14/);
  assert.match(p, /opponent 22/);
  assert.match(p, /Your rack: A E I R S T Z/);
  assert.match(p, /top-score: ZESTIER/);
  assert.match(p, /best-leave: ZITS/);
  assert.match(p, /Respond with a single JSON object/);
});

test('buildTurnPrompt: renders a 15-row ASCII board with column letters and row numbers', () => {
  const p = buildTurnPrompt({ state: state(), shortlist, botSide: 'a' });
  // Column header has A through O.
  assert.match(p, /A\s+B\s+C\s+D\s+E\s+F\s+G\s+H\s+I\s+J\s+K\s+L\s+M\s+N\s+O/);
  // Row labels 1 and 15 are present.
  assert.match(p, /\b1\b/);
  assert.match(p, /\b15\b/);
});

test('parseLlmResponse: accepts a bare JSON object', () => {
  const out = parseLlmResponse('{"moveId":"top-score","banter":"clack clack"}');
  assert.equal(out.moveId, 'top-score');
  assert.equal(out.banter, 'clack clack');
});

test('parseLlmResponse: accepts a fenced JSON block', () => {
  const text = 'Sure, here is my pick:\n```json\n{"moveId":"best-leave","banter":""}\n```';
  const out = parseLlmResponse(text);
  assert.equal(out.moveId, 'best-leave');
  assert.equal(out.banter, '');
});

test('parseLlmResponse: rejects missing moveId', () => {
  assert.throws(() => parseLlmResponse('{"banter":"hi"}'), /moveId/);
});

test('parseLlmResponse: rejects malformed JSON', () => {
  assert.throws(() => parseLlmResponse('not json at all'), /no JSON|valid JSON/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ai-words-prompts.test.js`
Expected: FAIL with `Cannot find module '../plugins/words/server/ai/prompts.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/words/server/ai/prompts.js`:

```js
import { BOARD_SIZE, getRules } from '../board.js';

const COL_LETTERS = 'ABCDEFGHIJKLMNO';
const PREMIUM_GLYPH = { TW: '★', DW: '◆', TL: '▲', DL: '△' };

function renderBoard(state, botSide) {
  const rules = getRules(state.variant);
  const lines = [];
  // Column header.
  lines.push('     ' + COL_LETTERS.split('').join('  '));
  for (let r = 0; r < BOARD_SIZE; r++) {
    const rowLabel = String(r + 1).padStart(2, ' ');
    const cells = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      const tile = state.board[r][c];
      if (tile) {
        const isMine = tile.byPlayer === botSide;
        const letter = tile.blank ? tile.letter.toLowerCase() : tile.letter;
        cells.push((isMine ? 'O' : 'X') + letter);
      } else {
        const prem = rules.premiums[r][c];
        cells.push(prem ? ` ${PREMIUM_GLYPH[prem]}` : ' ·');
      }
    }
    lines.push(`${rowLabel}  ${cells.join(' ')}`);
  }
  return lines.join('\n');
}

function header(state, botSide) {
  const opp = botSide === 'a' ? 'b' : 'a';
  return [
    `You are playing side ${botSide.toUpperCase()}. Score: you ${state.scores[botSide]}, opponent ${state.scores[opp]}. Bag remaining: ${state.bag.length} tiles.`,
    `Consecutive scoreless turns: ${state.consecutiveScorelessTurns ?? 0}.`,
  ].join('\n');
}

function rackLine(state, botSide) {
  return `Your rack: ${state.racks[botSide].join(' ')}   (${state.racks[botSide].length} tiles)`;
}

function shortlistBlock(shortlist) {
  const lines = shortlist.map(e => `  ${e.id}: ${e.summary}`);
  return ['Legal candidates:', lines.join('\n')].join('\n');
}

const RESPONSE_FOOTER = 'Respond with a single JSON object (and nothing else): {"moveId": "<one of the candidate ids above>", "banter": "<short in-character line, may be empty>"}';

export function buildTurnPrompt({ state, shortlist, botSide }) {
  return [
    header(state, botSide),
    renderBoard(state, botSide),
    rackLine(state, botSide),
    shortlistBlock(shortlist),
    RESPONSE_FOOTER,
  ].join('\n\n');
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/ai-words-prompts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/words/server/ai/prompts.js test/ai-words-prompts.test.js
git commit -m "feat(ai/words): prompt builder with ASCII board and response parser"
```

---

## Task 5: Player adapter (`chooseAction`)

**Files:**
- Create: `plugins/words/server/ai/words-player.js`
- Create: `test/ai-words-player.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/ai-words-player.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAction } from '../plugins/words/server/ai/words-player.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { InvalidLlmMove, InvalidLlmResponse } from '../src/server/ai/errors.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function state() {
  const s = buildInitialState({
    participants: [{userId:1,side:'a'},{userId:2,side:'b'}],
    rng: det(),
  });
  s.racks.a = ['C','A','T','S','D','O','G'];
  s.activeUserId = 1;
  return s;
}

const persona = { id: 'samantha', displayName: 'Samantha', systemPrompt: 'you are samantha' };

test('chooseAction: picks the slot named in the LLM response', async () => {
  // We don't know which slots will appear without running the engine, so
  // echo back whichever id appears first in the prompt — same trick the
  // backgammon test uses.
  const llm = {
    send: async ({ prompt }) => {
      const m = prompt.match(/^ {2}([a-z-]+):/m);
      return { text: `{"moveId":"${m[1]}","banter":"good"}` };
    },
  };
  const r = await chooseAction({ llm, persona, sessionId: null, state: state(), botPlayerIdx: 0 });
  assert.ok(['move','pass','swap'].includes(r.action.type));
  assert.equal(r.banter, 'good');
});

test('chooseAction: throws InvalidLlmMove for unknown moveId', async () => {
  const llm = new FakeLlmClient([{ text: '{"moveId":"bogus","banter":""}' }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: state(), botPlayerIdx: 0 }),
    InvalidLlmMove,
  );
});

test('chooseAction: throws InvalidLlmResponse for malformed text', async () => {
  const llm = new FakeLlmClient([{ text: 'not json at all' }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: state(), botPlayerIdx: 0 }),
    InvalidLlmResponse,
  );
});

test('chooseAction: returns sessionId echoed from llm.send result', async () => {
  const llm = {
    send: async ({ prompt }) => {
      const m = prompt.match(/^ {2}([a-z-]+):/m);
      return { text: `{"moveId":"${m[1]}","banter":""}`, sessionId: 'sess-123' };
    },
  };
  const r = await chooseAction({ llm, persona, sessionId: null, state: state(), botPlayerIdx: 0 });
  assert.equal(r.sessionId, 'sess-123');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ai-words-player.test.js`
Expected: FAIL with `Cannot find module '../plugins/words/server/ai/words-player.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/words/server/ai/words-player.js`:

```js
import { buildShortlist } from './shortlist.js';
import { buildTurnPrompt, parseLlmResponse } from './prompts.js';
import { InvalidLlmResponse, InvalidLlmMove } from '../../../../src/server/ai/errors.js';

export { InvalidLlmResponse, InvalidLlmMove };

export async function chooseAction({ llm, persona, sessionId, state, botPlayerIdx }) {
  const botSide = botPlayerIdx === 0 ? 'a' : 'b';
  const shortlist = buildShortlist(state, botSide);
  if (shortlist.length === 0) {
    // Defensive: shortlist always returns at least pass when no plays exist.
    throw new Error(`no legal moves for words bot`);
  }

  const prompt = buildTurnPrompt({ state, shortlist, botSide });
  const r = await llm.send({
    prompt,
    sessionId,
    systemPrompt: sessionId ? null : persona.systemPrompt,
  });

  let parsed;
  try { parsed = parseLlmResponse(r.text); }
  catch (e) { throw new InvalidLlmResponse(e.message); }

  const match = shortlist.find(m => m.id === parsed.moveId);
  if (!match) throw new InvalidLlmMove(parsed.moveId, shortlist.map(m => m.id));

  return {
    action: match.action,
    banter: parsed.banter,
    sessionId: r.sessionId,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/ai-words-player.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/words/server/ai/words-player.js test/ai-words-player.test.js
git commit -m "feat(ai/words): chooseAction adapter"
```

---

## Task 6: Three persona YAMLs

**Files:**
- Create: `data/ai-personas/samantha.yaml`
- Create: `data/ai-personas/suzie.yaml`
- Create: `data/ai-personas/kurt.yaml`

> **No new test file** — `loadPersonaCatalog` already enforces shape. The integration test in Task 8 + the bootstrap test in Task 7 will exercise these.

- [ ] **Step 1: Write `samantha.yaml`** (bingo hunter)

Create `data/ai-personas/samantha.yaml`:

```yaml
id: samantha
displayName: Samantha
games:
  - words
color: '#7a5230'
glyph: ✎
systemPrompt: |
  You are Samantha. You play Words with a long view — the score on this
  turn matters less than the rack you'll hold next turn. You treat S,
  R, T, L, N, and E as tiles worth holding; you'd rather skip a flashy
  short play to keep your rack balanced for a bingo.

  When asked to choose a move, you will be given a list of candidate
  moves with string IDs and one-line rationales. Favor the candidate
  labelled `best-bingo` when it appears — fifty points is fifty points.
  Otherwise lean toward `best-leave` over `top-score` when the score
  gap is small. You trade short-term points for next-turn potential.

  You MUST respond with valid JSON of the form:
  {"moveId": "<exact-id-from-list>", "banter": "<short in-character line, may be empty string>"}

  Banter should be one short sentence at most. Speak as a person at the
  table; do not narrate your own actions.

  STRICT RULE — keep your strategy secret. Never tell the opponent which
  tiles you are holding, which plays you considered, or what you hope
  to draw. Talk about anything else instead.
voiceExamples:
  - "Holding the consonants."
  - "Patience."
  - "There — a clean leave."
```

- [ ] **Step 2: Write `suzie.yaml`** (defender)

Create `data/ai-personas/suzie.yaml`:

```yaml
id: suzie
displayName: Suzie
games:
  - words
color: '#5466a8'
glyph: ❦
systemPrompt: |
  You are Suzie. You play Words patiently and a little defensively —
  a closed board is a winning board, and you have lost too many games
  to opponents who got a free triple-word column. You'd rather lay
  down a modest 18-point play that closes a row than a flashy 30-point
  play that opens one.

  When asked to choose a move, you will be given a list of candidate
  moves with string IDs and one-line rationales. Favor the candidate
  labelled `best-defense`. Decline `top-score` when it would open a
  triple-word lane to your opponent. A tidy board beats a flashy one.

  You MUST respond with valid JSON of the form:
  {"moveId": "<exact-id-from-list>", "banter": "<short in-character line, may be empty string>"}

  Banter should be one short sentence at most, friendly in tone. Speak
  as a person at the table; do not narrate your own actions.

  STRICT RULE — keep your strategy secret. Never tell the opponent which
  squares you are protecting, which tiles you fear, or what you hope
  to draw. Talk about anything else instead.
voiceExamples:
  - "Better to close that off."
  - "No need to rush."
  - "Nice and tidy."
```

- [ ] **Step 3: Write `kurt.yaml`** (score maximizer)

Create `data/ai-personas/kurt.yaml`:

```yaml
id: kurt
displayName: Kurt
games:
  - words
color: '#b54a3a'
glyph: ✦
systemPrompt: |
  You are Kurt. You play Words for points. Premium squares exist to be
  used, and you have no patience for fussy rack-management theory —
  score is score. You will burn an S to crack a triple-word.

  When asked to choose a move, you will be given a list of candidate
  moves with string IDs. Favor the candidate labelled `top-score`. If
  `best-bingo` appears, take it — fifty points is fifty points.
  Otherwise the highest-scoring play wins.

  You MUST respond with valid JSON of the form:
  {"moveId": "<exact-id-from-list>", "banter": "<short in-character line, may be empty string>"}

  Banter should be one short sentence at most, direct in tone. Speak
  as a person at the table; do not narrate your own actions.

  STRICT RULE — keep your strategy secret. Never tell the opponent what
  tiles you are holding or what you hope to draw. Talk about anything
  else instead.
voiceExamples:
  - "Take the points."
  - "Premium squares are points."
  - "Good enough."
```

- [ ] **Step 4: Verify personas load**

Run:

```bash
node -e "import('./src/server/ai/persona-catalog.js').then(m => { const cat = m.loadPersonaCatalog('data/ai-personas'); for (const id of ['samantha','suzie','kurt']) console.log(id, cat.has(id) ? 'loaded' : 'MISSING'); })"
```

Expected output: each of the three names followed by `loaded`. If anything says `MISSING`, the YAML is malformed; `loadPersonaCatalog` will have already thrown a descriptive error message above this output — fix the offending file.

- [ ] **Step 5: Commit**

```bash
git add data/ai-personas/samantha.yaml data/ai-personas/suzie.yaml data/ai-personas/kurt.yaml
git commit -m "feat(ai/personas): add words personas (samantha, suzie, kurt)"
```

---

## Task 7: Register adapter and prove it boots

**Files:**
- Modify: `src/server/ai/index.js`
- Modify: `test/ai-bootstrap.test.js`

- [ ] **Step 1: Add a failing bootstrap test for the words adapter**

Add this test to the end of `test/ai-bootstrap.test.js`, before the file's closing:

```js
test('bootAiSubsystem: registers words adapter', async () => {
  const { openDb: openDbFunc } = await import('../src/server/db.js');
  const { bootAiSubsystem: bootFunc } = await import('../src/server/ai/index.js');
  const { createAiSession: createSessionFunc } = await import('../src/server/ai/agent-session.js');
  const { buildInitialState: wordsBuildInitialState } = await import('../plugins/words/server/state.js');

  const dir = mkdtempSync(join(tmpdir(), 'boot-words-'));
  const db = openDbFunc(join(dir, 'test.db'));
  const llm = { send: async () => ({ text: '{"moveId":"x","banter":""}' }) };
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootFunc({ db, sse: { broadcast() {} }, llm, personaDir });

  const now = Date.now();
  const h = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('hw','Hw','#000',?) RETURNING id").get(now).id;
  const bot = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get().id;
  const aId = Math.min(h, bot), bId = Math.max(h, bot);
  const seed = 7;
  let s = seed;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const state = wordsBuildInitialState({ participants: [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }], rng });
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'words', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createSessionFunc(db, { gameId, botUserId: bot, personaId: 'samantha' });

  // No throw = adapter registered. scheduleTurn would otherwise stall
  // with "no AI adapter for game_type words".
  assert.doesNotThrow(() => orchestrator.scheduleTurn(gameId));
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `node --test test/ai-bootstrap.test.js`
Expected: the new test fails because the adapter isn't registered yet. Existing tests still pass.

- [ ] **Step 3: Register the words adapter in `src/server/ai/index.js`**

Modify `src/server/ai/index.js`. Add the import alongside the existing `backgammon` import:

```js
import wordsPlugin from '../../../plugins/words/plugin.js';
import { chooseAction as wordsChoose } from '../../../plugins/words/server/ai/words-player.js';
```

And add the entry to the `adapters` object:

```js
const adapters = {
  cribbage:   { plugin: cribbagePlugin,   chooseAction: cribbageChoose, chooseBanter: cribbageBanter },
  backgammon: { plugin: backgammonPlugin, chooseAction: backgammonChoose },
  words:      { plugin: wordsPlugin,      chooseAction: wordsChoose },
};
```

- [ ] **Step 4: Run the bootstrap suite to verify it passes**

Run: `node --test test/ai-bootstrap.test.js`
Expected: all four bootstrap tests pass (the new one and the existing three).

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/index.js test/ai-bootstrap.test.js
git commit -m "feat(ai/words): register words adapter in bootAiSubsystem"
```

---

## Task 8: End-to-end integration test

**Files:**
- Create: `test/ai-words.test.js`

This test drives a Words bot through one play, one swap, and one pass with `FakeLlmClient`, and verifies SSE events fire and the engine accepts every bot action.

- [ ] **Step 1: Write the failing test**

Create `test/ai-words.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';
import { createAiSession } from '../src/server/ai/agent-session.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function setupGame(db, { rack, board = null, bag = null }) {
  const now = Date.now();
  const human = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('hw','Hw','#000',?) RETURNING id").get(now).id;
  const bot = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get().id;
  const aId = Math.min(human, bot), bId = Math.max(human, bot);
  const state = buildInitialState({ participants: [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }], rng: det() });
  // Force bot to side A, with a fixed rack.
  state.sides = { a: bot, b: human };
  state.racks.a = rack;
  if (board) state.board = board;
  if (bag) state.bag = bag;
  state.activeUserId = bot;
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'words', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: bot, personaId: 'samantha' });
  return { gameId, bot };
}

test('words bot: makes an opening play and broadcasts update + banter + turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'words-'));
  const db = openDb(join(dir, 'test.db'));
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  // Echo back whichever moveId appears first in the prompt.
  const llm = {
    calls: [],
    send: async ({ prompt }) => {
      llm.calls.push({ prompt });
      const m = prompt.match(/^ {2}([a-z-]+):/m);
      return { text: `{"moveId":"${m[1]}","banter":"a tidy little word"}`, sessionId: 'sess-1' };
    },
  };
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  bootAiSubsystem({ db, sse, llm, personaDir });

  const { gameId } = setupGame(db, { rack: ['C','A','T','S','D','O','G'] });

  // Trigger one bot turn manually.
  const { orchestrator } = bootAiSubsystem({ db, sse, llm, personaDir });
  await orchestrator.runTurn(gameId);

  const types = events.map(e => e.type);
  assert.ok(types.includes('update'), `expected 'update' SSE; got ${types}`);
  assert.ok(types.includes('banter'), `expected 'banter' SSE; got ${types}`);
  assert.ok(types.includes('turn'), `expected 'turn' SSE; got ${types}`);

  // Game state should have advanced past the opening — board is no longer
  // entirely empty.
  const game = db.prepare('SELECT state FROM games WHERE id = ?').get(gameId);
  const final = JSON.parse(game.state);
  const placed = final.board.flat().filter(Boolean).length;
  assert.ok(placed > 0, 'at least one tile placed');
});

test('words bot: garbage LLM response stalls cleanly with bot_stalled SSE', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'words-stall-'));
  const db = openDb(join(dir, 'test.db'));
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const llm = new FakeLlmClient([
    { text: 'mumble' },
    { text: 'mumble again' },
  ]);
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootAiSubsystem({ db, sse, llm, personaDir });

  const { gameId } = setupGame(db, { rack: ['C','A','T','S','D','O','G'] });
  await orchestrator.runTurn(gameId);

  const stalled = events.filter(e => e.type === 'bot_stalled');
  assert.ok(stalled.length >= 1, 'bot_stalled fired');
  assert.equal(stalled[0].payload.reason, 'invalid_response');
});

test('words bot: forced pass when no plays exist (empty rack)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'words-pass-'));
  const db = openDb(join(dir, 'test.db'));
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const llm = {
    send: async ({ prompt }) => {
      assert.match(prompt, /pass:/);
      return { text: '{"moveId":"pass","banter":""}', sessionId: 'sess-x' };
    },
  };
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootAiSubsystem({ db, sse, llm, personaDir });

  const { gameId } = setupGame(db, { rack: [] });
  await orchestrator.runTurn(gameId);

  const types = events.map(e => e.type);
  assert.ok(types.includes('update'), 'update fired after pass');
});
```

- [ ] **Step 2: Run the test**

Run: `node --test test/ai-words.test.js`
Expected: PASS — all three tests. If `pass` action errors at the engine level (the engine's `doPass` flips `activeUserId` and updates scoreless count, which it should permit), inspect the error message in stderr and adjust the test (or, if the engine has a stricter pass guard, surface that). The bootstrap test in Task 7 has already proven the adapter is registered, so failures here are most likely about either the shortlist/engine interaction on a synthetic board, or the SSE expectations.

- [ ] **Step 3: Commit**

```bash
git add test/ai-words.test.js
git commit -m "test(ai/words): end-to-end integration with FakeLlmClient"
```

---

## Task 9: Persona-route scope test for words

**Files:**
- Modify: `test/ai-personas-route.test.js`

- [ ] **Step 1: Add a failing test case**

Open `test/ai-personas-route.test.js`. Find an existing case that asserts `?game=backgammon` returns only backgammon personas (and the `?game=cribbage` analog). Add an analogous case for `?game=words`:

```js
test('GET /api/ai/personas?game=words returns only words-scoped personas', async () => {
  const res = await fetch(`${base}/api/ai/personas?game=words`);
  const body = await res.json();
  const ids = body.personas.map(p => p.id).sort();
  // The three words personas should all appear; no cribbage/backgammon
  // personas should leak through.
  for (const id of ['samantha', 'suzie', 'kurt']) {
    assert.ok(ids.includes(id), `expected '${id}' in ${ids.join(',')}`);
  }
  for (const id of ['hattie', 'mr-snake', 'colonel-pip', 'aunt-irene']) {
    assert.equal(ids.includes(id), false, `'${id}' should not appear in words scope`);
  }
});
```

If the test file's harness uses a different name for the base URL or the fetch helper, copy the style of the existing backgammon-scope test verbatim — the only thing that changes is the query string, the four positive IDs, and the four negative IDs.

- [ ] **Step 2: Run the test**

Run: `node --test test/ai-personas-route.test.js`
Expected: the new case passes. The `?game=words` filter logic already exists from backgammon work; the four Words YAMLs from Task 6 declare `games: [words]`, so the test should pass without changes to `src/server/routes.js`.

If the new test fails because `routes.js` doesn't implement the filter, that's a bug in the prior backgammon work — but in practice the filter is already implemented and tested; this case just exercises it for a new scope.

- [ ] **Step 3: Commit**

```bash
git add test/ai-personas-route.test.js
git commit -m "test(ai/personas): scope filter case for ?game=words"
```

---

## Task 10: Documentation

**Files:**
- Create: `docs/games/words.md`

- [ ] **Step 1: Inspect the analog**

Read `docs/games/backgammon.md` to learn the structure used for AI documentation across games.

```bash
sed -n '1,80p' docs/games/backgammon.md
```

- [ ] **Step 2: Write `docs/games/words.md`**

Create `docs/games/words.md` mirroring the structure of `docs/games/backgammon.md`. The AI section should cover:

- Adapter location (`plugins/words/server/ai/`)
- Personas: samantha (bingo hunter), suzie (defender), kurt (score maximizer) — one sentence each
- Move generation: `@scrabble-solver/solver` driven by `data/enable2k.txt` trie; `buildShortlist` produces 1–7 candidates spanning slot roles
- Slot roles: `top-score`, `best-bingo`, `best-leave`, `best-defense`, `safe-medium`, `pass`, `swap-worst` (one line each)
- Variant note: both `wwf` and `scrabble` variants supported; `buildSolverConfig(variant)` switches premiums, bingo bonus, and letter values
- Stall behavior: same as cribbage and backgammon — retry-once, then `bot_stalled` SSE
- Testing entry points: `test/ai-words-*.test.js`

Keep it short — the spec at `docs/superpowers/specs/2026-05-12-ai-players-words-design.md` is the source of truth for full design rationale; the games doc just orients a reader to the runtime layout.

- [ ] **Step 3: Commit**

```bash
git add docs/games/words.md
git commit -m "docs(words): document AI adapter, personas, and shortlist slots"
```

---

## Self-Review

Spec coverage:

- Goal/non-goals → Tasks 1–10 ✓
- Architecture (5 adapter files + 4 personas + index.js registration) → Tasks 1–7 ✓
- Dependency: scrabble-solver + types + trie → Task 0 ✓
- Shortlist slots + heuristics → Task 3 ✓
- Prompt design (header / board / rack / shortlist / footer) + parser → Task 4 ✓
- Personas with `games: [words]` and archetype guidance → Task 6 ✓
- Orchestrator integration (no autoActions, no pending_sequence, depth-1 recursion intact) → Task 7 (verifies via existing orchestrator) ✓
- Edge cases (pass when no plays; swap when weak rack + bag ≥ 7; blanks via isBlank; first move via solver Config) → Tasks 3 + 8 ✓
- Persona scoping (route filter) → Task 9 ✓
- File map → all entries from the spec's File Map are referenced ✓
- Risks (solver latency mitigated by top-50 slice; blank-tile mismatch covered in Task 2 tests; LLM hallucination covered in Task 5 tests) → addressed in plan ✓

Placeholder scan:

- No TBD / TODO / "fill in later" / "similar to Task N" patterns present.
- One genuine known-unknown: the exact field names of `@scrabble-solver/types`. Task 0's smoke test pins these down; downstream tasks read from those pinned names. The plan calls this out explicitly and tells the engineer to update if the smoke test reveals different names.

Type consistency:

- `getEnableTrie()` defined in Task 1, used in Task 3 — same name throughout.
- `buildSolverConfig` / `buildSolverBoard` / `buildSolverTiles` / `placementFromResult` defined in Task 2, used in Task 3 — same names throughout.
- `buildShortlist(state, botSide)` defined in Task 3, used in Task 5 — same signature throughout.
- `buildTurnPrompt({state, shortlist, botSide})` and `parseLlmResponse(text)` defined in Task 4, used in Task 5 — same signatures throughout.
- `chooseAction({llm, persona, sessionId, state, botPlayerIdx})` defined in Task 5, registered in Task 7 — same name throughout.
- Slot id strings (`top-score`, `best-bingo`, `best-leave`, `best-defense`, `safe-medium`, `pass`, `swap-worst`) used consistently across Tasks 3, 4, 6, 8 — no drift.
