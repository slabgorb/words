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
