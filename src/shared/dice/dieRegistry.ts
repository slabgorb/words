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
  /** Geometry kind for the visual mesh. */
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
    geometryKind: "icosahedron",
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
