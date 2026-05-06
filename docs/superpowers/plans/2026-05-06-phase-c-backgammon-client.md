# Phase C — Backgammon Client UI

**Status:** Draft, awaiting Dev (Gandalf) execution.
**Branch:** `feat/backgammon-engine` (continue on existing branch — Phase B and Phase C will ship together).
**Spec source:** `docs/superpowers/specs/2026-05-06-backgammon-design.md` §5
**Design artifacts:** `docs/superpowers/specs/2026-05-06-backgammon-board-design/`
- `board.html` / `board.css` / `board.jsx` — the Anthropic Design handoff bundle
- `chat1.md` — design intent transcript
- `screenshots/` — reference renders (v1–v8, full, scrolled)
- `README.md` — handoff instructions from Claude Design

## Scope

Build the vanilla-JS client for the backgammon plugin. Engine (Phase B) is complete; this phase wires the UI to it via the existing host plumbing (SSE + action POST + publicView fetch).

**In scope:** SVG board, checker rendering, click-to-select with legal-target dots, scoreboard, doubling cube, dice-tray integration, action buttons (roll/double/resign), end-of-leg / end-of-match screens, history drawer, theme switching, SSE wiring.

**Out of scope (Phase D):** drag-and-drop (use click-to-select for v1), animations, sound, mobile portrait layout.

## Final state of Phase C

```
plugins/backgammon/client/
├── index.html             — entry HTML; matches design's #page/#topbar/#scoreboard/#stage skeleton
├── style.css              — copied verbatim from design board.css (themes + layout)
├── app.js                 — main wiring; render orchestrator; SSE + action plumbing
├── layout.js              — LAYOUT constants and pointLabel(idx) (board geometry)
├── board.js               — DOM rendering of board (4 quadrants + bar + off-tray)
├── point.js               — Point + Checker DOM helpers + SVG triangle factory
├── scoreboard.js          — topbar + scoreboard rendering (target, scores, pip, turn pill, Crawford)
├── cube.js                — Cube DOM rendering + Double button visibility
├── dice.js                — `<dice-tray>` integration (and placeholder fallback)
├── selection.js           — click-to-select state machine (source/target/legal-targets)
├── legal.js               — client-side mirror of `legalFirstMoves` for UI snappiness
├── pip.js                 — pure pip-count calculator from board state
├── actions.js             — postAction() helpers (roll, move, pass-turn, offer/accept/decline, resign)
├── themes.js              — body[data-theme] cycler (walnut, marble, jade, leather)
├── history.js             — history drawer (mirrors plugins/rummikub/client/history.js)
├── end-screen.js          — end-of-leg / end-of-match overlays
└── assets/                — any required local images (none expected; design is CSS-only)
```

No tests in this phase. UI testing is manual via `npm run dev` + browser. Spec §6 explicitly defers e2e for v1.

## Conventions baked into this plan (do not re-litigate)

