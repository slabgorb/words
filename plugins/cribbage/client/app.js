import { renderMyHand, renderOpponentHand, getSelection, clearSelection } from './hand.js';
import { renderCard } from './card.js';
import { renderPeggingStrip, isPlayable } from './pegging.js';
import { renderShow, hideShow } from './show.js';

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
    body: JSON.stringify(action),
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

function bannerText(state, mySide) {
  const myTurn = state.activeUserId === ctx.userId;
  const isDealer = mySide === state.dealer;
  switch (state.phase) {
    case 'discard':
      return `Discard 2 to ${isDealer ? 'your' : "your opponent's"} crib`;
    case 'cut':
      return isDealer ? 'Waiting for opponent to cut…' : 'Cut the deck';
    case 'pegging':
      return myTurn ? `Your play — running ${state.pegging.running}` : `Opponent's play — running ${state.pegging.running}`;
    case 'show':
      return 'Hand counts';
    case 'done':
      return state.scores[0] === state.scores[1]
        ? `Tied at ${state.scores[mySide]} — deal complete`
        : (state.scores[mySide] > state.scores[1 - mySide]
            ? `You took the deal, ${state.scores[mySide]} to ${state.scores[1 - mySide]}`
            : `Opponent took the deal, ${state.scores[1 - mySide]} to ${state.scores[mySide]}`);
  }
  return state.phase;
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

  banner.textContent = bannerText(state, mySide);

  if (state.phase === 'discard') {
    const mySubmitted = state.pendingDiscards?.[mySide] != null;
    if (mySubmitted) {
      banner.textContent = 'Waiting for opponent to discard…';
    } else {
      banner.innerHTML = `${bannerText(state, mySide)} <button id="btn-discard" disabled>Send to crib</button>`;
    }
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    renderMyHand(meArea, state.hands[mySide], mySubmitted ? 'view' : 'discard', () => updateDiscardBtn());
    if (!mySubmitted) {
      updateDiscardBtn();
      document.getElementById('btn-discard').onclick = async () => {
        const sel = getSelection();
        if (sel.length !== 2) return;
        const r = await window.__cribbage__.send({ type: 'discard', payload: { cards: sel } });
        if (r) clearSelection();
      };
    }
  } else if (state.phase === 'cut') {
    const isNonDealer = mySide !== state.dealer;
    if (isNonDealer) {
      banner.innerHTML = `${bannerText(state, mySide)} <button id="btn-cut">Cut</button>`;
    }
    renderMyHand(meArea, state.hands[mySide], 'view');
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 4);
    const slot = document.getElementById('starter');
    slot.innerHTML = '';
    const back = renderCard(null, { faceDown: true });
    slot.appendChild(back);
    if (isNonDealer) {
      document.getElementById('btn-cut').onclick = () => window.__cribbage__.send({ type: 'cut' });
    }
  } else if (state.phase === 'pegging') {
    const myTurn = state.activeUserId === myUserId;
    renderPeggingStrip(document.getElementById('pegging-strip'), state.pegging);
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    meArea.innerHTML = '';
    for (const card of state.hands[mySide]) {
      const el = renderCard(card);
      const playable = isPlayable(card, state.pegging) && myTurn;
      if (!playable) el.classList.add('is-disabled');
      if (playable) el.addEventListener('click', () => window.__cribbage__.send({ type: 'play', payload: { card } }));
      meArea.appendChild(el);
    }
    const slot = document.getElementById('starter');
    slot.innerHTML = '';
    if (state.starter) slot.appendChild(renderCard(state.starter));
  } else {
    // remaining phases (show / done) — banner already set via bannerText
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    renderMyHand(meArea, Array.isArray(state.hands[mySide]) ? state.hands[mySide] : [], 'view');
    const slot = document.getElementById('starter');
    slot.innerHTML = '';
    if (state.starter) slot.appendChild(renderCard(state.starter));
  }

  const overlay = document.getElementById('show-overlay');
  if (state.phase === 'show' && state.showBreakdown) {
    renderShow(overlay, state, ctx.userId, () => window.__cribbage__.send({ type: 'next' }));
  } else {
    hideShow(overlay);
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
es.addEventListener('turn', (e) => {
  try {
    const data = JSON.parse(e.data);
    const events = data?.summary?.events;
    if (!Array.isArray(events) || events.length === 0) return;
    const text = events.map(ev => ev.say).filter(Boolean).join(' · ');
    if (text) showToast(text);
  } catch { /* ignore malformed */ }
});

function showToast(text) {
  const layer = document.getElementById('toast-layer') ?? (() => {
    const el = document.createElement('div');
    el.id = 'toast-layer';
    document.body.appendChild(el);
    return el;
  })();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  layer.appendChild(t);
  setTimeout(() => t.classList.add('toast--show'), 10);
  setTimeout(() => {
    t.classList.remove('toast--show');
    setTimeout(() => t.remove(), 400);
  }, 2400);
}

window.__cribbage__ = { send };

fetchState();
