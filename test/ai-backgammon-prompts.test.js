import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoard, pipCount, buildTurnPrompt, parseLlmResponse } from '../plugins/backgammon/server/ai/prompts.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { enumerateLegalMoves } from '../plugins/backgammon/server/ai/legal-moves.js';

function startingBoard() {
  return buildInitialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng: () => 0.5,
  }).board;
}

test('pipCount: returns 167 for each side at the opening position', () => {
  const b = startingBoard();
  assert.equal(pipCount(b, 'a'), 167);
  assert.equal(pipCount(b, 'b'), 167);
});

test('renderBoard: contains both grid rows, bar line, and off line for side A', () => {
  const out = renderBoard(startingBoard(), 'a');
  assert.match(out, /13 14 15 16 17 18 \| 19 20 21 22 23 24/);
  assert.match(out, /12 11 10  9  8  7 \|  6  5  4  3  2  1/);
  assert.match(out, /bar: you=0 +opp=0/);
  assert.match(out, /off: you=0 +opp=0/);
});

test('renderBoard: bot on bar shows in the bar line', () => {
  const b = startingBoard();
  b.barA = 2;
  const out = renderBoard(b, 'a');
  assert.match(out, /bar: you=2 +opp=0/);
});

test('renderBoard: for side B, points are oriented from B perspective', () => {
  // Side B's 24-point is index 23 (A's index 0). Rendering for B should
  // place A's checkers on the equivalent of B's 24-point.
  const out = renderBoard(startingBoard(), 'b');
  // Smoke: contains both rows and the labels.
  assert.match(out, /13 14 15 16 17 18 \| 19 20 21 22 23 24/);
  assert.match(out, /bar: you=0 +opp=0/);
});

function preRollState() {
  const s = buildInitialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng: () => 0.5,
  });
  s.turn.phase = 'pre-roll';
  s.turn.activePlayer = 'a';
  s.activeUserId = 1;
  return s;
}

test('buildTurnPrompt: pre-roll prompt contains header, board, cube state, legal moves, footer', () => {
  const state = preRollState();
  const legalMoves = enumerateLegalMoves(state, 0);
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /You are playing side A/);
  assert.match(prompt, /Pip count/);
  assert.match(prompt, /Cube: 1, unowned/);
  assert.match(prompt, /Legal moves:/);
  assert.match(prompt, /- roll:/);
  assert.match(prompt, /- offer-double:2:/);
  assert.match(prompt, /Respond with a single JSON object/);
});

test('buildTurnPrompt: moving prompt lists dice and sequences', () => {
  const state = preRollState();
  state.turn.phase = 'moving';
  state.turn.dice = { values: [5, 3], remaining: [5, 3], throwParams: [] };
  const legalMoves = enumerateLegalMoves(state, 0);
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /Dice: 5 and 3/);
  assert.match(prompt, /- seq:1:/);
});

test('buildTurnPrompt: doubles roll labelled as four moves', () => {
  const state = preRollState();
  state.turn.phase = 'moving';
  state.turn.dice = { values: [4, 4, 4, 4], remaining: [4, 4, 4, 4], throwParams: [] };
  const legalMoves = enumerateLegalMoves(state, 0);
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /Dice: 4-4 \(doubles, four moves\)/);
});

test('buildTurnPrompt: awaiting-double-response includes offer context', () => {
  const state = preRollState();
  state.turn.phase = 'awaiting-double-response';
  state.cube = { value: 2, owner: 'a', pendingOffer: { from: 'b' } };
  const legalMoves = enumerateLegalMoves(state, 0);
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /Your opponent has offered/);
  assert.match(prompt, /cube would go from 2 to 4/);
  assert.match(prompt, /decline you pay 2 points/);
});

test('parseLlmResponse: accepts fenced JSON', () => {
  const r = parseLlmResponse('```json\n{"moveId":"seq:1","banter":"hmm"}\n```');
  assert.equal(r.moveId, 'seq:1');
  assert.equal(r.banter, 'hmm');
});

test('parseLlmResponse: accepts bare JSON with surrounding text', () => {
  const r = parseLlmResponse('Sure. {"moveId":"roll","banter":""} done.');
  assert.equal(r.moveId, 'roll');
  assert.equal(r.banter, '');
});

test('parseLlmResponse: rejects missing moveId', () => {
  assert.throws(() => parseLlmResponse('{"banter":"x"}'), /missing moveId/);
});

test('parseLlmResponse: defaults banter to empty string when non-string', () => {
  const r = parseLlmResponse('{"moveId":"roll","banter":42}');
  assert.equal(r.banter, '');
});

test('parseLlmResponse: rejects malformed JSON', () => {
  assert.throws(() => parseLlmResponse('not json'), /no JSON object found/);
});
