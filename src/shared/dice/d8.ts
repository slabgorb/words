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
