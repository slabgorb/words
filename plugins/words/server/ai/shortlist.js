// Shortlist builder for the Words AI.
//
// Runs the @scrabble-solver engine on the current state, then selects a
// 1–7 entry diverse-slot shortlist for the LLM to choose from. Each entry
// is { id, slot, action, summary }.

import { solve } from '@scrabble-solver/solver';
import { BONUS_CHARACTER, BONUS_WORD } from '@scrabble-solver/constants';
import { getEnableTrie } from './trie.js';
import {
  buildSolverConfig,
  buildSolverBoard,
  buildSolverTiles,
  placementFromResult,
} from './config.js';

// Cap on solver results we enrich/rank. The solver can return thousands of
// plays; the top 50 by score is more than enough to populate the 7 slots
// and bounds per-call CPU.
const TOP_RESULTS_KEEP = 50;
const SWAP_TRIGGER_TOP_SCORE = 12;
// Even when a decent score is available, the bot will offer a swap if its
// best play leaves a rack with very negative retention (heavy/awkward
// letters clogged together). Threshold tuned so QVWZY-class leaves trigger.
const SWAP_TRIGGER_LEAVE_SCORE = -10;
const LEAVE_DEFENSE_TIER_FRACTION = 0.25;
const LEAVE_DEFENSE_TIER_MIN = 3;
// safe-medium slot: plays in the 60–80% of top-score band, where the LLM
// might prefer them for non-score reasons (lower exposure, better leave,
// nicer board shape).
const SAFE_MEDIUM_MIN_RATIO = 0.6;
const SAFE_MEDIUM_MAX_RATIO = 0.8;
// Number of worst-retention tiles offered to the engine when swapping.
const SWAP_TILE_COUNT = 3;

// Per-letter retention weights for leaveScore.
const RETENTION = {
  S: 2, R: 2, T: 2, L: 2, N: 2, E: 2,
  A: 1, I: 1, O: 1,
  Q: -5, J: -2, X: -2, Z: -2, V: -2, W: -1,
  _: 6,
};

const EXPOSURE_VALUE = new Map([
  [`${BONUS_WORD}:3`, 15],
  [`${BONUS_WORD}:2`, 10],
  [`${BONUS_CHARACTER}:3`, 8],
  [`${BONUS_CHARACTER}:2`, 4],
]);

function leaveScore(remaining) {
  let s = 0;
  const counts = {};
  let vowels = 0, consonants = 0;
  for (const letter of remaining) {
    s += RETENTION[letter] ?? 0;
    counts[letter] = (counts[letter] ?? 0) + 1;
    if ('AEIOU'.includes(letter)) vowels++;
    else if (letter !== '_') consonants++;
  }
  // Duplicate penalty: each excess copy beyond two of the same letter is
  // worth -2 (triples and quads are sticky).
  for (const n of Object.values(counts)) if (n > 2) s -= 2 * (n - 2);
  // Vowel/consonant balance: tight balance (diff ≤ 1) is rewarded; a heavy
  // skew (diff ≥ 4) is penalised.
  const diff = Math.abs(vowels - consonants);
  if (diff <= 1) s += 2;
  else if (diff >= 4) s -= 3;
  return s;
}

// scrabble-solver's `result.cells` lists every cell of the full word formed,
// including tiles already on the board that the play extends through. The
// rack-leave and exposure heuristics care only about the NEW tiles — those
// played from the rack this turn — which are exactly the cells where the
// board was previously empty.
function isNewlyPlaced(state, cell) {
  return state.board[cell.y][cell.x] === null;
}

function newlyPlacedCells(state, result) {
  return result.cells.filter((c) => c.tile && isNewlyPlaced(state, c));
}

function buildExposureLookup(config) {
  const map = new Map();
  for (const b of config.bonuses) {
    const key = `${b.type}:${b.multiplier}`;
    const value = EXPOSURE_VALUE.get(key) ?? 0;
    if (value > 0) map.set(`${b.x},${b.y}`, value);
  }
  return map;
}

function exposureScore(state, result, premiums) {
  const newCells = newlyPlacedCells(state, result);
  if (newCells.length === 0) return 0;
  const ys = new Set(newCells.map((c) => c.y));
  const axis = ys.size === 1 ? 'row' : 'col';
  const perp = axis === 'row' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
  let s = 0;
  for (const cell of newCells) {
    for (const [dy, dx] of perp) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      const value = premiums.get(`${nx},${ny}`);
      if (value) s += value;
    }
  }
  return s;
}

function remainingAfter(rack, newCells) {
  const r = rack.slice();
  for (const cell of newCells) {
    const want = cell.tile.isBlank ? '_' : cell.tile.character;
    const idx = r.indexOf(want);
    if (idx >= 0) r.splice(idx, 1);
  }
  return r;
}

