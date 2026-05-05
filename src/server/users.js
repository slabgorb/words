export const PALETTE = [
  '#3b82f6', // blue
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#ef4444'  // red
];

function rowToUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, friendlyName: row.friendly_name, color: row.color, createdAt: row.created_at };
}

function nextPaletteColor(db) {
  const used = new Set(db.prepare('SELECT color FROM users').all().map(r => r.color));
  return PALETTE.find(c => !used.has(c)) ?? PALETTE[0];
}

export function createUser(db, { email, friendlyName, color }) {
  const c = color ?? nextPaletteColor(db);
  const info = db.prepare(
    'INSERT INTO users (email, friendly_name, color, created_at) VALUES (?, ?, ?, ?)'
  ).run(email, friendlyName, c, Date.now());
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
