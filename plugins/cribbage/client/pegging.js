import { renderCard } from '/shared/cards/card-element.js';

const PIP = { A:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8, 9:9, T:10, J:10, Q:10, K:10 };

export function renderPeggingStrip(container, peg) {
  container.innerHTML = '';
  const total = document.createElement('div');
  total.className = 'running-total';
  total.textContent = `Running: ${peg.running}`;
  container.appendChild(total);
  for (const c of peg.history) container.appendChild(renderCard(c));
}

export function isPlayable(card, peg) {
  return peg.running + PIP[card.rank] <= 31;
}
