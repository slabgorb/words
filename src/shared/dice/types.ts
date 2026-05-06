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
