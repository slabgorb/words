async function fetchJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const PLUGINS = (await fetchJson('/api/plugins')).plugins;

// Per-plugin variant choices offered in the new-game dialog. A plugin
// without an entry here is offered as a single option using its
// displayName.
const PLUGIN_VARIANTS = {
  words: [
    { variant: 'wwf', label: 'Words (with Friends)' },
    { variant: 'scrabble', label: 'Words (Scrabble)' },
  ],
};

async function main() {
  const meRes = await fetchJson('/api/me').catch(() => null);
  const me = meRes?.user ?? null;
  document.getElementById('me').textContent =
    me?.friendlyName ? `signed in as ${me.friendlyName}` : '';
  if (!me) return;

  const [users, gamesRes] = await Promise.all([
    fetchJson('/api/users'),  // bare array
    fetchJson('/api/games'),  // {games: [...]}
  ]);
  const games = gamesRes.games;

  // Group games by opponent id
  const byOpponent = new Map();
  for (const g of games) {
    const oppId = g.playerAId === me.id ? g.playerBId : g.playerAId;
    const arr = byOpponent.get(oppId) ?? [];
    arr.push(g);
    byOpponent.set(oppId, arr);
  }

  const list = document.getElementById('opponents');
  list.innerHTML = '';
  for (const u of users) {
    if (u.id === me.id) continue;
    const li = document.createElement('li');
    li.className = 'opponent';
    const activeGames = byOpponent.get(u.id) ?? [];
    const activeTypes = new Set(activeGames.map(g => g.gameType));

    li.innerHTML = `
      <div class="name" style="color: ${u.color || 'inherit'}">${u.friendlyName}</div>
      <div class="games"></div>
    `;
    const gamesDiv = li.querySelector('.games');
    for (const g of activeGames) {
      const plugin = PLUGINS.find(p => p.id === g.gameType);
      const a = document.createElement('a');
      a.className = 'badge active';
      a.href = `/play/${g.gameType}/${g.id}/`;
      const ICONS = { words: '📝', rummikub: '🟦' };
      a.textContent = `${ICONS[g.gameType] ?? ''} ${plugin?.displayName ?? g.gameType}`.trim();
      gamesDiv.appendChild(a);
    }
    const btn = document.createElement('button');
    btn.className = 'start-new';
    btn.textContent = '+ Start new';
    btn.onclick = () => openNewGame(u, activeTypes);
    gamesDiv.appendChild(btn);
    list.appendChild(li);
  }
}

function openNewGame(opponent, activeTypes) {
  const dlg = document.getElementById('newgame');
  document.getElementById('ng-name').textContent = opponent.friendlyName;
  const opts = document.getElementById('ng-options');
  opts.innerHTML = '';

  const startGame = async (gameType, variant) => {
    const body = { opponentId: opponent.id, gameType };
    if (variant) body.variant = variant;
    const r = await fetch('/api/games', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      alert((await r.json()).error ?? 'failed to create game');
      return;
    }
    const { id, gameType: gt } = await r.json();
    window.location.href = `/play/${gt}/${id}/`;
  };

  for (const p of PLUGINS) {
    if (activeTypes.has(p.id)) continue;
    const variants = PLUGIN_VARIANTS[p.id];
    if (variants) {
      for (const v of variants) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.textContent = v.label;
        btn.onclick = () => startGame(p.id, v.variant);
        li.appendChild(btn);
        opts.appendChild(li);
      }
    } else {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = p.displayName;
      btn.onclick = () => startGame(p.id);
      li.appendChild(btn);
      opts.appendChild(li);
    }
  }
  document.getElementById('ng-cancel').onclick = () => dlg.close();
  dlg.showModal();
}

main().catch(err => { document.body.innerHTML = `<pre>${err.stack || err.message}</pre>`; });
