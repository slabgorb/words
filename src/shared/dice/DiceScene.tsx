/**
 * DiceScene — Physics world with N configurable dice.
 *
 * Adapted from sidequest-ui's d20-only DiceScene.tsx.
 *
 * Patterns retained:
 * - Fixed timestep (1/120) with no interpolation for deterministic replay
 * - Settle detection: linear + angular velocity below threshold
 * - Face reading via face-center dot product against world-up
 * - Tray colliders: floor (high friction) + walls + ceiling (sealed)
 * - Force-stop timeout after 5 seconds
 *
 * Generalized:
 * - Renders N dice of any registered DieKind
 * - Settles each die independently; emits onAllSettle once when all are at rest
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { TextureLoader } from "three";
import {
  Physics,
  RigidBody,
  CuboidCollider,
  ConvexHullCollider,
  RapierRigidBody,
} from "@react-three/rapier";
import { Text } from "@react-three/drei";

import type { DieKind, ThrowParams } from "./types";
import { DIE_REGISTRY, type DieEntry } from "./dieRegistry";
import { useDiceThrowGesture } from "./useDiceThrowGesture";
import { DEFAULT_DICE_THEME, type DiceTheme } from "./diceTheme";

const FACE_LABEL_FONT = "/shared/dice-assets/Inter-Bold.ttf";

const SETTLE_THRESHOLD = 0.005;
const MAX_ROLL_TIME = 5000;
const TRAY_HALF_WIDTH = 0.8;
const TRAY_HALF_DEPTH = 0.8;
const WALL_HALF_HEIGHT = 0.5;
const WALL_HALF_THICKNESS = 0.2;

function TrayColliders() {
  const wallTop = WALL_HALF_HEIGHT * 2;
  const wallX = TRAY_HALF_WIDTH + WALL_HALF_THICKNESS;
  const wallZ = TRAY_HALF_DEPTH + WALL_HALF_THICKNESS;

  return (
    <group>
      <RigidBody type="fixed" friction={10} restitution={0.3}>
        <CuboidCollider args={[wallX, 0.2, wallZ]} position={[0, -0.2, 0]} />
      </RigidBody>
      <RigidBody type="fixed" friction={1} restitution={0.6}>
        <CuboidCollider args={[wallX, WALL_HALF_HEIGHT, WALL_HALF_THICKNESS]} position={[0, WALL_HALF_HEIGHT, -(TRAY_HALF_DEPTH + WALL_HALF_THICKNESS)]} />
        <CuboidCollider args={[wallX, WALL_HALF_HEIGHT, WALL_HALF_THICKNESS]} position={[0, WALL_HALF_HEIGHT, TRAY_HALF_DEPTH + WALL_HALF_THICKNESS]} />
        <CuboidCollider args={[WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, wallZ]} position={[-(TRAY_HALF_WIDTH + WALL_HALF_THICKNESS), WALL_HALF_HEIGHT, 0]} />
        <CuboidCollider args={[WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, wallZ]} position={[TRAY_HALF_WIDTH + WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, 0]} />
        <CuboidCollider args={[wallX, 0.1, wallZ]} position={[0, wallTop + 0.1, 0]} />
      </RigidBody>
    </group>
  );
}

function TrayVisual() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
      <planeGeometry args={[TRAY_HALF_WIDTH * 2, TRAY_HALF_DEPTH * 2]} />
      <shadowMaterial opacity={0.3} />
    </mesh>
  );
}

function DieGeometry({ entry }: { entry: DieEntry }) {
  switch (entry.geometryKind) {
    case "icosahedron":
      return <icosahedronGeometry args={[entry.radius, 0]} />;
    case "box": {
      const edge = (entry.radius * 2) / Math.sqrt(3);
      return <boxGeometry args={[edge, edge, edge]} />;
    }
    case "tetrahedron":
      return <tetrahedronGeometry args={[entry.radius, 0]} />;
    case "decahedron":
      // Three.js has no built-in decahedron; visual-only fallback (d10 not used by backgammon).
      return <icosahedronGeometry args={[entry.radius, 0]} />;
    case "dodecahedron":
      return <dodecahedronGeometry args={[entry.radius, 0]} />;
  }
}

function FaceLabels({ entry, color, font }: { entry: DieEntry; color: string; font: string }) {
  const faces = useMemo(() => entry.computeFaceInfo(), [entry]);
  return (
    <>
      {faces.map((face, i) => {
        const labelPos = face.center.clone().add(face.normal.clone().multiplyScalar(0.002));
        return (
          <Text
            key={i}
            font={font}
            position={labelPos.toArray()}
            quaternion={face.quaternion}
            fontSize={entry.radius * 0.24}
            color={color}
            anchorX="center"
            anchorY="middle"
            fontWeight={700}
          >
            {face.number}
          </Text>
        );
      })}
    </>
  );
}

function DieMesh({ kind, theme }: { kind: DieKind; theme: DiceTheme }) {
  const entry = DIE_REGISTRY[kind];
  const baseTex = useLoader(
    TextureLoader,
    theme.normalMap ?? "/shared/dice-assets/scratched-plastic-normal.jpg",
  );
  const normalTex = useMemo(() => {
    const tex = baseTex.clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }, [baseTex]);
  const normalScaleVec = useMemo(
    () => new THREE.Vector2(theme.normalScale ?? 0.5, theme.normalScale ?? 0.5),
    [theme.normalScale],
  );

  return (
    <group>
      <mesh castShadow>
        <DieGeometry entry={entry} />
        <meshStandardMaterial
          color={theme.dieColor}
          roughness={theme.roughness ?? 0.3}
          metalness={theme.metalness ?? 0.1}
          normalMap={normalTex}
          normalScale={normalScaleVec}
          flatShading
        />
      </mesh>
      <FaceLabels entry={entry} color={theme.labelColor} font={theme.labelFont ?? FACE_LABEL_FONT} />
    </group>
  );
}

interface PhysicsDieProps {
  kind: DieKind;
  throwParams: ThrowParams;
  spawnOffset: [number, number, number];
  onSettle: (value: number) => void;
  theme: DiceTheme;
}

function PhysicsDie({ kind, throwParams, spawnOffset, onSettle, theme }: PhysicsDieProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const groupRef = useRef<THREE.Group>(null);
  const settledRef = useRef(false);
  const throwTimeRef = useRef(0);
  const entry = DIE_REGISTRY[kind];

  useEffect(() => {
    settledRef.current = false;
    throwTimeRef.current = performance.now();
  }, [throwParams]);

  useFrame(() => {
    const rb = rigidBodyRef.current;
    const group = groupRef.current;
    if (!rb || !group || settledRef.current) return;

    const lin = rb.linvel();
    const ang = rb.angvel();
    const speed =
      Math.sqrt(lin.x * lin.x + lin.y * lin.y + lin.z * lin.z) +
      Math.sqrt(ang.x * ang.x + ang.y * ang.y + ang.z * ang.z);

    const elapsed = performance.now() - throwTimeRef.current;
    const forceStop = elapsed > MAX_ROLL_TIME;

    if (speed < SETTLE_THRESHOLD || forceStop) {
      if (forceStop) console.warn("Dice exceeded max roll time, force-stopping");
      settledRef.current = true;
      rb.setEnabledRotations(false, false, false, false);
      rb.setEnabledTranslations(false, false, false, false);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, false);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, false);
      onSettle(entry.readValue(group));
    }
  });

  const pos: [number, number, number] = [
    throwParams.position[0] + spawnOffset[0],
    throwParams.position[1] + spawnOffset[1],
    throwParams.position[2] + spawnOffset[2],
  ];

  return (
    <RigidBody
      ref={rigidBodyRef}
      gravityScale={3}
      density={2}
      friction={0.2}
      restitution={0.3}
      position={pos}
      rotation={throwParams.rotation}
      linearVelocity={throwParams.linearVelocity}
      angularVelocity={throwParams.angularVelocity}
      colliders={false}
      ccd
    >
      <group ref={groupRef}>
        <ConvexHullCollider args={[entry.colliderVertices]} />
        <DieMesh kind={kind} theme={theme} />
      </group>
    </RigidBody>
  );
}

function PickupDie({ kind, theme, onThrow }: { kind: DieKind; theme: DiceTheme; onThrow: (p: ThrowParams) => void }) {
  const { onPointerDown } = useDiceThrowGesture({ onThrow });
  const groupRef = useRef<THREE.Group>(null);
  const entry = DIE_REGISTRY[kind];

  return (
    <group
      ref={groupRef}
      position={[0, entry.radius + 0.01, 0]}
      onPointerDown={onPointerDown}
    >
      <DieMesh kind={kind} theme={theme} />
    </group>
  );
}

function spawnOffsetFor(index: number, count: number, radius: number): [number, number, number] {
  const spacing = radius * 2.4;
  const totalWidth = (count - 1) * spacing;
  const x = -totalWidth / 2 + index * spacing;
  return [x, 0, 0];
}

export interface DiceSceneProps {
  kind: DieKind;
  count: number;
  throwParams: ThrowParams | null;
  rollKey: number;
  onThrow: (params: ThrowParams) => void;
  onAllSettle: (values: number[]) => void;
  theme?: DiceTheme;
}

export function DiceScene({
  kind,
  count,
  throwParams,
  rollKey,
  onThrow,
  onAllSettle,
  theme = DEFAULT_DICE_THEME,
}: DiceSceneProps) {
  const settledValuesRef = useRef<number[]>([]);
  const settledFlagsRef = useRef<boolean[]>([]);

  useEffect(() => {
    settledValuesRef.current = new Array(count).fill(0);
    settledFlagsRef.current = new Array(count).fill(false);
  }, [throwParams, count, rollKey]);

  const handleSettle = (index: number, value: number) => {
    settledValuesRef.current[index] = value;
    settledFlagsRef.current[index] = true;
    if (settledFlagsRef.current.every(Boolean)) {
      onAllSettle([...settledValuesRef.current]);
    }
  };

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 1]} intensity={1.2} castShadow />
      <Physics
        key={rollKey}
        colliders={false}
        interpolate={false}
        timeStep={1 / 120}
        gravity={[0, -9.81, 0]}
      >
        <TrayColliders />
        {throwParams ? (
          Array.from({ length: count }).map((_, i) => (
            <PhysicsDie
              key={i}
              kind={kind}
              throwParams={throwParams}
              spawnOffset={spawnOffsetFor(i, count, DIE_REGISTRY[kind].radius)}
              onSettle={(v) => handleSettle(i, v)}
              theme={theme}
            />
          ))
        ) : (
          <PickupDie kind={kind} theme={theme} onThrow={onThrow} />
        )}
      </Physics>
      <TrayVisual />
    </>
  );
}
