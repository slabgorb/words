import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Load or create a stable signing secret. Persists in .secret next to game.db
// so cookies survive restart. Two-player personal use; this is sufficient.
export function loadOrCreateSecret(path = '.secret') {
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const s = randomBytes(32).toString('hex');
  writeFileSync(path, s, { mode: 0o600 });
  return s;
}

const VALID_IDS = new Set(['keith', 'sonia']);

function sign(value, secret) {
  const mac = createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${mac}`;
}
function verify(signed, secret) {
  if (typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return null;
  const value = signed.slice(0, dot);
  const mac = signed.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(value).digest('hex');
  if (mac !== expected) return null;
  return value;
}

// Cookie name and helpers
export const COOKIE = 'wf_id';

export function setIdentityCookie(res, id, secret) {
  if (!VALID_IDS.has(id)) throw new Error(`invalid identity ${id}`);
  res.cookie(COOKIE, sign(id, secret), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
}

// Express middleware that attaches `req.playerId` from the signed cookie, or null.
export function attachIdentity(secret) {
  return (req, _res, next) => {
    const cookie = req.cookies?.[COOKIE];
    const value = verify(cookie, secret);
    req.playerId = VALID_IDS.has(value) ? value : null;
    next();
  };
}

export function requireIdentity(req, res, next) {
  if (!req.playerId) return res.status(401).json({ error: 'identity-required' });
  next();
}
