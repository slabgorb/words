const ctx = window.__GAME__;
const bubble = document.getElementById('opponent-bubble');
const bubbleText = document.getElementById('opp-bubble-text');
const bubbleDots = document.getElementById('opp-bubble-dots');
const stallBanner = document.getElementById('opp-stall-banner');
const stallText = document.getElementById('opp-stall-text');
const retryBtn = document.getElementById('opp-stall-retry');
const abandonBtn = document.getElementById('opp-stall-abandon');

let bubbleTimer = null;
const queue = [];
let showing = false;

function showBubbleNext() {
  if (showing) return;
  const next = queue.shift();
  if (!next) return;
  showing = true;
  bubbleText.textContent = next;
  bubbleDots.hidden = true;
  bubble.hidden = false;
  bubble.style.opacity = '1';
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubble.style.opacity = '0';
    setTimeout(() => {
      bubble.hidden = true;
      showing = false;
      showBubbleNext();
    }, 400);
  }, 5000);
}

function showThinking(displayName) {
  if (showing) return;
  bubbleText.textContent = `${displayName} is thinking`;
  bubbleDots.hidden = false;
  bubble.hidden = false;
  bubble.style.opacity = '1';
}
function clearThinking() {
  if (!bubbleDots.hidden) {
    bubble.hidden = true;
    bubbleDots.hidden = true;
  }
}
function showStall(displayName, reason) {
  stallText.textContent = `${displayName} froze up (${reason}). Retry or abandon?`;
  stallBanner.hidden = false;
  clearThinking();
}
function clearStall() {
  stallBanner.hidden = true;
}

const es = new EventSource(ctx.sseUrl);
es.addEventListener('bot_thinking', e => {
  const p = JSON.parse(e.data);
  showThinking(p.displayName);
});
es.addEventListener('banter', e => {
  const p = JSON.parse(e.data);
  if (p.text) {
    queue.push(p.text);
    clearThinking();
    showBubbleNext();
  }
});
es.addEventListener('bot_stalled', e => {
  const p = JSON.parse(e.data);
  showStall(p.displayName, p.reason);
});
es.addEventListener('update', () => clearThinking());

retryBtn.addEventListener('click', async () => {
  const r = await fetch(`/api/games/${ctx.gameId}/ai/retry`, { method: 'POST' });
  if (r.ok) clearStall();
  else alert(`retry failed: ${(await r.json().catch(() => ({}))).error || r.status}`);
});
abandonBtn.addEventListener('click', async () => {
  if (!confirm('End this game?')) return;
  const r = await fetch(`/api/games/${ctx.gameId}/ai/abandon`, { method: 'POST' });
  if (r.ok) { clearStall(); location.reload(); }
  else alert(`abandon failed: ${(await r.json().catch(() => ({}))).error || r.status}`);
});
