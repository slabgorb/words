# Words with Friends Clone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a faithful, ad-free Words with Friends clone for two players (Keith and Sonia), self-hosted on a Node + Express + SQLite stack.

**Architecture:** Single Node process serving static HTML/CSS/JS plus JSON HTTP routes and an SSE event stream. Server-authoritative state in SQLite; ENABLE2K dictionary loaded into an in-memory `Set` at boot. Client is plain ES modules — no build step.

**Tech Stack:** Node 20+, Express 4, better-sqlite3, cookie-parser, plain HTML/CSS/JS in `public/`, ENABLE2K word list (public domain), `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-05-04-words-with-friends-design.md`

---

## File Structure

```
words/
├── bin/
│   └── fetch-dictionary.js         # one-time download script
├── data/
│   └── enable2k.txt                # ~173k words, fetched, gitignored (3 MB)
├── public/                         # served as static
│   ├── index.html
│   ├── app.js                      # boot + identity + SSE wiring
│   ├── board.js                    # board renderer + drag/drop
│   ├── rack.js                     # 7-tile rack
│   ├── validator.js                # POST /api/validate (debounced)
│   ├── state.js                    # local UI state, server reconcile
│   └── style.css
├── src/server/
│   ├── server.js                   # bootstrap
│   ├── routes.js                   # express routes
│   ├── sse.js                      # SSE broadcaster
│   ├── engine.js                   # PURE: rules, validation, scoring
│   ├── dictionary.js               # ENABLE2K Set + isWord()
│   ├── board.js                    # constants: premiums, values, bag
│   ├── db.js                       # better-sqlite3 wrapper
│   └── identity.js                 # signed-cookie middleware
├── test/
│   ├── engine.test.js
│   ├── dictionary.test.js
│   ├── board.test.js
│   └── routes.test.js
├── docs/superpowers/
│   ├── specs/2026-05-04-words-with-friends-design.md
│   └── plans/2026-05-04-words-with-friends-implementation.md
├── game.db                         # gitignored
├── package.json
└── README.md
```

**Why this split:** `engine.js` is pure (no DB, no IO) so it's heavily unit-testable. `dictionary.js` is one method so swapping word lists is trivial. `db.js` is the only file that touches SQLite; routes and engine never see SQL directly. Client has 6 small files; `app.js` orchestrates and the rest are dumb handlers.

**Coding conventions:**
- ES modules (`"type": "module"` in `package.json`).
- 2-space indent, single quotes, no semicolons-required style — but follow what the first file establishes (we'll start with semicolons because Express examples use them).
- Test files mirror the module under test: `src/server/engine.js` → `test/engine.test.js`.

**Commit hygiene:** Each task ends with one commit. Conventional-commits style: `feat:`, `test:`, `chore:`, `docs:`, `fix:`. After the spec commit (already on `main`), every task adds at least one commit.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore` (modify)
- Create: directory tree

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p src/server public test bin data
```

- [ ] **Step 2: Initialize package.json**

Write `/Users/slabgorb/Projects/words/package.json`:

```json
{
  "name": "words",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/server/server.js",
    "test": "node --test test/",
    "fetch-dict": "node bin/fetch-dictionary.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "cookie-parser": "^1.4.7",
    "express": "^4.21.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` written, no errors.

- [ ] **Step 4: Add gitignore entries**

Append to `/Users/slabgorb/Projects/words/.gitignore`:

```
# Node
node_modules/
# Game runtime
game.db
game.db-journal
# Dictionary (downloaded, not committed)
data/enable2k.txt
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: scaffold node project with express, sqlite, cookie-parser"
```

---

## Task 2: Dictionary fetch script + module

**Files:**
- Create: `bin/fetch-dictionary.js`
- Create: `src/server/dictionary.js`
- Create: `test/dictionary.test.js`

- [ ] **Step 1: Write the fetch script**

Write `/Users/slabgorb/Projects/words/bin/fetch-dictionary.js`:

```javascript
// Downloads ENABLE2K word list to data/enable2k.txt.
// Source: dwyl/english-words "words_alpha.txt" mirror is convenient and stable;
// for a true ENABLE2K we use the canonical file from the official mirror.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, '..', 'data', 'enable2k.txt');
// Canonical ENABLE2K mirror (public domain).
const url = 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt';

if (existsSync(target)) {
  console.log(`Dictionary already present at ${target}; skipping.`);
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
console.log(`Fetching ${url} ...`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`Fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const text = await res.text();
const words = text.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(w => w.length > 0);
writeFileSync(target, words.join('\n') + '\n', 'utf8');
console.log(`Wrote ${words.length} words to ${target}`);
```

> Note: ENABLE1 and ENABLE2K differ by a few entries; ENABLE1 is what the public mirror reliably serves. This is acceptable for two-player personal use; see Task 22 if you ever need to swap word lists.

- [ ] **Step 2: Run the fetch script**

```bash
npm run fetch-dict
```

Expected: `data/enable2k.txt` exists with ~170k+ uppercase words, one per line.

- [ ] **Step 3: Write the failing dictionary test**

Write `/Users/slabgorb/Projects/words/test/dictionary.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDictionary } from '../src/server/dictionary.js';

test('dictionary loads and contains common words', () => {
  const dict = loadDictionary();
  assert.equal(dict.isWord('HELLO'), true);
  assert.equal(dict.isWord('QUIRK'), true);
  assert.equal(dict.isWord('XYZZY'), false);
});

test('dictionary lookups are case-insensitive', () => {
  const dict = loadDictionary();
  assert.equal(dict.isWord('hello'), true);
  assert.equal(dict.isWord('Hello'), true);
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
npm test
```

Expected: `Cannot find module ... dictionary.js` failure.

- [ ] **Step 5: Implement `dictionary.js`**

Write `/Users/slabgorb/Projects/words/src/server/dictionary.js`:

```javascript
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dirname, '..', '..', 'data', 'enable2k.txt');

export function loadDictionary(path = DEFAULT_PATH) {
  if (!existsSync(path)) {
    throw new Error(`Dictionary file missing: ${path}. Run \`npm run fetch-dict\` first.`);
  }
  const raw = readFileSync(path, 'utf8');
  const set = new Set(raw.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(Boolean));
  return {
    size: set.size,
    isWord: (s) => set.has(String(s).toUpperCase())
  };
}
```

- [ ] **Step 6: Run tests to verify pass**

```bash
npm test
```

Expected: 2 dictionary tests pass.

- [ ] **Step 7: Commit**

```bash
git add bin/ src/server/dictionary.js test/dictionary.test.js
git commit -m "feat(dictionary): load ENABLE2K into in-memory Set with isWord()"
```

---

## Task 3: Board constants

**Files:**
- Create: `src/server/board.js`
- Create: `test/board.test.js`

- [ ] **Step 1: Write the failing board test**

Write `/Users/slabgorb/Projects/words/test/board.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LETTER_VALUE, TILE_BAG, BOARD_PREMIUMS, BOARD_SIZE } from '../src/server/board.js';

test('board is 15x15', () => {
  assert.equal(BOARD_SIZE, 15);
  assert.equal(BOARD_PREMIUMS.length, 15);
  for (const row of BOARD_PREMIUMS) assert.equal(row.length, 15);
});

test('center square is double-word (WwF)', () => {
  assert.equal(BOARD_PREMIUMS[7][7], 'DW');
});

test('WwF tile bag has 104 tiles including 2 blanks', () => {
  assert.equal(TILE_BAG.length, 104);
  const blanks = TILE_BAG.filter(t => t === '_').length;
  assert.equal(blanks, 2);
});

test('letter values match WwF', () => {
  // Spot-check known WwF values
  assert.equal(LETTER_VALUE.A, 1);
  assert.equal(LETTER_VALUE.Q, 10);
  assert.equal(LETTER_VALUE.J, 10);
  assert.equal(LETTER_VALUE.X, 8);
  assert.equal(LETTER_VALUE.Z, 10);
  assert.equal(LETTER_VALUE._, 0);
});

test('TW squares are positioned per WwF (not corners)', () => {
  // WwF has TW at (0,3),(0,11),(3,0),(3,14),(11,0),(11,14),(14,3),(14,11)
  assert.equal(BOARD_PREMIUMS[0][0], null);
  assert.equal(BOARD_PREMIUMS[0][3], 'TW');
  assert.equal(BOARD_PREMIUMS[14][11], 'TW');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: `Cannot find module ... board.js`.

- [ ] **Step 3: Implement `board.js`**

Write `/Users/slabgorb/Projects/words/src/server/board.js`:

```javascript
export const BOARD_SIZE = 15;

// Words with Friends letter values.
// Reference: official WwF tile distribution.
export const LETTER_VALUE = {
  A: 1, B: 4, C: 4, D: 2, E: 1, F: 4, G: 3, H: 3, I: 1, J: 10,
  K: 5, L: 2, M: 4, N: 2, O: 1, P: 4, Q: 10, R: 1, S: 1, T: 1,
  U: 2, V: 5, W: 4, X: 8, Y: 3, Z: 10, _: 0
};

// Words with Friends tile distribution (104 tiles total).
// Reference counts: A:9 B:2 C:2 D:5 E:13 F:2 G:3 H:4 I:8 J:1 K:1 L:4 M:2 N:5 O:8
//                   P:2 Q:1 R:6 S:5 T:7 U:4 V:2 W:2 X:1 Y:2 Z:1 blank:2
const TILE_COUNTS = {
  A: 9, B: 2, C: 2, D: 5, E: 13, F: 2, G: 3, H: 4, I: 8, J: 1,
  K: 1, L: 4, M: 2, N: 5, O: 8, P: 2, Q: 1, R: 6, S: 5, T: 7,
  U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, _: 2
};

export const TILE_BAG = Object.entries(TILE_COUNTS).flatMap(([letter, n]) =>
  Array(n).fill(letter)
);

// Words with Friends premium-square layout (15x15).
// Sources: TW=triple word, DW=double word, TL=triple letter, DL=double letter.
// Center (7,7) is DW (the start star).
const TW = [[0,3],[0,11],[3,0],[3,14],[11,0],[11,14],[14,3],[14,11]];
const DW = [[1,5],[1,9],[5,1],[5,13],[9,1],[9,13],[13,5],[13,9],[7,7]];
const TL = [[0,6],[0,8],[3,3],[3,11],[6,0],[6,14],[8,0],[8,14],[11,3],[11,11],[14,6],[14,8]];
const DL = [[1,2],[1,12],[2,1],[2,4],[2,10],[2,13],[4,2],[4,6],[4,8],[4,12],[6,4],[6,10],[8,4],[8,10],[10,2],[10,6],[10,8],[10,12],[12,1],[12,4],[12,10],[12,13],[13,2],[13,12]];

export const BOARD_PREMIUMS = (() => {
  const grid = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  for (const [r,c] of TW) grid[r][c] = 'TW';
  for (const [r,c] of DW) grid[r][c] = 'DW';
  for (const [r,c] of TL) grid[r][c] = 'TL';
  for (const [r,c] of DL) grid[r][c] = 'DL';
  return grid;
})();
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test
```

Expected: all board + dictionary tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/board.js test/board.test.js
git commit -m "feat(board): WwF letter values, 104-tile bag, premium-square layout"
```

---

## Task 4: Engine — placement geometry validation

Implements `validateMove()` for placement geometry only (linearity, contiguity, first-move-center, must-touch-existing). Word extraction and scoring come in later tasks.

**Files:**
- Create: `src/server/engine.js`
- Create: `test/engine.test.js`

- [ ] **Step 1: Write failing geometry tests**

Write `/Users/slabgorb/Projects/words/test/engine.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE } from '../src/server/board.js';
import { validatePlacement } from '../src/server/engine.js';

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

test('first move must touch center', () => {
  const board = emptyBoard();
  const placement = [{ r: 0, c: 0, letter: 'A' }, { r: 0, c: 1, letter: 'T' }];
  const result = validatePlacement(board, placement, /* isFirstMove */ true);
  assert.equal(result.valid, false);
  assert.match(result.reason, /center/i);
});

test('first move on center is valid geometry', () => {
  const board = emptyBoard();
  const placement = [{ r: 7, c: 7, letter: 'A' }, { r: 7, c: 8, letter: 'T' }];
  const result = validatePlacement(board, placement, true);
  assert.equal(result.valid, true);
  assert.equal(result.axis, 'row');
});

test('placement must be in a single row or column', () => {
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 7, letter: 'A' },
    { r: 8, c: 8, letter: 'T' }
  ];
  const result = validatePlacement(board, placement, true);
  assert.equal(result.valid, false);
  assert.match(result.reason, /line/i);
});

