// History drawer for Rummikub. Same shape as the Words counterpart but with a
// game-specific format function.

const entries = []; // newest first

export function formatEntry(entry, names) {
  const name = entry.side === 'a' ? names.a : names.b;
  const s = entry.summary ?? {};
  switch (entry.kind) {
    case 'commit-turn': {
      if ((s.tilesPlayed ?? 0) === 0) {
        return `${name} rearranged the table`;
      }
      const tilesWord = s.tilesPlayed === 1 ? 'tile' : 'tiles';
      const base = `${name} played ${s.tilesPlayed} ${tilesWord} (+${s.meldPoints ?? 0})`;
      return s.openedInitialMeld ? `${base} — opened initial meld` : base;
    }
    case 'draw-tile':
      return `${name} drew a tile`;
    case 'resign':
      return `${name} resigned`;
    case 'game-ended': {
      const winner =
        s.winnerSide == null ? 'no winner'
        : s.winnerSide === 'a' ? names.a
        : names.b;
      return `Game over — ${winner} (${s.reason ?? 'ended'})`;
    }
    default:
      return `${name} ${entry.kind}`;
  }
}

function render(getNames) {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.textContent = '';
  for (const e of entries) {
    const li = document.createElement('li');
    li.textContent = formatEntry(e, getNames());
    li.title = new Date(e.createdAt).toLocaleString();
    list.appendChild(li);
  }
}

export async function loadHistory(getNames) {
  const ctx = window.__GAME__;
  if (!ctx) return;
  const url = `/api/games/${ctx.gameId}/history`;
  const r = await fetch(url);
  if (!r.ok) return;
  const body = await r.json();
  entries.length = 0;
  for (const e of (body.entries ?? []).slice().reverse()) entries.push(e);
  render(getNames);
}

export function appendEntry(entry, getNames) {
  entries.unshift(entry);
  render(getNames);
}

export function openDrawer() {
  const el = document.getElementById('history-drawer');
  const btn = document.getElementById('btn-history');
  if (!el) return;
  el.hidden = false;
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
  setTimeout(() => { el.hidden = true; }, 220);
}

export function toggleDrawer() {
  const el = document.getElementById('history-drawer');
  if (!el) return;
  if (el.hidden || !el.classList.contains('history-drawer--open')) openDrawer();
  else closeDrawer();
}
