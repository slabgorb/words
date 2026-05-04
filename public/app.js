const $ = (sel) => document.querySelector(sel);

async function whoami() {
  const r = await fetch('/api/whoami');
  const body = await r.json();
  return body.playerId;
}

async function chooseIdentity(id) {
  await fetch('/api/whoami', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: id })
  });
}

async function init() {
  let id = await whoami();
  if (!id) {
    $('#identity-picker').hidden = false;
    $('#identity-picker').addEventListener('click', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLButtonElement)) return;
      await chooseIdentity(t.dataset.id);
      location.reload();
    });
    return;
  }
  $('#game').hidden = false;
  $('#status').textContent = `You are ${id}. (Game UI: next task.)`;
}

init();
