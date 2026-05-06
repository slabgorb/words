import { describe, it, expect } from "vitest";
import { parseDiceNotation } from "../parseDiceNotation";

describe("parseDiceNotation", () => {
  it("parses '2d6' as {count: 2, sides: 6}", () => {
    expect(parseDiceNotation("2d6")).toEqual({ count: 2, sides: 6 });
  });

  it("parses '1d20' as {count: 1, sides: 20}", () => {
    expect(parseDiceNotation("1d20")).toEqual({ count: 1, sides: 20 });
  });

  it("parses '4d4' as {count: 4, sides: 4}", () => {
    expect(parseDiceNotation("4d4")).toEqual({ count: 4, sides: 4 });
  });

  it("treats 'd6' (no count) as count: 1", () => {
    expect(parseDiceNotation("d6")).toEqual({ count: 1, sides: 6 });
  });

  it("is case-insensitive: '2D6' parses the same as '2d6'", () => {
    expect(parseDiceNotation("2D6")).toEqual({ count: 2, sides: 6 });
  });

  it("trims whitespace", () => {
    expect(parseDiceNotation("  2d6  ")).toEqual({ count: 2, sides: 6 });
  });

  it("rejects unsupported sides (e.g. 7 or 8)", () => {
    expect(() => parseDiceNotation("1d7")).toThrow(/unsupported/i);
    expect(() => parseDiceNotation("1d8")).toThrow(/unsupported/i);
  });

  it("rejects malformed input", () => {
    expect(() => parseDiceNotation("hello")).toThrow();
    expect(() => parseDiceNotation("")).toThrow();
    expect(() => parseDiceNotation("2d")).toThrow();
    expect(() => parseDiceNotation("d")).toThrow();
  });

  it("rejects count > 8 (sanity cap)", () => {
    expect(() => parseDiceNotation("9d6")).toThrow(/count/i);
  });

  it("rejects count <= 0", () => {
    expect(() => parseDiceNotation("0d6")).toThrow(/count/i);
  });
});
