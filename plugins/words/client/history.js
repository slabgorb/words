// History drawer for Words.
// - loadHistory()  : fetch /history once and replace the rendered list
// - appendEntry(e) : called by the SSE handler when a new turn arrives
// - openDrawer()/closeDrawer()/toggleDrawer()
// - formatEntry(e, names) : pure formatter, returns a string

import { gameUrl } from './state.js';

const entries = []; // newest first

export function formatEntry(entry, names) {
  const name = entry.side === 'a' ? names.a : names.b;
  const s = entry.summary ?? {};
  switch (entry.kind) {
    case 'play': {
      const words = (s.words ?? []).join(', ');
      return `${name} played ${words} for ${s.scoreDelta ?? 0}`;
    }
    case 'pass':
      return `${name} passed`;
    case 'swap':
      return `${name} swapped ${s.count ?? 0} tile${s.count === 1 ? '' : 's'}`;
    case 'resign':
      return `${name} resigned`;
    case 'game-ended': {
      const winner =
        s.winnerSide == null ? 'tie'
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
  const r = await fetch(gameUrl('history'));
  if (!r.ok) return;
  const body = await r.json();
  entries.length = 0;
  // wire format is oldest-first; we display newest-first
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
  // Force a layout flush so the transform transition runs from the off-screen state.
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
  // Hide after transition so it's removed from the layout.
  setTimeout(() => { el.hidden = true; }, 220);
}

export function toggleDrawer() {
  const el = document.getElementById('history-drawer');
  if (!el) return;
  if (el.hidden || !el.classList.contains('history-drawer--open')) openDrawer();
  else closeDrawer();
}