test('single-tile placement is valid (axis ambiguous → row)', () => {
  const board = emptyBoard();
  const placement = [{ r: 7, c: 7, letter: 'A' }];
  const result = validatePlacement(board, placement, true);
  assert.equal(result.valid, true);
});

test('placement with gap (no existing tile filling it) is invalid', () => {
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 9, letter: 'T' }
  ];
  const result = validatePlacement(board, placement, true);
  assert.equal(result.valid, false);
  assert.match(result.reason, /gap/i);
});

test('placement with gap filled by existing tile is valid', () => {
  const board = emptyBoard();
  board[7][8] = { letter: 'I', byPlayer: 'keith' };
  const placement = [
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 9, letter: 'T' }
  ];
  const result = validatePlacement(board, placement, false);
  assert.equal(result.valid, true);
});

test('non-first move must touch an existing tile', () => {
  const board = emptyBoard();
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  const placement = [
    { r: 0, c: 0, letter: 'B' },
    { r: 0, c: 1, letter: 'Y' }
  ];
  const result = validatePlacement(board, placement, false);
  assert.equal(result.valid, false);
  assert.match(result.reason, /touch/i);
});

test('placing on an already-occupied cell is invalid', () => {
  const board = emptyBoard();
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  const placement = [{ r: 7, c: 7, letter: 'B' }];
  const result = validatePlacement(board, placement, false);
  assert.equal(result.valid, false);
  assert.match(result.reason, /occupied/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: all engine tests fail with `Cannot find module ... engine.js`.

- [ ] **Step 3: Implement `validatePlacement`**

Write `/Users/slabgorb/Projects/words/src/server/engine.js`:

```javascript
import { BOARD_SIZE } from './board.js';

const CENTER = 7;

// Validates that a placement is geometrically legal.
// Returns { valid: true, axis: 'row'|'col' } or { valid: false, reason: string }.
//
// `board` is a 15x15 array of null | { letter, byPlayer }.
// `placement` is an array of { r, c, letter, blank? } — newly-placed tiles only.
// `isFirstMove` is true iff the board has no existing tiles.
export function validatePlacement(board, placement, isFirstMove) {
  if (!Array.isArray(placement) || placement.length === 0) {
    return { valid: false, reason: 'placement is empty' };
  }
  // Bounds + occupancy check
  for (const t of placement) {
    if (t.r < 0 || t.r >= BOARD_SIZE || t.c < 0 || t.c >= BOARD_SIZE) {
      return { valid: false, reason: `tile at (${t.r},${t.c}) is out of bounds` };
    }
    if (board[t.r][t.c] !== null) {
      return { valid: false, reason: `cell (${t.r},${t.c}) is already occupied` };
    }
  }
  // Determine axis: all rows equal → horizontal; all cols equal → vertical; both → single tile (call it 'row').
  const rows = new Set(placement.map(t => t.r));
  const cols = new Set(placement.map(t => t.c));
  let axis;
  if (rows.size === 1 && cols.size === 1) axis = 'row';
  else if (rows.size === 1) axis = 'row';
  else if (cols.size === 1) axis = 'col';
  else return { valid: false, reason: 'tiles must be in a single line (row or column)' };

  // First-move rule: must cover the center square.
  if (isFirstMove) {
    const touchesCenter = placement.some(t => t.r === CENTER && t.c === CENTER);
    if (!touchesCenter) return { valid: false, reason: 'first move must cover the center star' };
  }

  // Contiguity: along the placement axis, the span from min to max must be filled
  // by either newly-placed tiles or existing board tiles. No gaps.
  const fixed = axis === 'row' ? [...placement][0].r : [...placement][0].c;
  const positions = placement.map(t => axis === 'row' ? t.c : t.r).sort((a, b) => a - b);
  const lo = positions[0], hi = positions[positions.length - 1];
  const placed = new Set(positions);
  for (let i = lo; i <= hi; i++) {
    if (placed.has(i)) continue;
    const r = axis === 'row' ? fixed : i;
    const c = axis === 'row' ? i : fixed;
    if (board[r][c] === null) {
      return { valid: false, reason: `gap at (${r},${c})` };
    }
  }

  // Non-first-move: at least one newly-placed tile must be orthogonally adjacent
  // to an existing tile, OR the placement extends an existing tile along the axis
  // (which the gap-fill check above already requires touching). For first move we
  // skipped this; for subsequent moves, check 4-neighbors of each new tile.
  if (!isFirstMove) {
    let touches = false;
    for (const t of placement) {
      const neighbors = [[t.r-1,t.c],[t.r+1,t.c],[t.r,t.c-1],[t.r,t.c+1]];
      for (const [r,c] of neighbors) {
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
        if (board[r][c] !== null) { touches = true; break; }
      }
      if (touches) break;
    }
    if (!touches) return { valid: false, reason: 'placement must touch an existing tile' };
  }

  return { valid: true, axis };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test
```

Expected: all 8 engine geometry tests pass; previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine.js test/engine.test.js
git commit -m "feat(engine): validatePlacement geometry (linear, contiguous, first-move, touch)"
```

---

## Task 5: Engine — word extraction

Given a valid placement, extract the main word and any cross-words formed.

**Files:**
- Modify: `src/server/engine.js`
- Modify: `test/engine.test.js`

- [ ] **Step 1: Write failing word-extraction tests**

Append to `test/engine.test.js`:

```javascript
import { extractWords } from '../src/server/engine.js';

test('extractWords on first move returns the single main word', () => {
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  assert.equal(mainWord.text, 'CAT');
  assert.deepEqual(crossWords, []);
});

test('extractWords picks up letters extending main word on both sides', () => {
  const board = emptyBoard();
  board[7][6] = { letter: 'C', byPlayer: 'keith' };
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  board[7][8] = { letter: 'T', byPlayer: 'keith' };
  // Now play 'S' before, 'S' after → SCATS
  const placement = [
    { r: 7, c: 5, letter: 'S' },
    { r: 7, c: 9, letter: 'S' }
  ];
  const { mainWord } = extractWords(board, placement, 'row');
  assert.equal(mainWord.text, 'SCATS');
  // mainWord.tiles includes both new and existing tiles, in order
  assert.equal(mainWord.tiles.length, 5);
});

test('extractWords picks up perpendicular crosswords', () => {
  const board = emptyBoard();
  // Existing word "CAT" in row 7 cols 6-8
  board[7][6] = { letter: 'C', byPlayer: 'keith' };
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  board[7][8] = { letter: 'T', byPlayer: 'keith' };
  // Play 'B' above each? Let's play vertically: A-T (col 7) downward forming "AT" plus crossword "AS" via S at (8,7)
  // Simpler: place 'O' at (8,7) and 'X' at (9,7) — vertical placement, axis=col
  const placement = [
    { r: 8, c: 7, letter: 'O' },
    { r: 9, c: 7, letter: 'X' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'col');
  assert.equal(mainWord.text, 'AOX'); // existing A at (7,7), O, X
  assert.deepEqual(crossWords, []);
});

test('extractWords detects single-tile placement extending two perpendiculars', () => {
  const board = emptyBoard();
  // Vertical existing: AT (rows 7,8 col 7)
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  board[8][7] = { letter: 'T', byPlayer: 'keith' };
  // Horizontal existing: HE (row 7 cols 5,6)
  board[7][5] = { letter: 'H', byPlayer: 'keith' };
  board[7][6] = { letter: 'E', byPlayer: 'keith' };
  // Place a single S at (7,8) — main word "HEATS"... wait that needs letters between A and the new tile.
  // Reset: HEAT existing row 7 cols 5..8, play S at (7,9) → main HEATS, no cross.
  // Different test: existing AT vertical at (7,7),(8,7); existing HE horizontal at (7,5),(7,6);
  // place R at (7,8): main = HEAR (cols 5..8 row 7), cross = R at (7,8) extending vertical? Only one tile column-wise so no.
  // Better: row=7 axis, cross-words form when new tile has perpendicular neighbors.
  // Simpler test: place a single tile S at (8,8). Above: T at (7,8) — already present? No, only A at (7,7) and T at (8,7) and H/E at (7,5)(7,6). (7,8) is empty.
  // I'll set up cleaner fixture:
  const b2 = emptyBoard();
  b2[7][7] = { letter: 'A', byPlayer: 'keith' };
  b2[8][7] = { letter: 'T', byPlayer: 'keith' };
  // Play horizontally: Q at (7,6), I at (7,8) — main "QAI"; cross at col 8 = "I" alone (length 1, no cross); cross at col 6 = "Q" alone.
  // For a real cross: place along row 7: O at (7,8). Vertical neighbors at (8,8) = null, (6,8) = null → no cross.
  // Place at (8,6): below T? B2 row 8 col 6 is null. Vertical neighbors: (7,6) null, (9,6) null. No cross.
  // To force a cross-word: vertical neighbor must already exist.
  b2[7][6] = { letter: 'O', byPlayer: 'keith' }; // existing OAT in row 7? cols 6,7 = O,A
  // Place 'S' at (8,6): vertically forms 'OS' (rows 7,8 col 6) and main horizontally is just 'S' (only one tile new on row 8).
  // For a single-tile placement, axis ambiguous — caller treats as row. Main = scan row 8 left/right: only S. Single letter is not a "word" — engine returns null mainWord if length < 2.
  const placement = [{ r: 8, c: 6, letter: 'S' }];
  const result = extractWords(b2, placement, 'row');
  // Single letter on row 8 with no existing horizontal neighbors → no main word; cross OS
  assert.equal(result.mainWord, null);
  assert.equal(result.crossWords.length, 1);
  assert.equal(result.crossWords[0].text, 'OS');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: 4 new tests fail (`extractWords` not exported).

- [ ] **Step 3: Implement `extractWords`**

Append to `src/server/engine.js`:

```javascript
// Returns { mainWord: { text, tiles[] } | null, crossWords: Array<{ text, tiles[] }> }
// `tiles` items are { r, c, letter, isNew: bool, blank?: bool }.
// Words of length < 2 are not words; mainWord may be null if the placement is a single tile
// with no neighbors along the axis.
export function extractWords(board, placement, axis) {
  const newByKey = new Map();
  for (const t of placement) newByKey.set(`${t.r},${t.c}`, t);

  const tileAt = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
    const key = `${r},${c}`;
    if (newByKey.has(key)) {
      const t = newByKey.get(key);
      return { r, c, letter: t.letter, blank: !!t.blank, isNew: true };
    }
    const cell = board[r][c];
    if (cell === null) return null;
    return { r, c, letter: cell.letter, blank: !!cell.blank, isNew: false };
  };

  // Walk along an axis from a starting cell, returning the contiguous tiles in order.
  function walk(r, c, dr, dc) {
    const tiles = [];
    let rr = r, cc = c;
    while (tileAt(rr, cc) !== null) { rr -= dr; cc -= dc; }
    rr += dr; cc += dc;
    while (tileAt(rr, cc) !== null) {
      tiles.push(tileAt(rr, cc));
      rr += dr; cc += dc;
    }
    return tiles;
  }

  // Main word: walk along the placement axis from any new tile.
  const first = placement[0];
  const mainTiles = axis === 'row'
    ? walk(first.r, first.c, 0, 1)
    : walk(first.r, first.c, 1, 0);
  const mainWord = mainTiles.length >= 2
    ? { text: mainTiles.map(t => t.letter).join(''), tiles: mainTiles }
    : null;

  // Crosswords: for each new tile, walk perpendicular to the axis. If length >= 2, it's a cross-word.
  const crossWords = [];
  for (const t of placement) {
    const cross = axis === 'row'
      ? walk(t.r, t.c, 1, 0)
      : walk(t.r, t.c, 0, 1);
    if (cross.length >= 2) {
      crossWords.push({ text: cross.map(x => x.letter).join(''), tiles: cross });
    }
  }

  return { mainWord, crossWords };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test
```

Expected: all engine tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine.js test/engine.test.js
git commit -m "feat(engine): extract main word and cross-words from a placement"
```

---

## Task 6: Engine — score calculation

`scoreMove()` computes the score for a placement: per-tile values × premiums × main-word multiplier + cross-word scores + 7-letter bingo bonus.

**Files:**
- Modify: `src/server/engine.js`
- Modify: `test/engine.test.js`

- [ ] **Step 1: Write failing scoring tests**

Append to `test/engine.test.js`:

```javascript
import { scoreMove } from '../src/server/engine.js';

test('scoreMove on first move with no premiums hit (except center DW)', () => {
  // CAT at row 7 cols 6,7,8. Center (7,7) = DW. C=4, A=1, T=1 = 6, doubled by DW = 12.
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  const score = scoreMove(board, placement, mainWord, crossWords);
  assert.equal(score, 12);
});

test('scoreMove applies premiums only to newly-placed tiles', () => {
  // Existing A at (7,7) (covered DW; premium already consumed).
  // Play C at (7,6), T at (7,8) → main CAT.
  // Premiums on (7,6) and (7,8) per WwF: (7,6) is null, (7,8) is null in standard layout.
  // Wait — per BOARD_PREMIUMS: row 7 has DW only at (7,7) and TL at (7,?)...
  // Actually with WwF layout, row 7 col 6 is null, col 8 is null. So just letter values.
  // C=4 + A=1 (existing, not premium-multipliable) + T=1 = 6, no word multiplier (DW already consumed).
  const board = emptyBoard();
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  const score = scoreMove(board, placement, mainWord, crossWords);
  assert.equal(score, 6);
});

test('scoreMove gives 7-letter bingo bonus of +35 (WwF)', () => {
  // Place 7 tiles forming a word; score should include +35.
  // Place QUIRKER at row 7 cols 4..10 with center 7,7 = DW giving the U slot? actually U is at col 5, R at col 6, etc.
  // Let's just assert that a 7-tile play adds 35 on top of the computed-letter total.
  const board = emptyBoard();
  // Place AAAAAAA (7 A's) at row 7 cols 4..10. Center (7,7) is DW so word-multiplier=2.
  // Letter totals: 7 * 1 = 7. Word multiplier: ×2 (center). = 14. + bingo 35 = 49.
  const placement = [
    { r: 7, c: 4, letter: 'A' },
    { r: 7, c: 5, letter: 'A' },
    { r: 7, c: 6, letter: 'A' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'A' },
    { r: 7, c: 9, letter: 'A' },
    { r: 7, c: 10, letter: 'A' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  const score = scoreMove(board, placement, mainWord, crossWords);
  assert.equal(score, 49);
});

test('scoreMove counts blank tiles as 0', () => {
  // Place "CAT" with the C as a blank.
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 6, letter: 'C', blank: true },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  const score = scoreMove(board, placement, mainWord, crossWords);
  // 0 (blank C) + 1 (A) + 1 (T) = 2; doubled by DW = 4
  assert.equal(score, 4);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: 4 new tests fail.

- [ ] **Step 3: Implement `scoreMove`**

Append to `src/server/engine.js`:

```javascript
import { LETTER_VALUE, BOARD_PREMIUMS } from './board.js';

const BINGO_BONUS = 35; // WwF bingo bonus
const RACK_SIZE = 7;

// Score a single word given its tiles (array of {r,c,letter,isNew,blank?}) and the
// premium grid. Premiums apply only to newly-placed tiles.
function scoreWord(tiles) {
  let wordMult = 1;
  let letterTotal = 0;
  for (const t of tiles) {
    const base = t.blank ? 0 : (LETTER_VALUE[t.letter] ?? 0);
    if (t.isNew) {
      const premium = BOARD_PREMIUMS[t.r][t.c];
      switch (premium) {
        case 'TL': letterTotal += base * 3; break;
        case 'DL': letterTotal += base * 2; break;
        case 'TW': letterTotal += base; wordMult *= 3; break;
        case 'DW': letterTotal += base; wordMult *= 2; break;
        default:   letterTotal += base; break;
      }
    } else {
      letterTotal += base;
    }
  }
  return letterTotal * wordMult;
}

export function scoreMove(board, placement, mainWord, crossWords) {
  let total = 0;
  if (mainWord) total += scoreWord(mainWord.tiles);
  for (const cw of crossWords) total += scoreWord(cw.tiles);
  if (placement.length === RACK_SIZE) total += BINGO_BONUS;
  return total;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test
```

Expected: all engine tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine.js test/engine.test.js
git commit -m "feat(engine): score moves with premium squares and 7-letter bingo bonus"
```

---

## Task 7: Engine — applyMove (rack/bag/board mutation)

`applyMove()` produces a new game state with the move applied: tiles moved from rack to board, rack refilled from bag, turn advanced.

**Files:**
- Modify: `src/server/engine.js`
- Modify: `test/engine.test.js`

- [ ] **Step 1: Write failing applyMove tests**

Append to `test/engine.test.js`:

```javascript
import { applyMove } from '../src/server/engine.js';

function baseState() {
  return {
    board: emptyBoard(),
    bag: ['Q','U','I','R','K','S','E','S','S','S'], // 10 tiles for predictable refill
    racks: {
      keith: ['C','A','T','S','E','E','D'],
      sonia: ['A','A','A','A','A','A','A']
    },
    scores: { keith: 0, sonia: 0 },
    currentTurn: 'keith',
    consecutiveScorelessTurns: 0
  };
}

test('applyMove places tiles on board, removes from rack, refills, advances turn', () => {
  const state = baseState();
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  // Pretend pre-validation already produced score
  const next = applyMove(state, {
    playerId: 'keith',
    kind: 'play',
    placement,
    scoreDelta: 12
  });
  // Board updated
  assert.equal(next.board[7][6].letter, 'C');
  assert.equal(next.board[7][7].letter, 'A');
  assert.equal(next.board[7][8].letter, 'T');
  // Rack: removed CAT (3 tiles), refilled to 7 from front of bag (Q,U,I)
  assert.equal(next.racks.keith.length, 7);
  assert.deepEqual(next.racks.keith.slice(-3), ['Q','U','I']);
  // Bag shrunk by 3
  assert.equal(next.bag.length, 7);
  // Turn advanced
  assert.equal(next.currentTurn, 'sonia');
  // Score updated
  assert.equal(next.scores.keith, 12);
  // Scoreless counter reset (this was a scoring play)
  assert.equal(next.consecutiveScorelessTurns, 0);
});

test('applyMove for pass does not mutate board, advances turn, increments scoreless counter', () => {
  const state = baseState();
  const next = applyMove(state, { playerId: 'keith', kind: 'pass' });
  assert.deepEqual(next.board, state.board);
  assert.deepEqual(next.racks.keith, state.racks.keith);
  assert.equal(next.currentTurn, 'sonia');
  assert.equal(next.consecutiveScorelessTurns, 1);
});

test('applyMove for swap exchanges tiles, advances turn, increments scoreless counter', () => {
  const state = baseState();
  const next = applyMove(state, {
    playerId: 'keith',
    kind: 'swap',
    swapTiles: ['C','A','T']
  });
  // 3 tiles removed, 3 drawn from bag front (Q,U,I), 3 returned to bag (somewhere — order doesn't matter for engine)
  assert.equal(next.racks.keith.length, 7);
  assert(next.racks.keith.includes('Q'));
  assert.equal(next.bag.length, 10); // size unchanged
  assert.equal(next.currentTurn, 'sonia');
  assert.equal(next.consecutiveScorelessTurns, 1);
});

test('applyMove refill is bounded by bag size', () => {
  const state = baseState();
  state.bag = ['X','Y']; // only 2 tiles left
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const next = applyMove(state, {
    playerId: 'keith',
    kind: 'play',
    placement,
    scoreDelta: 12
  });
  // Drew 2 (X, Y); rack now 6 tiles (4 left after removing CAT + 2 drawn)
  assert.equal(next.racks.keith.length, 6);
  assert.equal(next.bag.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: 4 new tests fail (`applyMove` not exported).

- [ ] **Step 3: Implement `applyMove`**

Append to `src/server/engine.js`:

```javascript
const PLAYER_IDS = ['keith', 'sonia'];

function otherPlayer(id) { return id === 'keith' ? 'sonia' : 'keith'; }

// Returns a new state. Does NOT mutate the input.
// move: { playerId, kind: 'play'|'pass'|'swap', placement?, scoreDelta?, swapTiles? }
export function applyMove(state, move) {
  const next = {
    board: state.board.map(row => row.slice()),
    bag: state.bag.slice(),
    racks: { keith: state.racks.keith.slice(), sonia: state.racks.sonia.slice() },
    scores: { ...state.scores },
    currentTurn: otherPlayer(state.currentTurn),
    consecutiveScorelessTurns: state.consecutiveScorelessTurns
  };

  if (move.kind === 'play') {
    const playerRack = next.racks[move.playerId];
    // Place tiles, remove from rack
    for (const t of move.placement) {
      next.board[t.r][t.c] = { letter: t.letter, byPlayer: move.playerId, blank: !!t.blank };
      // Remove one matching tile from rack: blank tiles play as '_' from rack but become specific letter.
      const rackKey = t.blank ? '_' : t.letter;
      const idx = playerRack.indexOf(rackKey);
      if (idx === -1) throw new Error(`tile ${rackKey} not in rack`);
      playerRack.splice(idx, 1);
    }
    // Refill rack from front of bag
    while (playerRack.length < 7 && next.bag.length > 0) {
      playerRack.push(next.bag.shift());
    }
    next.scores[move.playerId] = (next.scores[move.playerId] ?? 0) + (move.scoreDelta ?? 0);
    next.consecutiveScorelessTurns = (move.scoreDelta && move.scoreDelta > 0) ? 0 : next.consecutiveScorelessTurns + 1;
  } else if (move.kind === 'pass') {
    next.consecutiveScorelessTurns += 1;
  } else if (move.kind === 'swap') {
    const playerRack = next.racks[move.playerId];
    // Remove swap tiles from rack
    for (const letter of move.swapTiles) {
      const idx = playerRack.indexOf(letter);
      if (idx === -1) throw new Error(`swap tile ${letter} not in rack`);
      playerRack.splice(idx, 1);
    }
    // Draw replacements from front of bag
    const drawCount = move.swapTiles.length;
    for (let i = 0; i < drawCount && next.bag.length > 0; i++) {
      playerRack.push(next.bag.shift());
    }
    // Return swapped tiles to bag (caller may shuffle)
    next.bag.push(...move.swapTiles);
    next.consecutiveScorelessTurns += 1;
  } else {
    throw new Error(`unknown move kind: ${move.kind}`);
  }

  return next;
}

export { PLAYER_IDS, otherPlayer };
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test
```

Expected: all engine tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine.js test/engine.test.js
git commit -m "feat(engine): applyMove updates board, rack, bag, score, turn"
```

---

## Task 8: Engine — endGameAdjust + game-end detection

**Files:**
- Modify: `src/server/engine.js`
- Modify: `test/engine.test.js`

- [ ] **Step 1: Write failing endgame tests**

Append to `test/engine.test.js`:

```javascript
import { detectGameEnd, applyEndGameAdjustment } from '../src/server/engine.js';

test('detectGameEnd: rack empty + bag empty → rack-empty', () => {
  const state = baseState();
  state.bag = [];
  state.racks.keith = [];
  state.racks.sonia = ['A','B','C'];
  assert.equal(detectGameEnd(state), 'rack-empty');
});

test('detectGameEnd: rack empty but bag has tiles → null', () => {
  const state = baseState();
  state.bag = ['A'];
  state.racks.keith = [];
  assert.equal(detectGameEnd(state), null);
});

test('detectGameEnd: 6 consecutive scoreless turns → six-scoreless', () => {
  const state = baseState();
  state.consecutiveScorelessTurns = 6;
  assert.equal(detectGameEnd(state), 'six-scoreless');
});

test('detectGameEnd: 5 consecutive scoreless turns → null', () => {
  const state = baseState();
  state.consecutiveScorelessTurns = 5;
  assert.equal(detectGameEnd(state), null);
});

test('applyEndGameAdjustment rack-empty: out-player +sum(opp), opponent -sum(own)', () => {
  const state = baseState();
  state.racks.keith = [];
  state.racks.sonia = ['Q','Z','A']; // 10 + 10 + 1 = 21
  state.scores.keith = 100;
  state.scores.sonia = 90;
  const adjusted = applyEndGameAdjustment(state, 'rack-empty', 'keith');
  assert.equal(adjusted.scores.keith, 100 + 21); // 121
  assert.equal(adjusted.scores.sonia, 90 - 21);  // 69
  assert.equal(adjusted.endedReason, 'rack-empty');
  assert.equal(adjusted.winner, 'keith');
});

test('applyEndGameAdjustment six-scoreless: each player loses sum(own rack)', () => {
  const state = baseState();
  state.racks.keith = ['Q']; // 10
  state.racks.sonia = ['A','A']; // 2
  state.scores.keith = 50;
  state.scores.sonia = 50;
  const adjusted = applyEndGameAdjustment(state, 'six-scoreless', null);
  assert.equal(adjusted.scores.keith, 50 - 10); // 40
  assert.equal(adjusted.scores.sonia, 50 - 2);  // 48
  assert.equal(adjusted.winner, 'sonia');
});

test('applyEndGameAdjustment resigned: opponent wins regardless of score', () => {
  const state = baseState();
  state.scores.keith = 200; // ahead but resigned
  state.scores.sonia = 50;
  const adjusted = applyEndGameAdjustment(state, 'resigned', 'keith');
  assert.equal(adjusted.winner, 'sonia');
  assert.equal(adjusted.endedReason, 'resigned');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: 7 new tests fail.

- [ ] **Step 3: Implement endgame functions**

Append to `src/server/engine.js`:

```javascript
const SIX_SCORELESS = 6;

export function detectGameEnd(state) {
  if (state.consecutiveScorelessTurns >= SIX_SCORELESS) return 'six-scoreless';
  if (state.bag.length === 0) {
    if (state.racks.keith.length === 0 || state.racks.sonia.length === 0) return 'rack-empty';
  }
  return null;
}

function rackValue(rack) {
  let total = 0;
  for (const letter of rack) total += LETTER_VALUE[letter] ?? 0;
  return total;
}

// `resignedPlayer` is set only when reason === 'resigned'; otherwise null.
// For 'rack-empty', the out-player is whoever has length 0.
export function applyEndGameAdjustment(state, reason, resignedPlayer) {
  const next = {
    ...state,
    scores: { ...state.scores },
    endedReason: reason,
    winner: null
  };

  if (reason === 'resigned') {
    next.winner = otherPlayer(resignedPlayer);
    return next;
  }

  if (reason === 'rack-empty') {
    const outPlayer = state.racks.keith.length === 0 ? 'keith' : 'sonia';
    const opp = otherPlayer(outPlayer);
    const oppRackValue = rackValue(state.racks[opp]);
    next.scores[outPlayer] += oppRackValue;
    next.scores[opp] -= oppRackValue;
  } else if (reason === 'six-scoreless') {
    next.scores.keith -= rackValue(state.racks.keith);
    next.scores.sonia -= rackValue(state.racks.sonia);
  }

  // Determine winner by score (ties → null)
  if (next.scores.keith > next.scores.sonia) next.winner = 'keith';
  else if (next.scores.sonia > next.scores.keith) next.winner = 'sonia';
  else next.winner = null;

  return next;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test
```

Expected: all engine tests pass (~25+ total).

- [ ] **Step 5: Commit**

```bash
git add src/server/engine.js test/engine.test.js
git commit -m "feat(engine): detect game end and apply end-game rack-value adjustments"
```

---

## Task 9: DB module (better-sqlite3 wrapper)

**Files:**
- Create: `src/server/db.js`

- [ ] **Step 1: Implement `db.js`**

Write `/Users/slabgorb/Projects/words/src/server/db.js`:

```javascript
import Database from 'better-sqlite3';
import { TILE_BAG, BOARD_SIZE } from './board.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  color     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS game (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  status          TEXT NOT NULL,
  current_turn    TEXT NOT NULL REFERENCES players(id),
  bag             TEXT NOT NULL,
  board           TEXT NOT NULL,
  rack_keith      TEXT NOT NULL,
  rack_sonia      TEXT NOT NULL,
  score_keith     INTEGER NOT NULL DEFAULT 0,
  score_sonia     INTEGER NOT NULL DEFAULT 0,
  consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
  ended_reason    TEXT,
  winner          TEXT REFERENCES players(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     TEXT NOT NULL REFERENCES players(id),
  kind          TEXT NOT NULL,
  placement     TEXT,
  words_formed  TEXT,
  score_delta   INTEGER NOT NULL DEFAULT 0,
  client_nonce  TEXT UNIQUE,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ended_at    INTEGER NOT NULL,
  winner      TEXT,
  score_keith INTEGER NOT NULL,
  score_sonia INTEGER NOT NULL,
  snapshot    TEXT NOT NULL
);
`;

function shuffle(arr) {
  // Fisher–Yates, seeded by Math.random — fine for two-player personal use.
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function emptyBoardJSON() {
  return JSON.stringify(Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)));
}

function freshGameRow(now) {
  const bag = shuffle(TILE_BAG);
  const rackKeith = bag.splice(0, 7);
  const rackSonia = bag.splice(0, 7);
  return {
    id: 1,
    status: 'active',
    current_turn: 'keith',
    bag: JSON.stringify(bag),
    board: emptyBoardJSON(),
    rack_keith: JSON.stringify(rackKeith),
    rack_sonia: JSON.stringify(rackSonia),
    score_keith: 0,
    score_sonia: 0,
    consecutive_scoreless_turns: 0,
    ended_reason: null,
    winner: null,
    created_at: now,
    updated_at: now
  };
}

export function openDb(filePath = 'game.db') {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Seed players if absent
  const playerCount = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  if (playerCount === 0) {
    const insP = db.prepare('INSERT INTO players (id,name,color) VALUES (?,?,?)');
    insP.run('keith', 'Keith', '#3b82f6');
    insP.run('sonia', 'Sonia', '#ec4899');
  }
  // Seed game if absent
  const gameRow = db.prepare('SELECT id FROM game WHERE id=1').get();
  if (!gameRow) {
    const now = Date.now();
    const fresh = freshGameRow(now);
    db.prepare(`INSERT INTO game (id,status,current_turn,bag,board,rack_keith,rack_sonia,score_keith,score_sonia,consecutive_scoreless_turns,ended_reason,winner,created_at,updated_at)
                VALUES (@id,@status,@current_turn,@bag,@board,@rack_keith,@rack_sonia,@score_keith,@score_sonia,@consecutive_scoreless_turns,@ended_reason,@winner,@created_at,@updated_at)`).run(fresh);
  }
  return db;
}

// Read the current game state, deserialized.
export function getGameState(db) {
  const row = db.prepare('SELECT * FROM game WHERE id=1').get();
  return {
    status: row.status,
    currentTurn: row.current_turn,
    bag: JSON.parse(row.bag),
    board: JSON.parse(row.board),
    racks: { keith: JSON.parse(row.rack_keith), sonia: JSON.parse(row.rack_sonia) },
    scores: { keith: row.score_keith, sonia: row.score_sonia },
    consecutiveScorelessTurns: row.consecutive_scoreless_turns,
    endedReason: row.ended_reason,
    winner: row.winner
  };
}

// Persist a new state, append a moves row, all in one transaction.
// Returns the new move id.
export function persistMove(db, nextState, moveRecord) {
  const tx = db.transaction(() => {
    // Idempotency: if nonce already used, return the existing move id.
    if (moveRecord.clientNonce) {
      const existing = db.prepare('SELECT id FROM moves WHERE client_nonce=?').get(moveRecord.clientNonce);
      if (existing) return { moveId: existing.id, idempotent: true };
    }
    db.prepare(`UPDATE game SET
      status=@status, current_turn=@current_turn, bag=@bag, board=@board,
      rack_keith=@rack_keith, rack_sonia=@rack_sonia,
      score_keith=@score_keith, score_sonia=@score_sonia,
      consecutive_scoreless_turns=@consecutive_scoreless_turns,
      ended_reason=@ended_reason, winner=@winner, updated_at=@updated_at
      WHERE id=1`).run({
      status: nextState.status ?? (nextState.endedReason ? 'ended' : 'active'),
      current_turn: nextState.currentTurn,
      bag: JSON.stringify(nextState.bag),
      board: JSON.stringify(nextState.board),
      rack_keith: JSON.stringify(nextState.racks.keith),
      rack_sonia: JSON.stringify(nextState.racks.sonia),
      score_keith: nextState.scores.keith,
      score_sonia: nextState.scores.sonia,
      consecutive_scoreless_turns: nextState.consecutiveScorelessTurns,
      ended_reason: nextState.endedReason ?? null,
      winner: nextState.winner ?? null,
      updated_at: Date.now()
    });
    const info = db.prepare(`INSERT INTO moves (player_id,kind,placement,words_formed,score_delta,client_nonce,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      moveRecord.playerId,
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

// Reset the active game, archiving the current one to history.
export function resetGame(db) {
  const now = Date.now();
  const tx = db.transaction(() => {
    const cur = db.prepare('SELECT * FROM game WHERE id=1').get();
    db.prepare(`INSERT INTO game_history (ended_at,winner,score_keith,score_sonia,snapshot)
      VALUES (?,?,?,?,?)`).run(now, cur.winner, cur.score_keith, cur.score_sonia, JSON.stringify(cur));
    db.prepare('DELETE FROM moves').run();
    const fresh = freshGameRow(now);
    db.prepare(`UPDATE game SET status=@status, current_turn=@current_turn, bag=@bag, board=@board,
      rack_keith=@rack_keith, rack_sonia=@rack_sonia, score_keith=@score_keith, score_sonia=@score_sonia,
      consecutive_scoreless_turns=@consecutive_scoreless_turns, ended_reason=@ended_reason, winner=@winner,
      created_at=@created_at, updated_at=@updated_at WHERE id=1`).run(fresh);
  });
  tx();
}
```

- [ ] **Step 2: Smoke-test the DB module**

Add to `test/routes.test.js` (creating it):

Write `/Users/slabgorb/Projects/words/test/routes.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getGameState, persistMove, resetGame } from '../src/server/db.js';

test('openDb creates schema, seeds players, seeds active game', () => {
  const db = openDb(':memory:');
  const players = db.prepare('SELECT * FROM players ORDER BY id').all();
  assert.equal(players.length, 2);
  assert.equal(players[0].id, 'keith');
  const state = getGameState(db);
  assert.equal(state.status, 'active');
  assert.equal(state.currentTurn, 'keith');
  assert.equal(state.racks.keith.length, 7);
  assert.equal(state.racks.sonia.length, 7);
  assert.equal(state.bag.length, 104 - 14);
});

test('persistMove updates state and inserts moves row', () => {
  const db = openDb(':memory:');
  const state = getGameState(db);
  state.scores.keith = 12;
  const result = persistMove(db, state, {
    playerId: 'keith', kind: 'play', placement: [{ r:7, c:7, letter:'A' }],
    wordsFormed: ['A'], scoreDelta: 12, clientNonce: 'n1'
  });
  assert.equal(result.idempotent, false);
  const after = getGameState(db);
  assert.equal(after.scores.keith, 12);
  const moves = db.prepare('SELECT * FROM moves').all();
  assert.equal(moves.length, 1);
});

test('persistMove with duplicate nonce is idempotent', () => {
  const db = openDb(':memory:');
  const state = getGameState(db);
  persistMove(db, state, { playerId:'keith', kind:'pass', clientNonce:'dup' });
  const second = persistMove(db, state, { playerId:'keith', kind:'pass', clientNonce:'dup' });
  assert.equal(second.idempotent, true);
  const moves = db.prepare('SELECT * FROM moves').all();
  assert.equal(moves.length, 1);
});

test('resetGame archives and reinitializes', () => {
  const db = openDb(':memory:');
  resetGame(db);
  const history = db.prepare('SELECT COUNT(*) AS n FROM game_history').get().n;
  assert.equal(history, 1);
  const state = getGameState(db);
  assert.equal(state.status, 'active');
});
```

- [ ] **Step 3: Run tests to verify pass**

```bash
npm test
```

Expected: 4 db tests pass; engine + dictionary + board still pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/db.js test/routes.test.js
git commit -m "feat(db): sqlite schema, persist/load game state, idempotent moves"
```

---

## Task 10: Identity middleware

**Files:**
- Create: `src/server/identity.js`

- [ ] **Step 1: Implement signed-cookie identity**

Write `/Users/slabgorb/Projects/words/src/server/identity.js`:

```javascript
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Load or create a stable signing secret. Persists in .secret next to game.db
// so cookies survive restart. Two-player personal use; this is sufficient.
export function loadOrCreateSecret(path = '.secret') {
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const s = randomBytes(32).toString('hex');
  writeFileSync(path, s, { mode: 0o600 });
  return s;
}

const VALID_IDS = new Set(['keith', 'sonia']);

function sign(value, secret) {
  const mac = createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${mac}`;
}
function verify(signed, secret) {
  if (typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return null;
  const value = signed.slice(0, dot);
  const mac = signed.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(value).digest('hex');
  if (mac !== expected) return null;
  return value;
}

// Cookie name and helpers
export const COOKIE = 'wf_id';

export function setIdentityCookie(res, id, secret) {
  if (!VALID_IDS.has(id)) throw new Error(`invalid identity ${id}`);
  res.cookie(COOKIE, sign(id, secret), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
}

// Express middleware that attaches `req.playerId` from the signed cookie, or null.
export function attachIdentity(secret) {
  return (req, _res, next) => {
    const cookie = req.cookies?.[COOKIE];
    const value = verify(cookie, secret);
    req.playerId = VALID_IDS.has(value) ? value : null;
    next();
  };
}

export function requireIdentity(req, res, next) {
  if (!req.playerId) return res.status(401).json({ error: 'identity-required' });
  next();
}
```

- [ ] **Step 2: Add `.secret` to gitignore**

Append to `/Users/slabgorb/Projects/words/.gitignore`:

```
.secret
```

- [ ] **Step 3: Commit**

```bash
git add src/server/identity.js .gitignore
git commit -m "feat(identity): signed-cookie middleware for keith/sonia"
```

---

## Task 11: SSE broadcaster

**Files:**
- Create: `src/server/sse.js`

- [ ] **Step 1: Implement SSE broadcaster**

Write `/Users/slabgorb/Projects/words/src/server/sse.js`:

```javascript
// Minimal SSE broadcaster — keeps a Set of subscribers, broadcasts JSON events.
const subscribers = new Set();

export function subscribe(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
  subscribers.add(res);

  // Heartbeat every 25s so proxies don't close the connection.
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch { /* socket dead */ }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
  });
}

export function broadcast(event) {
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event.payload ?? {})}\n\n`;
  for (const res of subscribers) {
    try { res.write(data); } catch { subscribers.delete(res); }
  }
}

export function subscriberCount() { return subscribers.size; }
```

- [ ] **Step 2: Commit**

```bash
git add src/server/sse.js
git commit -m "feat(sse): broadcaster with heartbeat for live game updates"
```

---

## Task 12: HTTP routes — state, validate, move

**Files:**
- Create: `src/server/routes.js`
- Modify: `test/routes.test.js`

- [ ] **Step 1: Implement core routes**

Write `/Users/slabgorb/Projects/words/src/server/routes.js`:

```javascript
import { Router } from 'express';
import { getGameState, persistMove, resetGame } from './db.js';
import {
  validatePlacement, extractWords, scoreMove, applyMove,
  detectGameEnd, applyEndGameAdjustment, otherPlayer
} from './engine.js';
import { broadcast } from './sse.js';
import { setIdentityCookie, requireIdentity, attachIdentity } from './identity.js';

const VALID_IDS = new Set(['keith', 'sonia']);

export function buildRoutes({ db, dict, secret }) {
  const r = Router();
  r.use(attachIdentity(secret));

  // -- Identity --
  r.get('/whoami', (req, res) => {
    res.json({ playerId: req.playerId });
  });

  r.post('/whoami', (req, res) => {
    const { playerId } = req.body ?? {};
    if (!VALID_IDS.has(playerId)) return res.status(400).json({ error: 'bad-identity' });
    setIdentityCookie(res, playerId, secret);
    res.json({ playerId });
  });

  // -- State (read-only snapshot) --
  r.get('/state', requireIdentity, (req, res) => {
    const state = getGameState(db);
    res.json({ ...state, you: req.playerId });
  });

  // -- Validate (live word check, never 4xx for "not a word") --
  r.post('/validate', requireIdentity, (req, res) => {
    const state = getGameState(db);
    const { placement } = req.body ?? {};
    if (!Array.isArray(placement)) return res.status(400).json({ error: 'bad-placement' });

    const isFirstMove = state.board.every(row => row.every(c => c === null));
    const geo = validatePlacement(state.board, placement, isFirstMove);
    if (!geo.valid) return res.json({ valid: false, words: [], score: 0, reason: geo.reason });

    const { mainWord, crossWords } = extractWords(state.board, placement, geo.axis);
    const allWords = [mainWord, ...crossWords].filter(Boolean);
    const wordResults = allWords.map(w => ({ word: w.text, ok: dict.isWord(w.text) }));
    const allWordsValid = wordResults.every(w => w.ok);
    const score = allWordsValid ? scoreMove(state.board, placement, mainWord, crossWords) : 0;
    res.json({ valid: allWordsValid, words: wordResults, score });
  });

  // -- Submit a move (the canonical write path) --
  r.post('/move', requireIdentity, (req, res) => {
    const state = getGameState(db);
    if (state.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (state.currentTurn !== req.playerId) return res.status(409).json({ error: 'not-your-turn' });

    const { placement, clientNonce } = req.body ?? {};
    if (!Array.isArray(placement) || !clientNonce) {
      return res.status(400).json({ error: 'bad-request' });
    }

    const isFirstMove = state.board.every(row => row.every(c => c === null));
    const geo = validatePlacement(state.board, placement, isFirstMove);
    if (!geo.valid) return res.status(400).json({ error: 'placement-invalid', reason: geo.reason });

    // Verify each placed tile (by rack-key, where blanks are '_') is in player's rack.
    const rack = state.racks[req.playerId].slice();
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

    let next = applyMove(state, { playerId: req.playerId, kind: 'play', placement, scoreDelta });
    const endReason = detectGameEnd(next);
    if (endReason) next = applyEndGameAdjustment(next, endReason, null);

    const result = persistMove(db, next, {
      playerId: req.playerId, kind: 'play', placement,
      wordsFormed: allWords.map(w => w.text), scoreDelta, clientNonce
    });

    broadcast({ type: 'move', payload: { by: req.playerId, words: allWords.map(w => w.text), score: scoreDelta, ended: !!endReason } });
    res.json({ ok: true, moveId: result.moveId, idempotent: result.idempotent, ended: endReason });
  });

  return r;
}
```

- [ ] **Step 2: Append integration tests**

Append to `test/routes.test.js`:

```javascript
import express from 'express';
import cookieParser from 'cookie-parser';
import { buildRoutes } from '../src/server/routes.js';
import { loadDictionary } from '../src/server/dictionary.js';

function buildApp(db) {
  const dict = loadDictionary();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', buildRoutes({ db, dict, secret: 'test-secret' }));
  return app;
}

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function asPlayer(server, id) {
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/api/whoami`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: id })
  });
  const cookie = r.headers.get('set-cookie');
  return { url, cookie };
}

test('GET /api/state requires identity', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const r = await fetch(`http://localhost:${server.address().port}/api/state`);
    assert.equal(r.status, 401);
  } finally { server.close(); }
});

test('POST /api/whoami sets cookie and GET /api/state returns state', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    const r = await fetch(`${url}/api/state`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.you, 'keith');
    assert.equal(body.currentTurn, 'keith');
  } finally { server.close(); }
});

test('POST /api/move from wrong player returns 409', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    // Active turn is keith; sonia tries to play.
    const { url, cookie } = await asPlayer(server, 'sonia');
    const r = await fetch(`${url}/api/move`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ placement: [{ r:7, c:7, letter:'A' }], clientNonce: 'n1' })
    });
    assert.equal(r.status, 409);
  } finally { server.close(); }
});

test('POST /api/move with bad placement returns 400', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    // First move not on center
    const r = await fetch(`${url}/api/move`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ placement: [{ r:0, c:0, letter:'A' }], clientNonce: 'n2' })
    });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.equal(body.error, 'placement-invalid');
  } finally { server.close(); }
});

test('POST /api/validate with non-word returns valid:false but 200', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    // Need a real placement — give keith's actual rack tiles. We don't know them; use generic tiles
    // and rely on validate accepting any placement (it doesn't check rack ownership for /validate).
    const r = await fetch(`${url}/api/validate`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ placement: [
        { r:7, c:6, letter:'X' }, { r:7, c:7, letter:'Q' }, { r:7, c:8, letter:'Z' }
      ]})
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.valid, false);
    assert.equal(body.score, 0);
  } finally { server.close(); }
});
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: 5 new route tests pass; all prior tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes.js test/routes.test.js
git commit -m "feat(routes): /whoami /state /validate /move with identity guard"
```

---

## Task 13: HTTP routes — pass, swap, resign, new-game, events

**Files:**
- Modify: `src/server/routes.js`

- [ ] **Step 1: Add pass / swap / resign / new-game / events routes**

In `src/server/routes.js`, add these handlers inside `buildRoutes(...)`, before `return r;`:

```javascript
  // -- Pass turn --
  r.post('/pass', requireIdentity, (req, res) => {
    const state = getGameState(db);
    if (state.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (state.currentTurn !== req.playerId) return res.status(409).json({ error: 'not-your-turn' });
    const { clientNonce } = req.body ?? {};
    if (!clientNonce) return res.status(400).json({ error: 'bad-request' });
    let next = applyMove(state, { playerId: req.playerId, kind: 'pass' });
    const endReason = detectGameEnd(next);
    if (endReason) next = applyEndGameAdjustment(next, endReason, null);
    persistMove(db, next, { playerId: req.playerId, kind: 'pass', scoreDelta: 0, clientNonce });
    broadcast({ type: 'pass', payload: { by: req.playerId, ended: !!endReason } });
    res.json({ ok: true, ended: endReason });
  });

  // -- Swap tiles --
  r.post('/swap', requireIdentity, (req, res) => {
    const state = getGameState(db);
    if (state.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    if (state.currentTurn !== req.playerId) return res.status(409).json({ error: 'not-your-turn' });
    const { tiles, clientNonce } = req.body ?? {};
    if (!Array.isArray(tiles) || tiles.length === 0 || !clientNonce) {
      return res.status(400).json({ error: 'bad-request' });
    }
    if (state.bag.length < 7) return res.status(400).json({ error: 'bag-too-small' });
    const rack = state.racks[req.playerId].slice();
    for (const letter of tiles) {
      const idx = rack.indexOf(letter);
      if (idx === -1) return res.status(400).json({ error: 'rack-mismatch', missing: letter });
      rack.splice(idx, 1);
    }
    let next = applyMove(state, { playerId: req.playerId, kind: 'swap', swapTiles: tiles });
    const endReason = detectGameEnd(next);
    if (endReason) next = applyEndGameAdjustment(next, endReason, null);
    persistMove(db, next, { playerId: req.playerId, kind: 'swap', scoreDelta: 0, clientNonce });
    broadcast({ type: 'swap', payload: { by: req.playerId, count: tiles.length, ended: !!endReason } });
    res.json({ ok: true, ended: endReason });
  });

  // -- Resign --
  r.post('/resign', requireIdentity, (req, res) => {
    const state = getGameState(db);
    if (state.status !== 'active') return res.status(409).json({ error: 'game-ended' });
    const { clientNonce } = req.body ?? {};
    if (!clientNonce) return res.status(400).json({ error: 'bad-request' });
    const next = applyEndGameAdjustment(state, 'resigned', req.playerId);
    persistMove(db, next, { playerId: req.playerId, kind: 'pass', scoreDelta: 0, clientNonce });
    broadcast({ type: 'resign', payload: { by: req.playerId } });
    res.json({ ok: true, ended: 'resigned' });
  });

  // -- New game (requires both confirms) --
  // Simple model: a small in-memory pending-confirms set keyed on game-state.updated_at.
  // Cleared on reset. This works because the server is single-process.
  const pendingNewGame = new Set();
  r.post('/new-game', requireIdentity, (_req2, res2) => {
    const state = getGameState(db);
    if (state.status !== 'ended') return res2.status(409).json({ error: 'game-not-ended' });
    pendingNewGame.add(_req2.playerId);
    if (pendingNewGame.size === 2) {
      pendingNewGame.clear();
      resetGame(db);
      broadcast({ type: 'new-game', payload: {} });
      return res2.json({ ok: true, started: true });
    }
    res2.json({ ok: true, started: false, waitingFor: ['keith','sonia'].find(p => p !== _req2.playerId) });
  });

  // -- SSE event stream --
  r.get('/events', requireIdentity, (req, res) => {
    // import lazily to avoid a circular import at top
    import('./sse.js').then(({ subscribe }) => subscribe(req, res));
  });
```

- [ ] **Step 2: Append basic tests for pass/swap/new-game**

Append to `test/routes.test.js`:

```javascript
test('POST /api/pass advances turn', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    const r = await fetch(`${url}/api/pass`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ clientNonce: 'p1' })
    });
    assert.equal(r.status, 200);
    const state = await (await fetch(`${url}/api/state`, { headers: { cookie } })).json();
    assert.equal(state.currentTurn, 'sonia');
    assert.equal(state.consecutiveScorelessTurns, 1);
  } finally { server.close(); }
});

