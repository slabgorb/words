import { describe, it, expect } from "vitest";
import type { ThrowParams, DiceThrowParams, DieKind } from "../types";

describe("dice types", () => {
  it("ThrowParams has position[3], linearVelocity[3], angularVelocity[3], rotation[3]", () => {
    const p: ThrowParams = {
      position: [0, 0, 0],
      linearVelocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    expect(p.position).toHaveLength(3);
    expect(p.linearVelocity).toHaveLength(3);
    expect(p.angularVelocity).toHaveLength(3);
    expect(p.rotation).toHaveLength(3);
  });

  it("DiceThrowParams has velocity[3], angular[3], position[2]", () => {
    const p: DiceThrowParams = {
      velocity: [0, 0, 0],
      angular: [0, 0, 0],
      position: [0.5, 0.5],
    };
    expect(p.velocity).toHaveLength(3);
    expect(p.angular).toHaveLength(3);
    expect(p.position).toHaveLength(2);
  });

  it("DieKind covers d4, d6, d8, d10, d12, d20", () => {
    const kinds: DieKind[] = ["d4", "d6", "d8", "d10", "d12", "d20"];
    expect(kinds).toHaveLength(6);
  });
});
