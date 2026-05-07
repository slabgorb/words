// Gamebox lobby — "Game Shelf" skeuomorphic build.
// Vanilla JS, no build step. Renders top-down board-game-lid cards into
// the same DOM structure the previous lobby.js used (#sec-yours, etc).

async function fetchJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const PLUGIN_META = {
  words:      { tagline: 'Cross-word tile game' },
  rummikub:   { tagline: 'Tile runs and groups' },
  backgammon: { tagline: 'Race off the board' },
};
const PLUGIN_VARIANTS = {
  words: [
    { variant: 'wwf',      label: 'Words with Friends' },
    { variant: 'scrabble', label: 'Scrabble rules' },
  ],
};

let DISPLAY_NAMES = {};
function displayName(gameType) { return DISPLAY_NAMES[gameType] ?? gameType; }
function variantLabel(gameType, variant) {
  if (!variant) return '';
  const v = (PLUGIN_VARIANTS[gameType] ?? []).find(x => x.variant === variant);
  return v?.label ?? variant;
}
function tagline(gameType) { return PLUGIN_META[gameType]?.tagline ?? ''; }

function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const s = Math.max(1, Math.round(d / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 14) return `${days}d ago`;
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
  if (user.glyph) el.dataset.glyph = user.glyph; else delete el.dataset.glyph;
}
function glyphMark(user) {
  return user?.glyph ? ` <span class="glyph-mark" aria-hidden="true">${escapeHtml(user.glyph)}</span>` : '';
}
function glyphAttr(user) {
  return user?.glyph ? ` data-glyph="${escapeAttr(user.glyph)}"` : '';
}
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

// Per-game illustrated box-lid art — inline SVG strings.
// Each takes a `variant` for words; others ignore it.

function boxArtWords(variant) {
  const accent = variant === 'scrabble' ? '#cf3a2c' : '#d97757';
  const accent2 = variant === 'scrabble' ? '#3a6db0' : '#c2a14e';
  const tiles = [['W',4],['O',1],['R',1],['D',2],['S',1]];
  const tileSvgs = tiles.map(([ch, val], i) => `
    <g transform="translate(${i*30}, 0)">
      <rect x="0" y="0" width="26" height="30" rx="2.5" fill="#fff8e3" stroke="#9a7e3a" stroke-width="0.8"/>
      <rect x="0" y="0" width="26" height="3" fill="#000" opacity="0.06"/>
      <text x="13" y="19" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="15" fill="#3a2a18">${ch}</text>
      <text x="21" y="26" text-anchor="middle" font-family="Georgia, serif" font-weight="600" font-size="6" fill="#3a2a18">${val}</text>
    </g>`).join('');
  let grid = '';
  for (let i = 0; i < 9; i++) grid += `<line x1="0" x2="420" y1="${i*15}" y2="${i*15}"/>`;
  for (let i = 0; i < 29; i++) grid += `<line y1="0" y2="120" x1="${i*15}" x2="${i*15}"/>`;
  return `
    <svg viewBox="0 0 420 120" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="aw-paper-${variant||'wwf'}" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="#f3ead3"/>
          <circle cx="1" cy="1" r="0.3" fill="#c9b88a" opacity="0.4"/>
        </pattern>
      </defs>
      <rect width="420" height="120" fill="url(#aw-paper-${variant||'wwf'})"/>
      <g stroke="#c9b88a" stroke-width="0.4" opacity="0.5">${grid}</g>
      <rect x="30" y="18" width="15" height="15" fill="${accent}" opacity="0.85"/>
      <rect x="375" y="87" width="15" height="15" fill="${accent2}" opacity="0.85"/>
      <rect x="105" y="75" width="15" height="15" fill="${accent}" opacity="0.7"/>
      <rect x="330" y="30" width="15" height="15" fill="${accent2}" opacity="0.7"/>
      <g transform="translate(135, 45)">${tileSvgs}</g>
    </svg>`;
}

