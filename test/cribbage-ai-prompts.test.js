import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnPrompt, parseLlmResponse } from '../plugins/cribbage/server/ai/prompts.js';

const CARD = (rank, suit) => ({ rank, suit });

test('buildTurnPrompt: discard phase — includes hand, scores, legal moves with ids', () => {
  const state = {
    phase: 'discard',
    dealer: 1,
    hands: [[CARD('A','H'), CARD('5','H'), CARD('K','D'), CARD('7','S'), CARD('3','C'), CARD('Q','H')], []],
    scores: [12, 19],
    sides: { a:1, b:2 },
  };
  const legalMoves = [
    { id: 'discard:0,1', summary: 'Discard Ace of Hearts and Five of Hearts' },
    { id: 'discard:2,5', summary: 'Discard King of Diamonds and Queen of Hearts' },
  ];
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /phase.*discard/i);
  assert.match(prompt, /your score.*12/i);
  assert.match(prompt, /opponent score.*19/i);
  assert.match(prompt, /your hand/i);
  assert.match(prompt, /Ace of Hearts/);
  assert.match(prompt, /discard:0,1/);
  assert.match(prompt, /discard:2,5/);
  assert.match(prompt, /opponent.*crib|opponent's crib/i);
  assert.match(prompt, /JSON.*moveId.*banter/);
});

test('buildTurnPrompt: pegging phase — shows running total and pile', () => {
  const state = {
    phase: 'pegging',
    hands: [[CARD('5','H'), CARD('2','D')], []],
    scores: [60, 58],
    pegging: { running: 25, history: [CARD('K','C')], pile: [[],[CARD('K','C')]], next: 0 },
    sides: { a:1, b:2 },
  };
  const legal = [{ id: 'play:5H', summary: 'Play Five of Hearts (running 25 → 30)' }];
  const prompt = buildTurnPrompt({ state, legalMoves: legal, botPlayerIdx: 0 });
  assert.match(prompt, /running total.*25/i);
  assert.match(prompt, /play:5H/);
});

test('parseLlmResponse: valid JSON → {moveId, banter}', () => {
  const text = '{"moveId":"play:5H","banter":"There we go."}';
  const r = parseLlmResponse(text);
  assert.deepEqual(r, { moveId: 'play:5H', banter: 'There we go.' });
});

test('parseLlmResponse: JSON inside fenced block → still parsed', () => {
  const text = 'Here you go:\n```json\n{"moveId":"play:5H","banter":""}\n```';
  const r = parseLlmResponse(text);
  assert.equal(r.moveId, 'play:5H');
  assert.equal(r.banter, '');
});

test('parseLlmResponse: missing moveId → throws', () => {
  assert.throws(() => parseLlmResponse('{"banter":"hi"}'), /moveId/);
});

test('parseLlmResponse: not JSON at all → throws', () => {
  assert.throws(() => parseLlmResponse('I will play the five.'), /no JSON/i);
});

test('parseLlmResponse: banter optional, defaults to empty string', () => {
  const r = parseLlmResponse('{"moveId":"next"}');
  assert.equal(r.moveId, 'next');
  assert.equal(r.banter, '');
});
