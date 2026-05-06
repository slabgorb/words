# Backgammon plugin + shared `<dice-tray>` component

**Status:** Design (pending implementation plan)
**Date:** 2026-05-06
**Author:** Architect (Gollum/Smeagol)
**Decision driver:** First of N planned dice-using games. Dice will be a host-level reusable component, not a per-plugin asset.

---

## 1. Goals & non-goals

### Goals
- Add a Backgammon plugin to Gamebox that follows the existing plugin contract.
- Establish a **shared, reusable 3D dice component** at the host level (`src/shared/dice/`) usable by future dice games.
- Preserve the host's vanilla-JS plugin idiom — existing plugins (Words, Rummikub) are not modified, do not adopt React.
- Keep server authority and the existing single-row-per-game schema intact.
- Support **match play** (best-of-N legs) without introducing a new database concept.

### Non-goals (v1)
- Beavers / raccoons / Jacoby rule
- Automatic doubles on initial-roll tie (just reroll on tie)
- Post-Crawford automatic doubles
- Clock / time controls
- Spectator mode (no Gamebox plugin has it)
- Bot opponent
- Gammon/backgammon resignation negotiation (only single-cube-value resignation)
- Server-side physics verification of throw params (deferred to v2 — see §3.4)

---

## 2. Architecture overview

```
src/shared/dice/             ← NEW — host-owned, lifted from sidequest-ui
  index.tsx                  ← Web Component registration (<dice-tray>)
  DiceScene.tsx              ← rapier physics + r3f rendering
  useDiceThrowGesture.ts     ← gesture handler
  replayThrowParams.ts       ← deterministic replay
  d6.ts, d20.ts, d10.ts ...  ← per-die geometry / face-reading
  diceTheme.ts               ← theme palette
  __tests__/                 ← lifted + new web-component tests

vite.config.dice.js          ← NEW — bundles src/shared/dice/ → public/shared/dice.js

public/shared/dice.js        ← NEW — bundle output (.gitignored, built via npm prepare)

plugins/backgammon/          ← NEW — mirrors plugins/rummikub/ layout
  plugin.js
  server/{state,actions,validate,board,cube,match,view}.js
  client/{index.html,app.js,board.js,drag.js,cube.js,match.js,history.js,style.css}

src/plugins/index.js         ← MODIFIED — register backgammonPlugin
test/backgammon-*.test.js    ← NEW — node --test suites
```

**No changes to:** the host's plugin contract, the games table schema, the SSE transport, the existing plugins, or the auth/identity layer.

---

## 3. Shared `<dice-tray>` component

### 3.1 Why a Web Component

The dice are inherently a React component (sidequest-ui builds them on `@react-three/fiber` + `@react-three/rapier`, which are React-bound). Wrapping the React tree as a custom element lets vanilla-JS plugins (rummikub, words, backgammon) consume it without adopting React themselves. Plugins drop in `<dice-tray>` and listen for events — they never touch React, three, or rapier.

### 3.2 Public contract

```html
<dice-tray
  dice="2d6"
  mode="active"
  theme="ivory"
  disabled="false">
</dice-tray>
```

**Attributes:**

