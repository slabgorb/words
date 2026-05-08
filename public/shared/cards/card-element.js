const SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAME = {
  A: 'Ace', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five',
  '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine',
  T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King',
};

const ASSET_BASE = '/shared/cards/assets';

export function cardImageUrl(card) {
  if (card?.kind === 'joker') return `${ASSET_BASE}/joker-${card.color}.jpg`;
  return `${ASSET_BASE}/${SUIT_NAME[card.suit]}-${card.rank}.jpg`;
}

export function backImageUrl(n = 1) {
  return `${ASSET_BASE}/back_${n}.png`;
}

// Browser-only DOM renderer. Returns an HTMLDivElement.
export function renderCard(card, { faceDown = false, draggable = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (faceDown ? ' card--back' : '');
  el.style.backgroundImage = `url(${faceDown ? backImageUrl() : cardImageUrl(card)})`;
  if (faceDown) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Face-down card');
  } else if (card?.kind === 'joker') {
    el.classList.add('card--joker');
    el.dataset.kind = 'joker';
    el.dataset.color = card.color;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${card.color} joker`);
  } else {
    el.dataset.rank = card.rank;
    el.dataset.suit = card.suit;
    el.dataset.id = card.id ?? '';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${RANK_NAME[card.rank] ?? card.rank} of ${SUIT_NAME[card.suit] ?? card.suit}`);
  }
  if (draggable) el.tabIndex = 0;
  return el;
}
