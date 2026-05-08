import { canLay } from './sequence-validator.js';

export function renderActionBar(container, view, mySide, selection, callbacks) {
  container.innerHTML = '';
  const { onDrawStock, onTakeDiscard, onLayMeld, onExtendMode, onDiscardMode } = callbacks;

  if (view.currentTurn !== mySide) {
    container.textContent = `Waiting for opponent…`;
    return;
  }
  if (view.phase === 'draw') {
    container.append(button('Draw stock', onDrawStock));
    container.append(button('Take discard', onTakeDiscard, view.discard.length === 0));
    return;
  }
  if (view.phase === 'meld') {
    const selectedCards = view.hands[mySide].filter(c => selection.has(c.id));
    const valid = canLay(selectedCards);
    const lay = button(`Lay meld (${selection.size})`, onLayMeld, !valid);
    const ext = button('Extend meld', onExtendMode, selection.size === 0);
    const disc = button('Discard…', onDiscardMode);
    container.append(lay, ext, disc);
    return;
  }
}

function button(label, fn, disabled = false) {
  const b = document.createElement('button');
  b.textContent = label;
  b.disabled = !!disabled;
  if (fn) b.addEventListener('click', fn);
  return b;
}
