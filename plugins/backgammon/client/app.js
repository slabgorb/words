import { renderBoard } from './board.js';
import { renderScoreboard } from './scoreboard.js';
import { renderActionBar, wireActionBar } from './action-bar.js';
import { renderEndScreen, flashLegEnd } from './end-screen.js';
import { renderDice } from './dice.js';
import { legalTargetsFrom } from './legal.js';
import { getSelected, setSelected, clearSelection, onSelectionChange } from './selection.js';
import { postAction } from './actions.js';
import { cycleTheme } from './themes.js';
import { loadHistory, appendHistoryEntry, syncContext, toggleDrawer, closeDrawer } from './history.js';

const ctx = window.__GAME__ || {};
let state = null;

function currentUI() {
  const sel = getSelected();
  const me = state?.youAre ?? 'a';
  const dice = state?.turn?.dice?.remaining;
  const legalTargets = (sel != null && state)
    ? legalTargetsFrom(state.board, dice, me, sel === 'bar' ? 'bar' : sel)
    : new Set();
  return {
    selected: sel,
    legalTargets,
    showLegalDots: true,
    youAre: me,
  };
}

function render() {
  if (!state) return;
  const root = document.getElementById('root');
  if (root) renderBoard(root, state.board, currentUI(), state.cube);
  renderScoreboard(state, ctx);
  renderActionBar(state);
  renderEndScreen(state, ctx);
  renderDice(state, ctx, onRollFromTray);
  syncContext(ctx, state);
  attachBoardClicks();
}

function onRollFromTray(type, payload) {
  postAction(type, payload);
}

// ─── Board click delegation ───────────────────────────────────────────

let clickHandlerAttached = false;
function attachBoardClicks() {
  if (clickHandlerAttached) return;
  const root = document.getElementById('root');
  if (!root) return;
  clickHandlerAttached = true;
  root.addEventListener('click', handleBoardClick);
}

function classifyClick(target) {
  // Returns 'bar' | 'off' | <number 0..23> | null
  const offMine = target.closest('[data-role="off-mine"]');
  if (offMine) return 'off';
  const barMine = target.closest('[data-role="bar-mine"]');
  if (barMine) return 'bar';
  const point = target.closest('[data-idx]');
  if (!point) return null;
  const idx = Number(point.dataset.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx > 23) return null;
  return idx;
}

function handleBoardClick(e) {
  if (!state || state.turn?.phase !== 'moving') return;
  const me = state.youAre;
  if (state.turn.activePlayer !== me) return;

  const clicked = classifyClick(e.target);
  if (clicked === null) return;

  const sel = getSelected();
  const dice = state.turn.dice?.remaining;
  const onBar = (me === 'a' ? state.board.barA : state.board.barB) > 0;

  if (sel === null || sel === undefined) {
    // Picking a source. Off-tray is never a source.
    if (clicked === 'off') return;
    if (onBar && clicked !== 'bar') return;          // must enter from bar first
    if (clicked === 'bar') {
      setSelected('bar');
      return;
    }
    const cell = state.board.points[clicked];
    if (cell.color !== me || cell.count === 0) return;
    setSelected(clicked);
    return;
  }

  // Already have a selection; treat `clicked` as candidate destination.
  const targets = legalTargetsFrom(state.board, dice, me, sel === 'bar' ? 'bar' : sel);
  if (targets.has(clicked)) {
    const fromValue = sel === 'bar' ? 'bar' : sel;
    postAction('move', { from: fromValue, to: clicked });
    clearSelection();
    return;
  }

  // Otherwise: clicked a non-target — switch source if it's the viewer's,
  // else clear.
  if (typeof clicked === 'number' && !onBar) {
    const cell = state.board.points[clicked];
    if (cell.color === me && cell.count > 0) {
      setSelected(clicked);
      return;
    }
  }
  clearSelection();
}

// ─── Data fetch + SSE ──────────────────────────────────────────────────

async function fetchState() {
  if (!ctx.stateUrl) return;
  try {
    const r = await fetch(ctx.stateUrl);
    if (!r.ok) return;
    const json = await r.json();
    state = json.state;
    render();
  } catch (err) {
    console.warn('fetchState failed:', err);
  }
}

function openSSE() {
  if (!ctx.sseUrl) return;
  const es = new EventSource(ctx.sseUrl);
  es.addEventListener('update', () => fetchState());
  es.addEventListener('ended', () => fetchState());
  es.addEventListener('turn', (e) => {
    let entry;
    try { entry = JSON.parse(e.data); } catch { return; }
    appendHistoryEntry(entry, ctx, state);
    if (entry?.summary?.kind === 'leg-end') flashLegEnd(entry, ctx, state);
  });
  es.onerror = () => { /* browser auto-reconnects */ };
}

// ─── Wiring ───────────────────────────────────────────────────────────

onSelectionChange(render);

document.getElementById('btn-theme')?.addEventListener('click', () => {
  cycleTheme();
  render();
});
document.getElementById('btn-history')?.addEventListener('click', toggleDrawer);
document.getElementById('btn-history-close')?.addEventListener('click', closeDrawer);

wireActionBar();

fetchState().then(() => loadHistory(ctx, state));
openSSE();
