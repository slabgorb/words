// Holds local UI state separate from server state.
// `tentative` is the in-progress placement: { r, c, letter, fromRackIdx, blank? }
export const ui = {
  server: null,        // last server snapshot
  tentative: [],       // newly-placed-but-not-yet-submitted tiles
  rackOrder: null      // reorderable view of the rack (array of letters)
};

const TENTATIVE_KEY = 'words.tentative';

export function loadTentative() {
  try { ui.tentative = JSON.parse(localStorage.getItem(TENTATIVE_KEY) || '[]'); }
  catch { ui.tentative = []; }
}
export function saveTentative() {
  localStorage.setItem(TENTATIVE_KEY, JSON.stringify(ui.tentative));
}
export function clearTentative() {
  ui.tentative = [];
  localStorage.removeItem(TENTATIVE_KEY);
}

export async function fetchState() {
  const r = await fetch('/api/state');
  if (!r.ok) throw new Error('state-fetch-failed');
  ui.server = await r.json();
  if (!ui.rackOrder) ui.rackOrder = ui.server.racks[ui.server.you].slice();
  return ui.server;
}
