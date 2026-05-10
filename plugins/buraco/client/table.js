import { renderCard } from '/shared/cards/card-element.js';

export function renderTableCenter(container, view) {
  container.innerHTML = '';

  const piles = document.createElement('div');
  piles.className = 'piles';

  const stock = document.createElement('div');
  stock.className = 'pile pile--stock';
  stock.append(renderCard(null, { faceDown: true }));
  const stockLabel = document.createElement('div');
  stockLabel.className = 'pile-label';
  stockLabel.textContent = `stock ${view.stock}`;
  stock.append(stockLabel);

  const discard = document.createElement('div');
  discard.className = 'pile pile--discard';
  if (view.discard.length > 0) {
    discard.append(renderCard(view.discard[view.discard.length - 1]));
  } else {
    const empty = document.createElement('div');
    empty.className = 'pile-empty';
    empty.textContent = '∅';
    discard.append(empty);
  }
  const discardLabel = document.createElement('div');
  discardLabel.className = 'pile-label';
  discardLabel.textContent = `discard ${view.discard.length}`;
  discard.append(discardLabel);

  piles.append(stock, discard);

  const morto = document.createElement('div');
  morto.className = 'morto';
  morto.innerHTML = `
    <span class="morto__label">Mortos</span>
    <span class="morto__chip" data-taken="${view.mortoTaken.a}">a·${view.mortos.a}</span>
    <span class="morto__chip" data-taken="${view.mortoTaken.b}">b·${view.mortos.b}</span>
  `;

  container.append(piles, morto);
}
