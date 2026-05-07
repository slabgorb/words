import { renderRack, toggleSortMode } from './rack.js';
import { renderTable } from './table.js';
import { beginTurn, getTentative, getSnapshot, resetTurn, hasPendingChanges } from './turn.js';
import { attachDrag } from './drag.js';
import { initJokerPicker } from './joker-picker.js';
import { validateEndState } from './validate.js';
import { setValue } from './sets.js';
import { cycleTheme, getThemeLabel } from './themes.js';
import { cycleFont, getFontLabel } from './fonts.js';
import { loadHistory, toggleDrawer, closeDrawer, appendEntry } from './history.js';

const ctx = window.__GAME__;
let state = null;
let turnInProgress = false;

function historyNames() {
  const myUserId = ctx.userId;
  const mySide = state?.sides?.a === myUserId ? 'a' : 'b';
  const me = ctx.yourFriendlyName ?? 'You';
  const opp = ctx.opponentFriendlyName ?? 'Opponent';
  return mySide === 'a' ? { a: me, b: opp } : { a: opp, b: me };
}

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
  const meldEl = document.getElementById('meld-indicator');
  const fillEl = document.getElementById('meld-bar-fill');
  if (state.initialMeldComplete[mySide]) {
    meldEl.classList.add('hidden');
    return;
  }
  meldEl.classList.remove('hidden');
  const tent = getTentative();
  const snap = getSnapshot();
  let pts = 0;
  if (tent && snap) {
    const startKeys = new Set(snap.table.map(s => s.map(t => t.id).sort().join(',')));
    for (const set of tent.table) {
      const key = set.map(t => t.id).sort().join(',');
      if (!startKeys.has(key)) pts += setValue(set);
    }
  }
  document.getElementById('meld-points').textContent = pts;
  if (fillEl) fillEl.style.width = `${Math.min(100, (pts / 30) * 100)}%`;
}

function refreshTurnBanner(myTurn) {
  const banner = document.getElementById('turn-banner');
  const stateEl = document.getElementById('turn-state');
  const hintEl = document.getElementById('turn-hint');
  if (state.endedReason) {
    banner.dataset.mine = 'false';
    stateEl.textContent = 'Game over';
    hintEl.textContent = '';
    return;
  }
  banner.dataset.mine = myTurn ? 'true' : 'false';
  if (myTurn) {
    stateEl.textContent = 'Your turn';
    hintEl.textContent = '· play a set or draw a tile';
  } else {
    stateEl.textContent = "Opponent's turn";
    hintEl.textContent = '· waiting…';
  }
}

function renderOppRack(count) {
  const el = document.getElementById('opp-rack');
  el.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const back = document.createElement('div');
    back.className = 'tile face-down size-sm';
    el.appendChild(back);
  }
}

function setPlayerCard(prefix, name, score, tilesLeft, active) {
  document.getElementById(`${prefix}-name`).textContent = name;
  document.getElementById(`${prefix}-score`).textContent = score;
  document.getElementById(`${prefix}-tiles`).textContent = tilesLeft;
  document.getElementById(`${prefix}-card`).dataset.active = active ? 'true' : 'false';
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
  const myName = ctx.yourFriendlyName ?? 'You';
  const oppName = ctx.opponentFriendlyName ?? 'Opponent';
  const myTurn = state.activeUserId === myUserId;

  const myRackCount = (state.racks?.[mySide] ?? []).length;
  const oppRackCount = state.opponentRack.count;

  setPlayerCard('me', myName, state.scores[mySide], myRackCount, myTurn);
  setPlayerCard('opp', oppName, state.scores[oppSide], oppRackCount, !myTurn && !state.endedReason);

  document.getElementById('pool-count').textContent = state.pool.count;
  document.getElementById('opp-rack-count').textContent = oppRackCount;
  document.getElementById('opp-rack-name').textContent = `${oppName}'s rack`;
  document.getElementById('my-rack-count').textContent = myRackCount;
  renderOppRack(oppRackCount);
  refreshTurnBanner(myTurn);

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

  document.getElementById('my-rack-count').textContent = rackToRender.length;
  setPlayerCard('me', myName, state.scores[mySide], rackToRender.length, myTurn);

  const tableEl = document.getElementById('table');
  renderTable(tableEl, tableToRender);
  const rackEl = document.getElementById('rack');
  renderRack(rackEl, rackToRender);

  document.getElementById('btn-reset').disabled = !useTentative || !hasPendingChanges();
  document.getElementById('btn-draw').disabled = !!state.endedReason || state.activeUserId !== ctx.userId;
  document.getElementById('btn-resign').disabled = !!state.endedReason;

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
  es.addEventListener('turn', (e) => {
    let entry;
    try { entry = JSON.parse(e.data); } catch { return; }
    appendEntry(entry, historyNames);
  });
  es.onerror = () => {/* let browser auto-reconnect */};
}

fetchState();
openSSE();
initJokerPicker();
attachDrag(document.body, render);

document.getElementById('btn-sort').addEventListener('click', (e) => {
  toggleSortMode();
  const btn = e.currentTarget;
  const next = btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true';
  btn.setAttribute('aria-pressed', next);
  render();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  resetTurn();
  render();
});

async function postAction(type, payload) {
  const r = await fetch(ctx.actionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    alert(body.error ?? `action failed (${r.status})`);
    return null;
  }
  return r.json();
}

document.getElementById('btn-end').addEventListener('click', async () => {
  const tent = getTentative();
  if (!tent) return;
  await postAction('commit-turn', { rack: tent.rack, table: tent.table });
});

document.getElementById('btn-draw').addEventListener('click', async () => {
  if (hasPendingChanges()) {
    if (!confirm('Drawing will discard your pending moves. Continue?')) return;
    resetTurn();
    render();
  }
  await postAction('draw-tile', {});
});

document.getElementById('btn-resign').addEventListener('click', async () => {
  if (!confirm('Resign this game?')) return;
  await postAction('resign', {});
});

function setupThemeToggle() {
  const btn = document.createElement('button');
  btn.id = 'btn-theme';
  btn.type = 'button';
  const sync = () => {
    btn.title = `Theme: ${getThemeLabel()} (click to cycle)`;
    btn.setAttribute('aria-label', `Cycle board theme — current: ${getThemeLabel()}`);
    btn.textContent = getThemeLabel()[0];
  };
  sync();
  btn.addEventListener('click', () => { cycleTheme(); sync(); });
  document.body.appendChild(btn);
}

function setupFontToggle() {
  const btn = document.createElement('button');
  btn.id = 'btn-font';
  btn.type = 'button';
  const sync = () => {
    btn.title = `Font: ${getFontLabel()} (click to cycle)`;
    btn.setAttribute('aria-label', `Cycle display font — current: ${getFontLabel()}`);
    btn.textContent = 'Aa';
  };
  sync();
  btn.addEventListener('click', () => { cycleFont(); sync(); });
  document.body.appendChild(btn);
}

setupThemeToggle();
setupFontToggle();

document.getElementById('btn-history').addEventListener('click', () => {
  toggleDrawer();
  loadHistory(historyNames);
});
document.getElementById('btn-history-close').addEventListener('click', closeDrawer);

document.getElementById('btn-new').addEventListener('click', async () => {
  const myUserId = ctx.userId;
  const oppUserId = state.sides.a === myUserId ? state.sides.b : state.sides.a;
  const r = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opponentId: oppUserId, gameType: 'rummikub' }),
  });
  if (!r.ok) { alert('could not start new game'); return; }
  const { id, gameType } = await r.json();
  window.location.href = `/play/${gameType}/${id}/`;
});
