export const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
export const SUITS = ['S','H','D','C'];

const PIP = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:10, Q:10, K:10 };
const RUN = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:11, Q:12, K:13 };

export function pipValue(card) { return PIP[card.rank]; }
export function runValue(card) { return RUN[card.rank]; }
export function sameCard(a, b) { return a.rank === b.rank && a.suit === b.suit; }

export function buildDeck() {
  const out = [];
  for (const s of SUITS) for (const r of RANKS) out.push({ rank: r, suit: s });
  return out;
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
