import { renderCard } from '/shared/cards/card-element.js';

const PIP = { A:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8, 9:9, T:10, J:10, Q:10, K:10 };

export function renderPeggingStrip(container, peg) {
  container.innerHTML = '';
  if (peg.lastTrick && peg.lastTrick.cards?.length) {
    const trick = document.createElement('div');
    trick.className = 'last-trick';
    const label = document.createElement('div');
    label.className = 'last-trick__label';
    label.textContent = peg.lastTrick.kind === '31'
      ? `31 for ${peg.lastTrick.points}`
      : `Go for ${peg.lastTrick.points}`;
    trick.appendChild(label);
    const cards = document.createElement('div');
    cards.className = 'last-trick__cards';
    for (const c of peg.lastTrick.cards) cards.appendChild(renderCard(c));
    trick.appendChild(cards);
    container.appendChild(trick);
  }
  const total = document.createElement('div');
  total.className = 'running-total';
  total.textContent = `Running: ${peg.running}`;
  container.appendChild(total);
  for (const c of peg.history) container.appendChild(renderCard(c));
}

export function isPlayable(card, peg) {
  return peg.running + PIP[card.rank] <= 31;
}
