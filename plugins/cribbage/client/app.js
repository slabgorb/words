const ctx = window.__GAME__;
let state = null;

async function fetchState() {
  const r = await fetch(ctx.stateUrl);
  if (!r.ok) throw new Error(`state fetch failed: ${r.status}`);
  const data = await r.json();
  state = data.state ?? data;
  render();
}

async function send(action) {
  const r = await fetch(ctx.actionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    alert(body.error ?? `action failed (${r.status})`);
    return null;
  }
  state = body.state ?? state;
  render();
  return body;
}

function render() {
  const banner = document.getElementById('phase-banner');
  banner.textContent = `Phase: ${state?.phase ?? '…'}`;
  if (state) {
    const myUserId = ctx.userId;
    const mySide = state.sides.a === myUserId ? 0 : 1;
    document.getElementById('me-score').textContent = state.scores[mySide];
    document.getElementById('opp-score').textContent = state.scores[1 - mySide];
    document.getElementById('me-name').textContent = ctx.yourFriendlyName ?? 'You';
    document.getElementById('opp-name').textContent = ctx.opponentFriendlyName ?? 'Opponent';
  }
}

const es = new EventSource(ctx.sseUrl);
es.addEventListener('update', () => fetchState());
es.addEventListener('ended', () => fetchState());

window.__cribbage__ = { send };

fetchState();