| name       | type    | values                          | meaning |
|------------|---------|----------------------------------|---------|
| `dice`     | string  | `1d6`, `2d6`, `1d20`, `3d4`, ... | Standard dice notation; determines geometry and count |
| `mode`     | string  | `active`, `replay`, `idle`        | `active` = player can throw; `replay` = plays stored params; `idle` = pickup-die fidget only |
| `theme`    | string  | `ivory`, `obsidian`, `default`, ... | Visual palette key (registered in `diceTheme.ts`) |
| `replay`   | string (JSON) | `{"throwParams":[...]}` | Required when `mode="replay"`; the dice replay these params |
| `disabled` | boolean | `true` / absent                  | Active mode but rejects gestures (e.g. opponent's turn) |

**Events:**

| event              | `detail` shape                                  | fires when |
|--------------------|--------------------------------------------------|------------|
| `dice-throw`       | `{ throwParams: ThrowParams[] }`                 | Player gesture released; physics simulation begins |
| `dice-settle`      | `{ values: number[], throwParams: ThrowParams[] }` | Active-mode dice come to rest |
| `dice-replay-settle` | `{ values: number[] }`                         | Replay-mode dice come to rest |

**Methods:** `reset()`, `throw(throwParams)` — programmatic throw (used by tests; backgammon plugin does not call directly).

### 3.3 Source lift from sidequest-ui

The following files transfer near-verbatim from `~/Projects/oq-1/sidequest-ui/src/dice/`:

- `DiceScene.tsx` — adapted to be d-notation parameterized (renders N dice instead of one fixed d20)
- `d6.ts`, `d10.ts`, `d12.ts`, `d20.ts`, `d4.ts` — per-die geometry & face-reading (unchanged)
- `useDiceThrowGesture.ts`
- `replayThrowParams.ts`
- `diceTheme.ts`
- `__tests__/diceProtocol.test.ts`
- `__tests__/useDiceThrowGesture.test.ts`
- `__tests__/deterministicReplay.test.tsx`

The following are **new** in Gamebox:

- `index.tsx` — `customElements.define('dice-tray', ...)` registration; React root mounted into the custom element's shadow DOM; attribute → prop bridging via `attributeChangedCallback`; events dispatched via `this.dispatchEvent(new CustomEvent(...))`.
- `__tests__/diceTray.test.tsx` — Web Component contract: attribute changes update the React tree, `dice-settle` fires with correct payload shape, `replay` mode reproduces stored values.

### 3.4 Trust model

**v1: Optimistic, opponent-verified.**

1. Active player gestures → local rapier simulates → settles on values.
2. Client emits `dice-settle` with `{values, throwParams}`.
3. Plugin's `client/app.js` POSTs `action: { type: 'roll', payload: {throwParams, values} }`.
4. Server's `applyAction` validates *the action shape* and that the actor is the current player in the `pre-roll` phase. **It does not re-verify the values against the throw params.** Values are stored as-is.
5. SSE broadcast → opponent's client receives the new state including `turn.dice = {values, throwParams}`.
6. Opponent's `<dice-tray mode="replay" replay='{...}'>` runs the same params through deterministic rapier physics, fires `dice-replay-settle` with its own computed values, and `console.warn`s if those don't match the stored values.

This places the trust on the active player, which is acceptable on a curated Tailscale roster of friends and family. Detection is automatic: the opponent's screen *will* show the visual mismatch and log to console.

**v2 (deferred):** Add `@dimforge/rapier3d-compat` (Node-compatible rapier) to host deps and re-run physics server-side in `applyAction` to verify the claimed values. Reject the action on mismatch.

### 3.5 Build pipeline

- **`vite.config.dice.js`** at repo root — `lib`-mode build with entry `src/shared/dice/index.tsx`, format `es`, output `public/shared/dice.js`. Externalizes nothing — the bundle is self-contained.
- **`package.json` script:** `"build:dice": "vite build --config vite.config.dice.js"`.
- **Auto-build on install:** `"prepare": "npm run build:dice"` runs after `npm install`.
- **`.gitignore`:** add `public/shared/dice.js` (build artifact).
- **Watch mode for dev:** `"dev:dice": "vite build --config vite.config.dice.js --watch"`.
- **Dev-server impact:** none — Express serves the built file from `public/shared/` like any other static asset.

**New host devDependencies:**
- `vite`
- `@vitejs/plugin-react`
- `react`, `react-dom`
- `@react-three/fiber`, `@react-three/rapier`, `@react-three/drei`
- `three`
- `typescript`, `@types/react`, `@types/react-dom`, `@types/three`

The dice's React/three/rapier deps are **devDependencies**, not runtime deps — the bundle inlines them. The Node server never imports them.

**Bundle size budget:** ≤ 700 KB gzipped. Acceptable for a self-hosted LAN-bound app. No code-splitting (one bundle, one fetch).

### 3.6 Plugin consumption pattern

Backgammon's `client/index.html`:
```html
<script type="module" src="/shared/dice.js"></script>
...
<dice-tray id="my-dice" dice="2d6" mode="idle" theme="ivory"></dice-tray>
```

Backgammon's `client/app.js`:
```js
const tray = document.getElementById('my-dice');
tray.addEventListener('dice-settle', e => {
  postAction({ type: 'roll', payload: e.detail });
});
// On state update from SSE:
if (state.turn.activePlayer === me && state.turn.phase === 'pre-roll') {
  tray.setAttribute('mode', 'active');
} else if (state.turn.dice) {
  tray.setAttribute('mode', 'replay');
  tray.setAttribute('replay', JSON.stringify({ throwParams: state.turn.dice.throwParams }));
}
```

---

## 4. Backgammon plugin

### 4.1 File layout

Mirrors `plugins/rummikub/` exactly. Each file's responsibility:

- `plugin.js` — exports the plugin contract object
- `server/state.js` — `buildInitialState({participants, rng, options})`; reads `options.matchLength` (default 3)
- `server/actions.js` — `applyBackgammonAction` dispatcher; routes by `action.type`
- `server/validate.js` — pure functions: `enumerateLegalMoves(board, dice, player)`, `isLegalMove(board, dice, player, from, to)`, `mustUseBothDice(board, dice, player)`, `isBearingOff(board, player)`
- `server/board.js` — board representation, mutators: `applyMove`, `hitCheck`, `enterFromBar`, `bearOff`
- `server/cube.js` — cube state machine: `canOffer`, `applyOffer`, `applyAccept`, `applyDecline`
- `server/match.js` — score accrual, gammon/backgammon detection, Crawford-leg detection, match-end check, leg reset
- `server/view.js` — `backgammonPublicView({state, viewerId})` — minimal redaction (only sets `youAre`)
- `client/*` — vanilla JS rendering + drag + SSE handling, mirroring rummikub's structure

### 4.2 State shape (single JSON column)

```js
{
  match: {
    target: 3,                  // first to N points wins (configurable at game creation)
    scoreA: 0, scoreB: 0,
    gameNumber: 1,
    crawford: false,            // true on the leg where one side has reached target-1
    crawfordPlayed: false,      // true after the Crawford leg completes; cube re-enabled post-Crawford
  },
  cube: {
    value: 1,                   // 1, 2, 4, 8, 16, 32, 64
    owner: null,                // 'a' | 'b' | null (centered)
    pendingOffer: null,         // null | { from: 'a' | 'b' }
  },
  board: {
    points: [                   // length 24, index 0 = player A's 24-point, index 23 = player A's 1-point
      { color: 'a' | 'b' | null, count: 0 },
      ...
    ],
    barA: 0, barB: 0,           // checkers on the bar per player
    bornOffA: 0, bornOffB: 0,   // checkers borne off per player
  },
  turn: {
    activePlayer: 'a' | 'b',
    phase: 'initial-roll' | 'pre-roll' | 'moving' | 'awaiting-double-response',
    dice: null | {
      values: [4, 3],           // sorted high-to-low; 4 entries if doubles
      remaining: [4, 3],        // dice not yet consumed by a move
      throwParams: [...]        // parameter set per die (for replay)
    },
  },
  legHistory: [
    {
      gameNumber: 1,
      winner: 'a' | 'b',
      points: 2,                // cube value × multiplier (1 / 2 / 3)
      type: 'single' | 'gammon' | 'backgammon' | 'resigned',
      cube: 2,
    },
    ...
  ],
  initialRoll: null | {
    a: 4, b: 3,                 // null until both have rolled
    throwParamsA, throwParamsB,
  },
}
```

### 4.3 Action surface

| action            | payload                              | preconditions                                                                 | effect |
|-------------------|--------------------------------------|-------------------------------------------------------------------------------|--------|
| `roll-initial`    | `{value, throwParams}`               | `phase === 'initial-roll'`, `initialRoll[me]` is null                          | Records this player's die. When both present and unequal, sets `activePlayer` to higher, primes `turn.dice` with both values, advances to `phase: 'moving'`. On tie: clears `initialRoll`, both must reroll. |
| `roll`            | `{values, throwParams}`              | actor is `activePlayer`, `phase === 'pre-roll'`                                | Sets `turn.dice = {values, remaining: doubled-or-pair, throwParams}`. Advances `phase` to `'moving'`. Auto-`pass-turn` if `enumerateLegalMoves()` is empty. |
| `move`            | `{from, to}`                         | actor is `activePlayer`, `phase === 'moving'`, move is in `enumerateLegalMoves()` | Applies move, mutates board (incl. hits), removes consumed die from `remaining`. If `remaining` empty OR no legal moves: auto-`pass-turn`. |
| `pass-turn`       | (none)                               | actor is `activePlayer`, `phase === 'moving'`                                  | Switches `activePlayer`, clears `turn.dice`, sets `phase: 'pre-roll'`. |
| `offer-double`    | (none)                               | actor is `activePlayer`, `phase === 'pre-roll'`, actor owns cube OR cube centered, NOT Crawford leg, cube < cap (64) | Sets `cube.pendingOffer = {from: actor}`, `phase: 'awaiting-double-response'`. |
| `accept-double`   | (none)                               | actor is opponent, `phase === 'awaiting-double-response'`                      | `cube.value *= 2`, `cube.owner = actor`, clears pendingOffer, `phase: 'pre-roll'` (active player unchanged — they were about to roll). |
| `decline-double`  | (none)                               | actor is opponent, `phase === 'awaiting-double-response'`                      | Awards `cube.value` (pre-double) to offerer, ends leg, advances match. |
| `resign`          | (none)                               | not `awaiting-double-response`                                                 | Awards `cube.value` to opponent, type `'resigned'`, ends leg. |

### 4.4 Move validation (standard Western rules)

- A checker on the bar must be entered first (no other moves allowed while `barA > 0` or `barB > 0` for the active player).
- A checker may move to a point that is empty, owned by the active player, or occupied by exactly one opponent checker (a *blot*) — the blot is hit and sent to the bar.
- A checker may not move to a point with 2+ opponent checkers.
- Both dice must be used if any combination of legal moves exists that uses both. If only one die can be used, the higher die is mandatory if both are individually playable.
- Doubles produce 4 dice of the same value to be played.
- Bearing off requires all 15 checkers in the active player's home board (points 19–24 from A's perspective). Exact-pip bear-off is preferred; a higher die may bear off the highest-occupied point.
- Gammon: opponent has not borne off any checker → 2× cube.
- Backgammon: opponent has not borne off and has at least one checker in active player's home board OR on the bar → 3× cube.

