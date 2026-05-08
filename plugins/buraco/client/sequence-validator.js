const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
const RANK_INDEX = Object.fromEntries(RANKS.map((r, i) => [r, i]));

export function canLay(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;
  const naturals = cards.filter(c => c.kind !== 'joker' && !c.representsRank);
  if (naturals.length === 0) return false;
  const suit = naturals[0].suit;
  for (const c of naturals) if (c.suit !== suit) return false;

  const wildCount = cards.filter(c =>
    c.kind === 'joker' || c.representsRank || (c.rank === '2' && c.suit !== suit)
  ).length;
  if (wildCount > 1) return false;

  const ranks = cards.map(c => c.representsRank ?? c.rank);
  const tryAt = (aceIdx) => {
    const idx = ranks.map(r => r === 'A' ? aceIdx : RANK_INDEX[r]).sort((a, b) => a - b);
    for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1] + 1) return false;
    return true;
  };
  return tryAt(0) || tryAt(13);
}
