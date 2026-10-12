// AI Agent สำหรับจับคู่บัดดี้ท่องเที่ยว
// 1) ให้คะแนนเบื้องต้นด้วยกฎ (ความสนใจร่วม, ทริปที่ตรงกัน, สไตล์การเที่ยว, อายุ)
// 2) ถ้าตั้งค่า ANTHROPIC_API_KEY ไว้ จะส่งผู้สมัครอันดับต้น ๆ ให้ Claude วิเคราะห์ จัดอันดับ และเขียนเหตุผล
//    ถ้าเรียกไม่สำเร็จจะใช้ผลจากกฎแทนเสมอ
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { db, parseJSON } from '../db.js';

const ACTIVE = "('pending','confirmed','checked_in')";

export const claudeEnabled = () =>
  process.env.AI_AGENT !== 'local' &&
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.AI_AGENT === 'claude');

let client;
export const getClient = () => (client ??= new Anthropic());

export function tripsOf(userId) {
  return db.prepare(`
    SELECT h.id AS hotel_id, h.name AS hotel, h.city, b.check_in, b.check_out
    FROM bookings b JOIN rooms r ON r.id = b.room_id JOIN hotels h ON h.id = r.hotel_id
    WHERE b.user_id = ? AND b.status IN ${ACTIVE} ORDER BY b.check_in`).all(userId);
}

function profileOf(u) {
  return {
    id: u.id, name: u.name, age: u.age, gender: u.gender, bio: u.bio || '',
    interests: parseJSON(u.interests), travel_style: u.travel_style, trips: tripsOf(u.id),
  };
}

function localScore(me, other) {
  const reasons = [];
  let score = 0;

  // ทริปที่ตรงกัน (เมืองเดียวกัน + ช่วงเวลาทับซ้อน)
  let tripPts = 0;
  for (const a of me.trips) for (const b of other.trips) {
    if (a.city !== b.city || !(a.check_in < b.check_out && b.check_in < a.check_out)) continue;
    const pts = a.hotel_id === b.hotel_id ? 40 : 30;
    if (pts > tripPts) {
      tripPts = pts;
      reasons[0] = a.hotel_id === b.hotel_id
        ? `พักโรงแรมเดียวกัน (${a.hotel}) ช่วงเวลาเดียวกัน`
        : `ไป${a.city}ช่วงเวลาเดียวกัน`;
    }
  }
  score += tripPts;

  // ความสนใจร่วม (Jaccard similarity)
  const A = new Set(me.interests), B = new Set(other.interests);
  const common = [...A].filter((x) => B.has(x));
  const union = new Set([...A, ...B]).size || 1;
  score += Math.round((common.length / union) * 40);
  if (common.length) reasons.push(`ชอบ${common.join(', ')}เหมือนกัน`);

  if (me.travel_style && me.travel_style === other.travel_style) {
    score += 10; reasons.push(`สไตล์เที่ยวแบบ "${me.travel_style}" เหมือนกัน`);
  }
  if (me.age && other.age) {
    const diff = Math.abs(me.age - other.age);
    if (diff <= 5) { score += 10; reasons.push('อายุใกล้เคียงกัน'); }
    else if (diff <= 10) score += 5;
  }
  return { score: Math.min(100, score), reason: reasons.filter(Boolean).join(' · ') || 'โปรไฟล์ยังมีจุดร่วมไม่มาก' };
}

const RankingSchema = z.object({
  matches: z.array(z.object({
    user_id: z.number().int(),
    score: z.number().int(),
    reason: z.string(),
  })),
});

async function rankWithClaude(me, candidates) {
  const response = await getClient().beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low', format: betaZodOutputFormat(RankingSchema) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'คุณคือ AI Agent ของเว็บจองโรงแรม อัศวินรัตติกาล ทำหน้าที่ประเมินความเหมาะสมในการจับคู่ "บัดดี้ท่องเที่ยว" ' +
      'พิจารณาทริปที่เมืองและช่วงเวลาตรงกันเป็นสำคัญที่สุด รองลงมาคือความสนใจร่วม สไตล์การเที่ยว และข้อมูลใน bio ' +
      'ให้คะแนน 0-100 กับผู้สมัครทุกคนที่ได้รับ (local_score คือคะแนนจากกฎเบื้องต้น ใช้อ้างอิงได้) ' +
      'เขียน reason เป็นภาษาไทยสั้น ๆ 1 ประโยค บอกจุดร่วมที่เป็นรูปธรรม และเรียงจากเหมาะสมมากไปน้อย',
    messages: [{
      role: 'user',
      content: JSON.stringify({ me, candidates }),
    }],
  });

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`Claude ไม่ได้ส่งผลการจัดอันดับ (stop_reason=${response.stop_reason})`);
  }
  const valid = new Set(candidates.map((c) => c.id));
  return response.parsed_output.matches
    .filter((m) => valid.has(m.user_id))
    .map((m) => ({ ...m, score: Math.max(0, Math.min(100, m.score)) }));
}

