import { canLay } from './sequence-validator.js';

export function renderActionBar(container, view, mySide, selection, callbacks) {
  container.innerHTML = '';
  const { onDrawStock, onTakeDiscard, onLayMeld, onExtendMode, onDiscardMode, sorted, onToggleSort } = callbacks;

  if (view.currentTurn !== mySide) {
    container.textContent = `Waiting for opponent…`;
  } else if (view.phase === 'draw') {
    container.append(button('Draw stock', onDrawStock));
    container.append(button('Take discard', onTakeDiscard, view.discard.length === 0));
  } else if (view.phase === 'meld') {
    const selectedCards = view.hands[mySide].filter(c => selection.has(c.id));
    const valid = canLay(selectedCards);
    container.append(button(`Lay meld (${selection.size})`, onLayMeld, !valid));
    container.append(button('Extend meld', onExtendMode, selection.size === 0));
    container.append(button('Discard…', onDiscardMode));
  }

  // Always-on hand-sort toggle (persistent regardless of phase)
  const sortBtn = button(sorted ? 'Sort: ON' : 'Sort: OFF', onToggleSort);
  sortBtn.classList.add('btn-sort');
  sortBtn.setAttribute('aria-pressed', String(!!sorted));
  container.append(sortBtn);
}

function button(label, fn, disabled = false) {
  const b = document.createElement('button');
  b.textContent = label;
  b.disabled = !!disabled;
  if (fn) b.addEventListener('click', fn);
  return b;
}
