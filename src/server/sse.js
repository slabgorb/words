// Minimal SSE broadcaster — keeps a Set of subscribers, broadcasts JSON events.
const subscribers = new Set();

export function subscribe(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
  subscribers.add(res);

  // Heartbeat every 25s so proxies don't close the connection.
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch { /* socket dead */ }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
  });
}

export function broadcast(event) {
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event.payload ?? {})}\n\n`;
  for (const res of subscribers) {
    try { res.write(data); } catch { subscribers.delete(res); }
  }
}

export function subscriberCount() { return subscribers.size; }
