export function cardId(card) {
  if (card.kind === 'joker') return `jk-${card.index}`;
  return `${card.suit}-${card.rank}-${card.deckIndex}`;
}

export function parseCardId(id) {
  const jk = /^jk-(\d+)$/.exec(id);
  if (jk) return { kind: 'joker', index: Number(jk[1]) };
  const nat = /^([SHDC])-([A2-9TJQK]|10)-(\d+)$/.exec(id);
  if (nat) return { kind: 'natural', suit: nat[1], rank: nat[2], deckIndex: Number(nat[3]) };
  throw new Error(`invalid card id: ${id}`);
}

export const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
export const SUITS = ['S','H','D','C'];

export function buildDeck({ decks = 1, jokers = 0 } = {}) {
  if (decks !== 1 && decks !== 2) throw new Error('decks must be 1 or 2');
  if (![0, 2, 4].includes(jokers)) throw new Error('jokers must be 0, 2, or 4');
  const out = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        out.push({
          id: `${suit}-${rank}-${d}`,
          rank, suit, deckIndex: d,
        });
      }
    }
  }
  const colors = ['red', 'black', 'red', 'black'];
  for (let j = 0; j < jokers; j++) {
    out.push({
      id: `jk-${j}`,
      kind: 'joker',
      index: j,
      color: colors[j],
    });
  }
  return out;
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function sameCard(a, b) {
  return a.id === b.id;
}

export function isJoker(card) {
  return card?.kind === 'joker';
}

export function isNaturalTwo(card, meldSuit) {
  if (isJoker(card)) return false;
  return card.rank === '2' && card.suit === meldSuit;
}
