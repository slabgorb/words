import { renderCard } from '/shared/cards/card-element.js';

const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];

export function renderOppHand(container, count) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    container.append(renderCard(null, { faceDown: true }));
  }
}

export function renderMyHand(container, hand, selection, { onToggle } = {}) {
  container.innerHTML = '';
  for (const card of hand) {
    const el = renderCard(card);
    if (selection.has(card.id)) el.classList.add('card--selected');
    el.addEventListener('click', () => onToggle?.(card));
    container.append(el);
  }
}

const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3 };
const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i]));

// Sort by suit then rank. Jokers go last.
export function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const aJoker = a.kind === 'joker';
    const bJoker = b.kind === 'joker';
    if (aJoker !== bJoker) return aJoker ? 1 : -1;
    if (aJoker && bJoker) return (a.index ?? 0) - (b.index ?? 0);
    const ds = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    if (ds !== 0) return ds;
    return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
  });
}
