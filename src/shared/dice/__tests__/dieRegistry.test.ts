import { describe, it, expect } from "vitest";
import { DIE_REGISTRY, dieKindForSides } from "../dieRegistry";

describe("dieRegistry", () => {
  it("has entries for d4, d6, d10, d12, d20", () => {
    expect(DIE_REGISTRY.d4).toBeDefined();
    expect(DIE_REGISTRY.d6).toBeDefined();
    expect(DIE_REGISTRY.d10).toBeDefined();
    expect(DIE_REGISTRY.d12).toBeDefined();
    expect(DIE_REGISTRY.d20).toBeDefined();
  });

  it("each entry exposes radius, colliderVertices, readValue", () => {
    for (const kind of ["d4", "d6", "d10", "d12", "d20"] as const) {
      const entry = DIE_REGISTRY[kind];
      expect(typeof entry.radius).toBe("number");
      expect(entry.radius).toBeGreaterThan(0);
      expect(entry.colliderVertices).toBeInstanceOf(Float32Array);
      expect(typeof entry.readValue).toBe("function");
    }
  });

  it("dieKindForSides maps sides → DieKind", () => {
    expect(dieKindForSides(4)).toBe("d4");
    expect(dieKindForSides(6)).toBe("d6");
    expect(dieKindForSides(10)).toBe("d10");
    expect(dieKindForSides(12)).toBe("d12");
    expect(dieKindForSides(20)).toBe("d20");
  });

  it("dieKindForSides throws on unsupported sides", () => {
    expect(() => dieKindForSides(7)).toThrow();
    expect(() => dieKindForSides(100)).toThrow();
  });
});
