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
    body: JSON.stringify(action),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    alert(body.error ?? `action failed (${r.status})`);
    return null;
  }
  if (body.state) {
    state = body.state;
    render();
  }
  return body;
}

function mySide() {
  return state.sides.a === ctx.userId ? 'a' : 'b';
}

function bannerText() {
  const me = mySide();
  if (state.phase === 'game-end') return state.winner === me ? 'You won the match!' : 'Opponent won the match.';
  if (state.phase === 'deal-end') return 'Deal ended — scoring…';
  if (state.currentTurn !== me) return `Waiting for opponent…`;
  if (state.phase === 'draw') return 'Your turn — draw a card';
  if (state.phase === 'meld') return 'Your turn — meld or discard';
  return state.phase;
}

function render() {
  if (!state) return;
  const me = mySide();
  const opp = me === 'a' ? 'b' : 'a';
  document.getElementById('me-name').textContent = ctx.yourFriendlyName ?? 'You';
  document.getElementById('opp-name').textContent = ctx.opponentFriendlyName ?? 'Opponent';
  document.getElementById('me-score').textContent = state.scores[me]?.total ?? 0;
  document.getElementById('opp-score').textContent = state.scores[opp]?.total ?? 0;
  document.getElementById('phase-banner').textContent = bannerText();
}

const es = new EventSource(ctx.sseUrl);
es.addEventListener('update', () => fetchState());
es.addEventListener('ended', () => fetchState());

window.__buraco__ = { send };

fetchState();
