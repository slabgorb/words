# dice-faces visualizer

Static HTML tool for verifying the `FACE_NUMBERS` array in
`~/Projects/dice-lib/src/dN.ts` against the painted numbers on the Devil's
Workshop FBX dice models.

## Why

The dice library's `FACE_NUMBERS[i]` maps procedural face index `i` →
the integer value that should be reported when face `i` is "up". For
procedural-only rendering (FaceLabels), this is whatever convention the
library chose. For FBX-rendered dice, it MUST match what the FBX
texture actually paints on each face, which can only be determined by
looking at the model.

## Pages

- `/shared/d6-faces.html` — d6 only. Renders the cube from each of the
  6 axis directions (±X/±Y/±Z). The painted number visible in each
  panel is the value of `FACE_NUMBERS` for that face.
- `/shared/dice-faces.html?die=d4|d8|d10|d12|d20` — generic visualizer.
  Renders one panel per procedural face, with the FBX rotated so that
  face's normal points at the camera. Read off the painted number
  visible in each panel.

## Workflow

1. Open `http://localhost:3000/shared/dice-faces.html?die=d8` (or
   whichever die).
2. For each panel, note the painted number visible in the center of
   the canvas. Record it as `FACE_NUMBERS[face_index] = painted_value`.
3. Edit `~/Projects/dice-lib/src/dN.ts` and replace `FACE_NUMBERS`
   with the values you read.
4. Rebuild dice-lib + verify in-game that rolls report the correct
   face value.

## Example

```
d8 face mapping (after visual inspection):
Face 0 (+X +Y +Z): saw "5" → FACE_NUMBERS[0] = 5
Face 1 (+X +Y -Z): saw "1" → FACE_NUMBERS[1] = 1
Face 2 (+X -Y +Z): saw "3" → FACE_NUMBERS[2] = 3
...
```

Then update `~/Projects/dice-lib/src/d8.ts`:

```ts
const FACE_NUMBERS = [5, 1, 3, /* ... */];
```

## Caveats

- Assumes the FBX is in the same orientation as the procedural geometry
  (lib axes ↔ model axes). If you see a partial-face / edge view in a
  panel, the FBX is rotated relative to the procedural normals — apply
  a per-die rotation offset before the per-face quaternion.
- d6 already verified: `FACE_NUMBERS = [2, 5, 6, 1, 3, 4]` (see
  `dice-lib/src/d6.ts`).

## Assets

`/shared/dice-asset-preview/dN.fbx` + `dN-color.png`. Sourced from the
Devil's Workshop Low Poly Dice Pack v3.01. These are tooling-only — the
runtime dice library does not depend on them.
