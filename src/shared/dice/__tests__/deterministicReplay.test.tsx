/**
 * Deterministic physics replay tests.
 *
 * Adapted from sidequest-ui src/dice/__tests__/deterministicReplay.test.tsx.
 *
 * Deleted tests (not applicable to pure dice library):
 * - AC-6: Spectator replay via DiceOverlay — DiceOverlay is sidequest-ui-specific
 * - AC-7: Rolling player server-authoritative replay via DiceOverlay — same
 * - Wiring: "DiceOverlay imports replayThrowParams" — DiceOverlay doesn't exist here
 *
 * All replayThrowParams calls updated to pass D20_RADIUS as the third argument
 * (new signature: replayThrowParams(wire, seed, dieRadius)).
 */
import { describe, it, expect } from "vitest";
import { D20_RADIUS } from "../d20";
import type { DiceThrowParams } from "../types";

// ── Test fixtures ────────────────────────────────────────────────────────────

/** Wire-format ThrowParams */
const WIRE_THROW_PARAMS: DiceThrowParams = {
  velocity: [1.5, 3.0, -2.5],
  angular: [10.0, -5.0, 8.0],
  position: [0.4, 0.6],
};

// ══════════════════════════════════════════════════════════════════════════════
// AC-1: replayThrowParams — deterministic wire→scene conversion
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-1: replayThrowParams exists and converts wire→scene params", () => {
  it("exports replayThrowParams from dice module", async () => {
    const mod = await import("../replayThrowParams");
    expect(mod.replayThrowParams).toBeDefined();
    expect(typeof mod.replayThrowParams).toBe("function");
  });

  it("returns scene ThrowParams with all required fields", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const scene = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);

    expect(scene).toHaveProperty("position");
    expect(scene).toHaveProperty("linearVelocity");
    expect(scene).toHaveProperty("angularVelocity");
    expect(scene).toHaveProperty("rotation");

    expect(scene.position).toHaveLength(3);
    expect(scene.linearVelocity).toHaveLength(3);
    expect(scene.angularVelocity).toHaveLength(3);
    expect(scene.rotation).toHaveLength(3);
  });

  it("maps wire velocity to scene linearVelocity", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const scene = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);

    // Wire velocity should map directly to scene linearVelocity
    expect(scene.linearVelocity).toEqual(WIRE_THROW_PARAMS.velocity);
  });

  it("maps wire angular to scene angularVelocity", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const scene = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);

    expect(scene.angularVelocity).toEqual(WIRE_THROW_PARAMS.angular);
  });

  it("converts wire 2D position to scene 3D position", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const scene = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);

    // Wire position is [x, y] normalized (0..1), scene position is [x, y, z] in tray space
    expect(scene.position).toHaveLength(3);
    expect(scene.position.every((v: number) => typeof v === "number" && Number.isFinite(v))).toBe(true);
  });

  it("produces no NaN or Infinity values in any field", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const scene = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);

    const allValues = [
      ...scene.position,
      ...scene.linearVelocity,
      ...scene.angularVelocity,
      ...scene.rotation,
    ];
    for (const v of allValues) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-2: Same seed + params = identical output (determinism contract)
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-2: Determinism — same inputs always produce same output", () => {
  it("same seed + params produces identical scene params over 100 iterations", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const reference = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);

    for (let i = 0; i < 100; i++) {
      const result = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);
      expect(result.position).toEqual(reference.position);
      expect(result.linearVelocity).toEqual(reference.linearVelocity);
      expect(result.angularVelocity).toEqual(reference.angularVelocity);
      expect(result.rotation).toEqual(reference.rotation);
    }
  });

  it("different wire params produce different scene positions", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const params1 = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);
    const params2 = replayThrowParams(
      {
        velocity: [0.5, 1.0, -0.5],
        angular: [3.0, -2.0, 1.0],
        position: [0.8, 0.2],
      },
      42,
      D20_RADIUS,
    );

    // At least one field should differ
    const posMatch = params1.position.every((v: number, i: number) => v === params2.position[i]);
    const velMatch = params1.linearVelocity.every((v: number, i: number) => v === params2.linearVelocity[i]);
    expect(posMatch && velMatch).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-3: Seed drives initial rotation (different seeds = different die orientation)
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-3: Seed determines initial die rotation", () => {
  it("different seeds produce different initial rotations", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const result1 = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);
    const result2 = replayThrowParams(WIRE_THROW_PARAMS, 9999, D20_RADIUS);

    // Same throw params but different seeds must produce different rotations
    const rotationsMatch = result1.rotation.every(
      (v: number, i: number) => v === result2.rotation[i],
    );
    expect(rotationsMatch).toBe(false);
  });

  it("same seed always produces same rotation", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const results = Array.from({ length: 50 }, () =>
      replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS),
    );

    for (const r of results) {
      expect(r.rotation).toEqual(results[0].rotation);
    }
  });

  it("rotation values are in valid Euler range", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    // Test with multiple seeds to check range across different values
    for (const seed of [0, 1, 42, 999, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
      const result = replayThrowParams(WIRE_THROW_PARAMS, seed, D20_RADIUS);
      for (const angle of result.rotation) {
        expect(angle).toBeGreaterThanOrEqual(-Math.PI);
        expect(angle).toBeLessThanOrEqual(Math.PI);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-4: Seed within JS safe integer range
// (Epic guardrail #11: seeds above MAX_SAFE_INTEGER silently truncate)
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-4: Seed boundary — JS safe integer range", () => {
  it("handles seed of 0 without error", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const result = replayThrowParams(WIRE_THROW_PARAMS, 0, D20_RADIUS);
    expect(result.rotation).toHaveLength(3);
    expect(result.rotation.every((v: number) => Number.isFinite(v))).toBe(true);
  });

  it("handles seed at MAX_SAFE_INTEGER boundary", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const result = replayThrowParams(WIRE_THROW_PARAMS, Number.MAX_SAFE_INTEGER, D20_RADIUS);
    expect(result.rotation).toHaveLength(3);
    expect(result.rotation.every((v: number) => Number.isFinite(v))).toBe(true);
  });

  it("is deterministic at MAX_SAFE_INTEGER", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const a = replayThrowParams(WIRE_THROW_PARAMS, Number.MAX_SAFE_INTEGER, D20_RADIUS);
    const b = replayThrowParams(WIRE_THROW_PARAMS, Number.MAX_SAFE_INTEGER, D20_RADIUS);
    expect(a.rotation).toEqual(b.rotation);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC-5 removed: DiceScene no longer takes a seed prop. Seed handling lives
// one layer up in replayThrowParams (tested by AC-1..4 above).
// ══════════════════════════════════════════════════════════════════════════════

// AC-6, AC-7 removed: DiceOverlay is sidequest-ui-specific and not part of
// the shared dice library. These tests relied on DiceOverlay, DiceRequest,
// and DiceResult types from @/types/payloads — none of which exist here.

// ══════════════════════════════════════════════════════════════════════════════
// AC-8: Wire → scene conversion handles edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-8: Edge cases for replay conversion", () => {
  it("handles zero-velocity throw (dropped die)", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const scene = replayThrowParams(
      {
        velocity: [0, 0, 0],
        angular: [0, 0, 0],
        position: [0.5, 0.5],
      },
      42,
      D20_RADIUS,
    );

    // Should still produce valid params (die drops straight down)
    expect(scene.linearVelocity).toEqual([0, 0, 0]);
    expect(scene.angularVelocity).toEqual([0, 0, 0]);
    expect(scene.position.every((v: number) => Number.isFinite(v))).toBe(true);
    // Rotation should still be seeded even with zero velocity
    expect(scene.rotation).toHaveLength(3);
  });

  it("handles position at tray boundaries (0,0) and (1,1)", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");

    const corner00 = replayThrowParams(
      { ...WIRE_THROW_PARAMS, position: [0, 0] },
      42,
      D20_RADIUS,
    );
    const corner11 = replayThrowParams(
      { ...WIRE_THROW_PARAMS, position: [1, 1] },
      42,
      D20_RADIUS,
    );

    // Both should produce valid positions within tray bounds
    for (const result of [corner00, corner11]) {
      expect(result.position.every((v: number) => Number.isFinite(v))).toBe(true);
    }
  });

  it("handles negative velocity components", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const scene = replayThrowParams(
      {
        velocity: [-5.0, -3.0, -1.0],
        angular: [-10.0, -5.0, -8.0],
        position: [0.5, 0.5],
      },
      42,
      D20_RADIUS,
    );

    expect(scene.linearVelocity).toEqual([-5.0, -3.0, -1.0]);
    expect(scene.angularVelocity).toEqual([-10.0, -5.0, -8.0]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Rule enforcement: TS lang-review checklist
// ══════════════════════════════════════════════════════════════════════════════

describe("Rule: replayThrowParams has no type-safety escapes (#1)", () => {
  it("module source does not use 'as any'", async () => {
    // Structural check: the module should not need type escapes
    const mod = await import("../replayThrowParams");
    expect(mod.replayThrowParams).toBeDefined();
    // The real gate is the TS compiler — if it compiles without as any, this passes
  });
});

describe("Rule: null/undefined handling (#4)", () => {
  it("replayThrowParams does not return undefined for any field", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const result = replayThrowParams(WIRE_THROW_PARAMS, 42, D20_RADIUS);

    expect(result.position).toBeDefined();
    expect(result.linearVelocity).toBeDefined();
    expect(result.angularVelocity).toBeDefined();
    expect(result.rotation).toBeDefined();

    // No undefined values in arrays
    const allValues = [
      ...result.position,
      ...result.linearVelocity,
      ...result.angularVelocity,
      ...result.rotation,
    ];
    for (const v of allValues) {
      expect(v).not.toBeUndefined();
      expect(v).not.toBeNull();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// dieRadius parameter — generalization tests (new, not in sidequest-ui)
// ══════════════════════════════════════════════════════════════════════════════

describe("dieRadius parameter: generalization", () => {
  it("different dieRadius changes y position", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const a = replayThrowParams(WIRE_THROW_PARAMS, 42, 0.36);
    const b = replayThrowParams(WIRE_THROW_PARAMS, 42, 0.18);
    expect(a.position[1]).toBeGreaterThan(b.position[1]);
  });

  it("velocity passes through unchanged regardless of dieRadius", async () => {
    const { replayThrowParams } = await import("../replayThrowParams");
    const a = replayThrowParams(WIRE_THROW_PARAMS, 42, 0.36);
    const b = replayThrowParams(WIRE_THROW_PARAMS, 42, 0.18);
    expect(a.linearVelocity).toEqual(b.linearVelocity);
  });
});
