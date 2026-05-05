async function load() {
  const meR = await fetch('/api/me');
  if (meR.status === 403) {
    const email = (await meR.json()).email || '';
    location.href = `/lockout?email=${encodeURIComponent(email)}`;
    return;
  }
  if (!meR.ok) {
    document.body.textContent = 'Could not load — try refreshing.';
    return;
  }
  const me = await meR.json();
  const usersR = await fetch('/api/users');
  const users = await usersR.json();

  document.getElementById('greeting').textContent = `Hi, ${me.user.friendlyName}.`;

  const gamesByOpponentId = new Map(me.games.map(g => [g.opponent.id, g]));
  const others = users.filter(u => u.id !== me.user.id);

  const root = document.getElementById('tiles');
  for (const u of others) {
    const game = gamesByOpponentId.get(u.id);
    root.appendChild(renderTile(u, game));
  }
}

function renderTile(other, game) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.style.setProperty('--accent', other.color);
  const name = document.createElement('div');
  name.className = 'tile-name';
  name.textContent = other.friendlyName;
  tile.appendChild(name);

  if (game && game.status === 'active') {
    const badge = document.createElement('div');
    badge.className = 'tile-badge';
    badge.textContent = game.yourTurn ? 'Your turn' : 'Their turn';
    badge.dataset.state = game.yourTurn ? 'you' : 'them';
    tile.appendChild(badge);
    const score = document.createElement('div');
    score.className = 'tile-score';
    score.textContent = `${game.yourScore} — ${game.theirScore}`;
    tile.appendChild(score);
    const time = document.createElement('div');
    time.className = 'tile-time';
    time.textContent = relativeTime(game.updatedAt);
    tile.appendChild(time);
    tile.addEventListener('click', () => location.href = `/game/${game.id}`);
    tile.classList.add('tile-active');
  } else {
    const btn = document.createElement('button');
    btn.className = 'tile-start';
    btn.textContent = 'Start a game';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const r = await fetch('/api/games', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otherUserId: other.id })
      });
      if (r.status === 201) {
        const { gameId } = await r.json();
        location.href = `/game/${gameId}`;
      } else {
        btn.disabled = false;
        btn.textContent = 'Try again';
      }
    });
    tile.appendChild(btn);
  }
  return tile;
}

function relativeTime(t) {
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

load();
