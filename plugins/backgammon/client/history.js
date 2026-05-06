// History drawer for backgammon. Mirrors plugins/rummikub/client/history.js
// shape; only formatEntry differs.

const entries = []; // newest first

function nameOf(side, names) {
  return side === names.mine ? names.me : names.opp;
}

export function formatEntry(entry, names) {
  const s = entry.summary ?? {};
  const actor = entry.side ? nameOf(entry.side, names) : '';
  switch (s.kind) {
    case 'roll-initial':
      if (s.tie) return 'Initial roll: tied — both reroll';
      if (s.activePlayer) {
        const winner = nameOf(s.activePlayer, names);
        return `${winner} won the initial roll`;
      }
      return `${actor} rolled (initial)`;
    case 'roll':
      return `${actor} rolled ${(s.values ?? []).join('-')}`;
    case 'move':
      return `${actor} moved`;
    case 'pass-turn':
      return `${actor} passed`;
    case 'offer-double':
      return `${actor} offered the cube`;
    case 'accept-double':
      return `${actor} accepted the double`;
    case 'leg-end': {
      const winner = s.winner ? nameOf(s.winner, names) : actor;
      const type = s.type ? ` (${s.type})` : '';
      return `Leg ended — ${winner} wins${type}`;
    }
    case 'match-end': {
      const winner = s.winner ? nameOf(s.winner, names) : actor;
      return `Match — ${winner} wins`;
    }
    default:
      return `${actor} ${s.kind ?? entry.kind ?? 'action'}`;
  }
}

function namesFromCtxState(ctx, state) {
  const me = state?.youAre ?? 'a';
  return {
    mine: me,
    me: ctx?.yourFriendlyName ?? 'You',
    opp: ctx?.opponentFriendlyName ?? 'Opponent',
  };
}

let lastCtx = null;
let lastState = null;
function getNames() { return namesFromCtxState(lastCtx, lastState); }

function render() {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.textContent = '';
  const names = getNames();
  for (const e of entries) {
    const li = document.createElement('li');
    li.textContent = formatEntry(e, names);
    if (e.createdAt) li.title = new Date(e.createdAt).toLocaleString();
    list.appendChild(li);
  }
}

export async function loadHistory(ctx, state) {
  lastCtx = ctx; lastState = state;
  if (!ctx?.gameId) return;
  const url = `/api/games/${ctx.gameId}/history`;
  try {
    const r = await fetch(url);
    if (!r.ok) return;
    const body = await r.json();
    entries.length = 0;
    for (const e of (body.entries ?? []).slice().reverse()) entries.push(e);
    render();
  } catch (err) {
    console.warn('loadHistory failed:', err);
  }
}

export function appendHistoryEntry(entry, ctx, state) {
  lastCtx = ctx; lastState = state;
  entries.unshift(entry);
  render();
}

export function syncContext(ctx, state) {
  lastCtx = ctx; lastState = state;
  render();
}

export function openDrawer() {
  const el = document.getElementById('history-drawer');
  const btn = document.getElementById('btn-history');
  if (!el) return;
  el.classList.remove('hidden');
  void el.offsetWidth;
  el.classList.add('history-drawer--open');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

export function closeDrawer() {
  const el = document.getElementById('history-drawer');
  const btn = document.getElementById('btn-history');
  if (!el) return;
  el.classList.remove('history-drawer--open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  setTimeout(() => { el.classList.add('hidden'); }, 220);
}

export function toggleDrawer() {
  const el = document.getElementById('history-drawer');
  if (!el) return;
  if (el.classList.contains('hidden') || !el.classList.contains('history-drawer--open')) openDrawer();
  else closeDrawer();
}
