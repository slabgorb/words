async function fetchJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const PLUGIN_META = {
  words:      { icon: '📝', tagline: 'Cross-word tile game' },
  rummikub:   { icon: '🟦', tagline: 'Tile runs and groups' },
  backgammon: { icon: '⚀',  tagline: 'Race off the board' },
};
const PLUGIN_VARIANTS = {
  words: [
    { variant: 'wwf',      label: 'Words (with Friends)' },
    { variant: 'scrabble', label: 'Scrabble rules' },
  ],
};

function metaFor(gameType) {
  return PLUGIN_META[gameType] ?? { icon: '🎲', tagline: '' };
}

function variantLabel(gameType, variant) {
  if (!variant) return '';
  const v = (PLUGIN_VARIANTS[gameType] ?? []).find(x => x.variant === variant);
  return v?.label ?? variant;
}

function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const s = Math.max(1, Math.round(d / 1000));
  if (s < 60)            return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60)            return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48)            return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 14)         return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}

function avatarInitial(name) {
  if (!name) return '?';
  return name.trim().slice(0, 1).toUpperCase();
}

function setAvatar(el, user) {
  el.textContent = avatarInitial(user.friendlyName);
  if (user.color) el.style.background = user.color;
}

// --- Card builders -----------------------------------------------------

function activeCard(game) {
  const meta = metaFor(game.gameType);
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `/play/${game.gameType}/${game.id}/`;

  const variantText = variantLabel(game.gameType, game.variant);
  const titleSuffix = variantText ? ` <span class="variant">· ${variantText}</span>` : '';

  a.innerHTML = `
    <span class="rail" style="background: ${escapeAttr(game.opponent.color || '#1a73e8')}"></span>
    <span class="icon">${meta.icon}</span>
    <span class="body">
      <span class="title">${escapeHtml(displayName(game.gameType))}${titleSuffix}</span>
      <span class="opp">vs <span class="opp-name" style="color: ${escapeAttr(game.opponent.color || 'inherit')}">${escapeHtml(game.opponent.friendlyName)}</span> ·
        <span class="score">${game.yourScore} — ${game.theirScore}</span>
      </span>
      <span class="meta">${escapeHtml(metaLine(game))}</span>
    </span>
    <span class="chevron-go" aria-hidden="true">›</span>
  `;
  return a;
}

function endedCard(game) {
  const meta = metaFor(game.gameType);
  const a = document.createElement('a');
  a.className = 'card ended';
  a.href = `/play/${game.gameType}/${game.id}/`;

  const outcome = endedOutcomeText(game);

  a.innerHTML = `
    <span class="rail" style="background: ${escapeAttr(game.opponent.color || '#999')}"></span>
    <span class="icon">${meta.icon}</span>
    <span class="body">
      <span class="title">${escapeHtml(displayName(game.gameType))}</span>
      <span class="opp">${escapeHtml(outcome)} · ${relTime(game.updatedAt)}</span>
    </span>
    <span></span>
  `;
  return a;
}

function metaLine(game) {
  const ago = relTime(game.updatedAt);
  return game.yourTurn ? `Your move · ${ago}` : `${game.opponent.friendlyName}'s move · ${ago}`;
}

function endedOutcomeText(game) {
  const opp = game.opponent.friendlyName;
  if (game.winnerSide && game.winnerSide === game.you)        return `You won vs ${opp}`;
  if (game.winnerSide && game.winnerSide !== game.you)        return `${opp} won`;
  if (game.endedReason === 'draw' || game.winnerSide === 'draw') return `Draw with ${opp}`;
  return `Ended vs ${opp}`;
}

// Display-name fallback chain: PLUGIN_META has tagline only; we want the
// human label too. Use the registry data fetched alongside.
let DISPLAY_NAMES = {};
function displayName(gameType) {
  return DISPLAY_NAMES[gameType] ?? gameType;
}

// --- Escapes -----------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

// --- Render ------------------------------------------------------------

function renderBucket(sectionEl, listEl, countEl, items, builder) {
  listEl.innerHTML = '';
  if (items.length === 0) {
    sectionEl.hidden = true;
    return;
  }
  sectionEl.hidden = false;
  if (countEl) countEl.textContent = items.length;
  for (const g of items) listEl.appendChild(builder(g));
}

