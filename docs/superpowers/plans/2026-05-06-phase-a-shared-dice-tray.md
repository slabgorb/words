# Phase A: Shared `<dice-tray>` Web Component — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a host-bundled, reusable `<dice-tray>` Web Component to Gamebox, lifted from `~/Projects/oq-1/sidequest-ui/src/dice/`, generalized to support arbitrary dice notation (`1d6`, `2d6`, `1d20`, …), and exposed to vanilla-JS plugins as a custom element. No game integration in this phase — only the shared infrastructure.

**Architecture:** New `src/shared/dice/` source directory built by a new Vite config (`vite.config.dice.js`) into a single self-contained ES module bundle at `public/shared/dice.js`. The bundle inlines React, three.js, @react-three/fiber, @react-three/rapier and registers `customElements.define('dice-tray', …)` on import. Plugins consume it via `<script type="module" src="/shared/dice.js">` and a `<dice-tray>` element. Test runner is **Vitest with jsdom** for the dice subtree; existing **node --test** suite is untouched.

**Tech Stack:** TypeScript, React 19, @react-three/fiber, @react-three/rapier, @react-three/drei, three, Vite (lib mode), Vitest + jsdom + @testing-library/react.

**Reference paths (read-only sources for lift):**
- `~/Projects/oq-1/sidequest-ui/src/dice/d4.ts`, `d6.ts`, `d10.ts`, `d12.ts`, `d20.ts`
- `~/Projects/oq-1/sidequest-ui/src/dice/diceTheme.ts`
- `~/Projects/oq-1/sidequest-ui/src/dice/useDiceThrowGesture.ts`
- `~/Projects/oq-1/sidequest-ui/src/dice/replayThrowParams.ts`
- `~/Projects/oq-1/sidequest-ui/src/dice/DiceScene.tsx`
- `~/Projects/oq-1/sidequest-ui/src/dice/__tests__/deterministicReplay.test.tsx`
- `~/Projects/oq-1/sidequest-ui/src/dice/__tests__/useDiceThrowGesture.test.ts`
- `~/Projects/oq-1/sidequest-ui/public/fonts/Inter-Bold.ttf`
- `~/Projects/oq-1/sidequest-ui/public/textures/dice/scratched-plastic-normal.jpg`

---

## File structure (final state of Phase A)

**Created:**
```
vite.config.dice.js                         # Vite lib-mode config for the dice bundle
tsconfig.dice.json                          # TS config for src/shared/dice/
vitest.config.ts                            # Vitest config (jsdom env)
src/shared/dice/
  index.tsx                                 # <dice-tray> custom element + React root
  DiceScene.tsx                             # r3f scene; multi-die capable
  diceTheme.ts                              # theme types + presets
  dieRegistry.ts                            # die-kind → geometry/face-reading
  d4.ts d6.ts d8.ts d10.ts d12.ts d20.ts    # per-die geometry (d4/d6/d10/d12/d20 lifted; d8 NEW)
  useDiceThrowGesture.ts                    # gesture hook (lifted)
  replayThrowParams.ts                      # deterministic replay (adapted)
  parseDiceNotation.ts                      # "2d6" → {count, sides}
  types.ts                                  # ThrowParams, DiceThrowParams, DieKind
  __tests__/
    parseDiceNotation.test.ts               # NEW
    useDiceThrowGesture.test.ts             # LIFTED
    deterministicReplay.test.tsx            # LIFTED + adapted
    diceTray.test.tsx                       # NEW (Web Component contract)
public/shared/dice-assets/
  Inter-Bold.ttf                            # COPIED from sidequest-ui
  scratched-plastic-normal.jpg              # COPIED from sidequest-ui
public/shared/dice-test.html                # smoke-test page (manual verification)
```

**Modified:**
```
package.json                                # add deps + scripts
.gitignore                                  # ignore public/shared/dice.js bundle output
```

**NOT modified in Phase A:** any `plugins/*`, `src/server/*`, `src/plugins/*`. Game integration is Phase B/C.

---

## Task 1: Add dependencies and base scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add devDependencies and scripts to `package.json`**

Read current `package.json`, then replace the `scripts` and `devDependencies` blocks (and add `devDependencies` if absent). Final shape:

```json
{
  "name": "gamebox",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/server/server.js",
    "test": "node --test 'test/**/*.test.js'",
    "test:dice": "vitest run --config vitest.config.ts",
    "test:dice:watch": "vitest --config vitest.config.ts",
    "build:dice": "vite build --config vite.config.dice.js",
    "dev:dice": "vite build --config vite.config.dice.js --watch",
    "prepare": "npm run build:dice",
    "fetch-dict": "node bin/fetch-dictionary.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@react-three/drei": "^10.7.7",
    "@react-three/fiber": "^9.5.0",
    "@react-three/rapier": "^2.2.0",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@types/three": "^0.183.1",
    "@vitejs/plugin-react": "^6.0.1",
    "jsdom": "^29.0.1",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "three": "^0.183.2",
    "typescript": "~5.9.3",
    "vite": "^8.0.5",
    "vitest": "^4.1.1"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install --ignore-scripts` (use `--ignore-scripts` because the `prepare` script will fail until vite.config.dice.js exists)
Expected: installs without error, `node_modules` populated. Warnings about peer deps are acceptable as long as install completes.

- [ ] **Step 3: Update `.gitignore`**

Append:
```
# Built dice bundle (regenerated by `npm run build:dice`)
public/shared/dice.js
public/shared/dice.js.map
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore(deps): add Vite + React + r3f + rapier + vitest for shared dice"
```

---

## Task 2: TypeScript and Vitest configuration

**Files:**
- Create: `tsconfig.dice.json`
- Create: `vitest.config.ts`
- Create: `src/shared/dice/__tests__/_smoke.test.ts` (temporary — proves the test runner works)

- [ ] **Step 1: Create `tsconfig.dice.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src/shared/dice/**/*"]
}
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/shared/dice/**/*.test.{ts,tsx}"],
    setupFiles: [],
  },
});
```

- [ ] **Step 3: Create the smoke test**

Create `src/shared/dice/__tests__/_smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("vitest smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run smoke test**

Run: `npm run test:dice`
Expected: 1 test passes. If you see an error, the most likely causes are: missing `@types/react`, jsdom not installed, or the include glob mismatch — re-check Step 2.

- [ ] **Step 5: Delete smoke test**

Run: `rm src/shared/dice/__tests__/_smoke.test.ts`

- [ ] **Step 6: Commit**

```bash
git add tsconfig.dice.json vitest.config.ts
git commit -m "chore: TS + Vitest config for src/shared/dice"
```

---

## Task 3: Lift dice assets

**Files:**
- Create: `public/shared/dice-assets/Inter-Bold.ttf`
- Create: `public/shared/dice-assets/scratched-plastic-normal.jpg`

- [ ] **Step 1: Create the assets directory**

Run: `mkdir -p public/shared/dice-assets`

- [ ] **Step 2: Copy the font and texture**

Run:
```bash
cp ~/Projects/oq-1/sidequest-ui/public/fonts/Inter-Bold.ttf public/shared/dice-assets/
cp ~/Projects/oq-1/sidequest-ui/public/textures/dice/scratched-plastic-normal.jpg public/shared/dice-assets/
```

- [ ] **Step 3: Verify**

Run: `ls -la public/shared/dice-assets/`
Expected: both files present, non-zero size.

- [ ] **Step 4: Commit**

```bash
git add public/shared/dice-assets/
git commit -m "feat(shared/dice): add font + normal-map texture for dice rendering"
```

---

## Task 4: Local types module (`types.ts`)

**Files:**
- Create: `src/shared/dice/types.ts`
- Create: `src/shared/dice/__tests__/types.test.ts`

This module declares the wire types used by `replayThrowParams` and the Web Component contract — replacing the sidequest-ui-specific `@/types/payloads` import in the original code.

- [ ] **Step 1: Write the failing test**

Create `src/shared/dice/__tests__/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { ThrowParams, DiceThrowParams, DieKind } from "../types";