function boxArtRummikub() {
  const tiles = [
    {n:8, c:'#3a6db0'}, {n:9, c:'#3a6db0'}, {n:10, c:'#3a6db0'}, {n:11, c:'#3a6db0'}, {n:12, c:'#3a6db0'},
  ];
  const sevens = [{n:7,c:'#cf3a2c'},{n:7,c:'#3a6db0'},{n:7,c:'#1f6b3a'},{n:7,c:'#2a1808'}];
  const tileGroup = (arr) => arr.map((t,i) => `
    <g transform="translate(${i*24}, 0)">
      <rect x="0" y="0" width="22" height="32" rx="3" fill="#f7f0d8" stroke="#5a4a2a" stroke-width="0.6"/>
      <rect x="0" y="0" width="22" height="3" fill="#fff" opacity="0.5"/>
      <text x="11" y="24" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="18" fill="${t.c}">${t.n}</text>
    </g>`).join('');
  return `
    <svg viewBox="0 0 420 120" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="ar-felt" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect width="2" height="2" fill="#1d4f47"/>
          <circle cx="1" cy="1" r="0.3" fill="#2a6960" opacity="0.6"/>
        </pattern>
      </defs>
      <rect width="420" height="120" fill="url(#ar-felt)"/>
      <path d="M8 8 H40 M8 8 V36" stroke="#c9a14e" stroke-width="1.2" fill="none"/>
      <path d="M412 112 H380 M412 112 V84" stroke="#c9a14e" stroke-width="1.2" fill="none"/>
      <g transform="translate(50, 22)">${tileGroup(tiles)}</g>
      <g transform="translate(110, 70)">${tileGroup(sevens)}</g>
      <g transform="translate(360, 24) rotate(12)">
        <rect x="0" y="0" width="22" height="32" rx="3" fill="#f7f0d8" stroke="#5a4a2a" stroke-width="0.6"/>
        <text x="11" y="24" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="20" fill="#cf3a2c">★</text>
      </g>
      <g transform="translate(330, 76) rotate(-8)">
        <rect x="0" y="0" width="22" height="32" rx="3" fill="#f7f0d8" stroke="#5a4a2a" stroke-width="0.6"/>
        <text x="11" y="24" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="18" fill="#1f6b3a">13</text>
      </g>
    </svg>`;
}

function boxArtBackgammon() {
  let pts = '';
  for (let i = 0; i < 6; i++) {
    const x = 28 + i*26;
    const c1 = i%2 ? '#3a1f12' : '#fff5d8';
    const c2 = i%2 ? '#fff5d8' : '#3a1f12';
    pts += `<path d="M${x},17 L${x+22},17 L${x+11},58 Z" fill="${c1}"/>`;
    pts += `<path d="M${x},103 L${x+22},103 L${x+11},62 Z" fill="${c2}"/>`;
  }
  for (let i = 0; i < 6; i++) {
    const x = 230 + i*26;
    const c1 = i%2 ? '#fff5d8' : '#3a1f12';
    const c2 = i%2 ? '#3a1f12' : '#fff5d8';
    pts += `<path d="M${x},17 L${x+22},17 L${x+11},58 Z" fill="${c1}"/>`;
    pts += `<path d="M${x},103 L${x+22},103 L${x+11},62 Z" fill="${c2}"/>`;
  }
  return `
    <svg viewBox="0 0 420 120" preserveAspectRatio="xMidYMid slice">
      <rect width="420" height="120" fill="#7a3a28"/>
      <rect x="15" y="15" width="390" height="90" fill="#c9a872" stroke="#3a1f12" stroke-width="1.2"/>
      ${pts}
      <rect x="206" y="15" width="8" height="90" fill="#3a1f12"/>
      <circle cx="39" cy="96" r="7" fill="#f7e7c2" stroke="#5a3a18" stroke-width="0.6"/>
      <circle cx="39" cy="83" r="7" fill="#f7e7c2" stroke="#5a3a18" stroke-width="0.6"/>
      <circle cx="39" cy="70" r="7" fill="#f7e7c2" stroke="#5a3a18" stroke-width="0.6"/>
      <circle cx="377" cy="24" r="7" fill="#3a1f12" stroke="#1a0a04" stroke-width="0.6"/>
      <circle cx="377" cy="37" r="7" fill="#3a1f12" stroke="#1a0a04" stroke-width="0.6"/>
      <g transform="translate(310, 50) rotate(-8)">
        <rect x="0" y="0" width="26" height="26" rx="3.5" fill="#fff8e3" stroke="#3a1f12" stroke-width="0.8"/>
        <circle cx="7" cy="7"  r="1.7" fill="#3a1f12"/>
        <circle cx="19" cy="19" r="1.7" fill="#3a1f12"/>
        <circle cx="13" cy="13" r="1.7" fill="#3a1f12"/>
      </g>
      <g transform="translate(342, 66) rotate(15)">
        <rect x="0" y="0" width="26" height="26" rx="3.5" fill="#fff8e3" stroke="#3a1f12" stroke-width="0.8"/>
        <circle cx="7" cy="7"  r="1.7" fill="#cf3a2c"/>
        <circle cx="19" cy="7" r="1.7" fill="#cf3a2c"/>
        <circle cx="7" cy="19" r="1.7" fill="#cf3a2c"/>
        <circle cx="19" cy="19" r="1.7" fill="#cf3a2c"/>
      </g>
    </svg>`;
}

