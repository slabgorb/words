const SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

export function cardImageUrl(card) {
  return `assets/cards/${SUIT_NAME[card.suit]}-${card.rank}.jpg`;
}

export function backImageUrl(n = 5) {
  return `assets/cards/back-${n}.jpg`;
}

export function renderCard(card, { faceDown = false, draggable = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (faceDown ? ' card--back' : '');
  el.style.backgroundImage = `url(${faceDown ? backImageUrl() : cardImageUrl(card)})`;
  if (!faceDown) {
    el.dataset.rank = card.rank;
    el.dataset.suit = card.suit;
  }
  if (draggable) el.tabIndex = 0;
  return el;
}
