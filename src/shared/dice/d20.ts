/**
 * D20 icosahedron geometry data.
 *
 * Face centers are positioned slightly outside each triangular face.
 * The dot product of (faceCenter - dieCenter) with the world-up vector
 * determines which face is on top after the die settles.
 *
 * Collider vertices are the 12 vertices of a regular icosahedron,
 * scaled to match the visual mesh.
 */

import * as THREE from "three";

const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Visual + collider scale for the die. Playtest 2026-04-25 bumped the
 * die from radius=0.24 to radius=0.36 (1.5× larger) so Sebastien
 * (mechanics-first) and Alex (slower reader) can read the settled face
 * without leaning forward. Combined with the FOV tightening from 50 to
 * 42 in InlineDiceTray.tsx, the die now occupies ~39% of the frame
 * width at default zoom (was ~21% — roughly 1.86× perceptual size).
 *
 * The collider scale is held at radius/PHI_VERTEX_LEN so the convex
 * hull tracks the visual mesh exactly — must scale together or the die
 * bounces off invisible walls.
 */

/** Die radius for the visual mesh */
export const D20_RADIUS = 0.36;

/** Collider vertex scale — derived from D20_RADIUS so visual + physics stay in sync. */
const _COLLIDER_VERTEX_SCALE = (D20_RADIUS / 0.24) * 0.14;

/**
 * 12 vertices of a regular icosahedron (unit-ish scale).
 * Used for the ConvexHullCollider in Rapier.
 */
export const D20_COLLIDER_VERTICES = new Float32Array([
  -1, PHI, 0,
   1, PHI, 0,
  -1, -PHI, 0,
   1, -PHI, 0,
   0, -1, PHI,
   0,  1, PHI,
   0, -1, -PHI,
   0,  1, -PHI,
   PHI, 0, -1,
   PHI, 0,  1,
  -PHI, 0, -1,
  -PHI, 0,  1,
].map(v => v * _COLLIDER_VERTEX_SCALE));

/**
 * Standard d20 face-to-number mapping.
 * Each face is a triangle defined by 3 vertex indices from IcosahedronGeometry.
 * The number on each face follows the d20 convention where opposite faces sum to 21.
 */
const FACE_INDICES: [number, number, number][] = [
  [0, 11, 5],  [0, 5, 1],   [0, 1, 7],   [0, 7, 10],  [0, 10, 11],
  [1, 5, 9],   [5, 11, 4],  [11, 10, 2],  [10, 7, 6],  [7, 1, 8],
  [3, 9, 4],   [3, 4, 2],   [3, 2, 6],   [3, 6, 8],   [3, 8, 9],
  [4, 9, 5],   [2, 4, 11],  [6, 2, 10],  [8, 6, 7],   [9, 8, 1],
];

// d20 standard numbering: opposite faces sum to 21
const FACE_NUMBERS = [20, 2, 8, 14, 12, 18, 4, 16, 6, 10, 1, 19, 13, 7, 9, 11, 17, 5, 15, 3];

/**
 * Face information: number, center position, outward normal, and a
 * quaternion that orients text to read upright when the face is on top.
 */
export interface FaceInfo {
  number: number;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  /** Quaternion that orients a +Z-facing text mesh onto this face,
   *  with the text reading upright when the face points toward +Y. */
  quaternion: THREE.Quaternion;
}

/** Icosahedron vertices at die radius, computed once. */
const RAW_VERTS = [
  new THREE.Vector3(-1, PHI, 0),
  new THREE.Vector3(1, PHI, 0),
  new THREE.Vector3(-1, -PHI, 0),
  new THREE.Vector3(1, -PHI, 0),
  new THREE.Vector3(0, -1, PHI),
  new THREE.Vector3(0, 1, PHI),
  new THREE.Vector3(0, -1, -PHI),
  new THREE.Vector3(0, 1, -PHI),
  new THREE.Vector3(PHI, 0, -1),
  new THREE.Vector3(PHI, 0, 1),
  new THREE.Vector3(-PHI, 0, -1),
  new THREE.Vector3(-PHI, 0, 1),
].map(v => v.normalize().multiplyScalar(D20_RADIUS));

/**
 * Compute face center, normal, and text orientation for all 20 faces.
 *
 * Text orientation: on a real d20, each number reads upright when its face
 * is the "top" face (normal pointing up). We build a lookAt matrix from
 * the face center outward along the normal, with "up" derived from the
 * vertex layout of each triangle — specifically, the edge from vertex A
 * to the midpoint of B-C gives a consistent "up" direction within the
 * face plane. This avoids the arbitrary twist that setFromUnitVectors produces.
 */
export function computeFaceInfo(): FaceInfo[] {
  return FACE_INDICES.map((indices, i) => {
    const [a, b, c] = indices;
    const center = new THREE.Vector3()
      .add(RAW_VERTS[a])
      .add(RAW_VERTS[b])
      .add(RAW_VERTS[c])
      .divideScalar(3);

    const normal = center.clone().normalize();

    // Build a rotation matrix that faces the normal with stable "up".
    // The "up" hint is the direction from vertex A toward the midpoint of
    // edge B-C — this lies in the face plane and gives a repeatable
    // orientation for every triangle.
    const edgeMid = RAW_VERTS[b].clone().add(RAW_VERTS[c]).multiplyScalar(0.5);
    const faceUp = edgeMid.clone().sub(RAW_VERTS[a]).normalize();

    // lookAt: point FROM outside the face back TO center, so the text
    // (which faces +Z by default) ends up facing outward, not mirrored.
    const outside = center.clone().add(normal);
    const mat = new THREE.Matrix4();
    mat.lookAt(outside, center, faceUp);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(mat);

    return { number: FACE_NUMBERS[i], center, normal, quaternion };
  });
}

/**
 * Given a d20 group's world transform, determine which face number is on top.
 * Works by finding the face center with the highest dot product against world-up.
 */
export function readD20Value(group: THREE.Group): number {
  const up = new THREE.Vector3(0, 1, 0);
  const worldPos = new THREE.Vector3();
  const faceCenters = computeFaceInfo();

  group.getWorldPosition(worldPos);

  let bestDot = -Infinity;
  let bestNumber = 1;

  for (const { number, center } of faceCenters) {
    // Transform face center to world space
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