function placementSignature(state, result) {
  return newlyPlacedCells(state, result)
    .map((c) => `${c.y}:${c.x}:${c.tile.character}:${c.tile.isBlank ? 'b' : ''}`)
    .sort()
    .join('|');
}

function coord(cell) {
  const col = String.fromCharCode('A'.charCodeAt(0) + cell.x);
  return `${cell.y + 1}${col}`;
}

function pickSwapTiles(rack) {
  return rack.slice()
    .sort((a, b) => (RETENTION[a] ?? 0) - (RETENTION[b] ?? 0))
    .slice(0, SWAP_TILE_COUNT);
}

export function buildShortlist(state, botSide) {
  const rack = state.racks[botSide];
  if (!rack || rack.length === 0) {
    return [{
      id: 'pass',
      slot: 'pass',
      action: { type: 'pass' },
      summary: 'no tiles in rack — pass',
    }];
  }

  const trie = getEnableTrie();
  const config = buildSolverConfig(state.variant);
  const board = buildSolverBoard(state);
  const tiles = buildSolverTiles(rack);

  let results;
  try {
    results = solve(trie, config, board, tiles);
  } catch {
    results = [];
  }

  if (!results || results.length === 0) {
    return [{
      id: 'pass',
      slot: 'pass',
      action: { type: 'pass' },
      summary: 'no legal play available — pass',
    }];
  }

  results.sort((a, b) => b.points - a.points);
  const top = results.slice(0, TOP_RESULTS_KEEP);

  const premiums = buildExposureLookup(config);
  const enriched = top.map((r) => {
    const newCells = newlyPlacedCells(state, r);
    const leave = remainingAfter(rack, newCells);
    return {
      result: r,
      newCells,
      leave,
      leaveScore: leaveScore(leave),
      exposure: exposureScore(state, r, premiums),
      sig: placementSignature(state, r),
      isBingo: newCells.length === 7,
    };
  });

  const slots = [];
  const used = new Set();

  function take(entry, slotId) {
    if (!entry || used.has(entry.sig)) return false;
    used.add(entry.sig);
    const word = entry.result.cells.map((c) => c.tile?.character ?? '?').join('');
    const first = entry.result.cells[0];
    const last = entry.result.cells[entry.result.cells.length - 1];
    const range = `${coord(first)}→${coord(last)}`;
    const leaveStr = entry.leave.length ? entry.leave.join('') : 'nothing';
    const bingoMark = entry.isBingo ? '; bingo' : '';
    slots.push({
      id: slotId,
      slot: slotId,
      action: placementFromResult(entry.result),
      summary: `${word} ${range}; ${entry.result.points} pts${bingoMark}; leaves ${leaveStr}`,
    });
    return true;
  }

  take(enriched[0], 'top-score');

  // Best bingo: highest-points 7-tile play. If the top-score is itself a
  // bingo (sig already used), fall through to the next-best bingo with a
  // distinct placement so the slot stays informative.
  const bingoCandidate = enriched.find((e) => e.isBingo && !used.has(e.sig));
  if (bingoCandidate) take(bingoCandidate, 'best-bingo');

  const tierSize = Math.max(
    LEAVE_DEFENSE_TIER_MIN,
    Math.ceil(enriched.length * LEAVE_DEFENSE_TIER_FRACTION),
  );
  const tier = enriched.slice(0, tierSize);
  const bestLeave = tier.slice().sort((a, b) => b.leaveScore - a.leaveScore)[0];
  take(bestLeave, 'best-leave');
  const bestDefense = tier.slice().sort((a, b) => a.exposure - b.exposure)[0];
  take(bestDefense, 'best-defense');

  const topPts = enriched[0].result.points;
  const safe = enriched
    .filter((e) => e.result.points >= topPts * SAFE_MEDIUM_MIN_RATIO
      && e.result.points <= topPts * SAFE_MEDIUM_MAX_RATIO
      && e.exposure === 0)
    .sort((a, b) => b.leaveScore - a.leaveScore)[0];
  take(safe, 'safe-medium');

  const bestLeaveScore = enriched[0].leaveScore;
  const swapWorthwhile = topPts < SWAP_TRIGGER_TOP_SCORE
    || bestLeaveScore <= SWAP_TRIGGER_LEAVE_SCORE;
  if (state.bag.length >= 7 && swapWorthwhile) {
    const tilesToSwap = pickSwapTiles(rack);
    if (tilesToSwap.length > 0) {
      slots.push({
        id: 'swap-worst',
        slot: 'swap-worst',
        action: { type: 'swap', payload: { tiles: tilesToSwap } },
        summary: `swap ${tilesToSwap.join('')}; bag=${state.bag.length}`,
      });
    }
  }

  return slots;
}
