/* Shared opponent portrait card.
   Self-mounts into <body> using window.__GAME__. Renders:
   - portrait (or color+glyph fallback)
   - name strip
   - speech bubble (banter, thinking dots) — sits inside the card
   - stall banner with retry/abandon — also inside the card
   Skips render entirely when the opponent is not an AI persona. */

const ctx = window.__GAME__ ?? {};

// Only render the card when we have a persona to portray. Human-vs-human
// games still get the friendly name in the existing header — we don't need
// a portrait card for them.
if (ctx.opponentPersonaId) {
  mount();
}

function mount() {
  const card = document.createElement('div');
  card.className = 'opp-card';
  card.id = 'opp-card';

  const portrait = document.createElement('div');
  portrait.className = 'opp-card__portrait';
  if (ctx.opponentColor) portrait.style.background = ctx.opponentColor;

  const img = new Image();
  img.alt = ctx.opponentFriendlyName ?? 'Opponent';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.display = 'none';
  img.addEventListener('load', () => {
    img.style.display = 'block';
    fallback.style.display = 'none';
  });
  img.addEventListener('error', () => { img.remove(); });
  img.src = `/shared/portraits/${ctx.opponentPersonaId}.png`;

  const fallback = document.createElement('span');
  fallback.className = 'opp-card__fallback';
  fallback.textContent = ctx.opponentGlyph ?? '?';

  portrait.append(fallback, img);

  const name = document.createElement('div');
  name.className = 'opp-card__name';
  name.textContent = ctx.opponentFriendlyName ?? 'Opponent';

  const bubble = document.createElement('div');
  bubble.className = 'opp-card__bubble';
  bubble.hidden = true;
  const bubbleText = document.createElement('span');
  const bubbleDots = document.createElement('span');
  bubbleDots.className = 'opp-card__dots';
  bubbleDots.hidden = true;
  bubbleDots.append(
    document.createElement('span'),
    document.createElement('span'),
    document.createElement('span'),
  );
  bubble.append(bubbleText, bubbleDots);

  const stall = document.createElement('div');
  stall.className = 'opp-card__stall';
  stall.hidden = true;
  const stallText = document.createElement('span');
  const stallActions = document.createElement('div');
  stallActions.className = 'opp-card__stall-actions';
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.textContent = 'Retry';
  const abandonBtn = document.createElement('button');
  abandonBtn.type = 'button';
  abandonBtn.textContent = 'Abandon';
  stallActions.append(retryBtn, abandonBtn);
  stall.append(stallText, stallActions);

  card.append(portrait, name, bubble, stall);
  document.body.appendChild(card);

  // ---------- Bubble queue ----------
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
    stallText.textContent = `${displayName} froze up (${reason}).`;
    stall.hidden = false;
    clearThinking();
  }
  function clearStall() {
    stall.hidden = true;
  }

  // ---------- SSE wiring ----------
  const es = new EventSource(ctx.sseUrl);
  es.addEventListener('bot_thinking', e => {
    const p = JSON.parse(e.data);
    clearStall();
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
}