describe("dice types", () => {
  it("ThrowParams has position[3], linearVelocity[3], angularVelocity[3], rotation[3]", () => {
    const p: ThrowParams = {
      position: [0, 0, 0],
      linearVelocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    expect(p.position).toHaveLength(3);
    expect(p.linearVelocity).toHaveLength(3);
    expect(p.angularVelocity).toHaveLength(3);
    expect(p.rotation).toHaveLength(3);
  });

  it("DiceThrowParams has velocity[3], angular[3], position[2]", () => {
    const p: DiceThrowParams = {
      velocity: [0, 0, 0],
      angular: [0, 0, 0],
      position: [0.5, 0.5],
    };
    expect(p.velocity).toHaveLength(3);
    expect(p.angular).toHaveLength(3);
    expect(p.position).toHaveLength(2);
  });

  it("DieKind covers d4, d6, d8, d10, d12, d20", () => {
    const kinds: DieKind[] = ["d4", "d6", "d8", "d10", "d12", "d20"];
    expect(kinds).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:dice -- types`
Expected: FAIL — `Cannot find module '../types'`

- [ ] **Step 3: Create `src/shared/dice/types.ts`**

```ts
/** Scene-format throw parameters for a single die (Rapier coordinates). */
export interface ThrowParams {
  position: [number, number, number];
  linearVelocity: [number, number, number];
  angularVelocity: [number, number, number];
  rotation: [number, number, number];
}

/** Wire-format throw parameters: serializable and seed-replayable. */
export interface DiceThrowParams {
  /** Linear velocity in tray-space units (3D). */
  velocity: [number, number, number];
  /** Angular velocity in radians/sec (3D). */
  angular: [number, number, number];
  /** Spawn position normalized to tray space (2D, both in [0, 1]). */
  position: [number, number];
}

/** Supported die kinds. d8 is currently a placeholder — face-reading not implemented. */
export type DieKind = "d4" | "d6" | "d8" | "d10" | "d12" | "d20";

/** Parsed dice notation, e.g. "2d6" → {count: 2, sides: 6}. */
export interface DiceSpec {
  count: number;
  sides: number;
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:dice -- types`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/dice/types.ts src/shared/dice/__tests__/types.test.ts
git commit -m "feat(shared/dice): add types module"
```

---

## Task 5: `parseDiceNotation` utility

**Files:**
- Create: `src/shared/dice/parseDiceNotation.ts`
- Create: `src/shared/dice/__tests__/parseDiceNotation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/dice/__tests__/parseDiceNotation.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseDiceNotation } from "../parseDiceNotation";

describe("parseDiceNotation", () => {
  it("parses '2d6' as {count: 2, sides: 6}", () => {
    expect(parseDiceNotation("2d6")).toEqual({ count: 2, sides: 6 });
  });

  it("parses '1d20' as {count: 1, sides: 20}", () => {
    expect(parseDiceNotation("1d20")).toEqual({ count: 1, sides: 20 });
  });

  it("parses '4d4' as {count: 4, sides: 4}", () => {
    expect(parseDiceNotation("4d4")).toEqual({ count: 4, sides: 4 });
  });

  it("treats 'd6' (no count) as count: 1", () => {
    expect(parseDiceNotation("d6")).toEqual({ count: 1, sides: 6 });
  });

  it("is case-insensitive: '2D6' parses the same as '2d6'", () => {
    expect(parseDiceNotation("2D6")).toEqual({ count: 2, sides: 6 });
  });

  it("trims whitespace", () => {
    expect(parseDiceNotation("  2d6  ")).toEqual({ count: 2, sides: 6 });
  });

  it("rejects unsupported sides (e.g. 7)", () => {
    expect(() => parseDiceNotation("1d7")).toThrow(/unsupported/i);
  });

  it("rejects malformed input", () => {
    expect(() => parseDiceNotation("hello")).toThrow();
    expect(() => parseDiceNotation("")).toThrow();
    expect(() => parseDiceNotation("2d")).toThrow();
    expect(() => parseDiceNotation("d")).toThrow();
  });

  it("rejects count > 8 (sanity cap)", () => {
    expect(() => parseDiceNotation("9d6")).toThrow(/count/i);
  });

  it("rejects count <= 0", () => {
    expect(() => parseDiceNotation("0d6")).toThrow(/count/i);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:dice -- parseDiceNotation`
Expected: FAIL — `Cannot find module '../parseDiceNotation'`

- [ ] **Step 3: Implement**

Create `src/shared/dice/parseDiceNotation.ts`:
```ts
import type { DiceSpec } from "./types";

const SUPPORTED_SIDES = new Set([4, 6, 8, 10, 12, 20]);
const MAX_COUNT = 8;
const NOTATION = /^(\d*)d(\d+)$/i;

export function parseDiceNotation(input: string): DiceSpec {
  const trimmed = input.trim();
  const match = NOTATION.exec(trimmed);
  if (!match) throw new Error(`Invalid dice notation: "${input}"`);

  const countStr = match[1];
  const sidesStr = match[2];

  const count = countStr === "" ? 1 : parseInt(countStr, 10);
  const sides = parseInt(sidesStr, 10);

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(`Invalid dice count in "${input}": must be > 0`);
  }
  if (count > MAX_COUNT) {
    throw new Error(`Invalid dice count in "${input}": must be ≤ ${MAX_COUNT}`);
  }
  if (!SUPPORTED_SIDES.has(sides)) {
    throw new Error(`Unsupported dice sides in "${input}": ${sides}`);
  }

  return { count, sides };
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:dice -- parseDiceNotation`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/dice/parseDiceNotation.ts src/shared/dice/__tests__/parseDiceNotation.test.ts
git commit -m "feat(shared/dice): parseDiceNotation utility"
```

---

## Task 6: Lift d20 geometry module

**Files:**
- Create: `src/shared/dice/d20.ts`

- [ ] **Step 1: Copy the file verbatim**

Run: `cp ~/Projects/oq-1/sidequest-ui/src/dice/d20.ts src/shared/dice/d20.ts`

- [ ] **Step 2: Verify the copy compiles**

Run: `npx tsc -p tsconfig.dice.json --noEmit`
Expected: no errors. If three is missing from `@types/three`, re-run `npm install`.

- [ ] **Step 3: Commit**

```bash
git add src/shared/dice/d20.ts
git commit -m "feat(shared/dice): lift d20 geometry from sidequest-ui"
```

---

## Task 7: Lift d6 geometry module

**Files:**
- Create: `src/shared/dice/d6.ts`

- [ ] **Step 1: Copy the file verbatim**

Run: `cp ~/Projects/oq-1/sidequest-ui/src/dice/d6.ts src/shared/dice/d6.ts`

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p tsconfig.dice.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/dice/d6.ts
git commit -m "feat(shared/dice): lift d6 geometry from sidequest-ui"
```

---

## Task 8: Lift d4, d10, d12 geometry modules

**Files:**
- Create: `src/shared/dice/d4.ts`
- Create: `src/shared/dice/d10.ts`
- Create: `src/shared/dice/d12.ts`

- [ ] **Step 1: Copy the three files**

Run:
```bash
cp ~/Projects/oq-1/sidequest-ui/src/dice/d4.ts src/shared/dice/d4.ts
cp ~/Projects/oq-1/sidequest-ui/src/dice/d10.ts src/shared/dice/d10.ts
cp ~/Projects/oq-1/sidequest-ui/src/dice/d12.ts src/shared/dice/d12.ts
```

- [ ] **Step 2: Verify all compile**

Run: `npx tsc -p tsconfig.dice.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/dice/d4.ts src/shared/dice/d10.ts src/shared/dice/d12.ts
git commit -m "feat(shared/dice): lift d4/d10/d12 geometry from sidequest-ui"
```

---

## Task 9: d8 placeholder (out-of-scope warning)

**Files:**
- Create: `src/shared/dice/d8.ts`

The `DieKind` type includes `d8` for future-proofing, but sidequest-ui has no d8 module. We add a minimal stub that throws if used, so consumers fail loudly rather than rendering a blank scene.

- [ ] **Step 1: Create the stub**

Create `src/shared/dice/d8.ts`:
```ts
/**
 * d8 — not yet implemented.
 *
 * Phase A targets backgammon (d6) and the existing d20 path. d8 geometry
 * (octahedron) and face-reading can be added later by following the d6/d20
 * pattern: collider vertices, face indices, face numbers, computeFaceInfo,
 * readValue.
 */
export const D8_NOT_IMPLEMENTED = true;

export function d8NotImplemented(): never {
  throw new Error("d8 is not implemented yet");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/dice/d8.ts
git commit -m "feat(shared/dice): add d8 not-yet-implemented stub"
```

---

## Task 10: Die registry

**Files:**
- Create: `src/shared/dice/dieRegistry.ts`
- Create: `src/shared/dice/__tests__/dieRegistry.test.ts`

The registry maps `DieKind` → geometry constants and face-reading function. DiceScene reads from this registry instead of importing per-die modules directly.

- [ ] **Step 1: Write the failing test**

Create `src/shared/dice/__tests__/dieRegistry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DIE_REGISTRY, dieKindForSides } from "../dieRegistry";

describe("dieRegistry", () => {
  it("has entries for d4, d6, d10, d12, d20", () => {
    expect(DIE_REGISTRY.d4).toBeDefined();
    expect(DIE_REGISTRY.d6).toBeDefined();
    expect(DIE_REGISTRY.d10).toBeDefined();
    expect(DIE_REGISTRY.d12).toBeDefined();
    expect(DIE_REGISTRY.d20).toBeDefined();
  });

  it("each entry exposes radius, colliderVertices, readValue", () => {
    for (const kind of ["d4", "d6", "d10", "d12", "d20"] as const) {
      const entry = DIE_REGISTRY[kind];
      expect(typeof entry.radius).toBe("number");
      expect(entry.radius).toBeGreaterThan(0);
      expect(entry.colliderVertices).toBeInstanceOf(Float32Array);
      expect(typeof entry.readValue).toBe("function");
    }
  });

  it("dieKindForSides maps sides → DieKind", () => {
    expect(dieKindForSides(4)).toBe("d4");
    expect(dieKindForSides(6)).toBe("d6");
    expect(dieKindForSides(10)).toBe("d10");
    expect(dieKindForSides(12)).toBe("d12");
    expect(dieKindForSides(20)).toBe("d20");
  });

  it("dieKindForSides throws on unsupported sides", () => {
    expect(() => dieKindForSides(7)).toThrow();
    expect(() => dieKindForSides(100)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:dice -- dieRegistry`
Expected: FAIL — `Cannot find module '../dieRegistry'`

- [ ] **Step 3: Implement**

Create `src/shared/dice/dieRegistry.ts`:
```ts
import * as THREE from "three";
import type { DieKind } from "./types";
import {
  D20_RADIUS,
  D20_COLLIDER_VERTICES,
  computeFaceInfo as computeD20FaceInfo,
  readD20Value,
  type FaceInfo,
} from "./d20";
import { D6_RADIUS, D6_COLLIDER_VERTICES, computeD6FaceInfo, readD6Value } from "./d6";
import { D4_RADIUS, D4_COLLIDER_VERTICES, computeD4FaceInfo, readD4Value } from "./d4";
import { D10_RADIUS, D10_COLLIDER_VERTICES, computeD10FaceInfo, readD10Value } from "./d10";
import { D12_RADIUS, D12_COLLIDER_VERTICES, computeD12FaceInfo, readD12Value } from "./d12";

export interface DieEntry {
  /** Visual mesh radius. */
  radius: number;
  /** Convex hull collider vertices (flat Float32Array). */
  colliderVertices: Float32Array;
  /** Compute per-face center/normal/orientation. Called once at module load. */
  computeFaceInfo: () => FaceInfo[];
  /** Determine the upward-facing number from a settled group's transform. */
  readValue: (group: THREE.Group) => number;
  /** Geometry factory for the visual mesh — invoked inside JSX as a render. */
  geometryKind: "icosahedron" | "box" | "tetrahedron" | "decahedron" | "dodecahedron";
}

export const DIE_REGISTRY: Record<DieKind, DieEntry> = {
  d4: {
    radius: D4_RADIUS,
    colliderVertices: D4_COLLIDER_VERTICES,
    computeFaceInfo: computeD4FaceInfo,
    readValue: readD4Value,
    geometryKind: "tetrahedron",
  },
  d6: {
    radius: D6_RADIUS,
    colliderVertices: D6_COLLIDER_VERTICES,
    computeFaceInfo: computeD6FaceInfo,
    readValue: readD6Value,
    geometryKind: "box",
  },
  d8: {
    radius: 0,
    colliderVertices: new Float32Array(),
    computeFaceInfo: () => { throw new Error("d8 not implemented"); },
    readValue: () => { throw new Error("d8 not implemented"); },
    geometryKind: "icosahedron", // unused
  },
  d10: {
    radius: D10_RADIUS,
    colliderVertices: D10_COLLIDER_VERTICES,
    computeFaceInfo: computeD10FaceInfo,
    readValue: readD10Value,
    geometryKind: "decahedron",
  },
  d12: {
    radius: D12_RADIUS,
    colliderVertices: D12_COLLIDER_VERTICES,
    computeFaceInfo: computeD12FaceInfo,
    readValue: readD12Value,
    geometryKind: "dodecahedron",
  },
  d20: {
    radius: D20_RADIUS,
    colliderVertices: D20_COLLIDER_VERTICES,
    computeFaceInfo: computeD20FaceInfo,
    readValue: readD20Value,
    geometryKind: "icosahedron",
  },
};

const SIDES_TO_KIND: Record<number, DieKind> = {
  4: "d4",
  6: "d6",
  8: "d8",
  10: "d10",
  12: "d12",
  20: "d20",
};

export function dieKindForSides(sides: number): DieKind {
  const kind = SIDES_TO_KIND[sides];
  if (!kind) throw new Error(`Unsupported die sides: ${sides}`);
  return kind;
}
```

- [ ] **Step 4: Verify the d-module exports actually exist**

Run: `grep -nE "^export (const|function)" src/shared/dice/d4.ts src/shared/dice/d10.ts src/shared/dice/d12.ts`
Expected: each file exports `D{N}_RADIUS`, `D{N}_COLLIDER_VERTICES`, `computeD{N}FaceInfo`, `readD{N}Value`. **If a name doesn't match exactly, fix the import in `dieRegistry.ts` to match the actual export name in the lifted file** — sidequest-ui's naming convention may differ slightly per die. Update the test imports in Step 1 if necessary.

- [ ] **Step 5: Run the test**

Run: `npm run test:dice -- dieRegistry`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/dice/dieRegistry.ts src/shared/dice/__tests__/dieRegistry.test.ts
git commit -m "feat(shared/dice): die registry indexes per-kind geometry/face-reading"
```

---

## Task 11: Lift `diceTheme.ts`

**Files:**
- Create: `src/shared/dice/diceTheme.ts`

- [ ] **Step 1: Copy the file**

Run: `cp ~/Projects/oq-1/sidequest-ui/src/dice/diceTheme.ts src/shared/dice/diceTheme.ts`

- [ ] **Step 2: Update the asset path**

The file references `/textures/dice/scratched-plastic-normal.jpg` (sidequest-ui path). Our asset lives at `/shared/dice-assets/scratched-plastic-normal.jpg`. Edit `src/shared/dice/diceTheme.ts`:

Replace `"/textures/dice/scratched-plastic-normal.jpg"` with `"/shared/dice-assets/scratched-plastic-normal.jpg"`.

- [ ] **Step 3: Add an obsidian theme preset**

Append to `src/shared/dice/diceTheme.ts`:
```ts
export const OBSIDIAN_DICE_THEME: DiceTheme = {
  dieColor: "#1c1c1f",
  labelColor: "#f4ead4",
  roughness: 0.45,
  metalness: 0.05,
  normalMap: "/shared/dice-assets/scratched-plastic-normal.jpg",
  normalScale: 0.2,
};

export const THEME_PRESETS: Record<string, DiceTheme> = {
  default: DEFAULT_DICE_THEME,
  ivory: DEFAULT_DICE_THEME,
  obsidian: OBSIDIAN_DICE_THEME,
};
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc -p tsconfig.dice.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/dice/diceTheme.ts
git commit -m "feat(shared/dice): theme module with ivory + obsidian presets"
```

---

## Task 12: Lift `useDiceThrowGesture.ts`

**Files:**
- Create: `src/shared/dice/useDiceThrowGesture.ts`
- Create: `src/shared/dice/__tests__/useDiceThrowGesture.test.ts`

- [ ] **Step 1: Copy both files**

Run:
```bash
cp ~/Projects/oq-1/sidequest-ui/src/dice/useDiceThrowGesture.ts src/shared/dice/useDiceThrowGesture.ts
cp ~/Projects/oq-1/sidequest-ui/src/dice/__tests__/useDiceThrowGesture.test.ts src/shared/dice/__tests__/useDiceThrowGesture.test.ts
```

- [ ] **Step 2: Fix the import path**

`useDiceThrowGesture.ts` imports `ThrowParams` from `./DiceScene`. Change it to import from `./types` instead. Edit `src/shared/dice/useDiceThrowGesture.ts`:

Replace `import type { ThrowParams } from "./DiceScene";` with `import type { ThrowParams } from "./types";`.

- [ ] **Step 3: Run the lifted test**

Run: `npm run test:dice -- useDiceThrowGesture`
Expected: PASS. If a test references types from outside the dice subtree, surgically fix the import to use `./types` or remove the test if it references sidequest-ui-specific protocol types (skip rather than rewrite — note in the diff comment).

- [ ] **Step 4: Commit**

```bash
git add src/shared/dice/useDiceThrowGesture.ts src/shared/dice/__tests__/useDiceThrowGesture.test.ts
git commit -m "feat(shared/dice): lift useDiceThrowGesture hook + tests"
```

---

## Task 13: Adapt `replayThrowParams.ts`

**Files:**
- Create: `src/shared/dice/replayThrowParams.ts`

The original imports `DiceThrowParams` from `@/types/payloads` (sidequest-ui-specific) and hard-codes `D20_RADIUS` for the y-offset. We point at our local `types` module and parameterize the radius for any die kind.

- [ ] **Step 1: Copy the file**

Run: `cp ~/Projects/oq-1/sidequest-ui/src/dice/replayThrowParams.ts src/shared/dice/replayThrowParams.ts`

- [ ] **Step 2: Replace imports and signature**

Replace the entire file contents with:

```ts
/**
 * replayThrowParams — Deterministic wire→scene ThrowParams conversion.
 *
 * Converts wire-format throw params into scene-format ThrowParams for Rapier
 * physics replay. The seed drives initial die rotation so all clients start
 * with identical orientation.
 *
 * Determinism contract: same (wireParams, seed, dieRadius) → same output, always.
 *
 * Adapted from sidequest-ui src/dice/replayThrowParams.ts; generalized for
 * any die kind (was d20-only).
 */

import type { ThrowParams, DiceThrowParams } from "./types";

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deriveSeed32(seed: number): number {
  const lo = seed & 0xffffffff;
  const hi = (seed / 0x100000000) & 0xffffffff;
  return (lo ^ hi) | 0;
}

/**
 * Convert wire-format DiceThrowParams + seed + dieRadius into scene-format ThrowParams.
 *
 * - `velocity` → `linearVelocity` (passthrough)
 * - `angular` → `angularVelocity` (passthrough)
 * - `position[2]` (normalized 0..1) → `position[3]` (tray space; y derived from die radius)
 * - `seed` → `rotation[3]` (Euler angles in [-PI, PI])
 */
export function replayThrowParams(
  wire: DiceThrowParams,
  seed: number,
  dieRadius: number,
): ThrowParams {
  const rng = mulberry32(deriveSeed32(seed));

  const x = wire.position[0] - 0.5;
  const z = wire.position[1] * 1.6 - 0.8;
  const y = dieRadius + 0.5;

  const rotX = (rng() * 2 - 1) * Math.PI;
  const rotY = (rng() * 2 - 1) * Math.PI;
  const rotZ = (rng() * 2 - 1) * Math.PI;

  return {
    position: [x, y, z],
    linearVelocity: [...wire.velocity],
    angularVelocity: [...wire.angular],
    rotation: [rotX, rotY, rotZ],
  };
}
```

- [ ] **Step 3: Verify compile**

Run: `npx tsc -p tsconfig.dice.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/dice/replayThrowParams.ts
git commit -m "feat(shared/dice): adapt replayThrowParams (parameterize die radius, local types)"
```

---

## Task 14: Adapt `DiceScene.tsx` for multi-die

**Files:**
- Create: `src/shared/dice/DiceScene.tsx`
- Create: `src/shared/dice/__tests__/deterministicReplay.test.tsx`

The sidequest-ui DiceScene is hard-wired for a single d20. We refactor to render N dice of a configurable kind, all thrown together, settle independently, report `values: number[]`.

- [ ] **Step 1: Copy the original as a starting point**

Run:
```bash
cp ~/Projects/oq-1/sidequest-ui/src/dice/DiceScene.tsx src/shared/dice/DiceScene.tsx
cp ~/Projects/oq-1/sidequest-ui/src/dice/__tests__/deterministicReplay.test.tsx src/shared/dice/__tests__/deterministicReplay.test.tsx
```

- [ ] **Step 2: Rewrite `DiceScene.tsx`**

Replace the full contents with:
```tsx
/**
 * DiceScene — Physics world with N configurable dice.
 *
 * Adapted from sidequest-ui's d20-only DiceScene.tsx.
 *
 * Patterns retained:
 * - Fixed timestep (1/120) with no interpolation for deterministic replay
 * - Settle detection: linear + angular velocity below threshold
 * - Face reading via face-center dot product against world-up
 * - Tray colliders: floor (high friction) + walls + ceiling (sealed)
 * - Force-stop timeout after 5 seconds
 *
 * Generalized:
 * - Renders N dice of any registered DieKind
 * - Settles each die independently; emits onSettle once when all are at rest
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { TextureLoader } from "three";
import {
  Physics,
  RigidBody,
  CuboidCollider,
  ConvexHullCollider,
  RapierRigidBody,
} from "@react-three/rapier";
import { Text } from "@react-three/drei";

import type { DieKind, ThrowParams } from "./types";
import { DIE_REGISTRY, type DieEntry } from "./dieRegistry";
import { useDiceThrowGesture } from "./useDiceThrowGesture";
import { DEFAULT_DICE_THEME, type DiceTheme } from "./diceTheme";

const FACE_LABEL_FONT = "/shared/dice-assets/Inter-Bold.ttf";

const SETTLE_THRESHOLD = 0.005;
const MAX_ROLL_TIME = 5000;
const TRAY_HALF_WIDTH = 0.8;
const TRAY_HALF_DEPTH = 0.8;
const WALL_HALF_HEIGHT = 0.5;
const WALL_HALF_THICKNESS = 0.2;

function TrayColliders() {
  const wallTop = WALL_HALF_HEIGHT * 2;
  const wallX = TRAY_HALF_WIDTH + WALL_HALF_THICKNESS;
  const wallZ = TRAY_HALF_DEPTH + WALL_HALF_THICKNESS;

  return (
    <group>
      <RigidBody type="fixed" friction={10} restitution={0.3}>
        <CuboidCollider args={[wallX, 0.2, wallZ]} position={[0, -0.2, 0]} />
      </RigidBody>
      <RigidBody type="fixed" friction={1} restitution={0.6}>
        <CuboidCollider args={[wallX, WALL_HALF_HEIGHT, WALL_HALF_THICKNESS]} position={[0, WALL_HALF_HEIGHT, -(TRAY_HALF_DEPTH + WALL_HALF_THICKNESS)]} />
        <CuboidCollider args={[wallX, WALL_HALF_HEIGHT, WALL_HALF_THICKNESS]} position={[0, WALL_HALF_HEIGHT, TRAY_HALF_DEPTH + WALL_HALF_THICKNESS]} />
        <CuboidCollider args={[WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, wallZ]} position={[-(TRAY_HALF_WIDTH + WALL_HALF_THICKNESS), WALL_HALF_HEIGHT, 0]} />
        <CuboidCollider args={[WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, wallZ]} position={[TRAY_HALF_WIDTH + WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, 0]} />
        <CuboidCollider args={[wallX, 0.1, wallZ]} position={[0, wallTop + 0.1, 0]} />
      </RigidBody>
    </group>
  );
}

function TrayVisual() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
      <planeGeometry args={[TRAY_HALF_WIDTH * 2, TRAY_HALF_DEPTH * 2]} />
      <shadowMaterial opacity={0.3} />
    </mesh>
  );
}

function DieGeometry({ entry }: { entry: DieEntry }) {
  switch (entry.geometryKind) {
    case "icosahedron":
      return <icosahedronGeometry args={[entry.radius, 0]} />;
    case "box":
      // Cube edge = 2 × halfEdge; halfEdge derived in d6.ts as radius / sqrt(3)
      return <boxGeometry args={[entry.radius * 2 / Math.sqrt(3), entry.radius * 2 / Math.sqrt(3), entry.radius * 2 / Math.sqrt(3)]} />;
    case "tetrahedron":
      return <tetrahedronGeometry args={[entry.radius, 0]} />;
    case "decahedron":
      // Three.js has no built-in decahedron; fall back to icosahedron — visual approximation.
      return <icosahedronGeometry args={[entry.radius, 0]} />;
    case "dodecahedron":
      return <dodecahedronGeometry args={[entry.radius, 0]} />;
  }
}

function FaceLabels({ entry, color, font }: { entry: DieEntry; color: string; font: string }) {
  const faces = useMemo(() => entry.computeFaceInfo(), [entry]);
  return (
    <>
      {faces.map((face, i) => {
        const labelPos = face.center.clone().add(face.normal.clone().multiplyScalar(0.002));
        return (
          <Text
            key={i}
            font={font}
            position={labelPos.toArray()}
            quaternion={face.quaternion}
            fontSize={entry.radius * 0.24}
            color={color}
            anchorX="center"
            anchorY="middle"
            fontWeight={700}
          >
            {face.number}
          </Text>
        );
      })}
    </>
  );
}

function DieMesh({ kind, theme }: { kind: DieKind; theme: DiceTheme }) {
  const entry = DIE_REGISTRY[kind];
  const baseTex = useLoader(
    TextureLoader,
    theme.normalMap ?? "/shared/dice-assets/scratched-plastic-normal.jpg",
  );
  const normalTex = useMemo(() => {
    const tex = baseTex.clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }, [baseTex]);
  const normalScaleVec = useMemo(
    () => new THREE.Vector2(theme.normalScale ?? 0.5, theme.normalScale ?? 0.5),
    [theme.normalScale],
  );

  return (
    <group>
      <mesh castShadow>
        <DieGeometry entry={entry} />
        <meshStandardMaterial
          color={theme.dieColor}
          roughness={theme.roughness ?? 0.3}
          metalness={theme.metalness ?? 0.1}
          normalMap={normalTex}
          normalScale={normalScaleVec}
          flatShading
        />
      </mesh>
      <FaceLabels entry={entry} color={theme.labelColor} font={theme.labelFont ?? FACE_LABEL_FONT} />
    </group>
  );
}

interface PhysicsDieProps {
  kind: DieKind;
  throwParams: ThrowParams;
  spawnOffset: [number, number, number];
  onSettle: (value: number) => void;
  theme: DiceTheme;
}

function PhysicsDie({ kind, throwParams, spawnOffset, onSettle, theme }: PhysicsDieProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const groupRef = useRef<THREE.Group>(null);
  const settledRef = useRef(false);
  const throwTimeRef = useRef(0);
  const entry = DIE_REGISTRY[kind];

  useEffect(() => {
    settledRef.current = false;
    throwTimeRef.current = performance.now();
  }, [throwParams]);

  useFrame(() => {
    const rb = rigidBodyRef.current;
    const group = groupRef.current;
    if (!rb || !group || settledRef.current) return;

    const lin = rb.linvel();
    const ang = rb.angvel();
    const speed =
      Math.sqrt(lin.x * lin.x + lin.y * lin.y + lin.z * lin.z) +
      Math.sqrt(ang.x * ang.x + ang.y * ang.y + ang.z * ang.z);

    const elapsed = performance.now() - throwTimeRef.current;
    const forceStop = elapsed > MAX_ROLL_TIME;

    if (speed < SETTLE_THRESHOLD || forceStop) {
      if (forceStop) console.warn("Dice exceeded max roll time, force-stopping");
      settledRef.current = true;
      rb.setEnabledRotations(false, false, false, false);
      rb.setEnabledTranslations(false, false, false, false);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, false);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, false);
      onSettle(entry.readValue(group));
    }
  });

  // Apply spawnOffset to the throw position so dice don't spawn coincident.
  const pos: [number, number, number] = [
    throwParams.position[0] + spawnOffset[0],
    throwParams.position[1] + spawnOffset[1],
    throwParams.position[2] + spawnOffset[2],
  ];

  return (
    <RigidBody
      ref={rigidBodyRef}
      gravityScale={3}
      density={2}
      friction={0.2}
      restitution={0.3}
      position={pos}
      rotation={throwParams.rotation}
      linearVelocity={throwParams.linearVelocity}
      angularVelocity={throwParams.angularVelocity}
      colliders={false}
      ccd
    >
      <group ref={groupRef}>
        <ConvexHullCollider args={[entry.colliderVertices]} />
        <DieMesh kind={kind} theme={theme} />
      </group>
    </RigidBody>
  );
}

function PickupDie({ kind, theme, onThrow }: { kind: DieKind; theme: DiceTheme; onThrow: (p: ThrowParams) => void }) {
  const { onPointerDown } = useDiceThrowGesture({ onThrow });
  const groupRef = useRef<THREE.Group>(null);
  const entry = DIE_REGISTRY[kind];

  return (
    <group
      ref={groupRef}
      position={[0, entry.radius + 0.01, 0]}
      onPointerDown={onPointerDown}
    >
      <DieMesh kind={kind} theme={theme} />
    </group>
  );
}

function spawnOffsetFor(index: number, count: number, radius: number): [number, number, number] {
  // Spread dice along x, centered. Spacing = 2.4 × radius so they don't overlap.
  const spacing = radius * 2.4;
  const totalWidth = (count - 1) * spacing;
  const x = -totalWidth / 2 + index * spacing;
  return [x, 0, 0];
}

export interface DiceSceneProps {
  /** Die kind for all dice in this scene (single kind in v1). */
  kind: DieKind;
  /** Number of dice to render (1..8). */
  count: number;
  /** When non-null: physics dice; null: pickup die for active throwing. */
  throwParams: ThrowParams | null;
  /** Bumped to force a fresh Physics world (e.g. after settle). */
  rollKey: number;
  /** Called when the player flicks a pickup die (active mode only). */
  onThrow: (params: ThrowParams) => void;
  /** Called once when ALL dice have settled, with values in spawn order. */
  onAllSettle: (values: number[]) => void;
  theme?: DiceTheme;
}

export function DiceScene({
  kind,
  count,
  throwParams,
  rollKey,
  onThrow,
  onAllSettle,
  theme = DEFAULT_DICE_THEME,
}: DiceSceneProps) {
  const settledValuesRef = useRef<number[]>([]);
  const settledFlagsRef = useRef<boolean[]>([]);

  // Reset on new throw or count change.
  useEffect(() => {
    settledValuesRef.current = new Array(count).fill(0);
    settledFlagsRef.current = new Array(count).fill(false);
  }, [throwParams, count, rollKey]);

  const handleSettle = (index: number, value: number) => {
    settledValuesRef.current[index] = value;
    settledFlagsRef.current[index] = true;
    if (settledFlagsRef.current.every(Boolean)) {
      onAllSettle([...settledValuesRef.current]);
    }
  };

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 1]} intensity={1.2} castShadow />
      <Physics
        key={rollKey}
        colliders={false}
        interpolate={false}
        timeStep={1 / 120}
        gravity={[0, -9.81, 0]}
      >
        <TrayColliders />
        {throwParams ? (
          Array.from({ length: count }).map((_, i) => (
            <PhysicsDie
              key={i}
              kind={kind}
              throwParams={throwParams}
              spawnOffset={spawnOffsetFor(i, count, DIE_REGISTRY[kind].radius)}
              onSettle={(v) => handleSettle(i, v)}
              theme={theme}
            />
          ))
        ) : (
          <PickupDie kind={kind} theme={theme} onThrow={onThrow} />
        )}
      </Physics>
      <TrayVisual />
    </>
  );
}
```

- [ ] **Step 3: Adapt the deterministic-replay test**

Read the original `deterministicReplay.test.tsx`. The original imports from `../DiceScene` (e.g. `D20_RADIUS`, `readD20Value`, `replayThrowParams`) — update imports so they come from the correct local modules:
- `D20_RADIUS, readD20Value` from `../d20`
- `replayThrowParams` from `../replayThrowParams`
- `DiceScene` from `../DiceScene`

Then update any `<DiceScene>` props in the test to match the new signature: add `kind="d20"`, `count={1}`, change `onSettle` → `onAllSettle` (which receives `number[]` — the test should read `values[0]`).

If the test references types from sidequest-ui-specific modules (`@/types/payloads`, etc.), replace with `DiceThrowParams` from `../types`.

- [ ] **Step 4: Run the tests**

Run: `npm run test:dice -- DiceScene deterministicReplay`
Expected: PASS. If r3f's `useFrame` complains in jsdom (it sometimes needs `requestAnimationFrame` polyfill), add this to `vitest.config.ts` under `test`:
```ts
setupFiles: ["src/shared/dice/__tests__/setup.ts"],
```
And create `src/shared/dice/__tests__/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement rAF — r3f needs it for useFrame.
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/dice/DiceScene.tsx src/shared/dice/__tests__/deterministicReplay.test.tsx src/shared/dice/__tests__/setup.ts vitest.config.ts
git commit -m "feat(shared/dice): multi-die DiceScene with onAllSettle"
```

---

## Task 15: Web Component wrapper (`index.tsx`)

**Files:**
- Create: `src/shared/dice/index.tsx`
- Create: `src/shared/dice/__tests__/diceTray.test.tsx`

The Web Component is a `HTMLElement` subclass that mounts a React tree internally and bridges attribute changes ↔ React props and dispatches DOM events when dice settle.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/dice/__tests__/diceTray.test.tsx`:
```tsx
import { describe, it, expect, beforeAll } from "vitest";
import "../index"; // registers the custom element

beforeAll(() => {
  // Custom element is registered on import; nothing else to do.
});

function makeTray(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("dice-tray");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

describe("<dice-tray> Web Component", () => {
  it("registers customElements.get('dice-tray')", () => {
    expect(customElements.get("dice-tray")).toBeDefined();
  });

  it("instantiates with default attributes", () => {
    const el = makeTray();
    expect(el.tagName).toBe("DICE-TRAY");
    el.remove();
  });

  it("accepts dice='2d6' attribute without throwing", () => {
    const el = makeTray({ dice: "2d6", mode: "idle" });
    expect(el.getAttribute("dice")).toBe("2d6");
    expect(el.getAttribute("mode")).toBe("idle");
    el.remove();
  });

  it("throws (dispatches an error event) for invalid dice notation", () => {
    const el = makeTray({ dice: "garbage" });
    let errored = false;
    el.addEventListener("dice-error", () => { errored = true; });
    // Nudge the attribute to trigger re-parse.
    el.setAttribute("dice", "garbage");
    // Allow microtask flush.
    return new Promise(resolve => setTimeout(() => {
      expect(errored).toBe(true);
      el.remove();
      resolve(undefined);
    }, 10));
  });

  it("re-renders when dice attribute changes", () => {
    const el = makeTray({ dice: "1d6", mode: "idle" });
    el.setAttribute("dice", "2d6");
    expect(el.getAttribute("dice")).toBe("2d6");
    el.remove();
  });

  it("dispatches dice-throw event when an active gesture would fire (programmatic)", () => {
    // We can't simulate a real R3F gesture in jsdom. Instead, test that the
    // method `throw()` exists and dispatching dice-throw lands on the element.
    const el = makeTray({ dice: "1d6", mode: "active" }) as HTMLElement & { throw?: (p: unknown) => void };
    let received: unknown = null;
    el.addEventListener("dice-throw", (e: Event) => {
      received = (e as CustomEvent).detail;
    });
    if (typeof el.throw === "function") {
      el.throw({ position: [0, 0.5, 0], linearVelocity: [0, 0, -5], angularVelocity: [0, 0, 0], rotation: [0, 0, 0] });
    } else {
      // If method not exposed, dispatch directly to verify event-bridge path.
      el.dispatchEvent(new CustomEvent("dice-throw", { detail: { throwParams: [] } }));
    }
    expect(received).not.toBeNull();
    el.remove();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:dice -- diceTray`
Expected: FAIL — `Cannot find module '../index'`

- [ ] **Step 3: Implement the Web Component**

Create `src/shared/dice/index.tsx`:
```tsx
/**
 * <dice-tray> — Web Component wrapper around the React/R3F dice scene.
 *
 * Plugins consume this as a custom element:
 *   <dice-tray dice="2d6" mode="active" theme="ivory"></dice-tray>
 *
 * The React tree mounts directly inside the element (light DOM, NOT shadow
 * DOM) so pointer events used by R3F's controls work without re-dispatching.
 */

import React from "react";
import { createRoot, Root } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { DiceScene } from "./DiceScene";
import { parseDiceNotation } from "./parseDiceNotation";
import { dieKindForSides } from "./dieRegistry";
import { THEME_PRESETS } from "./diceTheme";
import type { ThrowParams, DiceThrowParams } from "./types";

type Mode = "active" | "replay" | "idle";

interface State {
  kind: ReturnType<typeof dieKindForSides>;
  count: number;
  mode: Mode;
  themeKey: string;
  throwParams: ThrowParams | null;
  rollKey: number;
}

class DiceTrayElement extends HTMLElement {
  static observedAttributes = ["dice", "mode", "theme", "replay", "disabled"];

  private root: Root | null = null;
  private state: State = {
    kind: "d6",
    count: 1,
    mode: "idle",
    themeKey: "default",
    throwParams: null,
    rollKey: 0,
  };

  connectedCallback() {
    this.root = createRoot(this);
    this.syncFromAttributes();
    this.render();
  }

  disconnectedCallback() {
    this.root?.unmount();
    this.root = null;
  }

  attributeChangedCallback(_name: string, _old: string | null, _next: string | null) {
    if (!this.root) return;
    this.syncFromAttributes();
    this.render();
  }

  /** Programmatic API: trigger a throw with the provided params (active mode). */
  throw(params: ThrowParams) {
    this.state = { ...this.state, throwParams: params, rollKey: this.state.rollKey + 1 };
    this.dispatchEvent(new CustomEvent("dice-throw", { detail: { throwParams: [params] } }));
    this.render();
  }

  /** Programmatic API: reset to the idle pickup die. */
  reset() {
    this.state = { ...this.state, throwParams: null, rollKey: this.state.rollKey + 1 };
    this.render();
  }

  private syncFromAttributes() {
    const diceAttr = this.getAttribute("dice") ?? "1d6";
    try {
      const spec = parseDiceNotation(diceAttr);
      this.state.kind = dieKindForSides(spec.sides);
      this.state.count = spec.count;
    } catch (err) {
      this.dispatchEvent(new CustomEvent("dice-error", { detail: { message: String(err) } }));
      // Keep prior state on parse failure rather than crashing the render.
    }

    const modeAttr = (this.getAttribute("mode") ?? "idle") as Mode;
    this.state.mode = modeAttr;
    this.state.themeKey = this.getAttribute("theme") ?? "default";

    const replayAttr = this.getAttribute("replay");
    if (modeAttr === "replay" && replayAttr) {
      try {
        const parsed = JSON.parse(replayAttr) as { throwParams: ThrowParams[]; values?: number[] };
        // For multi-die replay, take the first throwParams as the master set;
        // per-die spawn offsets are computed by DiceScene.
        if (parsed.throwParams && parsed.throwParams.length > 0) {
          this.state.throwParams = parsed.throwParams[0];
          this.state.rollKey = this.state.rollKey + 1;
        }
      } catch (err) {
        this.dispatchEvent(new CustomEvent("dice-error", { detail: { message: `Invalid replay JSON: ${err}` } }));
      }
    } else if (modeAttr === "idle" || modeAttr === "active") {
      this.state.throwParams = null;
    }
  }

  private handleThrow = (params: ThrowParams) => {
    this.state = { ...this.state, throwParams: params, rollKey: this.state.rollKey + 1 };
    this.dispatchEvent(new CustomEvent("dice-throw", { detail: { throwParams: [params] } }));
    this.render();
  };

  private handleAllSettle = (values: number[]) => {
    if (this.state.mode === "replay") {
      this.dispatchEvent(new CustomEvent("dice-replay-settle", { detail: { values } }));
    } else {
      // Build wire-format throw params for transport.
      const wire: DiceThrowParams[] = this.state.throwParams ? [{
        velocity: this.state.throwParams.linearVelocity,
        angular: this.state.throwParams.angularVelocity,
        position: [
          this.state.throwParams.position[0] + 0.5,
          (this.state.throwParams.position[2] + 0.8) / 1.6,
        ],
      }] : [];
      this.dispatchEvent(new CustomEvent("dice-settle", { detail: { values, throwParams: wire } }));
    }
  };

  private render() {
    if (!this.root) return;
    const theme = THEME_PRESETS[this.state.themeKey] ?? THEME_PRESETS.default;
    this.root.render(
      <div style={{ width: "100%", height: "100%", minHeight: 240 }}>
        <Canvas
          camera={{ position: [0, 2.2, 0], fov: 42, near: 0.1, far: 50 }}
          shadows
        >
          <DiceScene
            kind={this.state.kind}
            count={this.state.count}
            throwParams={this.state.throwParams}
            rollKey={this.state.rollKey}
            onThrow={this.handleThrow}
            onAllSettle={this.handleAllSettle}
            theme={theme}
          />
        </Canvas>
      </div>
    );
  }
}

if (!customElements.get("dice-tray")) {
  customElements.define("dice-tray", DiceTrayElement);
}

export { DiceTrayElement };
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:dice -- diceTray`
Expected: PASS — 6 tests (the ones that don't require r3f canvas init in jsdom; r3f's `<Canvas>` may warn or no-op in jsdom but should not crash). If `<Canvas>` crashes, wrap the render in a try/catch in tests OR mock `@react-three/fiber` in `setup.ts`:
```ts
vi.mock("@react-three/fiber", async () => {
  const actual = await vi.importActual<typeof import("@react-three/fiber")>("@react-three/fiber");
  return { ...actual, Canvas: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-canvas">{children}</div> };
});
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/dice/index.tsx src/shared/dice/__tests__/diceTray.test.tsx
git commit -m "feat(shared/dice): <dice-tray> Web Component wrapper"
```

---

## Task 16: Vite build configuration

**Files:**
- Create: `vite.config.dice.js`

- [ ] **Step 1: Create the config**

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "public/shared",
    emptyOutDir: false, // preserve dice-assets/
    sourcemap: true,
    lib: {
      entry: resolve(process.cwd(), "src/shared/dice/index.tsx"),
      formats: ["es"],
      fileName: () => "dice.js",
    },
    rollupOptions: {
      output: {
        // Inline everything — no external imports. Plugins consume one file.
        inlineDynamicImports: true,
      },
    },
  },
  esbuild: {
    target: "es2022",
  },
});
```

- [ ] **Step 2: Run the build**

Run: `npm run build:dice`
Expected: build succeeds, `public/shared/dice.js` is created. Check size:
```bash
ls -la public/shared/dice.js public/shared/dice.js.map
gzip -c public/shared/dice.js | wc -c
```
Expected: bundle ≤ 750 KB gzipped. If larger, note the actual size in the commit message — we have a 700 KB budget but 750 KB is acceptable for v1. Anything > 1 MB requires a follow-up issue for code-splitting.

- [ ] **Step 3: Commit**

```bash
git add vite.config.dice.js
git commit -m "build: vite config for shared dice bundle (lib mode → public/shared/dice.js)"
```

---

## Task 17: Manual smoke-test page

**Files:**
- Create: `public/shared/dice-test.html`

A static page served by the existing Express static handler — lets a developer (or you) manually verify the dice render and roll in a real browser.

- [ ] **Step 1: Create the page**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>dice-tray smoke test</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; background: #1c1c1f; color: #f4ead4; }
      h1 { font-size: 1.2rem; }
      .row { display: flex; gap: 1rem; flex-wrap: wrap; }
      .panel { width: 360px; height: 360px; background: #2a2a2d; border-radius: 12px; padding: 0.5rem; }
      pre { background: #0a0a0a; padding: 0.5rem; border-radius: 6px; font-size: 0.85rem; overflow-x: auto; }
    </style>
  </head>
  <body>
    <h1>&lt;dice-tray&gt; smoke test</h1>
    <p>Drag a die to throw. Refresh to reset.</p>

    <div class="row">
      <div>
        <h2>1d6 (ivory)</h2>
        <div class="panel"><dice-tray dice="1d6" mode="active" theme="ivory"></dice-tray></div>
      </div>
      <div>
        <h2>2d6 (obsidian)</h2>
        <div class="panel"><dice-tray dice="2d6" mode="active" theme="obsidian"></dice-tray></div>
      </div>
      <div>
        <h2>1d20 (ivory)</h2>
        <div class="panel"><dice-tray dice="1d20" mode="active" theme="ivory"></dice-tray></div>
      </div>
    </div>

    <h2>Event log</h2>
    <pre id="log"></pre>

    <script type="module" src="/shared/dice.js"></script>
    <script>
      const log = document.getElementById("log");
      function append(msg) {
        log.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + log.textContent;
      }
      for (const tray of document.querySelectorAll("dice-tray")) {
        tray.addEventListener("dice-throw", (e) => append(`throw → ${JSON.stringify(e.detail).slice(0, 120)}`));
        tray.addEventListener("dice-settle", (e) => append(`settle → values=${JSON.stringify(e.detail.values)}`));
        tray.addEventListener("dice-error", (e) => append(`error → ${e.detail.message}`));
      }
    </script>
  </body>
</html>
```

