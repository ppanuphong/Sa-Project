// จัดการ session ผ่าน cookie ที่ลงลายเซ็น (HMAC) — ไม่ต้องเก็บ session ในฐานข้อมูล
// จึงใช้ได้ทั้งเซิร์ฟเวอร์ปกติและ serverless (เช่น Vercel) ที่มีหลาย instance
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const COOKIE = 'sb_session';
const DAY = 86400000;

if (process.env.VERCEL && !process.env.SESSION_SECRET) throw new Error('ต้องตั้งค่า SESSION_SECRET บน Vercel');
const SECRET = process.env.SESSION_SECRET || 'local-dev-session-secret';

// ลายเซ็นผูกกับ username ด้วย ถ้าฐานข้อมูลถูกสร้างใหม่แล้ว id เดิมเป็นของคนอื่น cookie เก่าจะใช้ไม่ได้
const sign = (userId, exp, username) => createHmac('sha256', SECRET).update(`${userId}.${exp}.${username}`).digest('hex');

export function createSession(userId, remember) {
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  const exp = Date.now() + (remember ? 30 * DAY : DAY);
  const token = `${userId}.${exp}.${sign(userId, exp, u.username)}`;
  // remember = cookie อยู่ได้ 30 วัน, ไม่ remember = หมดเมื่อปิดเบราว์เซอร์
  const maxAge = remember ? `; Max-Age=${30 * 86400}` : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge}`;
}

export function destroySession() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function currentUser(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.(\\d+)\\.([a-f0-9]{64})`).exec(req.headers.cookie || '');
  if (!m) return null;
  const [, id, exp, sig] = m;
  if (Number(exp) < Date.now()) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!u) return null;
  const expected = Buffer.from(sign(id, exp, u.username), 'hex');
  return timingSafeEqual(expected, Buffer.from(sig, 'hex')) ? u : null;
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return { ...rest, interests: JSON.parse(rest.interests || '[]'), buddy_enabled: !!rest.buddy_enabled };
}
