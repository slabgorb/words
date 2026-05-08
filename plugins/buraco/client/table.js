import { renderCard } from '/shared/cards/card-element.js';

export function renderTableCenter(container, view) {
  container.innerHTML = '';

  const stockSlot = document.createElement('div');
  stockSlot.className = 'pile';
  const stockBack = renderCard(null, { faceDown: true });
  const stockCount = document.createElement('div');
  stockCount.className = 'pile-count';
  stockCount.textContent = `stock ${view.stock}`;
  stockSlot.append(stockBack, stockCount);

  const discardSlot = document.createElement('div');
  discardSlot.className = 'pile';
  if (view.discard.length > 0) {
    const top = renderCard(view.discard[view.discard.length - 1]);
    discardSlot.append(top);
  } else {
    const empty = document.createElement('div');
    empty.className = 'pile-empty';
    empty.textContent = 'empty';
    discardSlot.append(empty);
  }
  const discardCount = document.createElement('div');
  discardCount.className = 'pile-count';
  discardCount.textContent = `discard ${view.discard.length}`;
  discardSlot.append(discardCount);

  const mortoStatus = document.createElement('div');
  mortoStatus.className = 'morto-status';
  mortoStatus.innerHTML = `
    <div>Mortos</div>
    <div>${view.mortoTaken.a ? '◯' : '●'} a (${view.mortos.a} cards)</div>
    <div>${view.mortoTaken.b ? '◯' : '●'} b (${view.mortos.b} cards)</div>
  `;

  container.append(stockSlot, discardSlot, mortoStatus);
}