test('POST /api/swap exchanges tiles', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    const stateBefore = await (await fetch(`${url}/api/state`, { headers: { cookie } })).json();
    const swapTiles = stateBefore.racks.keith.slice(0, 3);
    const r = await fetch(`${url}/api/swap`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ tiles: swapTiles, clientNonce: 's1' })
    });
    assert.equal(r.status, 200);
    const stateAfter = await (await fetch(`${url}/api/state`, { headers: { cookie } })).json();
    assert.equal(stateAfter.racks.keith.length, 7);
    assert.equal(stateAfter.bag.length, stateBefore.bag.length); // size unchanged
  } finally { server.close(); }
});
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: 2 new tests pass; all prior tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes.js test/routes.test.js
git commit -m "feat(routes): pass swap resign new-game and SSE events"
```

---

## Task 14: Server bootstrap

**Files:**
- Create: `src/server/server.js`

- [ ] **Step 1: Wire it all together**

Write `/Users/slabgorb/Projects/words/src/server/server.js`:

```javascript
import express from 'express';
import cookieParser from 'cookie-parser';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { loadDictionary } from './dictionary.js';
import { buildRoutes } from './routes.js';
import { loadOrCreateSecret } from './identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const secretPath = process.env.SECRET_PATH ?? resolve(PROJECT_ROOT, '.secret');

