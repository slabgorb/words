import { getUserByEmail } from './users.js';

const HEADER = 'cf-access-authenticated-user-email';

// Reads identity from the CF Access header (or DEV_USER in dev).
// Attaches req.user (or null) and req.authEmail (the email from the header,
// even if not on the roster — used by the lockout path).
export function attachIdentity({ db, isProd, devUser } = {}) {
  return (req, _res, next) => {
    const headerEmail = req.headers[HEADER];
    let email = typeof headerEmail === 'string' ? headerEmail.trim() : null;
    if (!email && !isProd && devUser) email = devUser;
    req.authEmail = email;
    req.user = email ? getUserByEmail(db, email) : null;
    next();
  };
}

export function requireIdentity(req, res, next) {
  if (!req.authEmail) return res.status(401).json({ error: 'unauthenticated' });
  if (!req.user) return res.status(403).json({ error: 'not-on-roster', email: req.authEmail });
  next();
}
