/**
 * D10 pentagonal trapezohedron geometry data.
 *
 * Not a Platonic solid — the d10 is a Catalan solid (dual of the pentagonal
 * antiprism). 12 vertices: 2 polar apices + two rings of 5 vertices offset
 * by 36° from each other. 10 kite-shaped faces, each touching one apex.
 *
 * Numbering: 1–10 with opposite faces summing to 11 (mirrors the d20's
 * sum-to-21 convention, scaled).
 */

import * as THREE from "three";
import type { FaceInfo } from "./d20";

export const D10_RADIUS = 0.36;

/**
 * Trapezohedron proportions. APEX_Y is the polar apex height; RING_Y is
 * the equatorial-ring elevation; RING_R is the equatorial-ring radius.
 * These ratios produce the classic d10 silhouette.
 */
const APEX_Y = 1.0;
const RING_Y = 0.25;
const RING_R = 0.85;

/** Scale so apex distance from center equals D10_RADIUS. */
const _SCALE = D10_RADIUS / APEX_Y;

/** Vertex angles in radians: upper ring at multiples of 72°, lower ring offset by 36°. */
const UPPER_ANGLE = (i: number) => (i * 2 * Math.PI) / 5;
const LOWER_ANGLE = (i: number) => ((i * 2 + 1) * Math.PI) / 5;

/**
 * 12 vertices: index 0 = north apex, 1 = south apex, 2..6 = upper ring,
 * 7..11 = lower ring.
 */
const VERT_ARRAY: number[] = [
  0,  APEX_Y, 0, // 0: north apex
  0, -APEX_Y, 0, // 1: south apex
];
for (let i = 0; i < 5; i++) {
  VERT_ARRAY.push(RING_R * Math.cos(UPPER_ANGLE(i)),  RING_Y, RING_R * Math.sin(UPPER_ANGLE(i)));
}
for (let i = 0; i < 5; i++) {
  VERT_ARRAY.push(RING_R * Math.cos(LOWER_ANGLE(i)), -RING_Y, RING_R * Math.sin(LOWER_ANGLE(i)));
}

export const D10_COLLIDER_VERTICES = new Float32Array(VERT_ARRAY.map(v => v * _SCALE));

/**
 * 10 kite faces.
 * Upper kite i (i=0..4): north → upper_i → lower_i → upper_{i+1} → north.
 * Lower kite i (i=0..4): south → lower_i → upper_{i+1} → lower_{i+1} → south.
 * lower_i sits at angle (i·72° + 36°), between upper_i and upper_{i+1}.
 */
const FACE_INDICES: number[][] = [
  // Upper kites (face indices 0..4)
  [0, 2, 7, 3],   // upper 0: north, upper_0, lower_0, upper_1
  [0, 3, 8, 4],   // upper 1
  [0, 4, 9, 5],   // upper 2
  [0, 5, 10, 6],  // upper 3
  [0, 6, 11, 2],  // upper 4
  // Lower kites (face indices 5..9)
  [1, 7, 3, 8],   // lower 0: south, lower_0, upper_1, lower_1
  [1, 8, 4, 9],   // lower 1
  [1, 9, 5, 10],  // lower 2
  [1, 10, 6, 11], // lower 3
  [1, 11, 2, 7],  // lower 4
];

/**
 * Numbering: upper face i ∈ {0..4} → odd numbers 1,3,5,7,9.
 * Upper i is opposite Lower (i+2)%5, so each lower number is 11 minus its
 * opposite upper. Verified opposite-sum = 11 for all five pairs.
 */
const FACE_NUMBERS = [1, 3, 5, 7, 9, 4, 2, 10, 8, 6];

const RAW_VERTS: THREE.Vector3[] = [];
for (let i = 0; i < VERT_ARRAY.length; i += 3) {
  RAW_VERTS.push(new THREE.Vector3(VERT_ARRAY[i], VERT_ARRAY[i + 1], VERT_ARRAY[i + 2]).multiplyScalar(_SCALE));
}

export function computeD10FaceInfo(): FaceInfo[] {
  return FACE_INDICES.map((indices, i) => {
    const center = new THREE.Vector3();
    for (const idx of indices) center.add(RAW_VERTS[idx]);
    center.divideScalar(indices.length);

    const normal = center.clone().normalize();

    // Stable in-plane "up": pick the kite's far-from-apex vertex (index 2 in
    // each face list — the equator vertex opposite the apex) and project its
    // offset onto the face plane. This points the number's top toward that
    // vertex when the kite is oriented apex-up.
    const radial = RAW_VERTS[indices[2]].clone().sub(center);
    const faceUp = radial.sub(normal.clone().multiplyScalar(radial.dot(normal))).normalize();

    const outside = center.clone().add(normal);
    const mat = new THREE.Matrix4();
    mat.lookAt(outside, center, faceUp);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(mat);

    return { number: FACE_NUMBERS[i], center, normal, quaternion };
  });
}

export function readD10Value(group: THREE.Group): number {
  const up = new THREE.Vector3(0, 1, 0);
  const worldPos = new THREE.Vector3();
  const faces = computeD10FaceInfo();

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
