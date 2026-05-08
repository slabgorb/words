import { renderCard, cardImageUrl } from '/shared/cards/card-element.js';

let selected = []; // array of {rank,suit}

export function clearSelection() { selected = []; }
export function getSelection() { return selected.slice(); }

function sameCard(a, b) { return a.rank === b.rank && a.suit === b.suit; }

export function renderMyHand(container, hand, mode, onAction) {
  container.innerHTML = '';
  for (const card of hand) {
    const el = renderCard(card);
    const isSelected = selected.some(s => sameCard(s, card));
    if (isSelected) el.classList.add('is-selected');
    el.addEventListener('click', () => {
      if (mode === 'discard') {
        if (isSelected) {
          selected = selected.filter(s => !sameCard(s, card));
        } else if (selected.length < 2) {
          selected = [...selected, card];
        }
        renderMyHand(container, hand, mode, onAction);
        onAction?.({ type: 'selection-changed', selected });
      } else if (mode === 'pegging') {
        onAction?.({ type: 'play', card });
      }
    });
    container.appendChild(el);
  }
}

export function renderOpponentHand(container, count) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const el = renderCard(null, { faceDown: true });
    container.appendChild(el);
  }
}
