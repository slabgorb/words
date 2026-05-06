// Thin POST helper for /api/games/:gameId/action. Successful actions
// broadcast 'update' via SSE, which triggers fetchState() in app.js — so
// this helper does NOT manually re-render.

export async function postAction(type, payload) {
  const ctx = window.__GAME__ || {};
  if (!ctx.actionUrl) {
    console.warn('postAction: missing window.__GAME__.actionUrl');
    return { error: 'no game context' };
  }
  try {
    const r = await fetch(ctx.actionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    });
    if (!r.ok) {
      const text = await r.text();
      console.warn(`action ${type} failed: ${r.status} ${text}`);
      return { error: text };
    }
    return await r.json().catch(() => ({}));
  } catch (err) {
    console.warn(`action ${type} threw:`, err);
    return { error: String(err) };
  }
}
