import { renderMyHand, renderOpponentHand, getSelection, clearSelection } from './hand.js';
import { renderCard } from './card.js';

const ctx = window.__GAME__;
let state = null;

async function fetchState() {
  const r = await fetch(ctx.stateUrl);
  if (!r.ok) throw new Error(`state fetch failed: ${r.status}`);
  const data = await r.json();
  state = data.state ?? data;
  render();
}

async function send(action) {
  const r = await fetch(ctx.actionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    alert(body.error ?? `action failed (${r.status})`);
    return null;
  }
  state = body.state ?? state;
  render();
  return body;
}

function render() {
  if (!state) return;
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 0 : 1;
  const oppSide = 1 - mySide;
  document.getElementById('me-score').textContent = state.scores[mySide];
  document.getElementById('opp-score').textContent = state.scores[oppSide];
  document.getElementById('me-name').textContent = ctx.yourFriendlyName ?? 'You';
  document.getElementById('opp-name').textContent = ctx.opponentFriendlyName ?? 'Opponent';

  const banner = document.getElementById('phase-banner');
  const oppArea = document.getElementById('opp-area');
  const meArea = document.getElementById('me-area');

  if (state.phase === 'discard') {
    banner.innerHTML = `Discard 2 to ${mySide === state.dealer ? 'your' : "your opponent's"} crib
      <button id="btn-discard" disabled>Send to crib</button>`;
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    renderMyHand(meArea, state.hands[mySide], 'discard', () => updateDiscardBtn());
    updateDiscardBtn();
    document.getElementById('btn-discard').onclick = async () => {
      const sel = getSelection();
      if (sel.length !== 2) return;
      const r = await window.__cribbage__.send({ type: 'discard', payload: { cards: sel } });
      if (r) clearSelection();
    };
  } else if (state.phase === 'cut') {
    const isNonDealer = mySide !== state.dealer;
    banner.innerHTML = isNonDealer
      ? `Cut the deck. <button id="btn-cut">Cut</button>`
      : `Waiting for opponent to cut…`;
    renderMyHand(meArea, state.hands[mySide], 'view');
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 4);
    const slot = document.getElementById('starter');
    slot.innerHTML = '';
    const back = renderCard(null, { faceDown: true });
    slot.appendChild(back);
    if (isNonDealer) {
      document.getElementById('btn-cut').onclick = () => window.__cribbage__.send({ type: 'cut' });
    }
  } else {
    banner.textContent = `Phase: ${state.phase}`;
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    renderMyHand(meArea, Array.isArray(state.hands[mySide]) ? state.hands[mySide] : [], 'view');
    const slot = document.getElementById('starter');
    slot.innerHTML = '';
    if (state.starter) {
      slot.appendChild(renderCard(state.starter));
    }
  }
}

function updateDiscardBtn() {
  const btn = document.getElementById('btn-discard');
  if (!btn) return;
  btn.disabled = getSelection().length !== 2;
}

const es = new EventSource(ctx.sseUrl);
es.addEventListener('update', () => fetchState());
es.addEventListener('ended', () => fetchState());

window.__cribbage__ = { send };

fetchState();
