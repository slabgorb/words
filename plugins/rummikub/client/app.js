const ctx = window.__GAME__;
let state = null;

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

  document.getElementById('my-score').textContent = state.scores[mySide];
  document.getElementById('opp-score').textContent = state.scores[oppSide];
  document.getElementById('turn-indicator').textContent =
    state.activeUserId === myUserId ? 'Your turn' : "Opponent's turn";
  document.getElementById('pool-count').textContent = state.pool.count;
  document.getElementById('opp-rack-count').textContent = state.opponentRack.count;

  // Meld indicator
  const meldEl = document.getElementById('meld-indicator');
  if (!state.initialMeldComplete[mySide]) {
    meldEl.classList.remove('hidden');
    document.getElementById('meld-points').textContent = '0';
  } else {
    meldEl.classList.add('hidden');
  }

  // Render table and rack as text for now (Tasks 11-12 give them real DOM)
  const tableEl = document.getElementById('table');
  tableEl.textContent = JSON.stringify(state.table);
  const rackEl = document.getElementById('rack');
  rackEl.textContent = JSON.stringify(state.racks[mySide] ?? []);

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
  es.onerror = () => {/* let browser auto-reconnect */};
}

fetchState();
openSSE();