/** หาบัดดี้ที่เหมาะสมให้ผู้ใช้ */
const toCard = (c, score, reason) => ({
  user: { id: c.id, name: c.name, age: c.age, gender: c.gender, bio: c.bio, interests: c.interests, travel_style: c.travel_style },
  trips: c.trips.map(({ city, hotel, check_in, check_out }) => ({ city, hotel, check_in, check_out })),
  score,
  reason,
});

// ผู้ใช้ที่ค้นหา/จับคู่ได้ (เปิดใช้งาน, ยังไม่มีคำขอค้าง/เป็นบัดดี้กัน, ไม่เคยถูกเรารายงาน)
const candidates = (userId) => db.prepare(`
    SELECT * FROM users u
    WHERE u.id != ? AND u.buddy_enabled = 1 AND u.role = 'customer'
      AND NOT EXISTS (SELECT 1 FROM buddy_matches m
        WHERE ((m.requester_id = ? AND m.target_id = u.id) OR (m.requester_id = u.id AND m.target_id = ?))
          AND m.status IN ('pending','accepted'))
      AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.reporter_id = ? AND r.reported_id = u.id)
  `).all(userId, userId, userId, userId);

/** ค้นหาบัดดี้ด้วยตัวเอง (ไม่ใช้ AI) — กรองตามคำค้น เมือง ช่วงวันที่ ความสนใจ สไตล์ เพศ และช่วงอายุ */
export function browseBuddies(userId, f = {}) {
  const me = profileOf(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
  const q = String(f.q || '').trim().toLowerCase();
  const interests = String(f.interests || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ageMin = Number(f.ageMin) || 0, ageMax = Number(f.ageMax) || 999;
  const results = candidates(userId).map(profileOf).filter((p) => {
    if (q && !`${p.name} ${p.bio}`.toLowerCase().includes(q)) return false;
    if (f.gender && p.gender !== f.gender) return false;
    if (f.style && p.travel_style !== f.style) return false;
    if ((f.ageMin || f.ageMax) && (!p.age || p.age < ageMin || p.age > ageMax)) return false;
    if (interests.length && !interests.some((i) => p.interests.includes(i))) return false;
    if (f.city || f.from || f.to) {
      const hit = p.trips.some((t) => (!f.city || t.city === f.city)
        && (!f.from || t.check_out > f.from) && (!f.to || t.check_in < f.to));
      if (!hit) return false;
    }
    return true;
  }).map((p) => { const l = localScore(me, p); return toCard(p, l.score, l.reason); });
  const sort = f.sort || 'score';
  results.sort(sort === 'name' ? (a, b) => a.user.name.localeCompare(b.user.name, 'th')
    : sort === 'trip' ? (a, b) => (a.trips[0]?.check_in || '9').localeCompare(b.trips[0]?.check_in || '9')
    : (a, b) => b.score - a.score);
  return { me: { interests: me.interests, trips: me.trips }, total: results.length, results };
}

export async function suggestBuddies(userId, limit = 6) {
  const meRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const me = profileOf(meRow);

  const others = candidates(userId);

  let ranked = others
    .map((u) => { const p = profileOf(u); return { ...p, local: localScore(me, p) }; })
    .sort((a, b) => b.local.score - a.local.score);

  let engine = 'local';
  let results = ranked.slice(0, limit).map((c) => ({ user_id: c.id, score: c.local.score, reason: c.local.reason }));

  if (claudeEnabled() && ranked.length) {
    const top = ranked.slice(0, 10);
    try {
      const ai = await rankWithClaude(me, top.map(({ local, ...p }) => ({ ...p, local_score: local.score })));
      if (ai.length) { results = ai.slice(0, limit); engine = 'claude'; }
    } catch (err) {
      console.warn('⚠️  AI Agent (Claude) ใช้งานไม่ได้ จึงใช้การจับคู่ด้วยกฎแทน:', err.message);
    }
  }

  const byId = new Map(ranked.map((c) => [c.id, c]));
  return {
    engine,
    me: { interests: me.interests, trips: me.trips },
    suggestions: results.map((r) => toCard(byId.get(r.user_id), r.score, r.reason)),
  };
}
