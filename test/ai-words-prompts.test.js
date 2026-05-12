import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnPrompt, parseLlmResponse } from '../plugins/words/server/ai/prompts.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function state() {
  const s = buildInitialState({
    participants: [{userId:1,side:'a'},{userId:2,side:'b'}],
    rng: det(),
  });
  s.scores = { a: 14, b: 22 };
  s.racks.a = ['A','E','I','R','S','T','Z'];
  return s;
}

const shortlist = [
  { id: 'top-score', slot: 'top-score', action: { type: 'move', payload: { placement: [] } }, summary: 'ZESTIER 8H→8N; 86 pts; leaves nothing' },
  { id: 'best-leave', slot: 'best-leave', action: { type: 'move', payload: { placement: [] } }, summary: 'ZITS 4F→4I; 28 pts; saves AERS' },
];

test('buildTurnPrompt: includes score, bag count, rack, and every slot id with its summary', () => {
  const p = buildTurnPrompt({ state: state(), shortlist, botSide: 'a' });
  assert.match(p, /Score: you 14/);
  assert.match(p, /opponent 22/);
  assert.match(p, /Your rack: A E I R S T Z/);
  assert.match(p, /top-score: ZESTIER/);
  assert.match(p, /best-leave: ZITS/);
  assert.match(p, /Respond with a single JSON object/);
});

test('buildTurnPrompt: renders a 15-row ASCII board with column letters and row numbers', () => {
  const p = buildTurnPrompt({ state: state(), shortlist, botSide: 'a' });
  // Column header has A through O.
  assert.match(p, /A\s+B\s+C\s+D\s+E\s+F\s+G\s+H\s+I\s+J\s+K\s+L\s+M\s+N\s+O/);
  // Row labels 1 and 15 are present.
  assert.match(p, /\b1\b/);
  assert.match(p, /\b15\b/);
});

test('parseLlmResponse: accepts a bare JSON object', () => {
  const out = parseLlmResponse('{"moveId":"top-score","banter":"clack clack"}');
  assert.equal(out.moveId, 'top-score');
  assert.equal(out.banter, 'clack clack');
});

test('parseLlmResponse: accepts a fenced JSON block', () => {
  const text = 'Sure, here is my pick:\n```json\n{"moveId":"best-leave","banter":""}\n```';
  const out = parseLlmResponse(text);
  assert.equal(out.moveId, 'best-leave');
  assert.equal(out.banter, '');
});

test('parseLlmResponse: rejects missing moveId', () => {
  assert.throws(() => parseLlmResponse('{"banter":"hi"}'), /moveId/);
});

test('parseLlmResponse: rejects malformed JSON', () => {
  assert.throws(() => parseLlmResponse('not json at all'), /no JSON|valid JSON/);
});
