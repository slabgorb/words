export const ui = {
  server: null,
  tentative: [],
  rackOrder: null,
  gameId: null
};

export function initGameId() {
  if (typeof window !== 'undefined' && window.__GAME__?.gameId) {
    ui.gameId = window.__GAME__.gameId;
    return;
  }
  // Legacy fallback (only if served the old way; should not happen in production)
  const m = location.pathname.match(/^\/play\/words\/(\d+)/) || location.pathname.match(/^\/game\/(\d+)/);
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

let _mePromise = null;
let _usersPromise = null;

function fetchMe() {
  _mePromise ??= fetch('/api/me').then(r => {
    if (!r.ok) throw new Error(`/api/me: ${r.status}`);
    return r.json();
  });
  return _mePromise;
}

function fetchUsersById() {
  _usersPromise ??= fetch('/api/users').then(r => {
    if (!r.ok) throw new Error(`/api/users: ${r.status}`);
    return r.json();
  }).then(arr => {
    const byId = new Map();
    for (const u of arr) byId.set(u.id, u);
    return byId;
  });
  return _usersPromise;
}

export async function fetchState() {
  const r = await fetch(`/api/games/${ui.gameId}`);
  if (r.status === 403) {
    const body = await r.json().catch(() => ({}));
    location.href = `/lockout?email=${encodeURIComponent(body.email || '')}`;
    return null;
  }
  if (r.status === 404) { location.href = '/'; return null; }
  if (!r.ok) throw new Error('state-fetch-failed');
  const payload = await r.json();
  const [meRes, usersById] = await Promise.all([fetchMe(), fetchUsersById()]);
  const me = meRes.user;
  const state = payload.state;
  const you = state.sides?.a === me.id ? 'a' : (state.sides?.b === me.id ? 'b' : null);
  const otherId = payload.playerAId === me.id ? payload.playerBId : payload.playerAId;
  const opp = usersById.get(otherId) ?? { friendlyName: '', color: '' };
  const currentTurn = state.sides?.a === state.activeUserId ? 'a'
                    : state.sides?.b === state.activeUserId ? 'b' : null;
  ui.server = {
    gameId: payload.id,
    you,
    opponent: { friendlyName: opp.friendlyName, color: opp.color },
    yourFriendlyName: me.friendlyName,
    yourColor: me.color,
    status: payload.status,
    currentTurn,
    board: state.board,
    bag: state.bag,
    racks: state.racks,
    scores: state.scores,
    consecutiveScorelessTurns: state.consecutiveScorelessTurns,
    endedReason: state.endedReason,
    winner: state.winnerSide,
    sides: state.sides,
    variant: state.variant,
  };
  if (!ui.rackOrder) ui.rackOrder = ui.server.racks[ui.server.you].slice();
  return ui.server;
}

export function gameUrl(suffix) {
  return `/api/games/${ui.gameId}/${suffix}`;
}
