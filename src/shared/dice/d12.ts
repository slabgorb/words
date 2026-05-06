/**
 * D12 regular dodecahedron geometry data.
 *
 * 20 vertices (cube corners + three orthogonal golden rectangles), 12
 * pentagonal faces. Standard numbering: opposite faces sum to 13.
 *
 * Face centers coincide with the vertices of the dual icosahedron — the
 * 12 face-center directions match the 12 directions used in d20.ts.
 */

import * as THREE from "three";
import type { FaceInfo } from "./d20";

const PHI = (1 + Math.sqrt(5)) / 2;
const INV_PHI = 1 / PHI;

export const D12_RADIUS = 0.36;

/**
 * Circumradius of the unit dodecahedron parameterization below is sqrt(3)
 * (the (±1,±1,±1) vertices). Scale so circumradius matches D12_RADIUS.
 */
const _SCALE = D12_RADIUS / Math.sqrt(3);

/**
 * 20 vertices of a regular dodecahedron.
 *  0..7  : (±1, ±1, ±1)              — same indexing as d6 cube corners
 *  8..11 : (0, ±φ, ±1/φ)
 *  12..15: (±1/φ, 0, ±φ)
 *  16..19: (±φ, ±1/φ, 0)
 */
const VERT_ARRAY = [
  -1, -1, -1, // 0
  -1, -1,  1, // 1
  -1,  1, -1, // 2
  -1,  1,  1, // 3
   1, -1, -1, // 4
   1, -1,  1, // 5
   1,  1, -1, // 6
   1,  1,  1, // 7
   0, -PHI, -INV_PHI, // 8
   0, -PHI,  INV_PHI, // 9
   0,  PHI, -INV_PHI, // 10
   0,  PHI,  INV_PHI, // 11
  -INV_PHI, 0, -PHI,  // 12
  -INV_PHI, 0,  PHI,  // 13
   INV_PHI, 0, -PHI,  // 14
   INV_PHI, 0,  PHI,  // 15
  -PHI, -INV_PHI, 0,  // 16
  -PHI,  INV_PHI, 0,  // 17
   PHI, -INV_PHI, 0,  // 18
   PHI,  INV_PHI, 0,  // 19
];

export const D12_COLLIDER_VERTICES = new Float32Array(VERT_ARRAY.map(v => v * _SCALE));

/**
 * 12 pentagonal faces. Each row is the cycle of 5 vertex indices that
 * form the pentagon. Face centers are diametrically opposite in pairs
 * (0↔3, 1↔2, 4↔7, 5↔6, 8↔11, 9↔10) — the standard d12 opposite-pairs.
 */
const FACE_INDICES: [number, number, number, number, number][] = [
  [6, 10, 11, 7, 19],   // 0: face center (+1, +φ, 0)
  [2, 10, 11, 3, 17],   // 1: (-1, +φ, 0)
  [4,  8,  9, 5, 18],   // 2: (+1, -φ, 0)
  [0,  8,  9, 1, 16],   // 3: (-1, -φ, 0)
  [3, 11,  7, 15, 13],  // 4: (0, +1, +φ)
  [2, 10,  6, 14, 12],  // 5: (0, +1, -φ)
  [1,  9,  5, 15, 13],  // 6: (0, -1, +φ)
  [0,  8,  4, 14, 12],  // 7: (0, -1, -φ)
  [5, 18, 19, 7, 15],   // 8: (+φ, 0, +1)
  [1, 16, 17, 3, 13],   // 9: (-φ, 0, +1)
  [4, 18, 19, 6, 14],   // 10: (+φ, 0, -1)
  [0, 16, 17, 2, 12],   // 11: (-φ, 0, -1)
];

/** Standard d12 numbering: opposite faces sum to 13. */
const FACE_NUMBERS = [1, 2, 11, 12, 3, 4, 9, 10, 5, 6, 7, 8];

const RAW_VERTS: THREE.Vector3[] = [];
for (let i = 0; i < VERT_ARRAY.length; i += 3) {
  RAW_VERTS.push(new THREE.Vector3(VERT_ARRAY[i], VERT_ARRAY[i + 1], VERT_ARRAY[i + 2]).multiplyScalar(_SCALE));
}

export function computeD12FaceInfo(): FaceInfo[] {
  return FACE_INDICES.map((indices, i) => {
    const center = new THREE.Vector3();
    for (const idx of indices) center.add(RAW_VERTS[idx]);
    center.divideScalar(indices.length);

    const normal = center.clone().normalize();

    // Stable in-plane "up": project the first vertex's offset from center
    // onto the face plane.
    const radial = RAW_VERTS[indices[0]].clone().sub(center);
    const faceUp = radial.sub(normal.clone().multiplyScalar(radial.dot(normal))).normalize();

    const outside = center.clone().add(normal);
    const mat = new THREE.Matrix4();
    mat.lookAt(outside, center, faceUp);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(mat);

    return { number: FACE_NUMBERS[i], center, normal, quaternion };
  });
}

export function readD12Value(group: THREE.Group): number {
  const up = new THREE.Vector3(0, 1, 0);
  const worldPos = new THREE.Vector3();
  const faces = computeD12FaceInfo();

  group.getWorldPosition(worldPos);

  let bestDot = -Infinity;
  let bestNumber = 1;

  for (const { number, center } of faces) {
    const worldCenter = center.clone().applyMatrix4(group.matrixWorld);
    const dir = worldCenter.sub(worldPos).normalize();
    const dot = dir.dot(up);
    if (dot > bestDot) {
      bestDot = dot;
      bestNumber = number;
    }
  }

  return bestNumber;
}