### 4.5 Cube + Crawford

- Cube starts at 1, centered (`owner: null`).
- Doubling allowed only at start of own turn (`phase === 'pre-roll'`).
- After accept: cube doubles, ownership transfers to the *acceptor*.
- Cap at 64 (no doubling beyond).
- Crawford: when a player first reaches `target - 1` points, the **next leg only** (`crawford: true`) disables doubling. After that leg completes, `crawfordPlayed: true` and the cube is re-enabled (post-Crawford auto-doubles are NOT implemented in v1).
- For matches with `target: 1`: cube is fully usable, Crawford never triggers.

### 4.6 Match-as-row mechanics

- `applyAction` returns `{ ended: false }` for every action that doesn't end the match — even leg-ending actions.
- When a leg ends (decline-double, resign, or all-15-borne-off): plugin pushes to `legHistory`, increments `match.scoreA` or `match.scoreB`, checks for match end.
- **If match continues:** plugin resets `board` (initial setup), resets `cube` (1, centered, no offer), resets `turn` (`activePlayer: null`, `phase: 'initial-roll'`, `dice: null`), clears `initialRoll` (set to `{a: null, b: null}`), increments `match.gameNumber`, sets `crawford` flag if applicable. Returns `{ ended: false }`. Each leg begins with the same initial-roll ceremony as game 1 — standard tournament rules.
- **If match ends:** sets winner-related fields, returns `{ ended: true, scoreDelta: { [winnerId]: target } }`.

