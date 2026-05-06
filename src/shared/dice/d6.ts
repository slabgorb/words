/**
 * D6 cube geometry data.
 *
 * Standard Western d6: opposite faces sum to 7. Numbering chosen so that
 * with 1 on +Y, 2 sits on +X and 3 sits on +Z (right-handed convention).
 *
 * Face index ↔ axis:
 *   0: +Y (1)   3: -Z (4)
 *   1: -Y (6)   4: +X (2)
 *   2: +Z (3)   5: -X (5)
 */

import * as THREE from "three";
import type { FaceInfo } from "./d20";

export const D6_RADIUS = 0.36;

/**
 * Half-edge length so the cube's circumradius matches D6_RADIUS:
 *   circumradius = halfEdge * sqrt(3) ⇒ halfEdge = D6_RADIUS / sqrt(3)
 * The visual mesh in DiceScene should use a BoxGeometry of side
 * 2 * D6_HALF_EDGE so the convex hull tracks the rendered cube.
 */
export const D6_HALF_EDGE = D6_RADIUS / Math.sqrt(3);

/**
 * 8 cube vertices at half-edge scale.
 * Indices encode signs as bits: x=bit2, y=bit1, z=bit0 (so vertex 5 = +X,-Y,+Z).
 */
export const D6_COLLIDER_VERTICES = new Float32Array([
  -1, -1, -1, // 0: -X -Y -Z
  -1, -1,  1, // 1: -X -Y +Z
  -1,  1, -1, // 2: -X +Y -Z
  -1,  1,  1, // 3: -X +Y +Z
   1, -1, -1, // 4: +X -Y -Z
   1, -1,  1, // 5: +X -Y +Z
   1,  1, -1, // 6: +X +Y -Z
   1,  1,  1, // 7: +X +Y +Z
].map(v => v * D6_HALF_EDGE));

/** Each face listed as the four vertex indices of that face (any cyclic order). */
const FACE_INDICES: [number, number, number, number][] = [
  [2, 3, 7, 6], // +Y
  [0, 1, 5, 4], // -Y
  [1, 3, 7, 5], // +Z
  [0, 2, 6, 4], // -Z
  [4, 5, 7, 6], // +X
  [0, 1, 3, 2], // -X
];

/** +Y=1, -Y=6, +Z=3, -Z=4, +X=2, -X=5 (opposite faces sum to 7). */
const FACE_NUMBERS = [1, 6, 3, 4, 2, 5];

const RAW_VERTS = [
  new THREE.Vector3(-1, -1, -1),
  new THREE.Vector3(-1, -1,  1),
  new THREE.Vector3(-1,  1, -1),
  new THREE.Vector3(-1,  1,  1),
  new THREE.Vector3( 1, -1, -1),
  new THREE.Vector3( 1, -1,  1),
  new THREE.Vector3( 1,  1, -1),
  new THREE.Vector3( 1,  1,  1),
].map(v => v.multiplyScalar(D6_HALF_EDGE));

export function computeD6FaceInfo(): FaceInfo[] {
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

export function readD6Value(group: THREE.Group): number {
  const up = new THREE.Vector3(0, 1, 0);
  const worldPos = new THREE.Vector3();
  const faces = computeD6FaceInfo();

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
