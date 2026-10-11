// จัดการ session ผ่าน cookie
import { randomBytes } from 'node:crypto';
import { db } from './db.js';

const COOKIE = 'sb_session';
const DAY = 86400000;

export function createSession(userId, remember) {
  const token = randomBytes(32).toString('hex');
  const ttl = remember ? 30 * DAY : DAY;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
    .run(token, userId, new Date(Date.now() + ttl).toISOString());
  // remember = cookie อยู่ได้ 30 วัน, ไม่ remember = หมดเมื่อปิดเบราว์เซอร์
  const maxAge = remember ? `; Max-Age=${30 * 86400}` : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge}`;
}

export function destroySession(req) {
  const token = readToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function readToken(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`).exec(req.headers.cookie || '');
  return m?.[1];
}

export function currentUser(req) {
  const token = readToken(req);
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`).get(token, new Date().toISOString());
  return row || null;
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return { ...rest, interests: JSON.parse(rest.interests || '[]'), buddy_enabled: !!rest.buddy_enabled };
}
