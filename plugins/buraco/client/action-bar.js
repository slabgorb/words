import { canLay } from './sequence-validator.js';

export function renderActionBar(container, view, mySide, selection, callbacks) {
  container.innerHTML = '';
  const { onDrawStock, onTakeDiscard, onLayMeld, onExtendMode, onDiscardMode } = callbacks;

  if (view.currentTurn !== mySide) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  if (view.phase === 'draw') {
    container.append(button('Draw stock', onDrawStock));
    container.append(button('Take discard', onTakeDiscard, view.discard.length === 0));
  } else if (view.phase === 'meld') {
    const selectedCards = view.hands[mySide].filter(c => selection.has(c.id));
    const valid = canLay(selectedCards);
    container.append(button(`Lay meld (${selection.size})`, onLayMeld, !valid));
    container.append(button('Extend meld', onExtendMode, selection.size === 0));
    container.append(button('Discard…', onDiscardMode));
  }
}

function button(label, fn, disabled = false) {
  const b = document.createElement('button');
  b.textContent = label;
  b.disabled = !!disabled;
  if (fn) b.addEventListener('click', fn);
  return b;
}