function boxArt(gameType, variant) {
  if (gameType === 'words')      return boxArtWords(variant);
  if (gameType === 'rummikub')   return boxArtRummikub();
  if (gameType === 'backgammon') return boxArtBackgammon();
  return `<svg viewBox="0 0 200 120"><rect width="200" height="120" fill="#e9d9a8"/></svg>`;
}

// Card builders

function activeCard(game) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `/play/${game.gameType}/${game.id}/`;

  const yourTurn = !!game.yourTurn;
  const overdue  = yourTurn && (Date.now() - game.updatedAt) > 24*60*60*1000;

  const variantText = variantLabel(game.gameType, game.variant);
  const variantHTML = variantText ? `<div class="variant">${escapeHtml(variantText)}</div>` : '';
  const meta = yourTurn
    ? `Your move · ${escapeHtml(relTime(game.updatedAt))}`
    : `${escapeHtml(game.opponent.friendlyName)} is pondering · ${escapeHtml(relTime(game.updatedAt))}`;
  const oppColor = game.opponent.color || '#1a73e8';

  a.innerHTML = `
    <div class="lid">${boxArt(game.gameType, game.variant)}
      <div class="titlestrip">
        <div class="title">${escapeHtml(displayName(game.gameType))}</div>
        ${variantHTML}
      </div>
    </div>
    <div class="sideband">
      <div>
        <div class="opp-row">
          <span class="opp-mono"${glyphAttr(game.opponent)} style="background:${escapeAttr(oppColor)}">${escapeHtml(avatarInitial(game.opponent.friendlyName))}</span>
          <span><span class="opp-vs">vs.</span> <strong class="opp-name" style="color:${escapeAttr(oppColor)}">${escapeHtml(game.opponent.friendlyName)}${glyphMark(game.opponent)}</strong></span>
        </div>
        <div class="meta">${meta}</div>
      </div>
      <div class="score-row">
        <div class="score">${game.yourScore}<span class="dash">–</span>${game.theirScore}</div>
        ${yourTurn ? '' : '<span class="chev" aria-hidden="true">›</span>'}
      </div>
    </div>
    ${yourTurn ? `<div class="plaque">Your Move<span class="rv-bl"></span><span class="rv-br"></span></div>` : ''}
    ${overdue   ? `<div class="nudge">⚐ they've been waiting</div>` : ''}
  `;
  return a;
}

function endedCard(game) {
  const a = document.createElement('a');
  a.className = 'card ended';
  a.href = `/play/${game.gameType}/${game.id}/`;

  const oppColor = game.opponent.color || '#999';
  const won = game.winnerSide && game.winnerSide === game.you;
  const opp = game.opponent.friendlyName;
  const outcome = won ? `You won` :
    (game.endedReason === 'draw' || game.winnerSide === 'draw') ? `Draw with ${opp}` :
    game.winnerSide ? `${opp} won` :
    `Ended vs ${opp}`;

  a.innerHTML = `
    <div class="lid">${boxArt(game.gameType, game.variant)}
      <div class="titlestrip">
        <div class="title">${escapeHtml(displayName(game.gameType))}</div>
      </div>
    </div>
    <div class="sideband">
      <div>
        <div class="opp-row">
          <span class="opp-mono"${glyphAttr(game.opponent)} style="background:${escapeAttr(oppColor)}">${escapeHtml(avatarInitial(opp))}</span>
          <span class="opp-name" style="color:${escapeAttr(oppColor)}">${escapeHtml(outcome)}${glyphMark(game.opponent)}</span>
        </div>
        <div class="meta">${escapeHtml(relTime(game.updatedAt))}</div>
      </div>
      <div class="score">${game.yourScore}–${game.theirScore}</div>
    </div>
  `;
  return a;
}

// Render

function renderBucket(sectionEl, listEl, countEl, items, builder) {
  listEl.innerHTML = '';
  if (items.length === 0) { sectionEl.hidden = true; return; }
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
  if (!me) { document.getElementById('me-name').textContent = ''; return; }

  for (const p of plugins) DISPLAY_NAMES[p.id] = p.displayName;

  const meNameEl = document.getElementById('me-name');
  meNameEl.textContent = me.friendlyName;
  if (me.glyph) meNameEl.insertAdjacentHTML('beforeend', glyphMark(me));
  setAvatar(document.getElementById('me-avatar'), me);

  const games = meRes.games ?? [];
  const active = games.filter(g => g.status === 'active');
  const ended  = games.filter(g => g.status === 'ended');

  const yours  = active.filter(g => g.yourTurn).sort((a, b) => a.updatedAt - b.updatedAt);
  const theirs = active.filter(g => !g.yourTurn).sort((a, b) => b.updatedAt - a.updatedAt);
  const recentEnded = ended.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);

  renderBucket(
    document.getElementById('sec-yours'),
    document.getElementById('list-yours'),
    document.getElementById('count-yours'),
    yours, activeCard,
  );

  const theirsLabel = document.getElementById('theirs-label');
  if (theirs.length > 0) {
    const oppNames = new Set(theirs.map(g => g.opponent.friendlyName));
    theirsLabel.textContent = oppNames.size === 1 ? [...oppNames][0] : 'their reply';
  }
  renderBucket(
    document.getElementById('sec-theirs'),
    document.getElementById('list-theirs'),
    document.getElementById('count-theirs'),
    theirs, activeCard,
  );

  renderBucket(
    document.getElementById('sec-ended'),
    document.getElementById('list-ended'),
    document.getElementById('count-ended'),
    recentEnded, endedCard,
  );

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

  const toggle = document.getElementById('ended-toggle');
  if (recentEnded.length > 3) toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
  });

  document.getElementById('lobby').hidden = false;
  document.getElementById('fab').hidden = false;
  wireNewGame(me, plugins);
}

// New-game flow

function wireNewGame(me, plugins) {
  const fab = document.getElementById('fab');
  const dlg = document.getElementById('newgame');
  const stepsEl = document.getElementById('ng-steps');
  const titleEl = document.getElementById('ng-title');
  const cancel = document.getElementById('ng-cancel');

  cancel.onclick = () => dlg.close();
  dlg.addEventListener('cancel', () => dlg.close());

  fab.onclick = async () => {
    const users = await fetchJson('/api/users').then(arr => arr.filter(u => u.id !== me.id));
    if (users.length === 0) {
      alert("You're the only player on this server.");
      return;
    }
    if (users.length === 1) showGameStep(users[0], plugins);
    else                     showOpponentStep(users, plugins);
    dlg.showModal();
  };

  function showOpponentStep(users, plugins) {
    titleEl.textContent = 'Pick a sparring partner';
    stepsEl.innerHTML = `<div class="ng-step">Step 1 of ${PLUGIN_VARIANTS.words ? 3 : 2}</div>`;
    for (const u of users) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ng-tile';
      btn.innerHTML = `
        <span class="ng-mono"${glyphAttr(u)} style="background:${escapeAttr(u.color || '#888')};margin-left:16px">${escapeHtml(avatarInitial(u.friendlyName))}</span>
        <span class="ng-body"><span class="ng-name">${escapeHtml(u.friendlyName)}${glyphMark(u)}</span></span>
        <span class="ng-chev" aria-hidden="true">›</span>`;
      btn.onclick = () => showGameStep(u, plugins);
      li.appendChild(btn);
      stepsEl.appendChild(li);
    }
  }

  function showGameStep(opponent, plugins) {
    titleEl.textContent = `New game vs. ${opponent.friendlyName}`;
    stepsEl.innerHTML = `<div class="ng-step">Step 2 — choose your weapon</div>`;
    for (const p of plugins) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ng-tile with-art';
      btn.innerHTML = `
        <span class="ng-art">${boxArt(p.id)}</span>
        <span class="ng-body" style="padding-left:0">
          <span class="ng-name">${escapeHtml(p.displayName)}</span>
          <span class="ng-tagline">${escapeHtml(tagline(p.id))}</span>
        </span>
        <span class="ng-chev" aria-hidden="true">›</span>`;
      btn.onclick = () => {
        if (PLUGIN_VARIANTS[p.id]) showVariantStep(opponent, p, plugins);
        else startGame(opponent, p.id, null);
      };
      li.appendChild(btn);
      stepsEl.appendChild(li);
    }
  }

  function showVariantStep(opponent, plugin, plugins) {
    titleEl.textContent = `${plugin.displayName} — pick the rulebook`;
    stepsEl.innerHTML = `<div class="ng-step">Step 3 of 3</div>`;
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
      btn.className = 'ng-tile with-art';
      btn.innerHTML = `
        <span class="ng-art">${boxArt(plugin.id, v.variant)}</span>
        <span class="ng-body" style="padding-left:0"><span class="ng-name">${escapeHtml(v.label)}</span></span>
        <span class="ng-chev" aria-hidden="true">›</span>`;
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