### 4.7 Initial roll (every leg)

- At the start of each leg (`phase === 'initial-roll'`): both players see `<dice-tray dice="1d6" mode="active">` simultaneously.
- Each rolls; client sends `roll-initial`.
- Server records each in `initialRoll`.
- When both present and unequal: higher → `activePlayer`, both values → `turn.dice` (sorted high-to-low), `phase: 'moving'`.
- On tie: `initialRoll = {a: null, b: null}`, both reroll. (Per §1 non-goals, the doubled-cube auto-double on tie is not implemented.)

Initial-roll repeats at the start of every leg — standard tournament rules. The previous leg's winner does not get to roll first by default.

### 4.8 publicView

```js
function backgammonPublicView({ state, viewerId }) {
  // Backgammon is open-information; no fields hidden.
  const youAre = participantSide(state, viewerId);  // 'a' | 'b'
  return { ...state, youAre };
}
```

---

## 5. Client UI (vanilla JS, mirrors rummikub patterns)

- **Board:** SVG board, 24 points alternating dark/light, bar in middle, off-tray on either side. CSS-themed.
- **Checkers:** 15 per side; rendered as circles stacked on points. Drag = pick up; valid destinations highlight using `validate.js`'s `enumerateLegalMoves` output.
- **Dice tray:** `<dice-tray>` Web Component anchored bottom-right.
- **Cube:** small element on the bar; shows value + owner; "Double" button when legal.
- **Match panel:** top — "Game N / Race to T" + scores + Crawford indicator.
- **History drawer:** side panel listing each completed leg (winner, points, cube, type) — pattern lifted from rummikub's `history.js`.
- **SSE handler:** existing pattern — fetch snapshot on `update` event, re-render.