async function main() {
  const [meRes, plugins] = await Promise.all([
    fetchJson('/api/me').catch(() => null),
    fetchJson('/api/plugins').then(r => r.plugins).catch(() => []),
  ]);
  const me = meRes?.user ?? null;
  if (!me) {
    document.getElementById('me-name').textContent = '';
    return;
  }

  for (const p of plugins) DISPLAY_NAMES[p.id] = p.displayName;

  // Header avatar + name
  const meName = document.getElementById('me-name');
  meName.textContent = me.friendlyName;
  setAvatar(document.getElementById('me-avatar'), me);

  const games = meRes.games ?? [];
  const active = games.filter(g => g.status === 'active');
  const ended  = games.filter(g => g.status === 'ended');

  // Your move: oldest activity first (most-overdue rises)
  const yours  = active.filter(g => g.yourTurn).sort((a, b) => a.updatedAt - b.updatedAt);
  // Theirs: most-recent first
  const theirs = active.filter(g => !g.yourTurn).sort((a, b) => b.updatedAt - a.updatedAt);
  // Ended: most-recent first, cap at 5
  const recentEnded = ended.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);

  renderBucket(
    document.getElementById('sec-yours'),
    document.getElementById('list-yours'),
    document.getElementById('count-yours'),
    yours, activeCard
  );

  // Personalize "Waiting on X" when a single opponent dominates
  const theirsLabel = document.getElementById('theirs-label');
  if (theirs.length > 0) {
    const oppNames = new Set(theirs.map(g => g.opponent.friendlyName));
    theirsLabel.textContent = oppNames.size === 1 ? [...oppNames][0] : 'others';
  }
  renderBucket(
    document.getElementById('sec-theirs'),
    document.getElementById('list-theirs'),
    document.getElementById('count-theirs'),
    theirs, activeCard
  );

  renderBucket(
    document.getElementById('sec-ended'),
    document.getElementById('list-ended'),
    document.getElementById('count-ended'),
    recentEnded, endedCard
  );

  // Meta sections (empty / caught-up)
  const empty = document.getElementById('sec-empty');
  const caughtUp = document.getElementById('sec-caught-up');
  if (active.length === 0 && ended.length === 0) {
    empty.hidden = false;
  } else if (yours.length === 0 && theirs.length > 0) {
    caughtUp.hidden = false;
    const oppNames = new Set(theirs.map(g => g.opponent.friendlyName));
    document.getElementById('caught-up-label').textContent =
      oppNames.size === 1 ? `waiting on ${[...oppNames][0]}` : 'waiting on others';
  }

  // Default-collapse ended bucket if it has more than 3
  const toggle = document.getElementById('ended-toggle');
  if (recentEnded.length > 3) toggle.setAttribute('aria-expanded', 'false');

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
  });

  // Reveal main content + FAB
  document.getElementById('lobby').hidden = false;
  document.getElementById('fab').hidden = false;
  wireNewGame(me, plugins);
}

// --- New-game flow -----------------------------------------------------

function wireNewGame(me, plugins) {
  const fab = document.getElementById('fab');
  const dlg = document.getElementById('newgame');
  const stepsEl = document.getElementById('ng-steps');
  const titleEl = document.getElementById('ng-title');
  const cancel = document.getElementById('ng-cancel');

  cancel.onclick = () => dlg.close();
  dlg.addEventListener('cancel', () => dlg.close());  // ESC

  fab.onclick = async () => {
    const users = await fetchJson('/api/users').then(arr => arr.filter(u => u.id !== me.id));
    if (users.length === 0) {
      alert("You're the only player on this server.");
      return;
    }
    if (users.length === 1) {
      showGameStep(users[0], plugins);
    } else {
      showOpponentStep(users, plugins);
    }
    dlg.showModal();
  };

  function showOpponentStep(users, plugins) {
    titleEl.textContent = 'Pick an opponent';
    stepsEl.innerHTML = '';
    for (const u of users) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ng-tile';
      btn.innerHTML = `
        <span class="tile-icon" style="display:inline-grid;place-items:center;width:32px;height:32px;border-radius:999px;background:${escapeAttr(u.color || '#888')};color:#fff;font-size:0.85rem;font-weight:700">${escapeHtml(avatarInitial(u.friendlyName))}</span>
        <span class="tile-body">${escapeHtml(u.friendlyName)}</span>`;
      btn.onclick = () => showGameStep(u, plugins);
      li.appendChild(btn);
      stepsEl.appendChild(li);
    }
  }

  function showGameStep(opponent, plugins) {
    titleEl.textContent = `New game vs ${opponent.friendlyName}`;
    stepsEl.innerHTML = '';
    for (const p of plugins) {
      const meta = metaFor(p.id);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ng-tile';
      btn.innerHTML = `
        <span class="tile-icon">${meta.icon}</span>
        <span class="tile-body">${escapeHtml(p.displayName)}<span class="tile-meta">${escapeHtml(meta.tagline)}</span></span>`;
      btn.onclick = () => {
        if (PLUGIN_VARIANTS[p.id]) showVariantStep(opponent, p);
        else startGame(opponent, p.id, null);
      };
      li.appendChild(btn);
      stepsEl.appendChild(li);
    }
  }

  function showVariantStep(opponent, plugin) {
    titleEl.textContent = plugin.displayName;
    stepsEl.innerHTML = '';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ng-back';
    back.textContent = 'back';
    back.onclick = () => showGameStep(opponent, plugins);
    stepsEl.appendChild(back);
    for (const v of PLUGIN_VARIANTS[plugin.id]) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ng-tile';
      btn.innerHTML = `<span class="tile-icon">${metaFor(plugin.id).icon}</span><span class="tile-body">${escapeHtml(v.label)}</span>`;
      btn.onclick = () => startGame(opponent, plugin.id, v.variant);
      li.appendChild(btn);
      stepsEl.appendChild(li);
    }
  }

  async function startGame(opponent, gameType, variant) {
    const body = { opponentId: opponent.id, gameType };
    if (variant) body.variant = variant;
    const r = await fetch('/api/games', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error ?? 'failed to create game');
      return;
    }
    const { id, gameType: gt } = await r.json();
    window.location.href = `/play/${gt}/${id}/`;
  }
}

main().catch(err => { document.body.innerHTML = `<pre>${err.stack || err.message}</pre>`; });
