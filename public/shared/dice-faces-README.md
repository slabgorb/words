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
visual inspection.

## Pages

- `/shared/d6-faces.html` — d6 only. Cube rendered from each of the 6
  axis directions (±X/±Y/±Z). The painted number in each panel is the
  `FACE_NUMBERS` value for that face.
- `/shared/dice-faces.html?die=d4|d8|d10|d12|d20` — generic visualizer.
  Single 500×500 canvas with **OrbitControls**: drag to rotate, scroll
  to zoom. A side panel lists every procedural face with a `snap`
  button that points the camera at that face's normal direction. Type
  the painted number you see into each face's input; the JS
  `FACE_NUMBERS = [...]` snippet at the bottom updates live.

## Workflow

1. `cd ~/Projects/words && PORT=3911 npm start`
2. Open `http://localhost:3911/shared/dice-faces.html?die=d8` (or
   whichever die).
3. Click `snap` on `face[0]` → camera jumps to that direction. The
   FBX may not be axis-aligned with lib coords — drag to fine-tune
   until the face is square-on and you can read its number.
4. Type the painted number into the input.
5. Repeat for each face.
6. Copy the `FACE_NUMBERS = [...]` line from the bottom box and paste
   into `~/Projects/dice-lib/src/dN.ts`, replacing the existing
   `FACE_NUMBERS` constant.

## Captured mappings

### d20 (verified 2026-05-13)

Reading face 0..19 from the original auto-rotated visualizer (which
happened to align well for d20 specifically):

```ts
const FACE_NUMBERS = [9, 3, 2, 8, 6, 11, 19, 1, 4, 7, 18, 12, 17, 15, 14, 16, 13, 10, 5, 20];
```

Re-verify with the orbit visualizer before committing to FBX rendering.

### d6 (already in dice-lib)

```ts
const FACE_NUMBERS = [2, 5, 6, 1, 3, 4];
```

### d4, d8, d10, d12

Pending visual verification — use the orbit visualizer.

## Caveats

- **d10 uses the percentile FBX** (`d10_Percentile_03.fbx`, FBX 7500).
  The standard `d10_03.fbx` is FBX 6100 which the modern three.js
  FBXLoader does not support. The percentile mesh shares the
  trapezohedron topology with the standard d10, but the Devil's
  Workshop d10 color textures paint the regular 1-10 numerals — the
  loaded model will show those (not 00-90), which is what we want.
- Texture 404s in the console for `dN_LOD0_Base_Color.png` /
  `dN_LOD0_Normal.png` are harmless — those are filenames the FBX
  embedded internally; we override the material with our own texture
  on every mesh.

## Assets

`/shared/dice-asset-preview/dN.fbx` + `dN-color.png`. Sourced from the
Devil's Workshop Low Poly Dice Pack v3.01. These are tooling-only —
the runtime dice library does not depend on them.