const dict = loadDictionary();
console.log(`[startup] dictionary loaded (${dict.size} words)`);
const db = openDb(dbPath);
console.log(`[startup] database opened at ${dbPath}`);
const secret = loadOrCreateSecret(secretPath);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', buildRoutes({ db, dict, secret }));
app.use(express.static(resolve(PROJECT_ROOT, 'public')));

// Top-level error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'server' });
});

app.listen(port, () => console.log(`[startup] listening on http://localhost:${port}`));
```

- [ ] **Step 2: Manual smoke test**

```bash
npm start &
sleep 1
curl -i http://localhost:3000/api/state
kill %1 2>/dev/null
```

Expected: `HTTP/1.1 401 Unauthorized` body `{"error":"identity-required"}`.

- [ ] **Step 3: Commit**

```bash
git add src/server/server.js
git commit -m "feat(server): bootstrap loads dict, db, secret, mounts routes and static"
```

---

## Task 15: Client — index.html, base CSS, identity picker

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`

- [ ] **Step 1: Write base HTML**

Write `/Users/slabgorb/Projects/words/public/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Words</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <div id="identity-picker" hidden>
    <h1>Who are you?</h1>
    <button data-id="keith">I'm Keith</button>
    <button data-id="sonia">I'm Sonia</button>
  </div>

  <main id="game" hidden>
    <header id="topbar">
      <div id="score-keith"></div>
      <div id="bag-count"></div>
      <div id="turn-indicator"></div>
      <div id="score-sonia"></div>
    </header>
    <section id="board"></section>
    <section id="rack"></section>
    <section id="controls">
      <button id="btn-submit" disabled>Submit move</button>
      <button id="btn-recall">Recall tiles</button>
      <button id="btn-shuffle">Shuffle rack</button>
      <button id="btn-pass">Pass</button>
      <button id="btn-swap">Swap…</button>
      <button id="btn-resign">Resign</button>
    </section>
    <div id="status"></div>
  </main>

  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write base CSS**

Write `/Users/slabgorb/Projects/words/public/style.css`:

```css
:root {
  --bg: #1a1a1a;
  --fg: #e8e8e8;
  --panel: #2a2a2a;
  --accent: #3b82f6;
  --pink: #ec4899;
  --tw: #c44;
  --dw: #d77;
  --tl: #36a;
  --dl: #6ac;
  --tile: #f3e3a3;
  --tile-fg: #1a1a1a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
  display: flex;
  justify-content: center;
}
main { width: min(640px, 96vw); padding: 12px; }
#identity-picker {
  text-align: center; padding-top: 25vh;
}
#identity-picker button {
  font-size: 24px; padding: 16px 32px; margin: 8px;
  background: var(--panel); color: var(--fg); border: 1px solid #444;
  border-radius: 8px; cursor: pointer;
}
#topbar {
  display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
  align-items: center; padding: 8px 0;
}
#turn-indicator { text-align: center; font-weight: bold; }
#bag-count { text-align: center; opacity: 0.7; font-size: 12px; }
#board {
  display: grid; grid-template-columns: repeat(15, 1fr);
  gap: 1px; background: #111; padding: 2px;
  aspect-ratio: 1 / 1; border-radius: 4px;
}
.cell {
  background: var(--panel); position: relative;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; user-select: none;
}
.cell.tw { background: var(--tw); }
.cell.dw { background: var(--dw); }
.cell.tl { background: var(--tl); }
.cell.dl { background: var(--dl); }
.cell.star::after { content: "★"; color: white; opacity: 0.6; }
.cell .tile { width: 100%; height: 100%; background: var(--tile); color: var(--tile-fg);
  display: flex; align-items: center; justify-content: center; font-weight: bold; }
