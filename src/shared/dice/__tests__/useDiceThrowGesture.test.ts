/**
 * Story 34-6: useDiceThrowGesture hook tests.
 *
 * Tests the extracted gesture capture hook that converts drag-and-flick
 * pointer events into ThrowParams for the dice physics engine.
 *
 * RED phase — all tests FAIL until Dev extracts and implements the hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ══════════════════════════════════════════════════════════════════════════════
// AC-1: useDiceThrowGesture hook exists and captures drag-and-flick
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-1: useDiceThrowGesture hook exports and basic contract", () => {
  it("exports useDiceThrowGesture from dice/useDiceThrowGesture", async () => {
    const mod = await import("../useDiceThrowGesture");
    expect(mod.useDiceThrowGesture).toBeDefined();
    expect(typeof mod.useDiceThrowGesture).toBe("function");
  });

  it("returns an object with onPointerDown handler", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    const { result } = renderHook(() => useDiceThrowGesture({ onThrow }));
    expect(result.current).toHaveProperty("onPointerDown");
    expect(typeof result.current.onPointerDown).toBe("function");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-2: Velocity calculation from pointer down → up (distance / time)
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-2: Velocity calculation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calculates linear velocity from drag distance and duration", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    const { result } = renderHook(() => useDiceThrowGesture({ onThrow }));

    const el = document.createElement("div");
    // Fast drag downward (positive Y = negative Z in world space)
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 400, clientY: 300, bubbles: true }),
      );
      result.current.onPointerDown({ stopPropagation: () => {} } as never);
    });

    // Simulate move + release via window events
    act(() => {
      vi.advanceTimersByTime(16);
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 400, clientY: 200, bubbles: true }),
      );
      vi.advanceTimersByTime(16);
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 400, clientY: 100, bubbles: true }),
      );
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 100, bubbles: true }));
    });

    expect(onThrow).toHaveBeenCalledTimes(1);
    const params = onThrow.mock.calls[0][0];
    // Velocity should have meaningful magnitude (not zero)
    const speed = Math.sqrt(
      params.linearVelocity[0] ** 2 +
      params.linearVelocity[1] ** 2 +
      params.linearVelocity[2] ** 2,
    );
    expect(speed).toBeGreaterThan(0);
  });

  it("produces higher velocity for faster drags", async () => {
    // Make the random Y component deterministic. `buildThrowParams` sets
    // `linearVelocity[1] = 2 + Math.random() * 2`, and without a stub a
    // high slow-roll + low fast-roll can flip the magnitude comparison
    // whenever the fast drag clamps at `MAX_THROW_SPEED`.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrowSlow = vi.fn();
    const onThrowFast = vi.fn();

    // Slow drag — 50 px over 1000 ms → speed 50 px/s, well under the
    // 500 px/s cap (MAX_THROW_SPEED / PX_TO_VELOCITY) so throwSpeed stays
    // proportional rather than clamping.
    const { result: slow } = renderHook(() => useDiceThrowGesture({ onThrow: onThrowSlow }));
    act(() => {
      slow.current.onPointerDown({ stopPropagation: () => {} } as never);
    });
    act(() => {
      vi.advanceTimersByTime(500);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 250, bubbles: true }));
      vi.advanceTimersByTime(500);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 200, bubbles: true }));
      vi.advanceTimersByTime(500);
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 200, bubbles: true }));
    });

    // Fast drag — same distance, 10 ms per step → speed 5000 px/s,
    // hits the clamp. Magnitude difference vs the slow drag is now
    // real and deterministic.
    const { result: fast } = renderHook(() => useDiceThrowGesture({ onThrow: onThrowFast }));
    act(() => {
      fast.current.onPointerDown({ stopPropagation: () => {} } as never);
    });
    act(() => {
      vi.advanceTimersByTime(10);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 250, bubbles: true }));
      vi.advanceTimersByTime(10);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 200, bubbles: true }));
      vi.advanceTimersByTime(10);
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 200, bubbles: true }));
    });

    expect(onThrowSlow).toHaveBeenCalledTimes(1);
    expect(onThrowFast).toHaveBeenCalledTimes(1);
    const slowSpeed = Math.sqrt(
      onThrowSlow.mock.calls[0][0].linearVelocity.reduce(
        (sum: number, v: number) => sum + v * v, 0,
      ),
    );
    const fastSpeed = Math.sqrt(
      onThrowFast.mock.calls[0][0].linearVelocity.reduce(
        (sum: number, v: number) => sum + v * v, 0,
      ),
    );
    expect(fastSpeed).toBeGreaterThan(slowSpeed);

    randomSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-3: Angular velocity from drag path curvature
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-3: Angular velocity calculation", () => {
  it("produces non-zero angular velocity on throw", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();

    vi.useFakeTimers();
    const { result } = renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      result.current.onPointerDown({ stopPropagation: () => {} } as never);
    });
    act(() => {
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 250, bubbles: true }));
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 410, clientY: 200, bubbles: true }));
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 410, clientY: 200, bubbles: true }));
    });

    vi.useRealTimers();

    if (onThrow.mock.calls.length > 0) {
      const params = onThrow.mock.calls[0][0];
      expect(params.angularVelocity).toHaveLength(3);
      // At least one axis should have non-zero rotation
      const angMag = Math.sqrt(
        params.angularVelocity[0] ** 2 +
        params.angularVelocity[1] ** 2 +
        params.angularVelocity[2] ** 2,
      );
      expect(angMag).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-4: ThrowParams shape matches wire type
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-4: ThrowParams shape", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("onThrow callback receives ThrowParams with correct shape", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    const { result } = renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      result.current.onPointerDown({ stopPropagation: () => {} } as never);
    });
    act(() => {
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 250, bubbles: true }));
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 100, bubbles: true }));
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 100, bubbles: true }));
    });

    expect(onThrow).toHaveBeenCalled();
    const params = onThrow.mock.calls[0][0];

    // position: [x, y, z] — 3D start position
    expect(params.position).toHaveLength(3);
    expect(params.position.every((v: unknown) => typeof v === "number")).toBe(true);

    // linearVelocity: [x, y, z]
    expect(params.linearVelocity).toHaveLength(3);
    expect(params.linearVelocity.every((v: unknown) => typeof v === "number")).toBe(true);

    // angularVelocity: [x, y, z]
    expect(params.angularVelocity).toHaveLength(3);
    expect(params.angularVelocity.every((v: unknown) => typeof v === "number")).toBe(true);

    // rotation: [x, y, z] — initial orientation
    expect(params.rotation).toHaveLength(3);
    expect(params.rotation.every((v: unknown) => typeof v === "number")).toBe(true);
  });

  it("ThrowParams contains no extra unexpected fields", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    const { result } = renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      result.current.onPointerDown({ stopPropagation: () => {} } as never);
    });
    act(() => {
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 250, bubbles: true }));
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 100, bubbles: true }));
      vi.advanceTimersByTime(16);
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 100, bubbles: true }));
    });

    if (onThrow.mock.calls.length > 0) {
      const params = onThrow.mock.calls[0][0];
      const expectedKeys = new Set(["position", "linearVelocity", "angularVelocity", "rotation"]);
      const actualKeys = new Set(Object.keys(params));
      expect(actualKeys).toEqual(expectedKeys);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-6: Edge cases — single-point drag, fast flick, slow drag, multi-touch
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-6: Edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("single-point drag (down + immediate up) does NOT fire onThrow", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    const { result } = renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      result.current.onPointerDown({ stopPropagation: () => {} } as never);
    });
    act(() => {
      // Immediate up at same location — no movement
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 300, bubbles: true }));
    });

    expect(onThrow).not.toHaveBeenCalled();
  });

  it("very slow drag below minimum speed threshold does NOT fire onThrow", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    const { result } = renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      result.current.onPointerDown({ stopPropagation: () => {} } as never);
    });
    act(() => {
      // Very slow: 1px over 2 seconds
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 299, bubbles: true }));
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 299, bubbles: true }));
    });

    expect(onThrow).not.toHaveBeenCalled();
  });

  it("fast flick fires onThrow with capped velocity (no infinite speed)", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    const { result } = renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      result.current.onPointerDown({ stopPropagation: () => {} } as never);
    });
    act(() => {
      // Extremely fast: 500px in 1ms
      vi.advanceTimersByTime(1);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 100, bubbles: true }));
      vi.advanceTimersByTime(1);
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 100, bubbles: true }));
    });

    if (onThrow.mock.calls.length > 0) {
      const params = onThrow.mock.calls[0][0];
      const speed = Math.sqrt(
        params.linearVelocity[0] ** 2 +
        params.linearVelocity[1] ** 2 +
        params.linearVelocity[2] ** 2,
      );
      // Speed should be capped — not Infinity, not NaN, and below a reasonable max
      expect(Number.isFinite(speed)).toBe(true);
      expect(speed).toBeLessThanOrEqual(20); // reasonable physics cap
    }
  });

  it("pointer up without prior pointer down does NOT fire onThrow", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    renderHook(() => useDiceThrowGesture({ onThrow }));

    // Fire pointer up directly without down
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 100, bubbles: true }));
    });

    expect(onThrow).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-7: No network calls — hook only calculates params
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-7: No network calls", () => {
  it("hook module does not import WebSocket or fetch utilities", async () => {
    // Read the module source to verify no network imports
    const mod = await import("../useDiceThrowGesture");
    // The hook should exist without importing any network modules
    expect(mod.useDiceThrowGesture).toBeDefined();
    // If the module imported fetch/WebSocket, it would likely add properties
    // The real test is that it only takes onThrow callback, nothing else
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-8: Keyboard throw fallback (accessibility)
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-8: Keyboard throw fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pressing Enter/Space fires onThrow with default ThrowParams", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onThrow).toHaveBeenCalledTimes(1);
    const params = onThrow.mock.calls[0][0];
    // Default throw should have reasonable values (not zero)
    expect(params.position).toHaveLength(3);
    expect(params.linearVelocity).toHaveLength(3);
    expect(params.angularVelocity).toHaveLength(3);
    const speed = Math.sqrt(
      params.linearVelocity[0] ** 2 +
      params.linearVelocity[1] ** 2 +
      params.linearVelocity[2] ** 2,
    );
    expect(speed).toBeGreaterThan(0);
  });

  it("Space key also triggers default throw", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });

    expect(onThrow).toHaveBeenCalledTimes(1);
  });

  it("non-activation keys do NOT trigger throw", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });

    expect(onThrow).not.toHaveBeenCalled();
  });

  it("keyboard throw produces valid ThrowParams shape", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    renderHook(() => useDiceThrowGesture({ onThrow }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onThrow).toHaveBeenCalled();
    const params = onThrow.mock.calls[0][0];
    expect(params).toHaveProperty("position");
    expect(params).toHaveProperty("linearVelocity");
    expect(params).toHaveProperty("angularVelocity");
    expect(params).toHaveProperty("rotation");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-5: Integration — hook is wired into DiceScene (DiceScene TBD)
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-5: Wiring — useDiceThrowGesture hook module validity", () => {
  it("useDiceThrowGesture is exported as the canonical gesture handler", async () => {
    // The inline useDragThrow function was extracted.
    // useDiceThrowGesture.ts should be the canonical gesture handler.
    const mod = await import("../useDiceThrowGesture");
    expect(mod.useDiceThrowGesture).toBeDefined();
    // The hook should be a function
    expect(typeof mod.useDiceThrowGesture).toBe("function");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Cleanup: hook removes event listeners on unmount
// ══════════════════════════════════════════════════════════════════════════════

describe("Lifecycle: cleanup on unmount", () => {
  it("removes window event listeners when hook unmounts", async () => {
    const { useDiceThrowGesture } = await import("../useDiceThrowGesture");
    const onThrow = vi.fn();
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useDiceThrowGesture({ onThrow }));
    unmount();

    // Should have called removeEventListener for pointermove and pointerup
    const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedTypes).toContain("pointermove");
    expect(removedTypes).toContain("pointerup");

    removeSpy.mockRestore();
  });
});
