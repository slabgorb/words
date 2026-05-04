// Floating callout that announces an opponent's move (words + score).
// Stacks if multiple events fire in quick succession; auto-dismisses.

let host = null;
function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'callout-host';
  document.body.appendChild(host);
  return host;
}

function nameOf(playerId) {
  if (!playerId) return '';
  return playerId[0].toUpperCase() + playerId.slice(1);
}

export function showMoveCallout({ by, words, score }) {
  const root = ensureHost();
  const card = document.createElement('div');
  card.className = 'callout';

  const who = document.createElement('div');
  who.className = 'callout-who';
  who.textContent = nameOf(by);
  card.appendChild(who);

  const wordList = (words ?? []).join(', ').toUpperCase();
  if (wordList) {
    const w = document.createElement('div');
    w.className = 'callout-words';
    w.textContent = wordList;
    card.appendChild(w);
  }

  const s = document.createElement('div');
  s.className = 'callout-score';
  s.textContent = `+${score ?? 0}`;
  card.appendChild(s);

  root.appendChild(card);

  // Force layout, then add 'in' to trigger transition
  requestAnimationFrame(() => card.classList.add('in'));

  const lifetime = 4200;
  setTimeout(() => {
    card.classList.remove('in');
    card.classList.add('out');
    setTimeout(() => card.remove(), 280);
  }, lifetime);
}

export function showPassCallout({ by }) {
  const root = ensureHost();
  const card = document.createElement('div');
  card.className = 'callout callout-quiet';
  const who = document.createElement('div');
  who.className = 'callout-who';
  who.textContent = nameOf(by);
  card.appendChild(who);
  const w = document.createElement('div');
  w.className = 'callout-words';
  w.textContent = 'passed';
  card.appendChild(w);
  root.appendChild(card);
  requestAnimationFrame(() => card.classList.add('in'));
  setTimeout(() => {
    card.classList.remove('in');
    card.classList.add('out');
    setTimeout(() => card.remove(), 280);
  }, 2800);
}

export function showSwapCallout({ by, count }) {
  const root = ensureHost();
  const card = document.createElement('div');
  card.className = 'callout callout-quiet';
  const who = document.createElement('div');
  who.className = 'callout-who';
  who.textContent = nameOf(by);
  card.appendChild(who);
  const w = document.createElement('div');
  w.className = 'callout-words';
  w.textContent = `swapped ${count}`;
  card.appendChild(w);
  root.appendChild(card);
  requestAnimationFrame(() => card.classList.add('in'));
  setTimeout(() => {
    card.classList.remove('in');
    card.classList.add('out');
    setTimeout(() => card.remove(), 280);
  }, 2800);
}
