// Cheap, principled backgammon board evaluation. Higher = better from `side`'s
// perspective. Used to pre-score sequence candidates so the LLM picks for
// style instead of evaluating 10-20 raw move sequences itself.
//
// Weights are hand-tuned defaults inspired by standard backgammon textbooks
// (Robertie, Magriel). Not a neural net; this is a "smart heuristic" pass.

import { pipCount } from './prompts.js';
import { opponent } from '../constants.js';

const BOARD_SIZE = 24;

// Standard 36-roll hit-probability table. Index = distance (in pips).
// Values are the number of dice rolls (out of 36) that hit at exactly
// that distance via either die individually, combined dice, or doubles.
// Distances >12 use a sparse table — long-distance hits are rare.
const HIT_NUM = {
  1: 11, 2: 12, 3: 14, 4: 15, 5: 15, 6: 17,
  7: 6, 8: 6, 9: 5, 10: 3, 11: 2, 12: 3,
  15: 1, 16: 1, 18: 1, 20: 1, 24: 1,
};

function hitProbability(distance) {
  return (HIT_NUM[distance] ?? 0) / 36;
}

// Per-blot hit risk: sum over opponent shooters (with simple compounding
// approximation: subtract product to avoid double-counting). Bar checkers
// have to enter on the opposite home, so their "distance" to my blot is
// 24 - blotIndex (side A) or blotIndex + 1 (side B).
function blotRiskAt(board, side, blotIdx) {
  const opp = opponent(side);
  const oppBar = opp === 'a' ? board.barA : board.barB;
  const probs = [];
  // Direction: opponent moves toward lower indices if opp === 'b' moving
  // toward 0; opp === 'a' moves toward higher indices. So an opponent
  // checker can hit my blot if it has to PASS my blot heading home.
  for (let j = 0; j < BOARD_SIZE; j++) {
    const cell = board.points[j];
    if (cell.color !== opp || cell.count === 0) continue;
    // Side A's blot at blotIdx: opp 'b' moves toward 0, so opp shooters
    // at j > blotIdx threaten it. Distance = j - blotIdx.
    // Side B's blot: opp 'a' moves toward 23, shooters at j < blotIdx
    // threaten it. Distance = blotIdx - j.
    const d = side === 'a' ? (j - blotIdx) : (blotIdx - j);
    if (d <= 0) continue;
    probs.push(hitProbability(d) * cell.count);
  }
  if (oppBar > 0) {
    const d = side === 'a' ? (BOARD_SIZE - blotIdx) : (blotIdx + 1);
    probs.push(hitProbability(d) * oppBar);
  }
  // Compound: 1 - product of (1 - p_i). Cap each at 1 for safety.
  let safe = 1;
  for (const p of probs) safe *= Math.max(0, 1 - Math.min(1, p));
  return 1 - safe;
}

function totalBlotRisk(board, side) {
  let risk = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const cell = board.points[i];
    if (cell.color === side && cell.count === 1) {
      risk += blotRiskAt(board, side, i);
    }
  }
  return risk;
}

// Longest run of consecutive points held (count>=2) by `side`.
function longestPrime(board, side) {
  let longest = 0, current = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const cell = board.points[i];
    if (cell.color === side && cell.count >= 2) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

// Anchors in the opponent's home board (defensive — hard for opponent to
// shape a strong prime against you).
function anchorsInOppHome(board, side) {
  const range = side === 'a' ? [0, 5] : [18, 23];
  let n = 0;
  for (let i = range[0]; i <= range[1]; i++) {
    const c = board.points[i];
    if (c.color === side && c.count >= 2) n++;
  }
  return n;
}

// Own home-board points held (offensive — strong home makes hits expensive
// for the opponent).
function homePointsHeld(board, side) {
  const range = side === 'a' ? [18, 23] : [0, 5];
  let n = 0;
  for (let i = range[0]; i <= range[1]; i++) {
    const c = board.points[i];
    if (c.color === side && c.count >= 2) n++;
  }
  return n;
}

function oppCheckersOnBar(board, side) {
  return side === 'a' ? board.barB : board.barA;
}

// Returns a breakdown for transparency (used by the prompt rationale).
// `total` is the score; higher is better for `side`.
export function evaluateBoard(board, side) {
  const opp = opponent(side);
  const pipDelta = pipCount(board, opp) - pipCount(board, side);
  const risk = totalBlotRisk(board, side);
  const blotPenalty = risk === 0 ? 0 : -8 * risk;        // 8 weight per "expected hit"
  const primeBonus = 2 * longestPrime(board, side);
  const anchorBonus = 6 * anchorsInOppHome(board, side);
  const hitBonus = 8 * oppCheckersOnBar(board, side);
  const homeBoardBonus = 3 * homePointsHeld(board, side);
  const total = pipDelta + blotPenalty + primeBonus + anchorBonus + hitBonus + homeBoardBonus;
  return { pipDelta, blotPenalty, primeBonus, anchorBonus, hitBonus, homeBoardBonus, total };
}
