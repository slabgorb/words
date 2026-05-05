export const ui = {
  server: null,
  tentative: [],
  rackOrder: null,
  gameId: null
};

export function initGameId() {
  const m = location.pathname.match(/^\/game\/(\d+)/);
  ui.gameId = m ? Number(m[1]) : null;
  if (!ui.gameId) location.href = '/';
}

const TENTATIVE_KEY = () => `words.tentative.${ui.gameId}`;

export function loadTentative() {
  try { ui.tentative = JSON.parse(localStorage.getItem(TENTATIVE_KEY()) || '[]'); }
  catch { ui.tentative = []; }
}
export function saveTentative() {
  localStorage.setItem(TENTATIVE_KEY(), JSON.stringify(ui.tentative));
}
export function clearTentative() {
  ui.tentative = [];
  localStorage.removeItem(TENTATIVE_KEY());
}

export async function fetchState() {
  const r = await fetch(`/api/games/${ui.gameId}/state`);
  if (r.status === 403) {
    const body = await r.json().catch(() => ({}));
    location.href = `/lockout?email=${encodeURIComponent(body.email || '')}`;
    return null;
  }
  if (r.status === 404) { location.href = '/'; return null; }
  if (!r.ok) throw new Error('state-fetch-failed');
  ui.server = await r.json();
  if (!ui.rackOrder) ui.rackOrder = ui.server.racks[ui.server.you].slice();
  return ui.server;
}

export function gameUrl(suffix) {
  return `/api/games/${ui.gameId}/${suffix}`;
}
