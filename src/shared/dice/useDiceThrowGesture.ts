/**
 * useDiceThrowGesture — Extracted gesture capture hook for dice throwing.
 *
 * Converts drag-and-flick pointer events into ThrowParams for the dice
 * physics engine. Also supports keyboard activation (Enter/Space) for
 * accessibility. No R3F dependency — works with raw screen coordinates.
 *
 * Story 34-6
 */

import { useCallback, useEffect, useRef } from "react";
import type { ThrowParams } from "./types";

/** Number of recent drag samples to keep for velocity averaging */
const DRAG_HISTORY_SIZE = 5;

/** Minimum screen-space speed (px/s) to register as a throw */
const MIN_SPEED_PX = 50;

/** Maximum linear velocity magnitude in physics units */
const MAX_THROW_SPEED = 15;

/** Scale factor: screen px/s → physics velocity units */
const PX_TO_VELOCITY = 0.03;

interface DragSample {
  x: number;
  y: number;
  t: number;
}

interface UseDiceThrowGestureOptions {
  onThrow: (params: ThrowParams) => void;
}

function randomRotation(): [number, number, number] {
  return [
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  ];
}

function randomAngularVelocity(): [number, number, number] {
  return [
    (Math.random() - 0.5) * 20,
    (Math.random() - 0.5) * 20,
    (Math.random() - 0.5) * 20,
  ];
}

function buildThrowParams(
  vx: number,
  vz: number,
  speed: number,
): ThrowParams {
  const throwSpeed = Math.min(speed * PX_TO_VELOCITY, MAX_THROW_SPEED);
  const dir = { x: vx / speed, z: vz / speed };

  return {
    position: [0, 0.5, 0],
    linearVelocity: [
      dir.x * throwSpeed,
      2 + Math.random() * 2,
      dir.z * throwSpeed,
    ],
    angularVelocity: randomAngularVelocity(),
    rotation: randomRotation(),
  };
}

function buildDefaultThrowParams(): ThrowParams {
  return {
    position: [0, 0.5, 0],
    linearVelocity: [
      (Math.random() - 0.5) * 4,
      3 + Math.random() * 2,
      -5 - Math.random() * 3,
    ],
    angularVelocity: randomAngularVelocity(),
    rotation: randomRotation(),
  };
}

export function useDiceThrowGesture({ onThrow }: UseDiceThrowGestureOptions) {
  const draggingRef = useRef(false);
  const historyRef = useRef<DragSample[]>([]);
  // Always-latest callback ref: keeps the pointer-up handler reading the
  // current `onThrow` without re-subscribing on every render. The assignment
  // lives in an effect (not render body) so eslint-plugin-react-hooks/refs
  // doesn't fire — refs may not be mutated during render.
  const onThrowRef = useRef(onThrow);
  useEffect(() => {
    onThrowRef.current = onThrow;
  }, [onThrow]);

  const onPointerDown = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      draggingRef.current = true;
      historyRef.current = [];
    },
    [],
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const history = historyRef.current;
      history.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (history.length > DRAG_HISTORY_SIZE) history.shift();
    };

    const handleUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;

      const history = historyRef.current;
      if (history.length < 2) return;

      let totalDx = 0;
      let totalDy = 0;
      let totalDt = 0;
      for (let i = 1; i < history.length; i++) {
        totalDx += history[i].x - history[i - 1].x;
        totalDy += history[i].y - history[i - 1].y;
        totalDt += history[i].t - history[i - 1].t;
      }

      if (totalDt === 0) return;

      const vx = (totalDx / totalDt) * 1000; // px/s
      const vy = (totalDy / totalDt) * 1000;
      const speed = Math.sqrt(vx * vx + vy * vy);

      if (speed < MIN_SPEED_PX) return;

      // Screen Y maps to world Z (inverted: drag up = throw forward = -Z)
      onThrowRef.current(buildThrowParams(vx, -vy, speed));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        onThrowRef.current(buildDefaultThrowParams());
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return { onPointerDown };
}
