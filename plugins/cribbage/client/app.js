import { renderMyHand, renderOpponentHand, getSelection, clearSelection } from './hand.js';
import { renderCard } from './card.js';
import { renderPeggingStrip, isPlayable } from './pegging.js';
import { renderShow, hideShow } from './show.js';
import { renderPegBoard } from './peg-board.js';
import { play, playForScore, primeAudio, isMuted, toggleMuted } from './sounds.js';

const ctx = window.__GAME__;
let state = null;
let prevState = null;       // last rendered state — drives transition detection
let myUserIdNumeric = ctx.userId;

async function fetchState() {
  const r = await fetch(ctx.stateUrl);
  if (!r.ok) throw new Error(`state fetch failed: ${r.status}`);
  const data = await r.json();
  const incoming = data.state ?? data;
  applyTransition(prevState, incoming);
  prevState = state;
  state = incoming;
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
    applyTransition(prevState, body.state);
    prevState = state;
    state = body.state;
    render();
  }
  return body;
}

function bannerText(state, mySide) {
  const myTurn = state.activeUserId === ctx.userId;
  const isDealer = mySide === state.dealer;
  switch (state.phase) {
    case 'discard':
      return `Discard 2 to ${isDealer ? 'your' : "your opponent's"} crib`;
    case 'cut':
      return isDealer ? 'Waiting for opponent to cut…' : 'Cut the deck';
    case 'pegging':
      return myTurn ? `Your play — running ${state.pegging.running}` : `Opponent's play — running ${state.pegging.running}`;
    case 'show':
      return 'Hand counts';
    case 'match-end': {
      const me = state.scores[mySide];
      const opp = state.scores[1 - mySide];
      const won = state.winnerSide === (mySide === 0 ? 'a' : 'b');
      const skunked = (won ? opp : me) < 91;
      const margin = skunked ? ' — skunk!' : '';
      return won
        ? `You won the match, ${me} to ${opp}${margin}`
        : `Opponent won the match, ${opp} to ${me}${margin}`;
    }
  }
  return state.phase;
}

function render() {
  if (!state) return;
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 0 : 1;
  const oppSide = 1 - mySide;
  document.getElementById('me-score').textContent = state.scores[mySide];
  document.getElementById('opp-score').textContent = state.scores[oppSide];
  document.getElementById('me-name').textContent = ctx.yourFriendlyName ?? 'You';
  document.getElementById('opp-name').textContent = ctx.opponentFriendlyName ?? 'Opponent';

  const banner = document.getElementById('phase-banner');
  const oppArea = document.getElementById('opp-area');
  const meArea = document.getElementById('me-area');
  const pegBoard = document.getElementById('peg-board');
  if (pegBoard) renderPegBoard(pegBoard, state, ctx);

  banner.textContent = bannerText(state, mySide);

  if (state.phase === 'discard') {
    const mySubmitted = state.pendingDiscards?.[mySide] != null;
    if (mySubmitted) {
      banner.textContent = 'Waiting for opponent to discard…';
    } else {
      banner.innerHTML = `${bannerText(state, mySide)} <button id="btn-discard" disabled>Send to crib</button>`;
    }
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    renderMyHand(meArea, state.hands[mySide], mySubmitted ? 'view' : 'discard', () => updateDiscardBtn());
    if (!mySubmitted) {
      updateDiscardBtn();
      document.getElementById('btn-discard').onclick = async () => {
        const sel = getSelection();
        if (sel.length !== 2) return;
        const r = await window.__cribbage__.send({ type: 'discard', payload: { cards: sel } });
        if (r) { clearSelection(); play('swoosh'); }
      };
    }
  } else if (state.phase === 'cut') {
    const isNonDealer = mySide !== state.dealer;
    if (isNonDealer) {
      banner.innerHTML = `${bannerText(state, mySide)} <button id="btn-cut">Cut</button>`;
    }
    renderMyHand(meArea, state.hands[mySide], 'view');
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 4);
    const slot = document.getElementById('starter');
    slot.innerHTML = '';
    const back = renderCard(null, { faceDown: true });
    slot.appendChild(back);
    if (isNonDealer) {
      document.getElementById('btn-cut').onclick = () => {
        play('swoosh');
        window.__cribbage__.send({ type: 'cut' });
      };
    }
  } else if (state.phase === 'pegging') {
    const myTurn = state.activeUserId === myUserId;
    renderPeggingStrip(document.getElementById('pegging-strip'), state.pegging);
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    meArea.innerHTML = '';
    for (const card of state.hands[mySide]) {
      const el = renderCard(card);
      const playable = isPlayable(card, state.pegging) && myTurn;
      if (!playable) el.classList.add('is-disabled');
      if (playable) el.addEventListener('click', () => {
        play('click');
        window.__cribbage__.send({ type: 'play', payload: { card } });
      });
      meArea.appendChild(el);
    }
    const slot = document.getElementById('starter');
    slot.innerHTML = '';
    if (state.starter) slot.appendChild(renderCard(state.starter));
  } else {
    // show / match-end — peg areas show resolved hands face-up
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    renderMyHand(meArea, Array.isArray(state.hands[mySide]) ? state.hands[mySide] : [], 'view');
    const slot = document.getElementById('starter');
    slot.innerHTML = '';
    if (state.starter) slot.appendChild(renderCard(state.starter));
  }

  // Show overlay: visible during 'show' and at 'match-end' if a breakdown
  // was computed (so a mid-show pegout is still visible to both players).
  const overlay = document.getElementById('show-overlay');
  if ((state.phase === 'show' || state.phase === 'match-end') && state.showBreakdown) {
    renderShow(overlay, state, ctx.userId, () => window.__cribbage__.send({ type: 'next' }));
  } else {
    hideShow(overlay);
  }

  // Skunk banner — overlaid only at match-end with loser < 91.
  renderSkunkBanner(state, mySide);
}