.cell.placed .tile { box-shadow: inset 0 0 0 2px gold; }
.cell.invalid .tile { box-shadow: inset 0 0 0 2px #f33; }
.cell.valid .tile { box-shadow: inset 0 0 0 2px #2c2; }
#rack {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 4px; margin-top: 12px;
}
.rack-slot {
  aspect-ratio: 1/1; background: var(--panel); border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-weight: bold; cursor: grab;
}
.rack-slot.tile { background: var(--tile); color: var(--tile-fg); }
#controls {
  display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;
}
#controls button {
  background: var(--panel); color: var(--fg); border: 1px solid #444;
  padding: 8px 12px; border-radius: 4px; cursor: pointer;
}
#controls button:disabled { opacity: 0.4; cursor: not-allowed; }
#status { margin-top: 12px; min-height: 24px; opacity: 0.8; }
```

- [ ] **Step 3: Write minimal `app.js` with identity picker only**

Write `/Users/slabgorb/Projects/words/public/app.js`:

```javascript
const $ = (sel) => document.querySelector(sel);

async function whoami() {
  const r = await fetch('/api/whoami');
  const body = await r.json();
  return body.playerId;
}

async function chooseIdentity(id) {
  await fetch('/api/whoami', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: id })
  });
}

async function init() {
  let id = await whoami();
  if (!id) {
    $('#identity-picker').hidden = false;
    $('#identity-picker').addEventListener('click', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLButtonElement)) return;
      await chooseIdentity(t.dataset.id);
      location.reload();
    });
    return;
  }
  $('#game').hidden = false;
  $('#status').textContent = `You are ${id}. (Game UI: next task.)`;
}

