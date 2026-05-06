import type { DiceSpec } from "./types";

const SUPPORTED_SIDES = new Set([4, 6, 10, 12, 20]);
const MAX_COUNT = 8;
const NOTATION = /^(\d*)d(\d+)$/i;

export function parseDiceNotation(input: string): DiceSpec {
  const trimmed = input.trim();
  const match = NOTATION.exec(trimmed);
  if (!match) throw new Error(`Invalid dice notation: "${input}"`);

  const countStr = match[1];
  const sidesStr = match[2];

  const count = countStr === "" ? 1 : parseInt(countStr, 10);
  const sides = parseInt(sidesStr, 10);

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(`Invalid dice count in "${input}": must be > 0`);
  }
  if (count > MAX_COUNT) {
    throw new Error(`Invalid dice count in "${input}": must be ≤ ${MAX_COUNT}`);
  }
  if (!SUPPORTED_SIDES.has(sides)) {
    throw new Error(`Unsupported dice sides in "${input}": ${sides}`);
  }

  return { count, sides };
}
