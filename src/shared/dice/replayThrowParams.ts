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