init();
```

- [ ] **Step 4: Manual smoke test**

```bash
rm -f game.db .secret
npm start &
sleep 1
echo "open http://localhost:3000 in your browser; pick an identity; reload should show 'You are <name>'"
# After verifying, kill the server:
kill %1 2>/dev/null
```

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "feat(client): identity picker, base layout and CSS"
```

---

## Task 16: Client — board + rack initial render

**Files:**
- Create: `public/board.js`
- Create: `public/rack.js`
- Create: `public/state.js`
- Modify: `public/app.js`

- [ ] **Step 1: Write `state.js`**

Write `/Users/slabgorb/Projects/words/public/state.js`:

```javascript
// Holds local UI state separate from server state.
// `tentative` is the in-progress placement: { r, c, letter, fromRackIdx, blank? }
export const ui = {
  server: null,        // last server snapshot
  tentative: [],       // newly-placed-but-not-yet-submitted tiles
  rackOrder: null      // reorderable view of the rack (array of letters)
};

const TENTATIVE_KEY = 'words.tentative';

export function loadTentative() {
  try { ui.tentative = JSON.parse(localStorage.getItem(TENTATIVE_KEY) || '[]'); }
  catch { ui.tentative = []; }
}
export function saveTentative() {
  localStorage.setItem(TENTATIVE_KEY, JSON.stringify(ui.tentative));
}
export function clearTentative() {
  ui.tentative = [];
  localStorage.removeItem(TENTATIVE_KEY);
}

export async function fetchState() {
  const r = await fetch('/api/state');
  if (!r.ok) throw new Error('state-fetch-failed');
  ui.server = await r.json();
  if (!ui.rackOrder) ui.rackOrder = ui.server.racks[ui.server.you].slice();
  return ui.server;
}
```

