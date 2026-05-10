import { renderTableCenter } from './table.js';
import { renderMeldsZone } from './melds.js';
import { renderOppHand, renderMyHand, sortHand } from './hand.js';
import { renderActionBar } from './action-bar.js';

const ctx = window.__GAME__;
let state = null;
let mySide = null;
const selection = new Set();
let extendModeMeldIdx = null;
let sorted = false;

async function fetchState() {
  const r = await fetch(ctx.stateUrl);
  if (!r.ok) throw new Error(`state fetch failed: ${r.status}`);
  const data = await r.json();
  state = data.state ?? data;
  if (!mySide) mySide = state.sides.a === ctx.userId ? 'a' : 'b';
  selection.clear();
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
  if (body.state) {
    state = body.state;
    selection.clear();
    extendModeMeldIdx = null;
    render();
  }
  return body;
}

function bannerText() {
  if (state.phase === 'game-end') return state.winner === mySide ? 'You won the match!' : 'Opponent won the match.';
  if (state.phase === 'deal-end') return 'Deal ended — scoring…';
  if (state.currentTurn !== mySide) return `Waiting for opponent…`;
  if (state.phase === 'draw') return 'Your turn — draw a card';
  if (state.phase === 'meld') return 'Your turn — meld or discard';
  return state.phase;
}

function onLayMeld() {
  const cards = state.hands[mySide].filter(c => selection.has(c.id));
  send({ type: 'meld', payload: { op: 'create', cards } });
}

function onExtendMode() {
  extendModeMeldIdx = -1; // -1 = picking; non-null enables interactive melds
  render();
}

function onExtendPick(idx) {
  const cards = state.hands[mySide].filter(c => selection.has(c.id));
  send({ type: 'meld', payload: { op: 'extend', meldIndex: idx, cards } });
}

function onDiscardMode() {
  const sel = [...selection];
  if (sel.length !== 1) {
    alert('Select exactly one card to discard.');
    return;
  }
  const card = state.hands[mySide].find(c => c.id === sel[0]);
  send({ type: 'discard', payload: { card } });
}

function render() {
  if (!state) return;
  const opp = mySide === 'a' ? 'b' : 'a';

  document.getElementById('me-name').textContent = ctx.yourFriendlyName ?? 'You';
  document.getElementById('opp-name').textContent = ctx.opponentFriendlyName ?? 'Opponent';
  document.getElementById('me-score').textContent = state.scores[mySide]?.total ?? 0;
  document.getElementById('opp-score').textContent = state.scores[opp]?.total ?? 0;

  const meCard = document.getElementById('p-me');
  const oppCard = document.getElementById('p-opp');
  const myTurn = state.currentTurn === mySide;
  meCard.dataset.active = String(myTurn);
  oppCard.dataset.active = String(!myTurn);

  // Opponent zone (hand is a number, melds is an array)
  renderOppHand(document.getElementById('opp-hand-row'), state.hands[opp]);
  renderMeldsZone(document.getElementById('opp-melds-row'), state.melds[opp]);

  // Table center
  renderTableCenter(document.getElementById('table-center'), state);

  // My melds (interactive when in extend mode)
  renderMeldsZone(document.getElementById('my-melds-row'), state.melds[mySide], {
    interactive: extendModeMeldIdx !== null,
    onPick: (idx) => onExtendPick(idx),
  });

  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  statusText.textContent = bannerText();
  const myTurnNow = state.currentTurn === mySide;
  statusBar.dataset.state =
    state.phase === 'game-end' || state.phase === 'deal-end' ? 'end'
    : myTurnNow ? 'my-turn' : 'waiting';

  const sortBtn = document.getElementById('btn-sort');
  sortBtn.setAttribute('aria-pressed', String(sorted));
  sortBtn.textContent = sorted ? 'Sort ✓' : 'Sort';
  sortBtn.onclick = () => { sorted = !sorted; render(); };

  const myHand = sorted ? sortHand(state.hands[mySide]) : state.hands[mySide];
  renderMyHand(document.getElementById('my-hand-row'), myHand, selection, {
    onToggle: (card) => {
      if (selection.has(card.id)) selection.delete(card.id);
      else selection.add(card.id);
      render();
    },
  });

  renderActionBar(document.getElementById('action-bar'), state, mySide, selection, {
    onDrawStock: () => send({ type: 'draw', payload: { source: 'stock' } }),
    onTakeDiscard: () => send({ type: 'draw', payload: { source: 'discard' } }),
    onLayMeld,
    onExtendMode,
    onDiscardMode,
  });
}

const es = new EventSource(ctx.sseUrl);
es.addEventListener('update', () => fetchState());
es.addEventListener('ended', () => fetchState());

window.__buraco__ = { send };

fetchState();
