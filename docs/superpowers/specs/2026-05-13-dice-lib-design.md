# dice-lib — shared dice library for words + sidequest-ui

**Date:** 2026-05-13
**Status:** Approved (brainstorming)
**Repos affected:** new `~/Projects/dice-lib/`, `~/Projects/words/`, `~/Projects/sidequest/sidequest-ui/`

## Problem

Words and sidequest-ui both ship a 3D dice tray built on R3F + Rapier. Most of the code is duplicated — `d4/d10/d12/d20.ts` are byte-identical, and `replayThrowParams.ts` / `useDiceThrowGesture.ts` differ only by an import path. Words has since diverged with newer code: a pip-style FBX d6 (Devil's Workshop low-poly v3), N-die generalization in `DiceScene`, snap-upright on settle, a d8, a dice-notation parser, and a `DIE_REGISTRY` keyed by kind.

Sidequest is missing all of those improvements. The recent d6 work in words highlights the cost of letting two copies drift: next time we touch dice (a new die, a new asset pack, a physics tweak) we'd be doing the work twice.

## Goal

Extract the shared *core* of both apps' dice systems into a single repo (`dice-lib`) that both apps consume as a local `file:` dependency. Sidequest keeps its app-specific consumer UI (`DiceOverlay`, `InlineDiceTray`, `DiceSpikePage`); words keeps its `<dice-tray>` web-component wrapper. Everything geometric, physical, themed, and gestural lives in one place.

## Non-goals

- Publishing to a registry. `file:` dep is sufficient until a third consumer appears.
- Reconciling sidequest-specific consumer UI with words' plugin-host UI. They serve different apps.
- Turning the lib into a monorepo package or workspace.

## Scope decisions (settled during brainstorming)

| Question | Decision |
|---|---|
| Library scope | Core only — geometry, scene, theme, gesture, replay, assets, parser, registry |
| Distribution | `"file:../dice-lib"` in each app's package.json |
| Asset handling | `import x from "./assets/x.fbx?url"` — Vite emits them at build time |
| Source vs. built | TS source — no `dist/`; consumer Vite bundlers compile in place |
| Reconciliation | Words' files are canonical (consistently newer) |

## Repo layout

```
~/Projects/dice-lib/
├── package.json          # name: "@local/dice-lib", peerDeps: react, three, R3F, drei, rapier
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts          # public exports
│   ├── types.ts          # DieKind, ThrowParams, DiceThrowParams, FaceInfo
│   ├── d4.ts d6.ts d8.ts d10.ts d12.ts d20.ts
│   ├── dieRegistry.ts
│   ├── DiceScene.tsx
│   ├── diceTheme.ts
│   ├── useDiceThrowGesture.ts
│   ├── replayThrowParams.ts
│   ├── parseDiceNotation.ts
│   └── assets/
│       ├── index.ts      # exports DICE_ASSETS map of resolved URLs
│       ├── d6-pip.fbx
│       ├── d6-pip-ivory.png
│       ├── d6-pip-obsidian.png
│       ├── d6-pip-normal.png
│       ├── scratched-plastic-normal.jpg
│       └── Inter-Bold.ttf
└── __tests__/            # 62 dice tests migrate here verbatim
```

## Public API

A single entry point at `@local/dice-lib`:

```ts
// Types
export type { DieKind, ThrowParams, DiceThrowParams, FaceInfo } from "./types";

// Geometry constants & face info (per die)
export {
  D4_RADIUS, computeD4FaceInfo, readD4Value,
  D6_RADIUS, D6_HALF_EDGE, computeD6FaceInfo, readD6Value,
  D8_RADIUS, computeD8FaceInfo, readD8Value,
  D10_RADIUS, computeD10FaceInfo, readD10Value,
  D12_RADIUS, computeD12FaceInfo, readD12Value,
  D20_RADIUS, computeD20FaceInfo, readD20Value,
} from "./d*";

// Registry
export { DIE_REGISTRY, type DieEntry } from "./dieRegistry";

// Scene component
export { DiceScene, type DiceSceneProps } from "./DiceScene";

// Theme
export {
  type DiceTheme,
  DEFAULT_DICE_THEME,
  OBSIDIAN_DICE_THEME,
  THEME_PRESETS,
} from "./diceTheme";

// Gesture + replay
export { useDiceThrowGesture } from "./useDiceThrowGesture";
export { replayThrowParams } from "./replayThrowParams";

// Notation
export { parseDiceNotation } from "./parseDiceNotation";

// Asset URLs (resolved by consumer's Vite bundler at build time)
export { DICE_ASSETS } from "./assets";
```

`DICE_ASSETS` replaces hard-coded `"/shared/dice-assets/..."` and `"/textures/dice/..."` paths:

```ts
// src/assets/index.ts
import d6Fbx from "./d6-pip.fbx?url";
import d6Ivory from "./d6-pip-ivory.png?url";
import d6Obsidian from "./d6-pip-obsidian.png?url";
import d6Normal from "./d6-pip-normal.png?url";
import scratchedPlasticNormal from "./scratched-plastic-normal.jpg?url";
import interBoldFont from "./Inter-Bold.ttf?url";

export const DICE_ASSETS = {
  d6Fbx, d6Ivory, d6Obsidian, d6Normal,
  scratchedPlasticNormal, interBoldFont,
};
```

`diceTheme.ts` and `DiceScene.tsx` import from `./assets` rather than using string literals. Each consumer's Vite bundler emits the assets with hashed filenames automatically.

**Words' `<dice-tray>` bundle (`vite.config.dice.js`):** the bundle gains additional emitted files alongside the JS (an `.fbx`, several `.png`s). Runtime fetch behavior is unchanged because the loaders (`useLoader`, `FBXLoader`) already work via URL.

## Source-of-truth reconciliation

| File | Words | Sidequest | Canonical |
|---|---|---|---|
| `d4/d10/d12/d20.ts` | identical | identical | as-is |
| `d6.ts` | FBX pip model, axis-aligned faceUp, `FACE_NUMBERS = [2,5,6,1,3,4]` | procedural box, radial faceUp, `[1,6,3,4,2,5]` | **words** |
| `d8.ts` | exists | absent | **words** |
| `diceTheme.ts` | `+ d6ColorMap`, `+ OBSIDIAN_DICE_THEME`, `+ THEME_PRESETS` | minimal | **words** (paths swap to `DICE_ASSETS.*`) |
| `DiceScene.tsx` | N dice, registry-driven, `snapDieUpright`, FBX path | d20-only | **words** |
| `useDiceThrowGesture.ts` | imports `ThrowParams` from `./types` | imports from `./DiceScene` | **words** |
| `replayThrowParams.ts` | takes `dieRadius` arg (generalized) | hardcodes `D20_RADIUS` | **words** |
| `dieRegistry.ts`, `parseDiceNotation.ts`, `types.ts` | exists | absent | **words** |

Sidequest gains the new FBX pip d6, N-die rolling, d8 support, and dice notation parsing. Nothing is lost.

## Consumer adaptation

### Sidequest's `DiceScene` API changes

| Prop | Sidequest current | Lib API |
|---|---|---|
| `kind` | implicit (d20) | **required** `"d20"` |
| `count` | implicit (1) | **required** `1` |
| `onSettle` | `(face: number) => void` | renamed `onAllSettle: (values: number[]) => void` |
| `onThrow` | `(params, face) => void` | `(params: ThrowParams) => void` |
| `throwParams`, `rollKey`, `theme` | unchanged | unchanged |

Both `DiceOverlay.tsx` and `InlineDiceTray.tsx` adapt the same way: add `kind="d20"` + `count={1}`, rename the callback prop, unwrap `values[0]` inside `onAllSettle`. No behavior change.

### `replayThrowParams` gains a `dieRadius` arg

Sidequest call sites pass `D20_RADIUS` (now imported from `@local/dice-lib`).

### Wires that survive untouched

- `ConfrontationOverlay → InlineDiceTray` wiring (`InlineDiceTray` keeps its `@/dice/InlineDiceTray` path inside sidequest)
- `App → diceRequest/diceResult → InlineDiceTray` props
- `DiceThrowParams` wire-format type in `@/types/payloads` (separate from the lib's runtime `ThrowParams`)
- Tests outside `src/dice/__tests__` (they mock `DiceScene` rather than importing it directly)
- `DiceSpikePage` and the `?dice-spike` URL hook
- `dice-overlay-wiring-34-5.test.ts` (grep-based; the paths it checks don't change)

## Testing

**Migrated to lib (`~/Projects/dice-lib/__tests__/`):**
The 62 existing dice tests from words — d4/d6/d8/d10/d12/d20 geometry invariants, face-info correctness, `parseDiceNotation`, `replayThrowParams` determinism. Pure logic, no DOM, no React. Run via `vitest run` in the lib.

**Stay in sidequest:**
- `dice-overlay-wiring-34-5.test.ts` (source-grep wiring check)
- `deterministicReplay.test.tsx`, `InlineDiceTray.test.tsx`, `DiceOverlay.test.tsx`, `useDiceThrowGesture.test.ts`, `diceProtocol.test.ts` — all exercise sidequest consumer components or its wire protocol.
- `deterministicReplay.test.tsx` gets a small update: its `replayThrowParams(wireParams, seed)` call becomes `replayThrowParams(wireParams, seed, D20_RADIUS)`.

**Stay in words:**
- Any plugin-side tests that mount `<dice-tray>` (web-component glue stays words-side).

**Lib `package.json` scripts:**
```jsonc
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
}
```

No build script — TS source ships as-is. Consumers' bundlers handle compilation.

## Dev workflow

`file:` deps copy on install rather than symlink, so live editing the lib won't auto-reflect in either app. One-time setup:

```bash
cd ~/Projects/dice-lib && npm link
cd ~/Projects/words && npm link @local/dice-lib
cd ~/Projects/sidequest/sidequest-ui && npm link @local/dice-lib
```

Both apps' Vite dev servers then HMR on lib edits. The `file:` dep in `package.json` is the lockfile-friendly fallback for fresh checkouts and CI.

## Migration order

1. **Bootstrap the lib repo.** Create `~/Projects/dice-lib/` with `package.json`, `tsconfig.json`, `vitest.config.ts`. Copy words' `src/shared/dice/*` and `public/shared/dice-assets/*` (binaries → `src/assets/`). Replace string-literal asset paths with `?url` imports via `DICE_ASSETS`. Run `npm test` — confirm 62/62 pass. Commit.

2. **Wire up words.** Add `"@local/dice-lib": "file:../dice-lib"` to words' `package.json`. `npm link` the lib. Replace `src/shared/dice/index.tsx` with a thin wrapper that re-exports from the lib and defines the `<dice-tray>` custom element. Delete `src/shared/dice/*` (everything except the wrapper) and `public/shared/dice-assets/*`. Update `vite.config.dice.js` if its entry path needs adjusting. Run `npm run build:dice` and smoke-test the backgammon plugin in the browser — confirm dice roll + render unchanged. Commit.

3. **Wire up sidequest.** Add `"@local/dice-lib": "file:../../dice-lib"` (sidequest-ui is nested inside `sidequest/`, so one extra `../`). `npm link` the lib. Adapt `DiceOverlay.tsx` and `InlineDiceTray.tsx` for the lib's `DiceScene` API. Update `replayThrowParams` call sites with `D20_RADIUS`. Update `deterministicReplay.test.tsx` likewise. Delete `src/dice/d4|d6|d10|d12|d20|DiceScene|diceTheme|useDiceThrowGesture|replayThrowParams.ts` and `public/textures/dice/`. Run sidequest's full test suite and dev-server smoke test (confrontation flow with a d20 roll). Commit.

4. **Verify final state:** all three repos' test suites green; dev-server smoke test in both apps; lockfiles checked in.

## Risks and open questions

- **`<dice-tray>` web-component bundle**: words' `vite.config.dice.js` currently produces a single static JS file. With `?url` assets, Vite will emit the dice JS plus the asset files alongside. Production server must serve the asset files at the URLs Vite emits — we'll verify this against the current deploy topology (`public/shared/`) during step 2.
- **`npm link` is per-developer**: CI and fresh clones use the `file:` dep, which copies. Lockfile resolution should still work; verify on a fresh clone after step 3.
- **Asset paths in sidequest's existing `diceTheme`** pointed at `/textures/dice/...`. After the lib swap, those URLs become whatever Vite chooses for the hashed asset emits — anyone hard-coding the old paths elsewhere in sidequest would break. Audit confirms no other files reference `/textures/dice/`.
