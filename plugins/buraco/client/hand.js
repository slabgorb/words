import { renderCard } from '/shared/cards/card-element.js';

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
