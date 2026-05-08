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
