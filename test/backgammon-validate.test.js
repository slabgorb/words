import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateLegalMoves, isLegalMove, legalFirstMoves, maxConsumableDice } from '../plugins/backgammon/server/validate.js';

function emptyBoard() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  return { points, barA: 0, barB: 0, bornOffA: 0, bornOffB: 0 };
}

test('A on bar: only bar-entry moves are legal', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[0] = { color: 'a', count: 2 };  // checker also on 24-point — irrelevant while barred
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  // Only entries onto indices 2 (die=3) and 4 (die=5)
  const entries = moves.filter(m => m.from === 'bar');
  assert.equal(entries.length, 2);
  assert.ok(entries.some(m => m.to === 2 && m.die === 3));
  assert.ok(entries.some(m => m.to === 4 && m.die === 5));
  // No point-to-point moves
  assert.equal(moves.length, 2);
});

test('A on bar: blocked entry points reject', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 2 };  // blocks die=3 entry
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  // Only die=5 entry (onto index 4) is legal.
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0], { from: 'bar', to: 4, die: 5 });
});

test('B on bar: enters into A home, die=4 onto index 20', () => {
  const b = emptyBoard();
  b.barB = 1;
  const moves = enumerateLegalMoves(b, [4, 6], 'b');
  // die=4 → 20, die=6 → 18
  assert.ok(moves.some(m => m.from === 'bar' && m.to === 20 && m.die === 4));
  assert.ok(moves.some(m => m.from === 'bar' && m.to === 18 && m.die === 6));
  assert.equal(moves.length, 2);
});

test('A on bar with NO legal entry: returns empty list', () => {
  const b = emptyBoard();
  b.barA = 1;
  for (let i = 0; i < 6; i++) b.points[i] = { color: 'b', count: 2 };
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  assert.deepEqual(moves, []);
});

test('isLegalMove: A bar entry onto blot is legal', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 1 };  // blot
  assert.equal(isLegalMove(b, [3], 'a', 'bar', 2), true);
});

test('isLegalMove: A bar entry onto blocked point is illegal', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 2 };
  assert.equal(isLegalMove(b, [3], 'a', 'bar', 2), false);
});

test('isLegalMove: A point-to-point illegal while on bar', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[10] = { color: 'a', count: 2 };
  assert.equal(isLegalMove(b, [3], 'a', 10, 13), false);
});

test('A point-to-point: legal onto empty point', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  assert.ok(moves.some(m => m.from === 0 && m.to === 3 && m.die === 3));
  assert.ok(moves.some(m => m.from === 0 && m.to === 5 && m.die === 5));
});

test('A point-to-point: legal onto own stack', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  b.points[3] = { color: 'a', count: 4 };
  const moves = enumerateLegalMoves(b, [3], 'a');
  assert.ok(moves.some(m => m.from === 0 && m.to === 3 && m.die === 3));
});

test('A point-to-point: legal onto opponent blot', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  b.points[3] = { color: 'b', count: 1 };
  const moves = enumerateLegalMoves(b, [3], 'a');
  assert.ok(moves.some(m => m.from === 0 && m.to === 3 && m.die === 3));
});

test('A point-to-point: blocked by 2+ opponents', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  b.points[3] = { color: 'b', count: 2 };
  const moves = enumerateLegalMoves(b, [3], 'a');
  assert.equal(moves.length, 0);
});

test('B point-to-point: moves toward lower indices', () => {
  const b = emptyBoard();
  b.points[23] = { color: 'b', count: 2 };
  const moves = enumerateLegalMoves(b, [3, 5], 'b');
  assert.ok(moves.some(m => m.from === 23 && m.to === 20 && m.die === 3));
  assert.ok(moves.some(m => m.from === 23 && m.to === 18 && m.die === 5));
});

test('point-to-point: cannot move from a point you do not own', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'b', count: 1 };  // B blot
  const moves = enumerateLegalMoves(b, [3], 'a');
  assert.equal(moves.length, 0);
});

test('point-to-point: cannot move past board edge before bearing off', () => {
  const b = emptyBoard();
  // A has only 1 checker, on index 22. die=5 → 27 OOB (point-to-point skipped).
  // A is not all-in-home (total checkers != 15), so bear-off remains illegal
  // when Task 8 adds it — this test stays valid through later tasks.
  b.points[22] = { color: 'a', count: 1 };
  const moves = enumerateLegalMoves(b, [5], 'a');
  assert.equal(moves.length, 0);
});

test('point-to-point: enumerateLegalMoves dedupes by from/to/die triple', () => {
  // Same die value present twice in remaining (non-doubles edge): two checkers
  // on same point should still produce a single (from,to,die) entry.
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  const moves = enumerateLegalMoves(b, [3, 3], 'a');  // doubles' remaining
  const fromZeroDieThree = moves.filter(m => m.from === 0 && m.to === 3 && m.die === 3);
  assert.equal(fromZeroDieThree.length, 1);
});