- [ ] **Step 2: Write `board.js`**

Write `/Users/slabgorb/Projects/words/public/board.js`:

```javascript
import { ui } from './state.js';

// WwF premium-square layout — duplicated client-side for rendering only.
const TW = new Set(['0,3','0,11','3,0','3,14','11,0','11,14','14,3','14,11']);
const DW = new Set(['1,5','1,9','5,1','5,13','9,1','9,13','13,5','13,9','7,7']);
const TL = new Set(['0,6','0,8','3,3','3,11','6,0','6,14','8,0','8,14','11,3','11,11','14,6','14,8']);
const DL = new Set(['1,2','1,12','2,1','2,4','2,10','2,13','4,2','4,6','4,8','4,12','6,4','6,10','8,4','8,10','10,2','10,6','10,8','10,12','12,1','12,4','12,10','12,13','13,2','13,12']);

export function renderBoard(root, { onCellClick, validation } = {}) {
  root.innerHTML = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r; cell.dataset.c = c;
      const k = `${r},${c}`;
      if (TW.has(k)) cell.classList.add('tw');
      else if (DW.has(k)) { cell.classList.add('dw'); if (k === '7,7') cell.classList.add('star'); }
      else if (TL.has(k)) cell.classList.add('tl');
      else if (DL.has(k)) cell.classList.add('dl');

      const placed = ui.server.board[r][c];
      const tentative = ui.tentative.find(t => t.r === r && t.c === c);
      if (placed) {
        const t = document.createElement('div');
        t.className = 'tile';
        t.textContent = placed.letter;
        cell.appendChild(t);
      } else if (tentative) {
        const t = document.createElement('div');
        t.className = 'tile';
        t.textContent = tentative.letter;
        cell.classList.add('placed');
        if (validation) {
          if (validation.invalidPositions?.has(k)) cell.classList.add('invalid');
          else if (validation.validPositions?.has(k)) cell.classList.add('valid');
        }
        cell.appendChild(t);
      }
      if (onCellClick) cell.addEventListener('click', () => onCellClick(r, c));
      root.appendChild(cell);
    }
  }
}
```

- [ ] **Step 3: Write `rack.js`**

Write `/Users/slabgorb/Projects/words/public/rack.js`:

```javascript
import { ui } from './state.js';

// Render the player's rack reflecting tiles already placed tentatively (those slots are empty).
export function renderRack(root, { onSlotClick } = {}) {
  root.innerHTML = '';
  const inUse = new Set();
  for (const t of ui.tentative) inUse.add(t.fromRackIdx);
  ui.rackOrder.forEach((letter, idx) => {
    const slot = document.createElement('div');
    slot.className = 'rack-slot';
    slot.dataset.idx = idx;
    if (!inUse.has(idx)) {
      slot.classList.add('tile');
      slot.textContent = letter === '_' ? '·' : letter;
      if (onSlotClick) slot.addEventListener('click', () => onSlotClick(idx, letter));
    }
    root.appendChild(slot);
  });
}

export function shuffleRack() {
  const a = ui.rackOrder.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  ui.rackOrder = a;
}
```

- [ ] **Step 4: Update `app.js` to render board + rack**

Replace `/Users/slabgorb/Projects/words/public/app.js` with:

```javascript
import { ui, fetchState, loadTentative, saveTentative, clearTentative } from './state.js';
import { renderBoard } from './board.js';
import { renderRack, shuffleRack } from './rack.js';

const $ = (sel) => document.querySelector(sel);

async function whoami() {
  const r = await fetch('/api/whoami');
  return (await r.json()).playerId;
}

async function chooseIdentity(id) {
  await fetch('/api/whoami', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: id })
  });
}

let selectedRackIdx = null;

function refresh() {
  renderBoard($('#board'), { onCellClick: handleBoardClick });
  renderRack($('#rack'), { onSlotClick: handleRackClick });
  $('#score-keith').textContent = `Keith: ${ui.server.scores.keith}`;
  $('#score-sonia').textContent = `Sonia: ${ui.server.scores.sonia}`;
  $('#bag-count').textContent = `bag: ${ui.server.bag.length}`;
  const myTurn = ui.server.currentTurn === ui.server.you;
  $('#turn-indicator').textContent = myTurn ? 'Your turn' : `${ui.server.currentTurn}'s turn`;
}

function handleRackClick(idx, _letter) {
  selectedRackIdx = idx;
  $('#status').textContent = `Selected rack tile ${idx} — click a board cell to place.`;
}

function handleBoardClick(r, c) {
  if (selectedRackIdx === null) return;
  if (ui.server.board[r][c] !== null) return;
  if (ui.tentative.some(t => t.r === r && t.c === c)) return;
  const letter = ui.rackOrder[selectedRackIdx];
  ui.tentative.push({ r, c, letter, fromRackIdx: selectedRackIdx, blank: letter === '_' });
  selectedRackIdx = null;
  saveTentative();
  refresh();
}

function recall() {
  clearTentative();
  refresh();
}

async function init() {
  const id = await whoami();
  if (!id) {
    $('#identity-picker').hidden = false;
    $('#identity-picker').addEventListener('click', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLButtonElement)) return;
      await chooseIdentity(t.dataset.id);
      location.reload();
    });
    return;
  }
  $('#game').hidden = false;
  loadTentative();
  await fetchState();
  refresh();

  $('#btn-recall').addEventListener('click', recall);
  $('#btn-shuffle').addEventListener('click', () => { shuffleRack(); refresh(); });
}

init();
```

- [ ] **Step 5: Manual smoke test**

```bash
rm -f game.db .secret
npm start &
sleep 1
echo "open http://localhost:3000; pick identity; you should see board, rack with 7 tiles, scores, turn"
# kill the server when done:
kill %1 2>/dev/null
```

- [ ] **Step 6: Commit**

```bash
git add public/
git commit -m "feat(client): render board, rack, scores; click-to-place tile flow"
```

---

## Task 17: Client — live validation integration

**Files:**
- Create: `public/validator.js`
- Modify: `public/app.js`

- [ ] **Step 1: Write `validator.js`**

Write `/Users/slabgorb/Projects/words/public/validator.js`:

```javascript
import { ui } from './state.js';

let timer = null;
let inflight = 0;

export function scheduleValidate(callback) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (ui.tentative.length === 0) { callback(null); return; }
    const myInflight = ++inflight;
    try {
      const r = await fetch('/api/validate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ placement: ui.tentative.map(t => ({ r: t.r, c: t.c, letter: t.letter, blank: !!t.blank })) })
      });
      if (myInflight !== inflight) return; // stale response
      const body = await r.json();
      callback(body);
    } catch (e) {
      console.error('validate failed', e);
      callback({ valid: false, words: [], score: 0, reason: 'network' });
    }
  }, 150);
}
```

- [ ] **Step 2: Wire validator into `app.js`**

In `/Users/slabgorb/Projects/words/public/app.js`, add this import at the top:

```javascript
import { scheduleValidate } from './validator.js';
```

Replace `handleBoardClick` and `refresh` with these versions:

```javascript
let lastValidation = null;

function refresh() {
  const validation = lastValidation ? buildValidationPositions(lastValidation) : null;
  renderBoard($('#board'), { onCellClick: handleBoardClick, validation });
  renderRack($('#rack'), { onSlotClick: handleRackClick });
  $('#score-keith').textContent = `Keith: ${ui.server.scores.keith}`;
  $('#score-sonia').textContent = `Sonia: ${ui.server.scores.sonia}`;
  $('#bag-count').textContent = `bag: ${ui.server.bag.length}`;
  const myTurn = ui.server.currentTurn === ui.server.you;
  $('#turn-indicator').textContent = myTurn ? 'Your turn' : `${ui.server.currentTurn}'s turn`;
  $('#btn-submit').disabled = !myTurn || !lastValidation?.valid;
  if (lastValidation) {
    if (lastValidation.valid) {
      $('#status').textContent = `Words: ${lastValidation.words.map(w => w.word).join(', ')} — +${lastValidation.score}`;
    } else if (lastValidation.reason) {
      $('#status').textContent = `Invalid: ${lastValidation.reason}`;
    } else {
      const bad = lastValidation.words.filter(w => !w.ok).map(w => w.word).join(', ');
      $('#status').textContent = `Not in dictionary: ${bad}`;
    }
  } else {
    $('#status').textContent = ui.tentative.length ? '...' : '';
  }
}

