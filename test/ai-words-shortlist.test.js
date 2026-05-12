import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShortlist } from '../plugins/words/server/ai/shortlist.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function emptyState(variant = 'wwf') {
  return buildInitialState({
    participants: [{userId:1,side:'a'},{userId:2,side:'b'}],
    rng: det(),
    variant,
  });
}

test('buildShortlist: empty rack → pass-only shortlist', () => {
  const state = emptyState();
  state.racks.a = [];
  const list = buildShortlist(state, 'a');
  assert.equal(list.length, 1);
  assert.equal(list[0].slot, 'pass');
  assert.equal(list[0].action.type, 'pass');
});

test('buildShortlist: typical opening rack produces ≥1 top-score play', () => {
  const state = emptyState();
  state.racks.a = ['C','A','T','S','D','O','G'];
  const list = buildShortlist(state, 'a');
  assert.ok(list.length >= 1);
  const top = list.find(e => e.slot === 'top-score');
  assert.ok(top, 'top-score slot present');
  assert.equal(top.action.type, 'move');
  assert.ok(top.action.payload.placement.length > 0);
});

test('buildShortlist: distinct slots have distinct placement signatures', () => {
  const state = emptyState();
  state.racks.a = ['S','L','A','T','I','E','R'];
  const list = buildShortlist(state, 'a');
  const sigs = new Set();
  for (const e of list.filter(e => e.action.type === 'move')) {
    const sig = JSON.stringify(e.action.payload.placement.map(p => [p.r, p.c, p.letter]));
    sigs.add(sig);
  }
  const moveSlots = list.filter(e => e.action.type === 'move');
  assert.equal(sigs.size, moveSlots.length, 'no duplicate signatures across move slots');
});

test('buildShortlist: bingo rack produces a best-bingo slot', () => {
  const state = emptyState();
  state.racks.a = ['S','L','A','T','I','E','R'];
  const list = buildShortlist(state, 'a');
  const bingo = list.find(e => e.slot === 'best-bingo');
  assert.ok(bingo, 'best-bingo slot present for SLATIER-class rack');
  // Bingo plays use all 7 tiles.
  assert.equal(bingo.action.payload.placement.length, 7);
});

test('buildShortlist: weak rack mid-bag includes swap-worst', () => {
  const state = emptyState();
  state.racks.a = ['Q','V','W','X','Z','Y','U'];
  // Plenty of tiles to draw.
  assert.ok(state.bag.length >= 7);
  // Place an anchor so the engine has at least an attempt at plays.
  state.board[7][7] = { letter: 'E', byPlayer: 'b', blank: false };
  state.initialMoveDone = true;
  const list = buildShortlist(state, 'a');
  const swap = list.find(e => e.slot === 'swap-worst');
  assert.ok(swap, `swap-worst slot present when top-score is low; got slots ${list.map(e => e.slot).join(',')}`);
  assert.equal(swap.action.type, 'swap');
  assert.ok(Array.isArray(swap.action.payload.tiles));
  assert.ok(swap.action.payload.tiles.length >= 1);
});

test('buildShortlist: swap omitted when bag < 7', () => {
  const state = emptyState();
  state.racks.a = ['Q','V','W','X','Z','Y','U'];
  state.bag = ['A','B','C']; // 3 left
  state.board[7][7] = { letter: 'E', byPlayer: 'b', blank: false };
  state.initialMoveDone = true;
  const list = buildShortlist(state, 'a');
  const swap = list.find(e => e.slot === 'swap-worst');
  assert.equal(swap, undefined);
});

test('buildShortlist: safe-medium fires when a low-exposure 60–80% play exists', () => {
  // Six-tile rack rules out bingos; with a single 'E' anchor at the center
  // the engine finds OCTAD (16 pts, top-score) and a tidy COG play (10 pts ≈
  // 62% of top, zero exposure) — exactly the safe-medium band.
  const state = emptyState();
  state.racks.a = ['C','A','T','D','O','G'];
  state.board[7][7] = { letter: 'E', byPlayer: 'b', blank: false };
  state.initialMoveDone = true;
  const list = buildShortlist(state, 'a');
  const safe = list.find(e => e.slot === 'safe-medium');
  assert.ok(safe, `safe-medium slot present; got slots ${list.map(e => e.slot).join(',')}`);
  assert.equal(safe.action.type, 'move');
  assert.ok(safe.action.payload.placement.length > 0);
});

test('buildShortlist: best-defense picks a placement distinct from top-score', () => {
  // Mid-game state with a 'B' anchor on row 7: the top-score (BLANDEST
  // through row 8) reaches lots of premium squares, while the best-defense
  // choice (DENTALS on row 9) shifts off the densest premium band. The two
  // slots must have distinct placement signatures.
  const state = emptyState();
  state.racks.a = ['D','E','N','T','A','L','S'];
  state.board[7][5] = { letter: 'B', byPlayer: 'b', blank: false };
  state.initialMoveDone = true;
  const list = buildShortlist(state, 'a');
  const top = list.find(e => e.slot === 'top-score');
  const defense = list.find(e => e.slot === 'best-defense');
  assert.ok(top, 'top-score slot present');
  assert.ok(defense, `best-defense slot present; got slots ${list.map(e => e.slot).join(',')}`);
  const sig = (e) => JSON.stringify(
    e.action.payload.placement.map(p => [p.r, p.c, p.letter]).sort(),
  );
  assert.notEqual(sig(top), sig(defense), 'best-defense placement differs from top-score');
});

test('buildShortlist: every entry has id, action, summary, slot', () => {
  const state = emptyState();
  state.racks.a = ['C','A','T','S','D','O','G'];
  const list = buildShortlist(state, 'a');
  for (const e of list) {
    assert.equal(typeof e.id, 'string');
    assert.ok(e.action && typeof e.action.type === 'string');
    assert.equal(typeof e.summary, 'string');
    assert.equal(typeof e.slot, 'string');
  }
});
