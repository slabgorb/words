const subscribers = new Map(); // gameId -> Set<res>

export function subscribe(gameId, req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
  let set = subscribers.get(gameId);
  if (!set) { set = new Set(); subscribers.set(gameId, set); }
  set.add(res);

  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch { /* socket dead */ }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    set.delete(res);
    if (set.size === 0) subscribers.delete(gameId);
  });
}

export function broadcast(gameId, event) {
  const set = subscribers.get(gameId);
  if (!set) return;
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event.payload ?? {})}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { set.delete(res); }
  }
}

export function subscriberCount(gameId) {
  return subscribers.get(gameId)?.size ?? 0;
}