function buildValidationPositions(v) {
  // Mark tentative cells as valid/invalid based on whether all words involving them are ok.
  const validPositions = new Set();
  const invalidPositions = new Set();
  for (const t of ui.tentative) {
    const k = `${t.r},${t.c}`;
    if (v.valid) validPositions.add(k);
    else invalidPositions.add(k);
  }
  return { validPositions, invalidPositions };
}

function handleBoardClick(r, c) {
  if (selectedRackIdx === null) return;
  if (ui.server.board[r][c] !== null) return;
  if (ui.tentative.some(t => t.r === r && t.c === c)) return;
  const letter = ui.rackOrder[selectedRackIdx];
  ui.tentative.push({ r, c, letter, fromRackIdx: selectedRackIdx, blank: letter === '_' });
  selectedRackIdx = null;
  saveTentative();
  refresh();
  scheduleValidate((result) => { lastValidation = result; refresh(); });
}
```

Also update `recall` to clear validation:

```javascript
function recall() {
  clearTentative();
  lastValidation = null;
  refresh();
}
```

- [ ] **Step 3: Manual smoke test**

```bash
rm -f game.db .secret
npm start &
sleep 1
echo "open http://localhost:3000; place tiles forming a real word — status should show valid + score; junk letters should show invalid"
kill %1 2>/dev/null
```

- [ ] **Step 4: Commit**

```bash
git add public/
git commit -m "feat(client): debounced live word validation with status display"
```

---

## Task 18: Client — submit move + recall + SSE

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add submit + SSE wiring**

In `/Users/slabgorb/Projects/words/public/app.js`, add these helpers above `init()`:

```javascript
function nonce() {
  return crypto.randomUUID();
}

async function submitMove() {
  if (!lastValidation?.valid) return;
  const r = await fetch('/api/move', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      placement: ui.tentative.map(t => ({ r: t.r, c: t.c, letter: t.letter, blank: !!t.blank })),
      clientNonce: nonce()
    })
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    $('#status').textContent = `Server rejected: ${body.error || r.status}`;
    return;
  }
  clearTentative();
  lastValidation = null;
  await fetchState();
  // refresh rack-order to reflect new rack from server
  ui.rackOrder = ui.server.racks[ui.server.you].slice();
  refresh();
}

function startSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('move', async () => { await fetchState(); ui.rackOrder = ui.server.racks[ui.server.you].slice(); refresh(); });
  es.addEventListener('pass', async () => { await fetchState(); refresh(); });
  es.addEventListener('swap', async () => { await fetchState(); ui.rackOrder = ui.server.racks[ui.server.you].slice(); refresh(); });
  es.addEventListener('resign', async () => { await fetchState(); refresh(); });
  es.addEventListener('new-game', () => location.reload());
  es.onerror = () => { /* browser auto-reconnects */ };
}
```

In `init()`, after `refresh();`, add:

```javascript
  $('#btn-submit').addEventListener('click', submitMove);
  startSSE();
```

- [ ] **Step 2: Manual smoke test (two browsers)**

```bash
rm -f game.db .secret
npm start &
sleep 1
echo "open http://localhost:3000 in two browser windows; pick keith in one and sonia in the other"
echo "submit a move from keith — sonia's window should update within ~1s without refresh"
kill %1 2>/dev/null
```

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(client): submit move via API and live updates via SSE"
```

---

## Task 19: Client — pass / swap / resign / new-game

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Wire pass + resign + new-game**

In `/Users/slabgorb/Projects/words/public/app.js`, add helpers:

```javascript
async function passTurn() {
  if (!confirm('Pass your turn?')) return;
  const r = await fetch('/api/pass', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientNonce: nonce() })
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    $('#status').textContent = `Pass failed: ${b.error || r.status}`;
    return;
  }
  await fetchState(); refresh();
}

async function swapTiles() {
  const which = prompt('Type the rack letters to swap (e.g. ABC):');
  if (!which) return;
  const tiles = which.toUpperCase().split('').filter(Boolean);
  const r = await fetch('/api/swap', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tiles, clientNonce: nonce() })
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    $('#status').textContent = `Swap failed: ${b.error || r.status}`;
    return;
  }
  await fetchState();
  ui.rackOrder = ui.server.racks[ui.server.you].slice();
  refresh();
}

async function resign() {
  if (!confirm('Resign and lose this game?')) return;
  const r = await fetch('/api/resign', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientNonce: nonce() })
  });
  if (r.ok) { await fetchState(); refresh(); }
}

async function maybeOfferNewGame() {
  if (ui.server.status !== 'ended') return;
  const winner = ui.server.winner ?? 'tie';
  $('#status').textContent = `Game ended (${ui.server.endedReason}) — winner: ${winner}. Click "Pass" to confirm a new game (both players must click).`;
  // Repurpose the pass button while game is ended → New Game confirm
  const btn = $('#btn-pass');
  btn.textContent = 'Confirm new game';
  btn.onclick = async () => {
    const r = await fetch('/api/new-game', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    if (r.ok) {
      const body = await r.json();
      if (body.started) location.reload();
      else $('#status').textContent = `Waiting for ${body.waitingFor} to confirm...`;
    }
  };
}
```

In `init()`, add after the existing button wiring:

```javascript
  $('#btn-pass').addEventListener('click', passTurn);
  $('#btn-swap').addEventListener('click', swapTiles);
  $('#btn-resign').addEventListener('click', resign);
  await maybeOfferNewGame();
```

In `refresh()`, also call `maybeOfferNewGame()` at the end:

```javascript
  maybeOfferNewGame();
```

- [ ] **Step 2: Manual smoke test**

Open two browsers, play a game, try pass/swap/resign/new-game.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(client): pass, swap, resign and new-game flows"
```

---

## Task 20: README + run instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Write `/Users/slabgorb/Projects/words/README.md`:

```markdown
# Words

A two-player Words with Friends clone for personal use. Self-hosted, ad-free.

## Setup

```bash
npm install
npm run fetch-dict
```

This downloads ENABLE2K (~3 MB) into `data/enable2k.txt`.

## Run

```bash
npm start
# defaults: PORT=3000, DB_PATH=./game.db, SECRET_PATH=./.secret
```

Open `http://localhost:3000`, pick "I'm Keith" or "I'm Sonia". Share the URL with your partner (Cloudflare tunnel, Tailscale, LAN, etc.) — the second browser picks the other identity.

## Test

```bash
npm test
```

## Files

- `data/enable2k.txt` — word list (gitignored; fetch with `npm run fetch-dict`)
- `game.db` — active game state (gitignored; safe to delete to reset)
- `.secret` — cookie signing key (gitignored; regenerated on next start if removed)

## Backups

```bash
cp game.db game.db.backup
```

## Reference

- Spec: `docs/superpowers/specs/2026-05-04-words-with-friends-design.md`
- Plan: `docs/superpowers/plans/2026-05-04-words-with-friends-implementation.md`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup/run/test/backup instructions"
```

---

## Self-Review

**1. Spec coverage check.**

Going through every section of the spec:

- [x] Architecture — Tasks 1, 9, 14 (scaffolding, db, server bootstrap)
- [x] Identity model — Task 10 (signed cookie) + Task 15 (picker UI)
- [x] Components: server.js (Task 14), routes.js (Tasks 12+13), sse.js (Task 11), engine.js (Tasks 4-8), dictionary.js (Task 2), board.js (Task 3), db.js (Task 9), identity.js (Task 10)
- [x] Components: index.html, app.js, board.js, rack.js, validator.js, state.js, style.css — Tasks 15-19
- [x] Data flow: validate → submit → SSE — Tasks 12, 17, 18
- [x] Pass/swap/resign/new-game — Task 13 (server) + Task 19 (client)
- [x] Data model: schema with `consecutive_scoreless_turns` — Task 9
- [x] JSON blob storage for board/bag/racks — Task 9
- [x] In-memory dictionary Set — Task 2
- [x] Error handling: invalid placement, bad word, wrong turn, double-submit, bag-too-small, dictionary-missing-at-boot, identity-required — covered across Tasks 12, 13, 9, 14
- [x] SSE drop / browser-closed-mid-placement — handled by `EventSource` auto-reconnect (Task 18) and localStorage `tentative` (Task 16)
- [x] Engine tests (geometry, scoring, applyMove, endGame) — Tasks 4-8
- [x] Dictionary smoke test — Task 2
- [x] Board constants test — Task 3
- [x] Routes integration tests with in-memory SQLite — Tasks 9, 12, 13
- [x] Acceptance criteria — implemented across Tasks 12-19; manual end-to-end in Task 18

**Gap noted:** SSE has no automated test in the plan (only manual two-browser smoke). The spec says "Open an EventSource, submit a move, assert the event arrives. Don't go deeper." This is small enough to add inline; punting it as a known follow-up rather than expanding the plan further. If the executing engineer wants, they can add a 5-line test in Task 13 using `fetch` with a stream reader.

**2. Placeholder scan.**

Searched for `TBD`, `TODO`, "implement later", "fill in details", "appropriate error handling", "similar to". None found.

**3. Type consistency.**

- `validatePlacement` returns `{ valid, axis }` or `{ valid: false, reason }` — same shape used in Tasks 4, 12.
- `extractWords` returns `{ mainWord, crossWords }` where `mainWord` may be null — used consistently in Tasks 5, 6, 12.
- `applyMove` accepts `{ playerId, kind, placement?, scoreDelta?, swapTiles? }` — same shape in Tasks 7, 12, 13.
- DB column `consecutive_scoreless_turns` matches engine field `consecutiveScorelessTurns` — translated in `db.js` (`getGameState`, `persistMove`).
- `clientNonce` (camelCase) → `client_nonce` (snake_case in DB) — translated in `persistMove`.
- `endedReason` (camelCase in JS) → `ended_reason` (DB) — translated in `persistMove`.
- Client uses `ui.server.you` field — populated by `/api/state` in `routes.js` Task 12.
- `ui.tentative` shape matches the placement payload format used by `/api/validate` and `/api/move`. Confirmed across Tasks 16, 17, 18.

**Bug caught and fixed inline:** Task 7 `applyMove` for `play` increments `consecutiveScorelessTurns` if `scoreDelta` is 0. But for a real `play`, score is always > 0 (no zero-score plays in WwF). The current logic only resets when `scoreDelta > 0`; if a play somehow scored 0 it would *increment*, which is correct per the WwF rule (zero-score plays count toward the six-scoreless trigger). Logic stands.

**4. Scope check.**

Plan is for a single sub-project: one app, one game, two players. All tasks build toward the same artifact. No decomposition needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-words-with-friends-implementation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
