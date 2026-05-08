import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardImageUrl, backImageUrl } from '../public/shared/cards/card-element.js';

test('cardImageUrl maps a natural card to /shared/cards/assets/<suit>-<rank>.jpg', () => {
  assert.equal(
    cardImageUrl({ rank: 'A', suit: 'S' }),
    '/shared/cards/assets/spades-A.jpg',
  );
  assert.equal(
    cardImageUrl({ rank: 'T', suit: 'C' }),
    '/shared/cards/assets/clubs-T.jpg',
  );
});

test('cardImageUrl maps a joker by color', () => {
  assert.equal(
    cardImageUrl({ kind: 'joker', color: 'red', index: 0 }),
    '/shared/cards/assets/joker-red.jpg',
  );
  assert.equal(
    cardImageUrl({ kind: 'joker', color: 'black', index: 1 }),
    '/shared/cards/assets/joker-black.jpg',
  );
});

test('backImageUrl defaults to back_1 and accepts 1..4', () => {
  assert.equal(backImageUrl(), '/shared/cards/assets/back_1.png');
  assert.equal(backImageUrl(1), '/shared/cards/assets/back_1.png');
  assert.equal(backImageUrl(4), '/shared/cards/assets/back_4.png');
});