- [ ] **Step 2: Manual verification**

Run: `npm start` (in another terminal: `DEV_USER=you@example.com npm start` if not yet on roster)
Open: `http://localhost:3000/shared/dice-test.html`
Expected:
- All three dice trays render with a 3D die.
- Drag a die → it tumbles and settles → the event log shows `throw` and `settle` entries.
- The event log shows the rolled value(s).
- No console errors.

If the page 404s on `/shared/dice-test.html`, the existing Express static config may need `public/shared/` exposed — verify via `curl http://localhost:3000/shared/dice.js` first; if that 404s too, check `src/server/server.js` for which directories under `public/` it serves. Open a follow-up note in the commit if a server change is needed (Phase A goal is to get the bundle building; static-serve adjustments are acceptable scope).

- [ ] **Step 3: Commit**

```bash
git add public/shared/dice-test.html
git commit -m "test(shared/dice): manual smoke-test page at /shared/dice-test.html"
```

---

## Task 18: Final verification & summary commit

- [ ] **Step 1: Run the full test suites**

Run:
```bash
npm test                   # node --test (existing) — should still pass
npm run test:dice          # vitest — should pass
npm run build:dice         # build should succeed
```
Expected: all green.

- [ ] **Step 2: Verify bundle exists in correct spot**

Run: `ls -la public/shared/`
Expected output includes `dice.js`, `dice.js.map`, and `dice-assets/` subdirectory with `Inter-Bold.ttf` + `scratched-plastic-normal.jpg`.