1. **Vanilla JS only.** No React, no Babel, no JSX. The design's JSX is reference; we render with `document.createElement` and string templates.
2. **CSS lifted verbatim from the design.** `board.css` (814 lines) is the visual contract. Copy it; do not rewrite. If a CSS variable is unused after our subset of UI is built, leave it — future tasks may need it.
3. **Tournament layout, home bottom-right** (per design's chat1.md):
   - Top row left→right: labels 13..18 | 19..24 (idx 11..6 | 5..0)
   - Bottom row left→right: labels 12..7 | 6..1 (idx 12..17 | 18..23)
   - `pointLabel(idx) = 24 - idx` (always — independent of viewer's side)
4. **Viewer perspective is always player A in the visual mock**; the real client must respect `youAre` from `publicView` and **rotate or label-swap accordingly**. (See Task 13 for the perspective-flip implementation note.)
5. **Click-to-select for v1**, drag deferred to Phase D. Spec §5 prefers drag; we deviate explicitly because (a) the design landed on click, (b) drag is a much larger interaction surface, (c) click is more accessible. Log this deviation in the session notes.
6. **No client-side rule rewrites.** `legal.js` MUST be a thin facade over the engine's `enumerateLegalMoves` / `legalFirstMoves` imported from `plugins/backgammon/server/validate.js`. Do not duplicate rule logic. The server is the source of truth.
7. **Theme is a simple cycler**, not a tweaks panel. The design's `tweaks-panel.jsx` is a development tool, not production UI. We use `themes.js` matching the rummikub pattern (button cycles through walnut → marble → jade → leather → walnut).
8. **All actions go through the host's existing plumbing.** `POST /api/games/:gameId/action` for actions, `GET /api/games/:gameId` for state, `EventSource(ctx.sseUrl)` for live updates. Do not invent new endpoints.
9. **`window.__GAME__`** provides ctx — userId, sseUrl, actionUrl, friendly names. Same pattern as rummikub. The host injects this into the served `index.html`.

## Branch setup

Already on `feat/backgammon-engine`. Continue on this branch — Phase B fixes and Phase C will ship in one PR.

```bash
git status                                   # confirm tree clean for backgammon scope
git diff main..HEAD --stat -- plugins/backgammon  # confirm Phase B + HIGH-fix commits present
```

The pre-existing rummikub working-tree changes (`plugins/rummikub/client/*.js`, `test/rummikub-*.test.js`) are unrelated and stay untouched throughout Phase C.

---

## Task 1: Client scaffold (index.html + style.css + empty modules)

**Files:**
- Create: `plugins/backgammon/client/index.html`
- Create: `plugins/backgammon/client/style.css`
- Create: empty `plugins/backgammon/client/{app,layout,board,point,scoreboard,cube,dice,selection,legal,pip,actions,themes,history,end-screen}.js`

### Step 1: Copy CSS verbatim
```bash
cp docs/superpowers/specs/2026-05-06-backgammon-board-design/board.css \
   plugins/backgammon/client/style.css
```
The CSS is final. Do not modify in this phase. If something looks off later, note it as a Phase D polish item.

### Step 2: Author `index.html`

Mirror the design's HTML skeleton, but **strip the React/Babel CDN scripts**, **drop the tweaks gear button**, and **add the SSE-driven `<main id="stage">` slot**. Use this exact structure:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backgammon</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=JetBrains+Mono:wght@500;600;700&display=swap">
<link rel="stylesheet" href="style.css">
</head>
<body data-theme="walnut">
<div id="page">
  <header id="topbar">
    <a class="back" href="/">← Lobby</a>
    <div class="match-meta">
      <span class="match-target">Match to <strong id="match-target">3</strong></span>
      <span class="dot"></span>
      <span class="game-no" id="game-no">Game 1</span>
      <span class="dot crawford-dot hidden"></span>
      <span class="crawford-indicator hidden">Crawford</span>
    </div>
    <div class="float-actions">
      <button id="btn-theme" type="button" aria-label="Cycle theme" title="Theme">◐</button>
      <button id="btn-history" type="button" aria-label="History" title="History">≡</button>
    </div>
  </header>

  <section id="scoreboard">
    <div class="score score-a">
      <span class="score-name" id="name-a">You</span>
      <span class="score-pts"><strong id="score-a">0</strong> <span class="score-of">/ <span id="target-a">3</span></span></span>
      <span class="score-pip">pip <em id="pip-a">167</em></span>
    </div>
    <div class="turn-pill" id="turn-pill">Waiting…</div>
    <div class="score score-b">
      <span class="score-name" id="name-b">Opponent</span>
      <span class="score-pts"><strong id="score-b">0</strong> <span class="score-of">/ <span id="target-b">3</span></span></span>
      <span class="score-pip">pip <em id="pip-b">167</em></span>
    </div>
  </section>

  <main id="stage">
    <div id="root"></div>
  </main>

  <section id="action-bar" class="hidden">
    <button id="btn-roll" class="hidden">Roll</button>
    <button id="btn-double" class="hidden">Double</button>
    <button id="btn-accept" class="hidden">Accept</button>
    <button id="btn-decline" class="hidden">Decline</button>
    <button id="btn-resign">Resign</button>
  </section>

  <section id="end-screen" class="hidden">
    <h2 id="end-headline"></h2>
    <p id="end-summary"></p>
    <button id="btn-new" class="hidden">Lobby</button>
  </section>

  <aside id="history-drawer" class="hidden">
    <header><h3>History</h3><button id="btn-history-close" aria-label="Close">×</button></header>
    <ol id="history-list"></ol>
  </aside>
</div>
<script type="module" src="app.js"></script>
</body>
</html>
```

Note the additions vs the design HTML:
- `#match-target`, `#game-no`, `.crawford-dot/.crawford-indicator` for live update.
- `#btn-theme` / `#btn-history` replace the design's `#btn-tweaks-toggle`.
- `#action-bar` for roll/double/accept/decline/resign — not present in the design.
- `#end-screen` and `#history-drawer` — not present in the design (mirroring rummikub).
- Score/name/target spans get IDs so the scoreboard module can update them in place.
- `<script type="module" src="app.js">` replaces the design's React/Babel scripts.

### Step 3: Stub all the JS modules

Create each file with exactly this header so subsequent tasks can land cleanly:

```js
// plugins/backgammon/client/app.js  (and analogous in each module)
// Phase C scaffold — implementation lands in Task N.
```

This makes the bare scaffold importable and prevents `404` cascades when the host serves it.

### Step 4: Smoke-check the served files

The host serves `plugins/backgammon/client/` at `/play/backgammon/:gameId/`. With `npm run dev` running, open a backgammon game in the browser. Expected: empty board area, but topbar + scoreboard render with placeholder content, no console errors, no missing-asset 404s.

### Step 5: Commit
```bash
git add plugins/backgammon/client/ docs/superpowers/specs/2026-05-06-backgammon-board-design/
git commit -m "feat(backgammon/client): Phase C scaffold + design artifacts"
```

---

## Task 2: Theme module + theme cycler

**Files:**
- Modify: `plugins/backgammon/client/themes.js`
- Modify: `plugins/backgammon/client/app.js` (wire button)

### Step 1: Author `themes.js` mirroring `plugins/rummikub/client/themes.js`

```js
// Board-surface theme cycler. Sets body[data-theme]; CSS responds.

const THEMES = {
  walnut:  { label: 'Walnut'  },
  marble:  { label: 'Marble'  },
  jade:    { label: 'Jade'    },
  leather: { label: 'Leather' },
};
const ORDER = ['walnut', 'marble', 'jade', 'leather'];
const STORAGE_KEY = 'backgammon.theme';

let active = localStorage.getItem(STORAGE_KEY);
if (!THEMES[active]) active = 'walnut';

function syncBodyAttr() {
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.theme = active;
  }
}
syncBodyAttr();

export function getTheme() { return active; }
export function getThemeLabel() { return THEMES[active].label; }

export function cycleTheme() {
  const i = ORDER.indexOf(active);
  active = ORDER[(i + 1) % ORDER.length];
  localStorage.setItem(STORAGE_KEY, active);
  syncBodyAttr();
  return active;
}
```

### Step 2: Wire the theme button in `app.js`

Add:
```js
import { cycleTheme } from './themes.js';
document.getElementById('btn-theme').addEventListener('click', cycleTheme);
```

### Step 3: Manual verification

Click the theme button and watch the board frame, point colors, and checker hues change between walnut → marble → jade → leather. Reload — the chosen theme persists.

### Step 4: Commit
```bash
git add plugins/backgammon/client/themes.js plugins/backgammon/client/app.js
git commit -m "feat(backgammon/client): theme cycler (walnut/marble/jade/leather)"
```

---

## Task 3: Layout module — geometry constants

**Files:**
- Modify: `plugins/backgammon/client/layout.js`

Pure module — no DOM, no state. Constants and one helper.

```js
// Standard tournament layout, home bottom-right (player A's home = idx 18..23).
//   Top row left→right:    labels 13..18 | 19..24
//   Bottom row left→right: labels 12..7  | 6..1
// Each indices array is THE 6 cells of one quadrant in render order.
export const LAYOUT = {
  topLeft:  [11, 10, 9, 8, 7, 6],     // labels 13..18
  topRight: [5, 4, 3, 2, 1, 0],       // labels 19..24
  botLeft:  [12, 13, 14, 15, 16, 17], // labels 12..7
  botRight: [18, 19, 20, 21, 22, 23], // labels 6..1 — A's HOME
};

// Standard backgammon point numbering for player A's perspective.
// idx 0 = label 24 (A's 24-point); idx 23 = label 1 (A's 1-point).
export function pointLabel(idx) { return 24 - idx; }
```

This module is referenced by `board.js`, `point.js`, and (later) `selection.js`. No tests — geometry is verified visually in Task 4.

Commit with Task 4 (no commit yet).

---

## Task 4: Board + Point + Checker rendering (static)

**Goal:** Render the four quadrants, the bar, and the off-tray with arbitrary supplied state. No interaction yet.

**Files:**
- Modify: `plugins/backgammon/client/point.js`
- Modify: `plugins/backgammon/client/board.js`

### Step 1: Author `point.js`

Pure DOM helpers — no state, no event listeners (those land in Task 7+).

Required exports:
- `createCheckerEl({ color, selected, badge })` → returns a `.checker` element with concentric-rings styling. Adds `.color-a` or `.color-b`. If `selected`, adds `.selected`. If `badge != null`, appends a `.stack-badge` showing `×count`.
- `createPointTriEl({ position, parity })` → returns a `.point-tri` wrapper containing the SVG triangle. Triangles point DOWN for top points, UP for bottom points. Parity is `'light'` or `'dark'`.
- `createPointEl({ idx, position, parity, cell, selected, isLegalTarget, showLegalDots })` → returns a `.point` element with `.point-num`, `.point-tri`, `.point-stack`, optional `.legal-target` dot. Stack compresses past 5 (visible cap=5, top checker carries `×count` badge if overflow). Adds `.movable` if `cell.color != null`.

The SVG triangle path:
```js
// Top point (apex pointing down): M0,0 L100,0 L50,100 Z
// Bottom point (apex pointing up): M0,100 L100,100 L50,0 Z
```
Use the design's gradient (`<linearGradient id="g-...">`) verbatim — copy from `board.jsx:111-138`. Include the subtle center-sheen highlight path.

### Step 2: Author `board.js`

```js
import { LAYOUT, pointLabel } from './layout.js';
import { createPointEl, createCheckerEl } from './point.js';

// Render the 4 quadrants + bar + off-tray into `<div id="root">`.
// `board` is the board portion of state: { points, barA, barB, bornOffA, bornOffB }.
// `ui` is the interactive overlay state: { selected, legalTargets, showLegalDots }.
//   - selected: idx | 'bar-a' | 'bar-b' | null
//   - legalTargets: Set<idx | 'off'>
export function renderBoard(root, board, ui) { /* ... */ }
```

Implementation outline:
1. Clear `root` (or use a stable wrapper element).
2. Build `.board-wrap > .board` with the four `.quad.tl/.tr/.bl/.br`, `.bar`, and `.off-tray` children.
3. For each quadrant, iterate its `LAYOUT.{topLeft|topRight|botLeft|botRight}` indices, render `createPointEl(...)` per cell. Compute `parity` from the design's rule:
   ```js
   const parity = (col % 2 === 0) === (position === 'top') ? 'light' : 'dark';
   ```
4. Render the `.bar` with two halves: `bar-top` (B's bar checkers — opponent perspective) and `bar-bottom` (A's bar checkers).
5. Render the `.off-tray` with `top` half = B's borne-off, `bottom` half = A's borne-off, divider in middle, `.off-bar` for each, `.off-count` badge if > 0.

### Step 3: Drive a static test render in `app.js`

Until publicView fetching is wired (Task 8), render a hard-coded mid-game state mirroring the design's `midGameState()` (board.jsx:28). This proves the board renders correctly. Replace once Task 8 lands.

```js
// app.js (temporary — replaced in Task 8)
import { renderBoard } from './board.js';
const fixtureBoard = { /* mirror midGameState from board.jsx */ };
renderBoard(document.getElementById('root'), fixtureBoard, {
  selected: null, legalTargets: new Set(), showLegalDots: false,
});
```

### Step 4: Manual verification

`npm run dev`, open a backgammon game. Expect: full board renders matching the design's `screenshots/full.png`. Verify:
- Point labels: top row reads 13–18 | 19–24 left-to-right; bottom row reads 12–7 | 6–1.
- Checker stacks render correctly; stacks > 5 compress and show ×N badge.
- Bar shows borne checkers (1 ivory in fixture).
- Off-tray shows 2 ivory bars + count badge.
- All four themes render correctly (cycle via theme button).
- No console errors.

### Step 5: Commit
```bash
git add plugins/backgammon/client/{layout,point,board,app}.js
git commit -m "feat(backgammon/client): static board, point, checker, off-tray, bar rendering"
```

---

## Task 5: Scoreboard + topbar live-update

**Files:**
- Modify: `plugins/backgammon/client/scoreboard.js`
- Modify: `plugins/backgammon/client/pip.js`

### Step 1: Author `pip.js`

```js
// Pure pip-count calculator. For player A, distance to bear-off is (24 - idx).
// For player B, distance is (idx + 1). Bar adds 25 pips per checker on the bar.
export function pipCount(board, side) { /* ... */ }
```

Definition: pip count is the sum of distances each checker must travel to bear off, ignoring blocking.

- For A: each checker at idx i contributes `(24 - i)` pips; bar checkers contribute 25 each (must enter at i ≤ 5, then travel ≥ 19 pips).
- For B: each checker at idx i contributes `(i + 1)` pips; bar checkers contribute 25 each.
- Borne-off checkers contribute 0.

### Step 2: Author `scoreboard.js`

```js
import { pipCount } from './pip.js';

// Update topbar (match-target, game-no, crawford indicator) and scoreboard
// (names, scores, pip, turn-pill) from state.
// `state` is the publicView. `ctx` is window.__GAME__ for friendly names.
export function renderScoreboard(state, ctx) { /* ... */ }
```

Map fields:
- `#match-target`, `#target-a`, `#target-b` ← `state.match.target`
- `#game-no` ← `Game ${state.match.gameNumber}`
- `.crawford-indicator` / `.crawford-dot` ← visible iff `state.match.crawford === true`
- `#name-a` / `#name-b` ← from `ctx` (you vs opponent friendly names, mapped by `state.youAre`)
- `#score-a` / `#score-b` ← `state.match.scoreA` / `state.match.scoreB`
- `#pip-a` / `#pip-b` ← `pipCount(state.board, 'a' | 'b')`
- `#turn-pill` text by phase:
  - `initial-roll`: "Roll for first move" (always visible to both players)
  - `pre-roll`: viewer is active → "Your turn"; else → "Opponent's turn"
  - `moving`: viewer is active → "Your move"; else → "Opponent moving…"
  - `awaiting-double-response`: viewer offered → "Waiting for response"; else → "Opponent doubled"

### Step 3: Wire to render orchestrator (placeholder for Task 8)

In `app.js`, call `renderScoreboard(fixtureState, ctx)` after `renderBoard(...)`. Use a hard-coded fixture state with the mid-game position used in Task 4.

### Step 4: Manual verification

Verify the scoreboard renders with the fixture's mid-game pip counts (compute by hand: A's checkers in mid-game ≈ 121 pips; B's ≈ 134 — should match the design's screenshot v8).

### Step 5: Commit
```bash
git add plugins/backgammon/client/{pip,scoreboard,app}.js
git commit -m "feat(backgammon/client): scoreboard + pip count + crawford indicator"
```

---

## Task 6: Cube rendering

**Files:**
- Modify: `plugins/backgammon/client/cube.js`

### Step 1: Author `cube.js`

```js
// Render the doubling cube into the .board's bar/cube position.
// `cube` is state.cube: { value, owner: 'a'|'b'|null, pendingOffer: null | { from } }.
// `youAre` is 'a' or 'b' (the viewer's side).
export function renderCube(cube, youAre) { /* ... */ }
```

Positioning rules (match `board.css` `.cube`, `.cube.owned-a`, `.cube.owned-b`):
- `owner === null` → centered on bar (default `.cube` styles)
- `owner === youAre` → `.cube.owned-a` (anchored to bottom of bar — viewer's side)
- `owner === opponent` → `.cube.owned-b` (anchored to top of bar — opponent's side)

If `pendingOffer != null`, render a small "DOUBLE?" label above the cube (use `.cube-pending` class — style with `color: var(--gold)`, `font-style: italic`, position absolute above the cube; CSS already has `--gold`).

The cube element lives **inside** `.board` (absolute-positioned). Insert/update it as a sibling of the quadrants, OR create it once on first render and only update its class + `.cube-value` text on subsequent renders.

### Step 2: Wire into `board.js` render

`renderBoard` calls `renderCube(state.cube, state.youAre)` after rendering the bar. Pass `state.cube` and `state.youAre` into `renderBoard` (extend its signature; update the static fixture call in `app.js`).

### Step 3: Manual verification

Hard-code three fixture states and visually verify:
1. `cube: { value: 1, owner: null, pendingOffer: null }` → centered, value "1"
2. `cube: { value: 2, owner: 'a', pendingOffer: null }` (with `youAre: 'a'`) → bottom of bar, value "2"
3. `cube: { value: 4, owner: 'b', pendingOffer: { from: 'b' } }` (with `youAre: 'a'`) → top of bar, "DOUBLE?" label above

### Step 4: Commit
```bash
git add plugins/backgammon/client/{cube,board,app}.js
git commit -m "feat(backgammon/client): cube rendering with owner positioning + pending-offer label"
```

---

## Task 7: Dice tray integration (`<dice-tray>` web component + placeholder fallback)

**Files:**
- Modify: `plugins/backgammon/client/dice.js`

The `<dice-tray>` Web Component is provided by Phase A at `public/shared/dice.js`. It is loaded as an ES module and self-registers the custom element.

### Step 1: Add the dice bundle script tag

Edit `index.html`. Just before `<script type="module" src="app.js">`, add:
```html
<script type="module" src="/shared/dice.js"></script>
```
This registers `<dice-tray>` globally before `app.js` runs.

### Step 2: Author `dice.js`

```js
// Renders/updates a <dice-tray> element in the active player's outer board.
// Phase-driven:
//   initial-roll: viewer can roll once their `state.initialRoll[youAre]` is null.
//   pre-roll:     viewer is active → roll button enabled; else → idle display.
//   moving:       show the rolled values (read-only, replay).
//   awaiting-double-response: dice hidden.
//
// On a successful roll, the tray emits `dice-rolled` with detail = { values, throwParams }.
// We forward that to actions.js postAction('roll' | 'roll-initial', payload).
export function renderDice(state, youAre, onRoll) { /* ... */ }
```

Mounting site: a `<div id="dice-area">` inside `.board`, absolute-positioned per `board.css` `.dice-area.right` (in viewer's outer board, currently styled in CSS as the right inner board — adjust the `.dice-area.right` rule if needed to land in the viewer's outer board, which is bottom-left under the standard layout).

API of `<dice-tray>` (from `src/shared/dice/index.tsx`):
- Attribute `dice="2d6"` — number/type of dice
- Attribute `mode="active"` (rollable) | `mode="replay"` (display only)
- Property `values` (when `mode="replay"`) — array of die values to render
- Event `dice-rolled` with `detail: { values: number[], throwParams: object[] }`
- Event `all-settle` — emitted when physics settle (ignore for now; the dice-rolled event is the action trigger)

If the bundle hasn't loaded yet (rare), fall back to the placeholder dice from the design's `DiePlaceholder` (board.jsx:274). Render `<div class="die-placeholder">` × N with pip layout. Replace once `<dice-tray>` is registered.

### Step 3: Wire into `app.js`

`app.js` calls `renderDice(state, state.youAre, ({ values, throwParams }) => postRollAction(values, throwParams))` after `renderBoard`.

### Step 4: Manual verification

- Open game in `pre-roll` (or use the `roll-initial` flow). The dice tray appears bottom-left (viewer's outer board).
- Click/tap to roll. Dice animate and settle on values 1–6 (Phase A's physics).
- After settling, the values appear in the tray. The values array is sent to the action endpoint (verify via Network tab).
- During opponent's turn, the dice show the **opponent's** roll in `mode="replay"` (read-only display).

### Step 5: Commit
```bash
git add plugins/backgammon/client/{dice,index,app}.html plugins/backgammon/client/{dice,app}.js
git commit -m "feat(backgammon/client): <dice-tray> integration with phase-driven mode"
```
(Note: stage `dice.js`, `index.html`, `app.js`.)

---

## Task 8: SSE wiring + state fetch

**Files:**
- Modify: `plugins/backgammon/client/app.js`
- Modify: `plugins/backgammon/client/actions.js`

### Step 1: Author the render orchestrator in `app.js`

```js
import { renderBoard } from './board.js';
import { renderScoreboard } from './scoreboard.js';
import { renderActionBar } from './action-bar.js';   // Task 9
import { renderEndScreen } from './end-screen.js';   // Task 16
import { appendHistoryEntry, loadHistory } from './history.js';  // Task 12

const ctx = window.__GAME__;
let state = null;

async function fetchState() {
  const r = await fetch(ctx.gameUrl);
  if (!r.ok) return;
  state = await r.json();   // publicView
  render();
}

function render() {
  if (!state) return;
  renderScoreboard(state, ctx);
  renderBoard(document.getElementById('root'), state.board, currentUI(), state.cube, state.youAre);
  renderActionBar(state, ctx);
  renderEndScreen(state);
}

function openSSE() {
  const es = new EventSource(ctx.sseUrl);
  es.addEventListener('update', () => fetchState());
  es.addEventListener('ended', () => fetchState());
  es.addEventListener('turn', (e) => {
    let entry; try { entry = JSON.parse(e.data); } catch { return; }
    appendHistoryEntry(entry, ctx);
  });
  es.onerror = () => {/* browser auto-reconnects */};
}

fetchState();
loadHistory(ctx);
openSSE();
```

`ctx` exposes `gameUrl`, `sseUrl`, `actionUrl`, `historyUrl`, `userId`, `yourFriendlyName`, `opponentFriendlyName` — same keys as rummikub uses (see `src/server/plugin-clients.js` `serveIndex` for the injection contract).

### Step 2: Remove the static fixture from `app.js`

Delete the hard-coded mid-game fixture; the live state from `fetchState()` drives everything from here on.

### Step 3: Author `actions.js` POST helper

```js
const ctx = window.__GAME__;

export async function postAction(type, payload) {
  const r = await fetch(ctx.actionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  });
  if (!r.ok) {
    const text = await r.text();
    console.warn(`action ${type} failed: ${text}`);
  }
  // Successful actions broadcast 'update' via SSE, which triggers fetchState().
  // No need to manually re-fetch here.
}
```

### Step 4: Manual verification

Open two browser tabs (two different users) on the same game. In tab A, roll dice or move a checker. Tab B should re-render within ~100ms via SSE.

### Step 5: Commit
```bash
git add plugins/backgammon/client/{app,actions}.js
git commit -m "feat(backgammon/client): SSE wiring + publicView fetch + action POST helper"
```

---

## Task 9: Action bar (roll / double / accept / decline / resign)

**Files:**
- Modify: `plugins/backgammon/client/actions.js`
- Create: `plugins/backgammon/client/action-bar.js`

### Step 1: Author `action-bar.js`

```js
import { postAction } from './actions.js';

// Show/hide buttons in #action-bar based on state.turn.phase and viewer side.
//   pre-roll, viewer active:               #btn-roll, #btn-double (if allowed), #btn-resign
//   moving, viewer active:                 #btn-resign  (no roll; doMove fires from selection)
//   awaiting-double-response, viewer ≠ offerer: #btn-accept, #btn-decline
//   initial-roll, viewer not yet rolled:   none (dice tray drives roll-initial)
//   any other phase:                       hide all
export function renderActionBar(state, ctx) { /* ... */ }
```

Helpers needed:
- "viewer active" = `state.turn.activePlayer === state.youAre`
- "double allowed" = `state.turn.phase === 'pre-roll' && (cube.owner === youAre || cube.owner === null) && !state.match.crawford && cube.value < 64`
  (mirror of `cube.canOffer` — keep this logic in **one** place; if needed, import the engine's `canOffer` from `plugins/backgammon/server/cube.js`.)

Wire button click handlers (idempotent — re-attaching on each render is fine if you remove old listeners first; or attach once on init and read state at click time):
- `#btn-roll` → `postAction('roll', { values: [...], throwParams: [...] })` — but in this codebase the **dice tray** owns the roll itself (Task 7); the `#btn-roll` is a fallback that only appears if the dice-tray bundle failed to load. Keep it as a graceful fallback; it submits two random 1..6 values with empty `throwParams`.
- `#btn-double` → `postAction('offer-double')`
- `#btn-accept` → `postAction('accept-double')`
- `#btn-decline` → `postAction('decline-double')`
- `#btn-resign` → confirm dialog (`confirm("Resign this leg?")`), then `postAction('resign')`

### Step 2: Manual verification

Open game in two tabs, walk a full leg:
1. Both roll-initial (via dice tray)
2. Active player rolls (dice tray)
3. (Until Task 10 lands, you can't move) — verify resign works: click Resign in tab A, observe leg ends, score updates in both tabs, board resets.
4. Test double offer/accept/decline on a fresh leg in `pre-roll`.

### Step 3: Commit
```bash
git add plugins/backgammon/client/{action-bar,actions,app}.js
git commit -m "feat(backgammon/client): action bar (roll/double/accept/decline/resign)"
```

---

## Task 10: Click-to-select + legal-target dots

**Files:**
- Modify: `plugins/backgammon/client/legal.js`
- Modify: `plugins/backgammon/client/selection.js`
- Modify: `plugins/backgammon/client/board.js` (event delegation)
- Modify: `plugins/backgammon/client/app.js` (re-render on selection change)

### Step 1: Author `legal.js`

Thin facade over the engine — **do not duplicate rule logic**:

```js
import { legalFirstMoves } from '../server/validate.js';

// Returns Set<idx | 'off'> of valid destinations from `from` for the active player.
// `from` is idx | 'bar'.
// `dice` is state.turn.dice.remaining (or null if not rolled).
export function legalTargetsFrom(board, dice, side, from) {
  if (!dice || dice.length === 0) return new Set();
  const all = legalFirstMoves(board, dice, side);
  const matches = all.filter(m => m.from === from);
  return new Set(matches.map(m => m.to));
}
```

Note: `plugins/backgammon/client/` imports from `../server/validate.js` — this works because the host serves the plugin directory and the relative path resolves correctly when run as ES modules in the browser. Verify via Network tab on first load that `validate.js`, `board.js`, `cube.js`, etc. are served as 200s.

If browser-side imports of `../server/...` cause CORS / static-serve trouble, the fallback is to bundle `validate.js` + `board.js` + `constants.js` into a single client-side `/play/backgammon/<gameId>/_engine.js` via a small build step or a dynamic import. **First try the direct relative import**; only fall back to bundling if it fails.

### Step 2: Author `selection.js`

```js
// Selection state: which checker source the user has clicked.
let selected = null;       // null | idx | 'bar'
const listeners = [];
export function getSelected() { return selected; }
export function setSelected(s) { selected = s; listeners.forEach(fn => fn()); }
export function onSelectionChange(fn) { listeners.push(fn); }
```

The `'bar-a'` / `'bar-b'` distinction in the design isn't needed — the viewer can only ever select **their own** bar (`'bar'`).

### Step 3: Wire click events in `board.js`

Use a single delegated click listener on `.board`:
```js
board.addEventListener('click', (e) => {
  const point = e.target.closest('.point');
  const bar = e.target.closest('.bar-half.bar-bottom'); // viewer's bar half
  // ... compute clicked source/target, call into selection state machine ...
});
```

Logic:
- If clicked on a point or bar containing the viewer's checkers, set `selected = idx | 'bar'`.
- If clicked on a point already in `legalTargets`, dispatch `postAction('move', { from, to })` and clear selection.
- Otherwise, clear selection.

Forbid selecting opponent's checkers. Forbid selecting if it's not the viewer's `moving` phase. Forbid selecting any source other than `'bar'` if the viewer's bar count > 0 (the engine enforces this; mirror the constraint client-side for clearer affordance).

### Step 4: Subscribe to selection changes from `app.js`

```js
import { onSelectionChange } from './selection.js';
onSelectionChange(render);
```

`render()` recomputes `legalTargets` via `legalTargetsFrom(state.board, state.turn.dice?.remaining, state.youAre, getSelected())` and passes it to `renderBoard`.

### Step 5: Manual verification

- It is your `moving` phase. Click one of your checkers. Selected checker lifts (`.selected` class), all reachable destinations show pulsing gold dots.
- Click a legal-dot point. Action posts; on update the checker has moved.
- Click your bar checker if any. Only legal entry points light up; click one to enter.
- Click a non-legal point with selection active. Selection clears, no action posted.
- Click an opponent's checker. Nothing happens.

### Step 6: Commit
```bash
git add plugins/backgammon/client/{legal,selection,board,app}.js
git commit -m "feat(backgammon/client): click-to-select + legal-target dots + move action"
```

---

## Task 11: Drag-and-drop (DEFERRED to Phase D)

Spec §5 says "Drag = pick up". We deviate to click-to-select for v1 because:
- The design landed on click-select (see chat1.md).
- Drag-and-drop is a much larger interaction surface (touch events, drag thresholds, accessibility, fallback when drag is blocked).
- Click-select is fully functional and accessible.

**Log this as a deviation when committing to the session record.** Phase D will add drag as an enhancement, not a replacement (click should continue to work).

No work in this task; documented for traceability.

---

## Task 12: History drawer

**Files:**
- Modify: `plugins/backgammon/client/history.js`

Mirror `plugins/rummikub/client/history.js` structure exactly. Differences are in `formatEntry`.

### Step 1: Author `history.js`

```js
const entries = []; // newest first

export function formatEntry(entry, ctx) {
  const me = ctx.yourFriendlyName ?? 'You';
  const opp = ctx.opponentFriendlyName ?? 'Opponent';
  const yourSide = entry.youAre /* if injected */ || /* derive from ctx + state.sides */;
  const name = entry.side === yourSide ? me : opp;
  const s = entry.summary ?? {};
  switch (s.kind) {
    case 'roll-initial':
      return s.tie
        ? `Initial roll: tied — both reroll`
        : `${name === me ? me : 'Opponent'} won the initial roll`;
    case 'roll':
      return `${name} rolled ${s.values.join('-')}`;
    case 'move':
      return `${name} moved`;
    case 'pass-turn':
      return `${name} passed (no legal moves)`;
    case 'offer-double':
      return `${name} offered the cube`;
    case 'accept-double':
      return `${name} accepted — cube is now ${s.cubeValue ?? '?'}`;
    case 'leg-end':
      return `Leg ${s.gameNumber ?? ''}: ${name} won (${s.type})`;
    case 'match-end':
      return `Match: ${name} wins`;
    default:
      return `${name} ${s.kind}`;
  }
}

export async function loadHistory(ctx) { /* GET ctx.historyUrl, populate entries[], render() */ }
export function appendHistoryEntry(entry, ctx) { /* push, render() */ }
export function toggleDrawer() { /* toggle .hidden on #history-drawer */ }
```

### Step 2: Wire toggle in `app.js`
```js
import { toggleDrawer } from './history.js';
document.getElementById('btn-history').addEventListener('click', toggleDrawer);
document.getElementById('btn-history-close').addEventListener('click', toggleDrawer);
```

### Step 3: CSS for `#history-drawer`

The design CSS doesn't include a history drawer — port from rummikub's `style.css` (search `#history-drawer`). Append the drawer CSS to the bottom of `plugins/backgammon/client/style.css` (one-time tweak; do not modify the design CSS rules above).

### Step 4: Manual verification

- Click ≡ history button → drawer slides in.
- Walk a full leg from the start. Drawer shows: initial-roll, rolls, moves, leg-end. Newest first.
- Resign or accept-double also appends correctly.

### Step 5: Commit
```bash
git add plugins/backgammon/client/{history,app}.js plugins/backgammon/client/style.css
git commit -m "feat(backgammon/client): history drawer with backgammon-specific formatter"
```

---

## Task 13: Viewer perspective (rotate vs label-swap)

**Files:**
- Modify: `plugins/backgammon/client/board.js`
- Modify: `plugins/backgammon/client/scoreboard.js`

The design assumes viewer is player A. When `state.youAre === 'b'`, naively rendering would put B's home (idx 0..5) at top-left, not bottom-right. Fix by swapping the LAYOUT mapping based on `youAre`.

### Step 1: Define perspective-flipped LAYOUT

Add to `layout.js`:
```js
// LAYOUT_B is LAYOUT mirrored for player B's perspective: B's home (idx 0..5)
// occupies the bottom-right quadrant.
export const LAYOUT_B = {
  topLeft:  [12, 13, 14, 15, 16, 17],  // B sees A's outer (idx 12..17), labels 12..7
  topRight: [18, 19, 20, 21, 22, 23],  // B sees A's home (idx 18..23), labels 6..1
  botLeft:  [11, 10, 9, 8, 7, 6],
  botRight: [5, 4, 3, 2, 1, 0],        // B's home — labels 19..24 if A-relative, but…
};
```

Wait — point labels are *standard* (1..24 from each player's own perspective). For B, the 1-point is idx 0; for A, the 1-point is idx 23. So `pointLabel` must take `youAre` into account:

```js
export function pointLabel(idx, youAre) {
  return youAre === 'a' ? 24 - idx : idx + 1;
}
```

Update all callers (board.js, point.js) to pass `state.youAre`.

For the bar split: viewer's checkers always render on the bottom half (`.bar-bottom`), opponent's on the top half — the existing convention from Task 4 still holds; just key the side by `youAre` rather than hard-coded `'a'`.

For the off-tray: viewer's borne-off goes in the bottom half (`.off-tray-half.bottom` "You borne off"), opponent's in the top half ("Opponent borne off") — keying by `youAre`.

### Step 2: Manual verification

Sign in as user 1 (player A) on tab 1, user 2 (player B) on tab 2. Both view the same game. Each sees their own checkers in the bottom half, their home bottom-right, point labels 1..6 in their own home quadrant.

### Step 3: Commit
```bash
git add plugins/backgammon/client/{layout,board,point,scoreboard}.js
git commit -m "feat(backgammon/client): viewer perspective — flip layout + point labels by youAre"
```

---

## Task 14: End-of-leg / end-of-match overlays

**Files:**
- Modify: `plugins/backgammon/client/end-screen.js`

### Step 1: Author `end-screen.js`

```js
// Show #end-screen when:
//   - state has a leg-end event (transient flash, 3s, then hides) — OR
//   - state.match indicates match is over (winner reached target).
// Show match-end persistently with a "Lobby" button.
export function renderEndScreen(state) { /* ... */ }
```

Logic:
- Match over: `state.match.scoreA >= state.match.target || state.match.scoreB >= state.match.target` → show persistent overlay with headline ("You won!" / "You lost.") and a "Lobby" button (link to `/`).
- Leg over (transient): triggered by the SSE `'turn'` event with `summary.kind === 'leg-end'`. Flash a 3-second toast: `${winnerName} won leg ${gameNumber} (+${points} ${type})`. Use `setTimeout` to hide.

Toast styling: append a small `.leg-toast` div to `#stage` (or top of `body`); CSS rules go at the bottom of `style.css`:
```css
.leg-toast {
  position: fixed;
  top: 20%;
  left: 50%;
  transform: translateX(-50%);
  padding: 18px 28px;
  background: rgba(0,0,0,0.85);
  color: var(--gold);
  border: 1px solid var(--gold);
  border-radius: 8px;
  font-family: var(--type-serif);
  font-style: italic;
  font-size: 18px;
  z-index: 200;
  pointer-events: none;
  animation: legtoast-fade 3s ease forwards;
}
@keyframes legtoast-fade {
  0%, 80% { opacity: 1; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, -10px); }
}
```

### Step 2: Manual verification

- Walk a full leg (resign in 2 clicks for speed). End-of-leg toast appears, fades, board resets to initial position with `gameNumber` incremented.
- Continue to match-end. Persistent overlay shows.

### Step 3: Commit
```bash
git add plugins/backgammon/client/end-screen.js plugins/backgammon/client/style.css
git commit -m "feat(backgammon/client): end-of-leg toast + end-of-match overlay"
```

---

## Task 15: Manual smoke run + cross-browser pass

**No code changes.** Verification only.

Run the host (`npm run dev`), open two tabs as two users. Walk through:
1. Match creation (lobby → new match → backgammon, target=3).
2. Initial roll for each side. Verify tie → reroll.
3. Higher-roller becomes active, plays first turn with both initial dice values.
4. Pass-turn auto-fires when no legal moves.
5. Test must-use-both: a position where one die is forced.
6. Test bear-off (set up via several turns or use a pre-rolled fixture if you add one — out of scope, can be omitted).
7. Test cube: A doubles → B accepts → next turn cube is 2, owned by B.
8. Test cube decline: A doubles → B declines → leg ends, A scores 1.
9. Test resign.
10. Test Crawford: build score to target-1 (e.g. target=3, A wins gammon for 2 → scoreA=2 → next leg is Crawford → no doubling allowed).
11. Test target=1 match: cube fully usable, Crawford never triggers.
12. Test history drawer accumulates correctly.
13. Test theme cycler — all 4 themes render correctly.
14. Browsers: Chrome, Safari, Firefox.

If anything regresses, file fixes as separate commits before Task 16.

---

## Task 16: Self-review pass against spec §5

**No code unless gaps found.**

Walk the spec §5 checklist:

- [ ] **Board:** SVG board, 24 points alternating dark/light, bar in middle, off-tray on either side, CSS-themed → ✓ Tasks 1, 4
  - Note: design uses off-tray on RIGHT only (single column), not "either side" — spec wording is loose; rummikub-style "off-tray on either side" would mean two separate trays. Design's single off-tray is acceptable; log as deviation if user prefers two.
- [ ] **Checkers:** 15 per side, circles stacked, drag = pick up, valid destinations highlight → ✓ except drag (deviated to click; Task 11)
- [ ] **Dice tray:** `<dice-tray>` Web Component anchored bottom-right → Task 7. (Note design positions in viewer's outer board, which is bottom-LEFT for player A in tournament layout. "Bottom-right" in spec is loose; bottom of board on viewer's side is the spirit.)
- [ ] **Cube:** small element on the bar; shows value + owner; "Double" button when legal → ✓ Tasks 6, 9
- [ ] **Match panel:** top — "Game N / Race to T" + scores + Crawford indicator → ✓ Task 5
- [ ] **History drawer:** side panel listing each completed leg (winner, points, cube, type) → ✓ Task 12. Note: rummikub's history shows EVERY action; backgammon's spec-words "each completed leg" suggests fewer entries. We render all turn events; user can filter by clicking. Acceptable; log if user prefers leg-only view.
- [ ] **SSE handler:** existing pattern — fetch snapshot on `update` event, re-render → ✓ Task 8

Address gaps inline before declaring Phase C done.

---

## Task 17: Push + open draft PR

```bash
git push origin feat/backgammon-engine
gh pr create --draft --base main --title "feat(backgammon): engine + client (Phases B + C)" --body "..."
```

PR body should:
- Reference both spec docs (`backgammon-design.md` for engine, `backgammon-board-design/` for UI)
- Reference both plans (`phase-b-backgammon-engine.md`, `phase-c-backgammon-client.md`)
- List Saruman's review verdict and the HIGH/MEDIUM remediation status
- Note what's deferred to Phase D (drag, mobile portrait, animations, polish)

Saruman gets summoned for full review on the combined diff.

---

## Done

When all 17 tasks are complete:
- `plugins/backgammon/client/*.js` and `index.html`/`style.css` exist and are self-contained.
- `<dice-tray>` integrates and rolls correctly.
- A full match plays end-to-end across two tabs without engine errors.
- All four themes render correctly.
- History drawer accumulates correctly.
- Branch `feat/backgammon-engine` is pushed.
- Draft PR is open targeting `main`.

Phase D (polish) covers: drag, animations, sound, mobile portrait, theme refinements, and the end-of-leg "next leg" CTA.