function updateDiscardBtn() {
  const btn = document.getElementById('btn-discard');
  if (!btn) return;
  btn.disabled = getSelection().length !== 2;
}

// Pacing aids triggered by phase transitions between snapshots.
function applyTransition(prev, next) {
  if (!prev || !next) return;
  // Activated turn boundary: not-my-turn → my-turn
  const wasMine = prev.activeUserId === ctx.userId;
  const isMine = next.activeUserId === ctx.userId;
  if (!wasMine && isMine && next.phase === 'pegging') play('your-turn');

  // Match end transition
  if (prev.phase !== 'match-end' && next.phase === 'match-end') {
    const mySide = next.sides.a === ctx.userId ? 0 : 1;
    const won = next.winnerSide === (mySide === 0 ? 'a' : 'b');
    const loserScore = won ? next.scores[1 - mySide] : next.scores[mySide];
    play('cheer-100');
    if (loserScore < 91) {
      // Skunk — a second beat after the cheer
      setTimeout(() => play('cheer-50'), 600);
    }
  }

  // Deal boundary: show → discard means a fresh deal began. Show a
  // summary toast describing what just happened so players don't lose
  // the moment.
  if (prev.phase === 'show' && next.phase === 'discard' && prev.showBreakdown) {
    const summary = formatDealSummary(prev, next);
    if (summary) showToast(summary, 4500);
  }

  // Score motion → tiered cheer
  for (let side = 0; side < 2; side++) {
    const prevS = prev.scores?.[side] ?? 0;
    const nextS = next.scores?.[side] ?? 0;
    const delta = nextS - prevS;
    if (delta > 0 && next.phase !== 'match-end') {
      // Don't double up with match-end cheer
      playForScore(delta);
    }
  }
}

function formatDealSummary(prev, next) {
  const aName = (next.sides.a === ctx.userId ? ctx.yourFriendlyName : ctx.opponentFriendlyName) ?? 'A';
  const bName = (next.sides.b === ctx.userId ? ctx.yourFriendlyName : ctx.opponentFriendlyName) ?? 'B';
  const aGain = (prev.scores?.[0] ?? 0) - (prev.prevScores?.[0] ?? 0);
  const bGain = (prev.scores?.[1] ?? 0) - (prev.prevScores?.[1] ?? 0);
  return `Deal ${prev.dealNumber ?? ''} → ${next.dealNumber ?? ''}. ${aName} ${prev.scores[0]}, ${bName} ${prev.scores[1]}.`;
}

function renderSkunkBanner(state, mySide) {
  const existing = document.getElementById('skunk-banner');
  if (state.phase !== 'match-end') {
    if (existing) existing.remove();
    return;
  }
  const won = state.winnerSide === (mySide === 0 ? 'a' : 'b');
  const loserScore = won ? state.scores[1 - mySide] : state.scores[mySide];
  if (loserScore >= 91) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return; // already shown
  const el = document.createElement('div');
  el.id = 'skunk-banner';
  el.className = 'skunk-banner';
  el.setAttribute('role', 'alert');
  el.textContent = won ? `SKUNKED! ${loserScore} to ${state.scores[mySide]}` : `Skunked. ${loserScore} to ${state.scores[1 - mySide]}.`;
  document.body.appendChild(el);
  // Animate in/out — sticks for 4 seconds then fades
  requestAnimationFrame(() => el.classList.add('skunk-banner--show'));
  setTimeout(() => {
    el.classList.remove('skunk-banner--show');
    setTimeout(() => el.remove(), 600);
  }, 4500);
}

const es = new EventSource(ctx.sseUrl);
es.addEventListener('update', () => fetchState());
es.addEventListener('ended', () => fetchState());
es.addEventListener('turn', (e) => {
  try {
    const data = JSON.parse(e.data);
    const events = data?.payload?.summary?.events ?? data?.summary?.events;
    if (!Array.isArray(events) || events.length === 0) return;
    const sideTag = data?.payload?.side ?? data?.side;
    const actorName = sideTag
      ? (state?.sides?.[sideTag] === ctx.userId ? (ctx.yourFriendlyName ?? 'You') : (ctx.opponentFriendlyName ?? 'Opponent'))
      : null;
    const text = events.map(ev => formatEventText(ev, actorName)).filter(Boolean).join(' · ');
    if (text) showToast(text);
  } catch { /* ignore malformed */ }
});

function formatEventText(ev, actorName) {
  if (!ev?.say) return '';
  const prefix = actorName ? `${actorName}: ` : '';
  return prefix + ev.say;
}

function showToast(text, duration = 2400) {
  const layer = document.getElementById('toast-layer') ?? (() => {
    const el = document.createElement('div');
    el.id = 'toast-layer';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    document.body.appendChild(el);
    return el;
  })();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  layer.appendChild(t);
  setTimeout(() => t.classList.add('toast--show'), 10);
  setTimeout(() => {
    t.classList.remove('toast--show');
    setTimeout(() => t.remove(), 400);
  }, duration);
}

// Mute toggle
function syncMuteBtn() {
  const btn = document.getElementById('btn-mute');
  if (!btn) return;
  btn.textContent = isMuted() ? '🔇' : '🔊';
  btn.setAttribute('aria-pressed', isMuted() ? 'true' : 'false');
}
syncMuteBtn();
document.getElementById('btn-mute')?.addEventListener('click', () => {
  toggleMuted();
  syncMuteBtn();
  if (!isMuted()) play('click');
});

// Browsers gate Audio.play() until user interaction. Prime on first click anywhere.
document.addEventListener('click', () => primeAudio(), { once: true });

window.__cribbage__ = { send };

fetchState();
