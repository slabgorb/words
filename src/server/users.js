export const PALETTE = [
  '#3b82f6', // blue
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#ef4444', // red
  '#14b8a6', // teal
  '#f97316', // orange
  '#84cc16', // lime
  '#06b6d4', // cyan
  '#d946ef', // fuchsia
  '#eab308', // yellow
  '#6366f1', // indigo
  '#a855f7'  // purple
];

export const GLYPHS = ['✦', '♤', '♡', '♢', '♧'];

function rowToUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, friendlyName: row.friendly_name, color: row.color, glyph: row.glyph ?? null, isBot: row.is_bot === 1, createdAt: row.created_at };
}

function nextPaletteColor(db) {
  const used = new Set(db.prepare('SELECT color FROM users').all().map(r => r.color));
  return PALETTE.find(c => !used.has(c)) ?? PALETTE[0];
}

function leastUsedGlyph(db) {
  const counts = new Map(GLYPHS.map(g => [g, 0]));
  for (const row of db.prepare('SELECT glyph FROM users WHERE glyph IS NOT NULL').all()) {
    if (counts.has(row.glyph)) counts.set(row.glyph, counts.get(row.glyph) + 1);
  }
  let best = GLYPHS[0];
  let min = counts.get(best);
  for (const g of GLYPHS) {
    if (counts.get(g) < min) { best = g; min = counts.get(g); }
  }
  return best;
}

export function createUser(db, { email, friendlyName, color, glyph }) {
  const c = color ?? nextPaletteColor(db);
  const g = glyph ?? leastUsedGlyph(db);
  const info = db.prepare(
    'INSERT INTO users (email, friendly_name, color, glyph, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(email, friendlyName, c, g, Date.now());
  return getUserById(db, info.lastInsertRowid);
}

export function getUserByEmail(db, email) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email));
}

export function getUserById(db, id) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function listUsers(db) {
  return db.prepare('SELECT * FROM users ORDER BY friendly_name COLLATE NOCASE').all().map(rowToUser);
}

export function renameUser(db, email, newName) {
  const info = db.prepare('UPDATE users SET friendly_name = ? WHERE email = ? COLLATE NOCASE').run(newName, email);
  if (info.changes === 0) throw new Error(`user not found: ${email}`);
  return info.changes;
}
