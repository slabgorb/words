import { RANKS, isJoker } from '../../../src/shared/cards/deck.js';

const RANK_INDEX = Object.fromEntries(RANKS.map((r, i) => [r, i]));

function effectiveRank(card) {
  if (card.representsRank) return card.representsRank;
  return card.rank;
}
function effectiveSuit(card) {
  if (card.representsSuit) return card.representsSuit;
  return card.suit;
}

function isWildIn(card, meldSuit) {
  if (isJoker(card)) return true;
  if (card.rank === '2' && card.suit !== meldSuit) return true;
  return false;
}

export function isValidSequence(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  const naturals = cards.filter(c => !isJoker(c) && !c.representsRank);
  if (naturals.length === 0) return false;
  const suit = naturals[0].suit;

  for (const c of naturals) {
    if (c.suit !== suit) return false;
  }

  let wildCount = 0;
  for (const c of cards) {
    if (c.representsRank) wildCount++;
    else if (isWildIn(c, suit)) wildCount++;
  }
  if (wildCount > 1) return false;

  const ranks = cards.map(effectiveRank);
  for (const c of cards) {
    const eSuit = effectiveSuit(c);
    if (eSuit !== suit) return false;
  }

  function tryIndices(aceIndex) {
    const idx = ranks.map(r => r === 'A' ? aceIndex : RANK_INDEX[r]);
    const sorted = [...idx].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) return false;
    }
    return true;
  }

  return tryIndices(0) || tryIndices(13);
}

const POINT_VALUE = {
  A: 15, '2': 20, '3': 5, '4': 5, '5': 5, '6': 5, '7': 5,
  '8': 10, '9': 10, T: 10, J: 10, Q: 10, K: 10,
};

export function sequencePoints(cards) {
  let total = 0;
  for (const c of cards) {
    if (isJoker(c)) total += 20;
    else total += POINT_VALUE[c.rank] ?? 0;
  }
  return total;
}

function hasWild(cards) {
  return cards.some(c => c.representsRank || isJoker(c));
}

export function isBuracoLimpo(cards) {
  if (!isValidSequence(cards)) return false;
  if (cards.length < 7) return false;
  return !hasWild(cards);
}

export function isBuracoSujo(cards) {
  if (!isValidSequence(cards)) return false;
  if (cards.length < 7) return false;
  return hasWild(cards);
}
