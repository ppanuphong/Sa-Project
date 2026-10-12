// บัดดี้ตัวอย่างตอบแชทอัตโนมัติ — ให้ทดสอบฟีเจอร์แชทได้ด้วยบัญชีเดียว
// ถ้าตั้งค่า ANTHROPIC_API_KEY ไว้ ให้ Claude สวมบทบาทบัดดี้ตามโปรไฟล์และทริปของเขา
// ถ้าไม่ได้ตั้งค่า หรือเรียกไม่สำเร็จ จะตอบด้วยกฎ (จับคำสำคัญในข้อความ) แทนเสมอ
import { db, parseJSON } from '../db.js';
import { notify } from './notificationService.js';
import { claudeEnabled, getClient, tripsOf } from './buddyAgent.js';

const typing = new Map(); // match_id → timer ของคำตอบที่กำลังจะส่ง

export const isTyping = (matchId) => typing.has(Number(matchId));

const userOf = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const pick = (list, avoid) => {
  const fresh = list.filter((x) => x !== avoid);
  return (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
};

// ---------- ตอบด้วยกฎ ----------
const CITY_TIPS = {
  'เชียงใหม่': { places: ['ดอยสุเทพ', 'วัดอุโมงค์', 'ถนนนิมมานฯ', 'ม่อนแจ่ม', 'ประตูท่าแพ'], food: ['ข้าวซอย', 'ไส้อั่ว', 'ขนมจีนน้ำเงี้ยว'], night: 'ถนนคนเดินวันอาทิตย์' },
  'กรุงเทพฯ': { places: ['วัดอรุณ', 'เยาวราช', 'ไอคอนสยาม', 'ตลาดน้อย', 'ล่องเรือเจ้าพระยา'], food: ['ผัดไทยประตูผี', 'ก๋วยเตี๋ยวเรือ', 'ของกินเยาวราช'], night: 'ตลาดจ๊อดแฟร์' },
  'ภูเก็ต': { places: ['แหลมพรหมเทพ', 'เมืองเก่าภูเก็ต', 'หาดกะตะ', 'บิ๊กพุทธา'], food: ['หมี่หุ้นต้มยำ', 'โอ้เอ๋ว', 'ติ่มซำเมืองเก่า'], night: 'ถนนคนเดินหลาดใหญ่' },
  'กระบี่': { places: ['ทะเลแหวก', 'เกาะห้อง', 'หาดไร่เลย์', 'สระมรกต'], food: ['ซีฟู้ดอ่าวนาง', 'ขนมจีนปักษ์ใต้'], night: 'ถนนคนเดินกระบี่' },
  'ชลบุรี': { places: ['เกาะล้าน', 'ปราสาทสัจธรรม', 'หาดจอมเทียน', 'จุดชมวิวเขาพระตำหนัก'], food: ['ซีฟู้ดนาเกลือ', 'ห่อหมกทะเล'], night: 'ถนนคนเดินพัทยา' },
};

function localReply(bot, me, history) {
  const p = bot.gender === 'หญิง' ? 'ค่ะ' : bot.gender === 'ชาย' ? 'ครับ' : 'นะ';
  const na = bot.gender === 'หญิง' ? 'นะคะ' : bot.gender === 'ชาย' ? 'นะครับ' : 'นะ';
  const q = bot.gender === 'หญิง' ? 'คะ' : bot.gender === 'ชาย' ? 'ครับ' : ''; // คำลงท้ายประโยคคำถาม
  const interests = parseJSON(bot.interests);
  const myTrips = tripsOf(bot.id), theirTrips = tripsOf(me.id);
  // ทริปที่ไปช่วงเดียวกัน (ถ้ามี) ไม่งั้นใช้ทริปแรกของบัดดี้
  const shared = myTrips.find((a) => theirTrips.some((b) => a.city === b.city && a.check_in < b.check_out && b.check_in < a.check_out));
  const trip = shared || myTrips[0];
  const tips = trip && CITY_TIPS[trip.city];
  // ตอบเฉพาะข้อความที่ผู้ใช้ส่งมาหลังคำตอบล่าสุดของบัดดี้ (ข้อความล่าสุดสำคัญที่สุด จึงเอาไว้หน้า)
  const lastBot = history.map((m) => m.sender_id).lastIndexOf(bot.id);
  const last = history.slice(lastBot + 1).filter((m) => m.sender_id === me.id).reverse().map((m) => m.text).join(' ').toLowerCase();
  const prev = lastBot >= 0 ? history[lastBot].text : undefined;
  const has = (re) => re.test(last);

  if (has(/บาย|ไว้คุยกัน|ฝันดี|ราตรีสวัสดิ์|ไปก่อน/)) return pick([`บายย ไว้คุยกันใหม่${na} 👋`, `ฝันดี${na} แล้วค่อยมาวางแผนกันต่อ`], prev);
  if (has(/ขอบคุณ|ขอบใจ|thank|thx/)) return pick([`ยินดี${p}! มีอะไรถามได้ตลอดเลย`, `ไม่เป็นไรเลย${p} 😊`], prev);
  if (has(/สวัสดี|หวัดดี|ดีจ้า|ดีครับ|ดีค่ะ|hello|^hi|hey/)) {
    return trip
      ? pick([`สวัสดี${p}! ดีใจที่ได้เป็นบัดดี้กัน เราจะไป${trip.city}ช่วง ${fmt(trip.check_in)}–${fmt(trip.check_out)} ${shared ? 'ตรงกับคุณพอดีเลย' : ''}`.trim(),
        `หวัดดี${p} 😊 ${shared ? `เห็นว่าไป${trip.city}ช่วงเดียวกันเลย` : `กำลังวางแผนไป${trip.city}อยู่เลย`} อยากไปที่ไหนบ้างเหรอ`], prev)
      : `สวัสดี${p}! ยินดีที่ได้รู้จัก${na}`;
  }
  if (has(/วันไหน|กี่วัน|กี่คืน|ช่วงไหน|ไปเมื่อ|วันที่|ถึงวัน/)) {
    return trip ? `เราไป${trip.city} ${fmt(trip.check_in)}–${fmt(trip.check_out)} พักที่${trip.hotel}${p} ${shared ? 'ช่วงเดียวกับคุณเลย' : 'คุณไปช่วงไหนเหรอ'}`
      : `ยังไม่ได้จองทริปเลย${p} กำลังหาที่ไปอยู่`;
  }
  if (has(/กิน|อาหาร|ร้าน|หิว|อร่อย/)) {
    return tips ? pick([`ถ้าไป${trip.city}ต้องลอง${tips.food[0]}เลย${p} ${tips.food[1] ? `${tips.food[1]}ก็ดี` : ''}`.trim(),
      `${interests.includes('อาหาร') || interests.includes('ตลาดกลางคืน') ? 'สายกินเหมือนกันเลย! ' : ''}ไป${tips.night}กันไหม ของกินเยอะมาก`], prev)
      : `ชอบกินเหมือนกัน${p} มีร้านไหนแนะนำบ้าง`;
  }
  if (has(/คาเฟ่|กาแฟ|ชา/)) return pick([`ชอบคาเฟ่${interests.includes('คาเฟ่') ? 'มาก' : 'เหมือนกัน'}${p}! ${trip ? `ที่${trip.city}มีร้านน่านั่งเยอะเลย ไปตะลอนด้วยกันไหม` : ''}`.trim(), `ไปนั่งคาเฟ่ช่วงบ่ายกันไหม${q} แล้วค่อยไปเที่ยวต่อ`], prev);
  if (has(/รูป|ถ่าย|กล้อง/)) return interests.includes('ถ่ายรูป') ? `เราชอบถ่ายรูปมาก${p}! ${tips ? `${tips.places[0]}ตอนเช้าแสงสวยมาก` : 'ไปถ่ายด้วยกันได้เลย'}` : `ได้เลย${p} ถ่ายรูปให้กันได้ 📸`;
  if (has(/เจอ|นัด|ไปด้วย|ไปกัน|ว่าง|ด้วยกัน/)) {
    const day = shared ? [shared.check_in, theirTrips.find((b) => b.city === shared.city)?.check_in].filter(Boolean).sort().pop() : null;
    return pick([`ได้เลย${p}! ${day ? `เจอกันวันที่ ${fmt(day)} ช่วงสาย ๆ ไหม` : 'สะดวกวันไหนบอกได้เลย'} นัดเจอที่ที่คนเยอะ ๆ อย่างล็อบบี้โรงแรมหรือคาเฟ่${na}`,
      `ดีเลย${p} ${tips ? `ไป${tips.places[0]}ด้วยกัน` : 'ไปเที่ยวด้วยกัน'} แล้วค่อยแชทนัดเวลากันอีกที`], prev);
  }
  if (has(/ที่ไหน|ไปไหน|แนะนำ|เที่ยว|อยากไป|น่าไป/)) {
    return tips ? pick([`ที่${trip.city}อยากไป${tips.places[0]}กับ${tips.places[1]}${p} คุณอยากไปที่ไหนบ้าง`, `เราลิสต์ไว้ว่าจะไป${tips.places.slice(0, 3).join(', ')} สนใจไปด้วยกันไหม${q}`], prev)
      : `เราชอบ${interests.slice(0, 2).join('กับ') || 'เที่ยวชิล ๆ'}${p} คุณมีที่ไหนแนะนำไหม`;
  }
  if (has(/ชอบอะไร|งานอะไร|ทำอะไร|อายุ|แนะนำตัว|เป็นคน/)) return `${bot.bio || 'เป็นคนชอบเที่ยว'} ${bot.age ? `อายุ ${bot.age} ` : ''}สไตล์เที่ยวแบบ${bot.travel_style || 'ชิล ๆ'}${p} แล้วคุณล่ะ`;
  if (has(/โอเค|ok|ตกลง|ดีเลย|ได้เลย|เอาเลย|ได้ๆ|ได้ครับ|ได้ค่ะ/)) return pick([`เยี่ยมเลย${p}! ใกล้วันแล้วทักมาอีกที${na}`, `ตกลงตามนี้${p} 🙌`], prev);
  if (has(/\?|ไหม|มั้ย|หรอ|เหรอ|อะไร|ยังไง/)) return pick([`อืม ดีเลย${p} ${trip ? `แต่ที่${trip.city}ต้องดูอากาศด้วย` : ''}`.trim(), `ได้${p} เดี๋ยวเราลองหาข้อมูลเพิ่มแล้วบอก${na}`], prev);
  return pick([
    `ฟังดูสนุกเลย${p}!`,
    `555 ใช่เลย${p}`,
    interests[0] ? `ว่าแต่คุณชอบ${interests[0]}ไหม${q} เราชอบมาก` : `ว่าแต่คุณชอบเที่ยวแบบไหน${q}`,
    trip ? `ตื่นเต้นกับทริป${trip.city}มากเลย${p}` : `อยากไปเที่ยวแล้วเนี่ย`,
  ], prev);
}

// ---------- ตอบด้วย Claude ----------
async function claudeReply(bot, me, history) {
  const persona = {
    name: bot.name, gender: bot.gender, age: bot.age, bio: bot.bio, travel_style: bot.travel_style,
    interests: parseJSON(bot.interests),
    trips: tripsOf(bot.id).map(({ city, hotel, check_in, check_out }) => ({ city, hotel, check_in, check_out })),
  };
  const partner = { name: me.name, trips: tripsOf(me.id).map(({ city, hotel, check_in, check_out }) => ({ city, hotel, check_in, check_out })) };
  const transcript = history.slice(-20).map((m) => `${m.sender_id === bot.id ? bot.name : me.name}: ${m.text}`).join('\n');

  const response = await getClient().beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'คุณสวมบทบาทเป็นผู้ใช้ตัวอย่างในฟีเจอร์ "จับคู่บัดดี้ท่องเที่ยว" ของเว็บจองโรงแรม อัศวินรัตติกาล (ระบบสาธิต) ' +
      'ตอบแชทเป็นภาษาไทยแบบเป็นกันเองตามโปรไฟล์ persona ที่ได้รับ สั้น 1–2 ประโยคเหมือนแชทจริง ใช้คำลงท้ายตามเพศ ' +
      'คุยเรื่องการวางแผนทริป สถานที่ อาหาร และความสนใจร่วมกัน อ้างอิงทริปของทั้งสองฝ่ายได้ ' +
      'ห้ามให้หรือขอเบอร์โทร ที่อยู่ หรือข้อมูลการเงิน และถ้าจะนัดเจอให้เสนอที่สาธารณะ ' +
      'ตอบเฉพาะข้อความแชทถัดไปของ persona เท่านั้น ไม่ต้องใส่ชื่อนำหน้า',
    messages: [{ role: 'user', content: JSON.stringify({ persona, partner, transcript }) }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude ปฏิเสธการตอบ');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error('Claude ไม่ได้ส่งข้อความกลับมา');
  return text.slice(0, 1000);
}

async function generateReply(bot, me, history) {
  if (claudeEnabled()) {
    try { return await claudeReply(bot, me, history); }
    catch (err) { console.warn('⚠️  บัดดี้ตัวอย่าง (Claude) ตอบไม่ได้ จึงใช้กฎแทน:', err.message); }
  }
  return localReply(bot, me, history);
}

/** หลังผู้ใช้ส่งข้อความ: ถ้าอีกฝ่ายเป็นบัดดี้ตัวอย่าง ให้ตอบกลับหลังหน่วงเวลาสักครู่ (ส่งรัว ๆ จะตอบรวมครั้งเดียว) */
export function scheduleReply(match, senderId) {
  const botId = match.requester_id === senderId ? match.target_id : match.requester_id;
  const bot = userOf(botId), me = userOf(senderId);
  if (!bot?.auto_reply || me?.auto_reply) return;
  clearTimeout(typing.get(match.id));
  typing.set(match.id, setTimeout(async () => {
    try {
      const still = db.prepare("SELECT 1 FROM buddy_matches WHERE id = ? AND status = 'accepted'").get(match.id);
      if (!still) return;
      const history = db.prepare('SELECT sender_id, text FROM messages WHERE match_id = ? ORDER BY id').all(match.id);
      const text = await generateReply(bot, me, history);
      db.prepare('INSERT INTO messages (match_id, sender_id, text) VALUES (?,?,?)').run(match.id, bot.id, text);
    } catch (err) {
      console.warn('⚠️  บัดดี้ตัวอย่างตอบแชทไม่สำเร็จ:', err.message);
    } finally {
      typing.delete(match.id);
    }
  }, 1500 + Math.random() * 1500));
}

/** คำขอจับคู่ที่ส่งถึงบัดดี้ตัวอย่าง: ตอบรับอัตโนมัติพร้อมทักทาย */
export function autoAcceptRequest(matchId, delay = 2500) {
  setTimeout(() => {
    const m = db.prepare("SELECT * FROM buddy_matches WHERE id = ? AND status = 'pending'").get(matchId);
    if (!m) return;
    const bot = userOf(m.target_id), me = userOf(m.requester_id);
    if (!bot?.auto_reply || me?.auto_reply) return;
    db.prepare("UPDATE buddy_matches SET status = 'accepted', responded_at = datetime('now') WHERE id = ?").run(m.id);
    db.prepare('INSERT INTO messages (match_id, sender_id, text) VALUES (?,?,?)').run(m.id, bot.id, localReply(bot, me, [{ sender_id: me.id, text: 'สวัสดี' }]));
    notify(me.id, { title: 'จับคู่บัดดี้สำเร็จ', message: `${bot.name} ตอบรับเป็นบัดดี้แล้ว เริ่มแชทกันได้เลย`, link: `#/chat/${m.id}` });
  }, delay);
}

// ตอนเปิดเซิร์ฟเวอร์: คำขอที่ค้างอยู่กับบัดดี้ตัวอย่างให้ตอบรับเลย
export function acceptPendingSampleRequests() {
  db.prepare(`SELECT m.id FROM buddy_matches m JOIN users t ON t.id = m.target_id JOIN users r ON r.id = m.requester_id
    WHERE m.status = 'pending' AND t.auto_reply = 1 AND r.auto_reply = 0`).all()
    .forEach((m, i) => autoAcceptRequest(m.id, 1000 + i * 200));
}
