// อัศวินรัตติกาล — เว็บจองโรงแรม + จับคู่บัดดี้ท่องเที่ยว
// รัน: npm start  แล้วเปิด http://localhost:3000
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './src/db.js';
import { matchRoute, HttpError } from './src/api.js';
import { currentUser } from './src/auth.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

const sendJSON = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

async function readBody(req) {
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

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  serveStatic(res, url.pathname);
}).listen(PORT, () => {
  const ai = process.env.AI_AGENT !== 'local' && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.AI_AGENT === 'claude');
  console.log(`🏨 อัศวินรัตติกาล พร้อมใช้งานที่ http://localhost:${PORT}`);
  console.log(`🤖 AI Agent จับคู่บัดดี้: ${ai ? 'Claude (claude-opus-5-5)' : 'โหมดกฎภายในเครื่อง (ตั้ง ANTHROPIC_API_KEY เพื่อใช้ Claude)'}`);
});
