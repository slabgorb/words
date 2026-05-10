import { renderCard } from '/shared/cards/card-element.js';

export function renderMeldsZone(container, melds, { interactive, onPick } = {}) {
  container.innerHTML = '';
  container.classList.toggle('zone--empty', melds.length === 0);
  if (melds.length === 0) return;
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