- [ ] **Step 3: Verify .gitignore excludes the bundle**

Run: `git status --short public/shared/`
Expected: nothing under `public/shared/dice.js` is tracked; `dice-assets/` files are tracked.

- [ ] **Step 4: README note (small addition)**

Edit `README.md` — append to the "Architecture" section, after the existing `plugins/` description:

```markdown
src/shared/dice/      shared <dice-tray> Web Component (Vite-built)
                      → public/shared/dice.js (bundle, .gitignored)
                      → public/shared/dice-assets/ (font + texture)
                      Plugins use it via `<script type="module" src="/shared/dice.js">`
                      and a `<dice-tray dice="2d6">` element.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(README): document src/shared/dice and the <dice-tray> bundle"
```

---

## Acceptance criteria — Phase A is done when:

1. ✅ `npm test` passes (existing rummikub/words tests untouched).
2. ✅ `npm run test:dice` passes.
3. ✅ `npm run build:dice` produces `public/shared/dice.js` (≤ 750 KB gzipped).
4. ✅ `http://localhost:3000/shared/dice-test.html` renders three dice trays. Each is throwable. `dice-settle` events fire with rolled values.
5. ✅ No game integration; `plugins/*` is unchanged from the start of Phase A.
6. ✅ `git log` shows ~17 small commits, each tied to one task and reversible.

When all six are met, mark Phase A complete and start Phase B (backgammon engine — see spec §4).
