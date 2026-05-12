import { buildDeck } from '../../../../src/shared/cards/deck.js';
import { pipValue, runValue } from '../values.js';
import { scoreHand } from '../scoring/hand.js';

const RANK_LABEL = { A:'A','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9',T:'T',J:'J',Q:'Q',K:'K' };
const SUIT_GLYPH = { H:'♥', D:'♦', C:'♣', S:'♠' };

function cardKey(c) { return `${c.rank}${c.suit}`; }
function cardLabel(c) { return `${RANK_LABEL[c.rank]}${SUIT_GLYPH[c.suit]}`; }

// V1 crib-value heuristic for a 2-card throw. Captures the well-known
// "5 to your crib good, 5 to opponent's crib bad" intuition without
// modelling the partner's likely throw.
//   - 5 + 5             : strong pair + high fifteen potential
//   - 5 + ten-card      : direct fifteen
//   - matching ranks    : pair
//   - pip sum == 15     : direct fifteen
//   - adjacent runValue : run potential
//   - any 5             : a 5 in the crib is generally welcomed by tens
function cribValueOfPair(c1, c2) {
  const r1 = c1.rank, r2 = c2.rank;
  const p1 = pipValue(c1), p2 = pipValue(c2);
  const isFive = r => r === '5';
  const isTenCard = r => r === 'T' || r === 'J' || r === 'Q' || r === 'K';
  if (isFive(r1) && isFive(r2)) return 6;
  if ((isFive(r1) && isTenCard(r2)) || (isFive(r2) && isTenCard(r1))) return 4;
  if (r1 === r2) return 2;
  if (p1 + p2 === 15) return 2;
  if (Math.abs(runValue(c1) - runValue(c2)) === 1) return 1;
  if (isFive(r1) || isFive(r2)) return 1;
  return 0;
}

// Enumerate the 46-card starter pool (52 - 6 in hand), then average
// scoreHand(keep, starter).total over the pool. Pure & deterministic.
function expectedKeepEV(keep, hand) {
  const inHand = new Set(hand.map(cardKey));
  const pool = buildDeck({ decks: 1, jokers: 0 }).filter(c => !inHand.has(cardKey(c)));
  let total = 0;
  for (const starter of pool) {
    total += scoreHand(keep, starter, { isCrib: false }).total;
  }
  return total / pool.length;
}

function shortRationale(keep, throwPair) {
  const keepStr = keep.map(cardLabel).join(',');
  const throwStr = throwPair.map(cardLabel).join(',');
  return `Keep ${keepStr}; throw ${throwStr}`;
}

// Returns top-N keep/throw splits sorted by total expected value.
// Each candidate has the same id shape as the legal-moves enumerator
// (discard:i,j with i<j) so downstream code is unchanged.
export function scoreDiscardCandidates(hand, { isDealer, topN = 4 } = {}) {
  if (hand.length !== 6) throw new Error(`discard scorer needs 6 cards, got ${hand.length}`);
  const candidates = [];
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const throwPair = [hand[i], hand[j]];
      const keep = hand.filter((_, idx) => idx !== i && idx !== j);
      const keepEV = expectedKeepEV(keep, hand);
      const cribRaw = cribValueOfPair(throwPair[0], throwPair[1]);
      const cribEV = isDealer ? cribRaw : -cribRaw;
      candidates.push({
        id: `discard:${i},${j}`,
        action: { type: 'discard', payload: { cards: throwPair } },
        keepIdx: hand.map((_, idx) => idx).filter(idx => idx !== i && idx !== j),
        throwIdx: [i, j],
        keep,
        throwPair,
        keepEV,
        cribEV,
        totalEV: keepEV + cribEV,
        rationale: shortRationale(keep, throwPair),
      });
    }
  }
  candidates.sort((a, b) => b.totalEV - a.totalEV);
  return candidates.slice(0, topN);
}
