import { renderCard } from '/shared/cards/card-element.js';

export function renderMeldsZone(container, melds, { interactive, onPick } = {}) {
  container.innerHTML = '';
  if (melds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'melds-empty';
    empty.textContent = '— no melds —';
    container.append(empty);
    return;
  }
  melds.forEach((meld, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'meld';
    if (meld.length >= 7) wrap.classList.add('meld--buraco');
    for (const card of meld) {
      const el = renderCard(card);
      wrap.append(el);
    }
    if (interactive) {
      wrap.classList.add('meld--target');
      wrap.addEventListener('click', () => onPick?.(idx));
    }
    container.append(wrap);
  });
}
