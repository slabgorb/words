// Smoke test for the @scrabble-solver/* and @kamilmielnik/trie deps.
//
// This file is the source of truth for the upstream API shape used by the
// rest of the AI Players — Words plan (Tasks 1–10). The published READMEs
// are skeletal; the assertions and config literal below were validated
// against the type definitions and source under
// node_modules/@scrabble-solver/{solver,types}/build and
// node_modules/@kamilmielnik/trie/build.
//
// Discoveries vs. the task placeholder schema:
//   - Trie API is `trie.has(word)` and `trie.hasPrefix(prefix)`. There is
//     no `hasWord` method.
//   - `solve(trie, config, board, tiles)` takes *instances* of `Config`,
//     `Board`, and `Tile` from @scrabble-solver/types, not raw JSON. It
//     returns ResultJson[]: { cells: CellJson[], collisions, id, points }.
//   - Config is constructed as `new Config(configJson)` where configJson is:
//       { bingo, blankScore, blanksCount, boardHeight, boardWidth,
//         bonuses, game, locale, name, rackSize, tiles }
//     - bingo is { multiplier } | { score } (Scrabble: { score: 50 })
//     - bonuses items are { multiplier, score?, type, x, y } where
//       `type` is 'BONUS_CHARACTER' | 'BONUS_WORD' (NOT the placeholder
//       'word-double' / 'letter-triple' / 'start' strings).
//     - tiles items are TileConfig: { character, count?, score }
//     - locale is an IETF tag (e.g. 'en-US'); game is a Game enum string
//       (e.g. 'scrabble').
//   - Cell JSON shape is { isEmpty, tile: TileJson|null, x, y } — NOT
//     { character, bonus }. Tile JSON shape is { character, isBlank }.
//   - Board is built via `Board.create(width, height)` (or
//     `Board.fromStringArray(rows)`). The opening play must cross the
//     center cell, otherwise no patterns are generated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Trie } from '@kamilmielnik/trie';
import { solve } from '@scrabble-solver/solver';
import { Board, Config, Tile } from '@scrabble-solver/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENABLE_PATH = resolve(__dirname, '..', 'data', 'enable2k.txt');

test('dep smoke: trie loads ENABLE2K and recognises known words', () => {
  const trie = new Trie();
  const words = readFileSync(ENABLE_PATH, 'utf8')
    .split(/\r?\n/)
    .map((w) => w.trim().toUpperCase())
    .filter(Boolean);
  // Sample-load the first 5000 words — the full set is fine but slow on
  // every smoke run. Real trie.js will load the full file.
  for (const w of words.slice(0, 5000)) trie.add(w);
  assert.ok(trie.has(words[0]), `expected trie to contain "${words[0]}"`);
  assert.ok(!trie.has('ZZZZZ'), 'trie must reject non-word ZZZZZ');
  assert.ok(trie.hasPrefix(words[0].slice(0, 2)), 'trie should report prefixes');
});

test('dep smoke: solve() returns scored plays on a one-row opening board', () => {
  // Small trie of guaranteed-legal Scrabble words. All upper-case so the
  // tile characters we feed solve() match the trie's keys exactly.
  const trie = new Trie();
  for (const w of ['CAT', 'DOG', 'HELLO', 'WORD', 'WORDS', 'HI', 'NO', 'IS', 'IT', 'AT', 'TA', 'CA', 'AC'])
    trie.add(w);

  // Standard 15x15 Scrabble config. Only the tile letters we actually use
  // need real entries — we throw in a few more so the solver's alphabet
  // can validate prefixes.
  const config = new Config({
    name: 'smoke-scrabble',
    game: 'scrabble',
    locale: 'en-US',
    boardWidth: 15,
    boardHeight: 15,
    rackSize: 7,
    blanksCount: 2,
    blankScore: 0,
    bingo: { score: 50 },
    bonuses: [], // empty bonus board is fine; opening play still scores
    tiles: [
      { character: 'A', score: 1, count: 9 },
      { character: 'B', score: 3, count: 2 },
      { character: 'C', score: 3, count: 2 },
      { character: 'D', score: 2, count: 4 },
      { character: 'E', score: 1, count: 12 },
      { character: 'G', score: 2, count: 3 },
      { character: 'H', score: 4, count: 2 },
      { character: 'I', score: 1, count: 9 },
      { character: 'L', score: 1, count: 4 },
      { character: 'N', score: 1, count: 6 },
      { character: 'O', score: 1, count: 8 },
      { character: 'R', score: 1, count: 6 },
      { character: 'S', score: 1, count: 4 },
      { character: 'T', score: 1, count: 6 },
      { character: 'W', score: 4, count: 2 },
    ],
  });

  // Empty 15x15 board — Board.create handles cell construction with the
  // correct CellJson-equivalent shape.
  const board = Board.create(15, 15);

  // Rack: C, A, T. Letters are upper-case to match the trie.
  const tiles = [
    new Tile({ character: 'C', isBlank: false }),
    new Tile({ character: 'A', isBlank: false }),
    new Tile({ character: 'T', isBlank: false }),
  ];

  const results = solve(trie, config, board, tiles);
  assert.ok(Array.isArray(results), 'solve returns an array');
  assert.ok(
    results.length > 0,
    `expected at least one legal opening play (CAT/CA/AT/...); got ${results.length}`,
  );

  // Every result has a numeric `points` and an array of placement cells.
  for (const r of results) {
    assert.equal(typeof r.points, 'number', 'result.points must be a number');
    assert.ok(Array.isArray(r.cells), 'result.cells must be an array');
    for (const cell of r.cells) {
      assert.equal(typeof cell.x, 'number');
      assert.equal(typeof cell.y, 'number');
      // cell.tile is TileJson | null: { character, isBlank }
      if (cell.tile !== null) {
        assert.equal(typeof cell.tile.character, 'string');
        assert.equal(typeof cell.tile.isBlank, 'boolean');
      }
    }
  }

  // Sanity: at least one result should spell CAT across the center.
  const words = results.map((r) => r.cells.map((c) => c.tile?.character ?? '').join(''));
  assert.ok(
    words.some((w) => w === 'CAT'),
    `expected CAT among opening plays; got ${words.join(', ')}`,
  );
});
