import { renderCard } from '/shared/cards/card-element.js';

function renderBreakdownCard(title, breakdown) {
  const card = document.createElement('div');
  card.className = 'breakdown-card';
  const h = document.createElement('h3');
  h.textContent = `${title} — ${breakdown.total}`;
  card.appendChild(h);
  const ul = document.createElement('ul');
  for (const item of breakdown.items) {
    const li = document.createElement('li');
    const say = document.createElement('div');
    say.className = 'say';
    say.textContent = item.say;
    const cards = document.createElement('div');
    cards.className = 'mini-cards';
    for (const c of item.cards) {
      const m = renderCard(c);
      m.classList.add('mini');
      cards.appendChild(m);
    }
    li.appendChild(say);
    li.appendChild(cards);
    ul.appendChild(li);
  }
  card.appendChild(ul);
  return card;
}

export function renderShow(overlay, state, myUserId, onNext) {
  overlay.hidden = false;
  overlay.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'show-wrap';

  const mySide = state.sides.a === myUserId ? 0 : 1;
  const isDealer = mySide === state.dealer;
  const isMatchEnd = state.phase === 'match-end';

  if (isMatchEnd) {
    const won = state.winnerSide === (mySide === 0 ? 'a' : 'b');
    const me = state.scores[mySide];
    const opp = state.scores[1 - mySide];
    const loserScore = won ? opp : me;
    const skunked = loserScore < 91;
    const head = document.createElement('h2');
    head.className = 'show-head';
    head.textContent = won
      ? (skunked ? `Game! You skunked them, ${me} to ${opp}.` : `Game! You won, ${me} to ${opp}.`)
      : (skunked ? `Game. You were skunked, ${opp} to ${me}.` : `Game. They won, ${opp} to ${me}.`);
    wrap.appendChild(head);
  }

  const ndLabel = isDealer ? 'Opponent (non-dealer)' : 'You (non-dealer)';
  const dLabel = isDealer ? 'You (dealer)' : 'Opponent (dealer)';
  wrap.appendChild(renderBreakdownCard(ndLabel, state.showBreakdown.nonDealer));
  wrap.appendChild(renderBreakdownCard(dLabel, state.showBreakdown.dealer));
  wrap.appendChild(renderBreakdownCard('Crib', state.showBreakdown.crib));

  if (isMatchEnd) {
    const link = document.createElement('a');
    link.href = '/';
    link.className = 'show-lobby-btn';
    link.textContent = 'Back to lobby';
    wrap.appendChild(link);
  } else {
    const myAck = state.acknowledged[mySide];
    const btn = document.createElement('button');
    btn.textContent = myAck ? 'Waiting for opponent…' : 'Continue';
    btn.disabled = myAck;
    btn.addEventListener('click', () => onNext());
    wrap.appendChild(btn);
  }

  overlay.appendChild(wrap);
}

export function hideShow(overlay) {
  overlay.hidden = true;
  overlay.innerHTML = '';
}