test('legalFirstMoves: when both dice usable, raw enumeration returned', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  const all = enumerateLegalMoves(b, [3, 5], 'a');
  const first = legalFirstMoves(b, [3, 5], 'a');
  // First move can use either die; both should remain in the candidate set.
  assert.ok(first.some(m => m.die === 3));
  assert.ok(first.some(m => m.die === 5));
  // No move dropped vs raw enumeration.
  assert.equal(first.length, all.length);
});

test('legalFirstMoves: when only one die usable, only that die survives', () => {
  // A is on bar; only die=5 enters legally (die=3 blocked).
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 2 };  // blocks die=3 entry
  // After entry on die=5, A still on bar? No — bar count 1, entry empties bar.
  // But other dice can't be used point-to-point if there are no A checkers
  // anywhere (we only set barA=1).
  const first = legalFirstMoves(b, [3, 5], 'a');
  assert.equal(first.length, 1);
  assert.equal(first[0].die, 5);
});

test('legalFirstMoves: higher-die rule when only one die playable from start', () => {
  // Construct: A has one checker on index 0. Roll [3, 5].
  // - die=3 → index 3 (legal, empty)
  // - die=5 → index 5 (legal, empty)
  // - But after moving die=3 first to index 3, die=5 from index 3 → index 8 (legal).
  // - And after moving die=5 first to index 5, die=3 from index 5 → index 8 (legal).
  // So both dice usable in sequence — both individual moves remain legal.
  // To force higher-die rule, block the second-step dest:
  // A on index 0 (count 1). Block index 8 (b count 2). Block second-step destinations.
  // Easier: A on index 19. Roll [3, 5]. die=3 → index 22 (legal). die=5 → index 24 (off, but home check fails).
  // Skip bear-off; use pure higher-die scenario:
  // A on index 0, only one A checker; B blocks indices 3, 8 with 2 stacks each;
  // index 5 empty (legal). die=3 blocked, die=5 legal — can only use one.
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  b.points[3] = { color: 'b', count: 2 };
  b.points[8] = { color: 'b', count: 2 };
  // Verify our scenario in the absence of the rule:
  // raw enumeration: only {0→5, die=5}.
  const raw = enumerateLegalMoves(b, [3, 5], 'a');
  assert.deepEqual(raw, [{ from: 0, to: 5, die: 5 }]);
  // Higher-die rule: same — only die=5 was usable to begin with.
  const first = legalFirstMoves(b, [3, 5], 'a');
  assert.deepEqual(first, [{ from: 0, to: 5, die: 5 }]);
});

test('legalFirstMoves: both individually playable but not both in sequence — higher-die wins', () => {
  // A on index 18 (count 1). B blocks index 21 (the only die=3 dest from 18). B blocks index 23 (die=5 dest).
  // Wait — both dests blocked = no moves at all.
  // Try: A on index 0 (count 1). B blocks index 8 (the die=3+5 combined dest).
  // - die=3: 0→3 legal. die=5 from 3 → 8 BLOCKED. So can't sequence 3-then-5.
  // - die=5: 0→5 legal. die=3 from 5 → 8 BLOCKED. So can't sequence 5-then-3.
  // - Either single move alone is legal; neither sequence is.
  // K = 1 (only one die consumable). Both dice individually playable → higher-die mandatory.
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  b.points[8] = { color: 'b', count: 2 };
  const first = legalFirstMoves(b, [3, 5], 'a');
  // Only the die=5 move survives.
  assert.equal(first.length, 1);
  assert.equal(first[0].die, 5);
  assert.equal(first[0].from, 0);
  assert.equal(first[0].to, 5);
});

test('maxConsumableDice: 2 when sequence exists', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  assert.equal(maxConsumableDice(b, [3, 5], 'a'), 2);
});

test('maxConsumableDice: 1 when only one die usable', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  b.points[8] = { color: 'b', count: 2 };
  assert.equal(maxConsumableDice(b, [3, 5], 'a'), 1);
});

test('maxConsumableDice: 0 when no moves at all', () => {
  const b = emptyBoard();
  b.barA = 1;
  for (let i = 0; i < 6; i++) b.points[i] = { color: 'b', count: 2 };
  assert.equal(maxConsumableDice(b, [3, 5], 'a'), 0);
});

test('maxConsumableDice: doubles count of 4 when fully playable', () => {
  // A has 4 checkers on index 0; doubles [3,3,3,3]; each onto index 3 then 6 then 9 etc.
  // Simpler: 4 separate A checkers — one on 0, 3, 6, 9 — each can step +3.
  const b = emptyBoard();
  b.points[0]  = { color: 'a', count: 1 };
  b.points[3]  = { color: 'a', count: 0 };  // overwritten by move
  // Build 4 disjoint chains: 0→3, 3→6 (after first), 6→9, 9→12.
  // Easier: 4 checkers stacked on 0, all step +3 onto a long empty lane.
  b.points[0] = { color: 'a', count: 4 };
  assert.equal(maxConsumableDice(b, [3, 3, 3, 3], 'a'), 4);
});