---

## 6. Testing

### Server (node --test, in `test/`)

- `backgammon-state.test.js` — initial state shape, configurable match length, initial board setup
- `backgammon-validate.test.js` — bar entry, bear-off (exact + higher-die), must-use-both, doubles (4 plays), hit detection, blocked points
- `backgammon-cube.test.js` — offer/accept/decline transitions, ownership transfer, cap, Crawford suppression, post-Crawford restoration
- `backgammon-match.test.js` — score accrual, gammon/backgammon detection, leg reset, match end, target=1 single-game mode
- `backgammon-actions.test.js` — full-turn flows: roll → moves → pass; offer → accept → next turn; offer → decline → leg end

### Shared dice (in `src/shared/dice/__tests__/`)

- `diceProtocol.test.ts` — lifted from sidequest-ui
- `useDiceThrowGesture.test.ts` — lifted
- `deterministicReplay.test.tsx` — lifted
- `diceTray.test.tsx` — NEW — Web Component contract: attribute changes update internal state, events fire with correct shape, replay mode reproduces values

### E2E (deferred, not blocking v1)

Optional Playwright-style flow following the recent rummikub e2e pattern (see git log: `895b917 test(e2e): assert history is recorded during full game flow`).

---

## 7. Open questions explicitly deferred

- **Server-side physics verification (v2):** decided to defer; opponent-side detection is sufficient for the trust environment. Revisit if Gamebox ever opens beyond Tailscale.
- **Theme system for dice:** initial themes `ivory` (white checkers/dice) and `obsidian` (black checkers/dice). Theme registration lives in `diceTheme.ts`; future plugins can register their own themes by extending the file.
- **Cube cap configurability:** hard-coded to 64 in v1. Could become a creation-time option later.
- **Match history at host level:** the lobby will show one row per active match. A future host-level "completed matches" view is out of scope.

---

## 8. Risk register

| risk                                                  | severity | mitigation |
|-------------------------------------------------------|----------|------------|
| Bundle size bloat (rapier WASM is large)              | medium   | Budget set at 700 KB gz; measured at first build. Code-split if exceeded. |
| Deterministic replay drift across browsers            | medium   | rapier is deterministic at fixed timestep across modern browsers; sidequest-ui already validates this in its test suite. Carry the test forward. |
| React + Web Component shadow-DOM event quirks         | low      | Custom element dispatches plain `CustomEvent`s on its own host node; React internals stay inside shadow root. Pattern is well-trodden. |
| Build step in `prepare` script slows fresh installs   | low      | One-time cost; can be cached in CI. Watch mode for dev iteration. |
| Mobile portrait layout for the board                  | medium   | Backgammon is landscape-friendly; mobile portrait will need a separate layout (defer to follow-up; v1 targets desktop / landscape tablet). |
| Trusting client-reported dice values                  | low      | Friends-and-family Tailscale roster; opponent-side detection logs mismatches. v2 path documented. |

---

## 9. Implementation phasing (high level — detailed plan to follow)

1. **Phase A — Shared dice infra:** Add Vite + React deps, create `src/shared/dice/` with lifted files, build Web Component wrapper, configure build pipeline, ship `<dice-tray>` with passing tests. *No game changes.* Verify dice load and roll on a throwaway HTML page.
2. **Phase B — Backgammon engine:** Implement `server/` modules with full test coverage. *No client work.* Engine usable headlessly via tests.
3. **Phase C — Backgammon client:** Build vanilla-JS client (board, drag, dice-tray integration, cube UI, match panel, history drawer). Wire to existing SSE.
4. **Phase D — Polish:** themes, mobile layout, sound effects (optional), final cross-browser pass.

Each phase is its own implementation plan / story.

---

## 10. References

- Existing plugin pattern: `plugins/rummikub/` (closest analog)
- Existing host contract: `README.md` §"Plugin contract"
- Dice source of truth: `~/Projects/oq-1/sidequest-ui/src/dice/`
- Match-history pattern: `plugins/rummikub/client/history.js` + recent commit `e779ad6`
