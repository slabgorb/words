import { renderRack, toggleSortMode } from './rack.js';
import { renderTable } from './table.js';
import { beginTurn, getTentative, getSnapshot, resetTurn, hasPendingChanges } from './turn.js';
import { attachDrag } from './drag.js';
import { validateEndState } from './validate.js';
import { setValue } from './sets.js';

const ctx = window.__GAME__;
let state = null;
let turnInProgress = false;

function refreshEndButton() {
  const tent = getTentative();
  const snap = getSnapshot();
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 'a' : 'b';
  if (!tent || state.activeUserId !== myUserId || state.endedReason) {
    document.getElementById('btn-end').disabled = true;
    return;
  }
  const result = validateEndState(
    { rack: snap.rack, table: snap.table, initialMeldComplete: state.initialMeldComplete[mySide] },
    { rack: tent.rack, table: tent.table }
  );
  const btn = document.getElementById('btn-end');
  btn.disabled = !result.valid;
  btn.title = result.valid ? '' : result.reason;
}

function refreshMeldIndicator() {
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 'a' : 'b';
  if (state.initialMeldComplete[mySide]) {
    document.getElementById('meld-indicator').classList.add('hidden');
    return;
  }
  document.getElementById('meld-indicator').classList.remove('hidden');
  const tent = getTentative();
  const snap = getSnapshot();
  if (!tent || !snap) {
    document.getElementById('meld-points').textContent = '0';
    return;
  }
  const startKeys = new Set(snap.table.map(s => s.map(t => t.id).sort().join(',')));
  let pts = 0;
  for (const set of tent.table) {
    const key = set.map(t => t.id).sort().join(',');
    if (!startKeys.has(key)) pts += setValue(set);
  }
  document.getElementById('meld-points').textContent = pts;
}

async function fetchState() {
  const r = await fetch(ctx.stateUrl);
  if (!r.ok) throw new Error(`state fetch failed: ${r.status}`);
  const json = await r.json();
  state = json.state;
  render();
}

function render() {
  if (!state) return;
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 'a' : 'b';
  const oppSide = mySide === 'a' ? 'b' : 'a';

  document.getElementById('my-score').textContent = state.scores[mySide];
  document.getElementById('opp-score').textContent = state.scores[oppSide];
  document.getElementById('turn-indicator').textContent =
    state.activeUserId === myUserId ? 'Your turn' : "Opponent's turn";
  document.getElementById('pool-count').textContent = state.pool.count;
  document.getElementById('opp-rack-count').textContent = state.opponentRack.count;

  const myTurn = state.activeUserId === myUserId;

  // When it stops being our turn, clear turnInProgress so next turn gets a fresh snapshot
  if (!myTurn || state.endedReason) {
    turnInProgress = false;
  }

  // Begin a new tentative turn on first render of our turn
  if (myTurn && !state.endedReason && !turnInProgress) {
    beginTurn(state.racks[mySide] ?? [], state.table);
    turnInProgress = true;
  }

  const tent = getTentative();
  const useTentative = myTurn && tent && !state.endedReason;
  const rackToRender = useTentative ? tent.rack : (state.racks[mySide] ?? []);
  const tableToRender = useTentative ? tent.table : state.table;

  const tableEl = document.getElementById('table');
  renderTable(tableEl, tableToRender);
  const rackEl = document.getElementById('rack');
  renderRack(rackEl, rackToRender);

  document.getElementById('btn-reset').disabled = !useTentative || !hasPendingChanges();

  refreshEndButton();
  refreshMeldIndicator();

  // End-game screen
  if (state.endedReason) {
    const screen = document.getElementById('end-screen');
    screen.classList.remove('hidden');
    document.getElementById('end-headline').textContent =
      state.winnerSide === mySide ? 'You won!' : 'You lost.';
    document.getElementById('end-summary').textContent = `Reason: ${state.endedReason}`;
  }
}

function openSSE() {
  const es = new EventSource(ctx.sseUrl);
  es.addEventListener('update', () => fetchState());
  es.addEventListener('ended', () => fetchState());
  es.onerror = () => {/* let browser auto-reconnect */};
}

fetchState();
openSSE();
attachDrag(document.body, render);

document.getElementById('btn-sort').addEventListener('click', () => {
  toggleSortMode();
  render();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  resetTurn();
  render();
});
