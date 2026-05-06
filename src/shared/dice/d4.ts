/**
 * D4 tetrahedron geometry data.
 *
 * Unlike a d20, a settled d4 has one vertex pointing up and one face flat
 * on the table. Standard tabletop d4s show the rolled number on the bottom
 * face (the same number appears on the upright corners of the three visible
 * faces). readD4Value mirrors that convention by selecting the face whose
 * normal points most strongly DOWN.
 */

import * as THREE from "three";
import type { FaceInfo } from "./d20";

/** Die radius for the visual mesh — matches d20 sizing for visual parity in trays. */
export const D4_RADIUS = 0.36;

/** Collider vertex scale — derived from D4_RADIUS so visual + physics stay in sync. */
const _COLLIDER_VERTEX_SCALE = D4_RADIUS / Math.sqrt(3);

/**
 * 4 vertices of a regular tetrahedron at unit-ish scale.
 * (1,1,1), (1,-1,-1), (-1,1,-1), (-1,-1,1) form a regular tetrahedron
 * inscribed in a cube of side 2; circumradius is sqrt(3).
 */
export const D4_COLLIDER_VERTICES = new Float32Array([
   1,  1,  1,
   1, -1, -1,
  -1,  1, -1,
  -1, -1,  1,
].map(v => v * _COLLIDER_VERTEX_SCALE));

/**
 * Each face is the triangle opposite one vertex, listed by the three other
 * vertex indices. Face i is opposite vertex i.
 */
const FACE_INDICES: [number, number, number][] = [
  [1, 2, 3], // opposite vertex 0
  [0, 3, 2], // opposite vertex 1
  [0, 1, 3], // opposite vertex 2
  [0, 2, 1], // opposite vertex 3
];

/** Standard d4 numbering: faces 0..3 → 1..4 (no opposite-sum convention on a tetrahedron). */
const FACE_NUMBERS = [1, 2, 3, 4];

/** Tetrahedron vertices at die radius, computed once. */
const RAW_VERTS = [
  new THREE.Vector3( 1,  1,  1),
  new THREE.Vector3( 1, -1, -1),
  new THREE.Vector3(-1,  1, -1),
  new THREE.Vector3(-1, -1,  1),
].map(v => v.normalize().multiplyScalar(D4_RADIUS));

export function computeD4FaceInfo(): FaceInfo[] {
  return FACE_INDICES.map((indices, i) => {
    const [a, b, c] = indices;
    const center = new THREE.Vector3()
      .add(RAW_VERTS[a])
      .add(RAW_VERTS[b])
      .add(RAW_VERTS[c])
      .divideScalar(3);

    const normal = center.clone().normalize();

    const edgeMid = RAW_VERTS[b].clone().add(RAW_VERTS[c]).multiplyScalar(0.5);
    const faceUp = edgeMid.clone().sub(RAW_VERTS[a]).normalize();

    const outside = center.clone().add(normal);
    const mat = new THREE.Matrix4();
    mat.lookAt(outside, center, faceUp);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(mat);

    return { number: FACE_NUMBERS[i], center, normal, quaternion };
  });
}

/**
 * Read the settled d4 value: the face whose normal points most strongly DOWN
 * (i.e., the face touching the table). This matches the standard tabletop
 * convention where the rolled number is the bottom face's number.
 */
export function readD4Value(group: THREE.Group): number {
  const down = new THREE.Vector3(0, -1, 0);
  const worldPos = new THREE.Vector3();
  const faces = computeD4FaceInfo();

  group.getWorldPosition(worldPos);

  let bestDot = -Infinity;
  let bestNumber = 1;

  for (const { number, center } of faces) {
    const worldCenter = center.clone().applyMatrix4(group.matrixWorld);
    const dir = worldCenter.sub(worldPos).normalize();
    const dot = dir.dot(down);
    if (dot > bestDot) {
      bestDot = dot;
      bestNumber = number;
    }
  }

  return bestNumber;
}
