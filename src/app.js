// ตัวจัดการ request ของทั้งระบบ — ใช้ร่วมกันระหว่าง server.js (รันเอง) และ api/index.js (Vercel)
import './tz.js';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './db.js';
import { matchRoute, HttpError } from './api.js';
import { currentUser } from './auth.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

const sendJSON = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

async function readBody(req) {
  // บน Vercel (เปิด Node helpers) body ถูกอ่านและแปลงเป็น object ไว้แล้ว
  if (process.env.VERCEL) {
    let parsed;
    try { parsed = req.body; } catch { throw new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }
    if (parsed !== undefined) return parsed && typeof parsed === 'object' ? parsed : {};
  }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) throw new HttpError(413, 'ข้อมูลมีขนาดใหญ่เกินไป');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }
}

async function handleApi(req, res, url) {
  const r = matchRoute(req.method, url.pathname);
  if (!r) return sendJSON(res, 404, { error: 'ไม่พบ API นี้' });
  try {
    const user = currentUser(req);
    if (r.auth && !user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบก่อน');
    if (r.admin && user?.role !== 'admin') throw new HttpError(403, 'เฉพาะผู้ดูแลระบบเท่านั้น');
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const query = Object.fromEntries(url.searchParams);
    const data = await r.handler({ req, res, params: r.params, query, body, user });
    sendJSON(res, 200, data ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return sendJSON(res, err.status, { error: err.message });
    console.error(err);
    sendJSON(res, 500, { error: 'เกิดข้อผิดพลาดในระบบ' });
  }
}

async function serveStatic(res, pathname) {
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(PUBLIC, safe);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (pathname === '/' || !extname(file)) file = join(PUBLIC, 'index.html');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ไม่พบไฟล์');
  }
}

export default function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(res, url.pathname);
}
