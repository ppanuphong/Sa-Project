// ฐานข้อมูล SQLite (ใช้ node:sqlite ที่มากับ Node.js ไม่ต้องติดตั้งเพิ่ม)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './password.js';

const here = dirname(fileURLToPath(import.meta.url));
// บน Vercel เขียนไฟล์ได้เฉพาะ /tmp (ข้อมูลจะกลับเป็นข้อมูลตัวอย่างเมื่อ instance ถูกสร้างใหม่)
const DB_PATH = process.env.DB_PATH || (process.env.VERCEL ? '/tmp/app.db' : join(here, '..', 'data', 'app.db'));
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer',          -- customer | admin
  gender TEXT,
  age INTEGER,
  bio TEXT,
  interests TEXT NOT NULL DEFAULT '[]',           -- JSON array
  travel_style TEXT,
  buddy_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hotels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT,
  description TEXT,
  amenities TEXT NOT NULL DEFAULT '[]',
  hue INTEGER NOT NULL DEFAULT 200,
  icon TEXT NOT NULL DEFAULT '🏨'
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,                             -- ราคาต่อห้องต่อคืน
  capacity INTEGER NOT NULL,                       -- ผู้เข้าพักสูงสุดต่อห้อง
  total_rooms INTEGER NOT NULL,
  bed TEXT,
  size INTEGER,
  amenities TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  guests INTEGER NOT NULL,
  rooms_count INTEGER NOT NULL DEFAULT 1,
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  special_request TEXT,
  total_price REAL NOT NULL,
  paid_amount REAL NOT NULL DEFAULT 0,             -- ยอดชำระสุทธิ (หักเงินคืนแล้ว)
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | confirmed | checked_in | checked_out | cancelled
  checked_in_at TEXT,
  checked_out_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  kind TEXT NOT NULL DEFAULT 'payment',            -- payment | refund
  method TEXT NOT NULL,                            -- card | qr | truemoney | refund
  amount REAL NOT NULL,
  status TEXT NOT NULL,                            -- pending | success | failed
  transaction_ref TEXT,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER UNIQUE REFERENCES bookings(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS buddy_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  target_id INTEGER NOT NULL REFERENCES users(id),
  score INTEGER,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | accepted | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES buddy_matches(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS booking_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                              -- edit | cancel
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected | withdrawn
  data TEXT NOT NULL DEFAULT '{}',                 -- JSON: edit = ค่าเดิม/ค่าใหม่, cancel = นโยบายคืนเงิน ณ วันที่ขอ
  reason TEXT,                                     -- เหตุผลจากลูกค้า
  admin_note TEXT,                                 -- หมายเหตุจากแอดมิน
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reported_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- migration: รูปภาพและระดับดาวของโรงแรม ----------
const hotelCols = db.prepare('PRAGMA table_info(hotels)').all().map((c) => c.name);
if (!hotelCols.includes('photos')) db.exec("ALTER TABLE hotels ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'");
if (!hotelCols.includes('star_class')) db.exec('ALTER TABLE hotels ADD COLUMN star_class INTEGER NOT NULL DEFAULT 4');

// ---------- migration: บัดดี้ตัวอย่างที่ตอบแชทอัตโนมัติ ----------
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('auto_reply')) db.exec('ALTER TABLE users ADD COLUMN auto_reply INTEGER NOT NULL DEFAULT 0');
// เวลา (ms) ที่บัดดี้ตัวอย่างจะตอบแชท: > 0 = รอตอบ, < 0 = กำลังสร้างคำตอบ (เก็บเวลาที่เริ่ม), NULL = ไม่มี
const matchCols = db.prepare('PRAGMA table_info(buddy_matches)').all().map((c) => c.name);
if (!matchCols.includes('reply_due')) db.exec('ALTER TABLE buddy_matches ADD COLUMN reply_due INTEGER');
const SAMPLE_BUDDIES = ['mali', 'somchai', 'nok', 'ploy', 'ton', 'fah', 'bank', 'mint', 'pete', 'jane'];
function markSampleBuddies() {
  db.prepare(`UPDATE users SET auto_reply = 1 WHERE role = 'customer' AND username IN (${SAMPLE_BUDDIES.map(() => '?').join(',')})`)
    .run(...SAMPLE_BUDDIES);
}

// รูปภาพจาก Unsplash (เก็บเป็น photo id) + ระดับดาว
const HOTEL_MEDIA = {
  'ริเวอร์ไซด์ แกรนด์ บางกอก': [5, ['1542314831-068cd1dbfeeb', '1590490360182-c33d57733427', '1571896349842-33c89424de2d', '1414235077428-338989a2e8c0']],
  'สุขุมวิท ซิตี้ โฮเทล': [4, ['1455587734955-081b22074882', '1631049307264-da0ec9d70304', '1576675784201-0e142b423952', '1504674900247-0877df9cc836']],
  'ดอยสุเทพ วิว รีสอร์ท': [4, ['1445019980597-93fa8acb246c', '1596394516093-501ba68a0ba6', '1611892440504-42a792e24d32', '1566073771259-6a8506099945']],
  'นิมมาน บูทีค โฮเทล': [3, ['1535827841776-24afc1e255ac', '1578683010236-d716f9a3f461', '1618773928121-c32242e63f39', '1504674900247-0877df9cc836']],
  'ป่าตอง บีช รีสอร์ท': [4, ['1540541338287-41700207dee6', '1600011689032-8b628b8a8747', '1519046904884-53103b34b206', '1582719478250-c89cae4dc85b']],
  'กะตะ ซันเซ็ต วิลล่า': [5, ['1584132967334-10e028bd69f7', '1566073771259-6a8506099945', '1600334089648-b0d9d3028eb2', '1582719478250-c89cae4dc85b']],
  'อ่าวนาง คลิฟฟ์ รีสอร์ท': [4, ['1520250497591-112f2f40a3f4', '1552465011-b4e21bf6e79a', '1544551763-46a013bb70d5', '1559339352-11d035aa65de']],
  'พัทยา เบย์ โฮเทล': [3, ['1564501049412-61c2a3083791', '1559339352-11d035aa65de', '1551882547-ff40c63fe5fa', '1618773928121-c32242e63f39']],
};
function applyHotelMedia() {
  const upd = db.prepare("UPDATE hotels SET star_class = ?, photos = ? WHERE name = ? AND photos = '[]'");
  for (const [name, [stars, photos]] of Object.entries(HOTEL_MEDIA)) upd.run(stars, JSON.stringify(photos), name);
}

// ความจุห้องแต่ละประเภท (ใช้ปรับฐานข้อมูลเดิมให้ตรงกับค่าใน seed)
// 1–3 คน: Standard / Deluxe / Family Suite · 4–5 คน: Deluxe / Family Suite · 6 คน: Family Suite
const ROOM_SPECS = {
  Standard: [3, 'เตียงควีน 1 + เตียงเสริม 1'],
  Deluxe: [5, 'เตียงคิง 1 + เตียงเดี่ยว 2'],
  'Family Suite': [6, 'เตียงคิง 2 + เตียงเดี่ยว 2'],
};
function applyRoomSpecs() {
  const upd = db.prepare('UPDATE rooms SET capacity = ?, bed = ? WHERE type = ?');
  for (const [type, [capacity, bed]] of Object.entries(ROOM_SPECS)) upd.run(capacity, bed, type);
}

// คำขอแก้ไข/ยกเลิกตัวอย่าง ให้แดชบอร์ดแอดมินมีรายการรอตรวจสอบ (สร้างครั้งเดียวตอนยังไม่มีคำขอเลย)
function seedRequests() {
  if (db.prepare('SELECT COUNT(*) AS n FROM booking_requests').get().n) return;
  const pick = (username) => db.prepare(`
    SELECT b.*, r.type AS room_type, r.price, r.hotel_id FROM bookings b
    JOIN rooms r ON r.id = b.room_id JOIN users u ON u.id = b.user_id
    WHERE u.username = ? AND b.status = 'confirmed' AND b.check_in > date('now', 'localtime')
    ORDER BY b.check_in LIMIT 1`).get(username);
  const ins = db.prepare(`INSERT INTO booking_requests (booking_id, user_id, type, data, reason, created_at)
    VALUES (?,?,?,?,?, datetime('now', ?))`);

  const e = pick('mali');
  if (e) {
    const suite = db.prepare("SELECT * FROM rooms WHERE hotel_id = ? AND type = 'Family Suite'").get(e.hotel_id);
    if (suite) {
      const n = Math.round((new Date(e.check_out) - new Date(e.check_in)) / 86400000);
      const sub = suite.price * n * e.rooms_count, total = n >= 3 ? sub - Math.round(sub * 0.1) : sub;
      const data = {
        before: { checkIn: e.check_in, checkOut: e.check_out, guests: e.guests, roomId: e.room_id, roomType: e.room_type, total: e.total_price },
        after: { checkIn: e.check_in, checkOut: e.check_out, guests: 4, roomId: suite.id, roomType: suite.type, total },
      };
      ins.run(e.id, e.user_id, 'edit', JSON.stringify(data), 'เพื่อนจะมาด้วยอีก 3 คน ขอเปลี่ยนเป็นห้องใหญ่', '-3 hours');
    }
  }
  const c = pick('nok');
  if (c) {
    const days = Math.round((new Date(c.check_in) - new Date(today())) / 86400000);
    const percent = days >= 7 ? 100 : days >= 3 ? 50 : 0;
    const rule = percent === 100 ? 'ยกเลิกล่วงหน้า 7 วันขึ้นไป: คืนเงิน 100%' : percent ? 'ยกเลิกล่วงหน้า 3–6 วัน: คืนเงิน 50%' : 'ยกเลิกน้อยกว่า 3 วันก่อนเช็คอิน: ไม่คืนเงิน';
    const policy = { daysBefore: days, percent, rule, paid: c.paid_amount, refund: Math.round(c.paid_amount * percent / 100) };
    ins.run(c.id, c.user_id, 'cancel', JSON.stringify(policy), 'ติดธุระด่วน ไปไม่ได้แล้ว', '-1 day');
  }
}

// ---------- helpers ----------
export const toISODate = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const today = () => toISODate(new Date());
export const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
};
export const nightsBetween = (a, b) =>
  Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

export const parseJSON = (s, fallback = []) => {
  try { return JSON.parse(s); } catch { return fallback; }
};

export function bookingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = 'SB';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

// ---------- seed ----------
function seed() {
  const has = db.prepare('SELECT COUNT(*) AS n FROM hotels').get().n;
  if (has > 0) return;
  console.log('🌱 กำลังสร้างข้อมูลตัวอย่าง...');

  const insHotel = db.prepare(
    'INSERT INTO hotels (name, city, address, description, amenities, hue, icon) VALUES (?,?,?,?,?,?,?)'
  );
  const insRoom = db.prepare(
    'INSERT INTO rooms (hotel_id, type, description, price, capacity, total_rooms, bed, size, amenities) VALUES (?,?,?,?,?,?,?,?,?)'
  );

  const hotels = [
    ['ริเวอร์ไซด์ แกรนด์ บางกอก', 'กรุงเทพฯ', 'ถนนเจริญกรุง บางรัก กรุงเทพฯ',
      'โรงแรมหรูริมแม่น้ำเจ้าพระยา วิวพระอาทิตย์ตก ใกล้ไอคอนสยามและเอเชียทีค', ['สระว่ายน้ำ', 'ฟิตเนส', 'สปา', 'Wi-Fi ฟรี', 'อาหารเช้า'], 210, '🌉'],
    ['สุขุมวิท ซิตี้ โฮเทล', 'กรุงเทพฯ', 'สุขุมวิท ซอย 11 กรุงเทพฯ',
      'โรงแรมใจกลางเมือง เดินถึง BTS นานา 3 นาที เหมาะกับสายช้อปและสายกิน', ['Wi-Fi ฟรี', 'รูฟท็อปบาร์', 'ฟิตเนส'], 260, '🏙️'],
    ['ดอยสุเทพ วิว รีสอร์ท', 'เชียงใหม่', 'ถนนห้วยแก้ว เมืองเชียงใหม่',
      'รีสอร์ทบรรยากาศล้านนา ท่ามกลางธรรมชาติ วิวดอยสุเทพ อากาศเย็นสบาย', ['สระว่ายน้ำ', 'สปา', 'อาหารเช้า', 'จักรยานฟรี'], 140, '⛰️'],
    ['นิมมาน บูทีค โฮเทล', 'เชียงใหม่', 'ถนนนิมมานเหมินท์ ซอย 9 เชียงใหม่',
      'บูทีคโฮเทลสไตล์มินิมอล อยู่กลางย่านคาเฟ่และร้านอาหารยอดนิยม', ['Wi-Fi ฟรี', 'คาเฟ่', 'Co-working'], 30, '☕'],
    ['ป่าตอง บีช รีสอร์ท', 'ภูเก็ต', 'ถนนทวีวงศ์ ป่าตอง ภูเก็ต',
      'รีสอร์ทติดหาดป่าตอง ใกล้ถนนบางลา เดินทางสะดวก บรรยากาศคึกคัก', ['ติดทะเล', 'สระว่ายน้ำ', 'บาร์', 'Wi-Fi ฟรี'], 190, '🏖️'],
    ['กะตะ ซันเซ็ต วิลล่า', 'ภูเก็ต', 'หาดกะตะ ภูเก็ต',
      'พูลวิลล่าส่วนตัว วิวพระอาทิตย์ตกทะเลอันดามัน เงียบสงบ เป็นส่วนตัว', ['สระส่วนตัว', 'อาหารเช้า', 'รถรับส่งสนามบิน'], 20, '🌅'],
    ['อ่าวนาง คลิฟฟ์ รีสอร์ท', 'กระบี่', 'อ่าวนาง เมืองกระบี่',
      'รีสอร์ทวิวหน้าผาหินปูน ใกล้ท่าเรือไปเกาะพีพีและทะเลแหวก', ['สระว่ายน้ำ', 'ทัวร์เกาะ', 'สปา'], 160, '🏝️'],
    ['พัทยา เบย์ โฮเทล', 'ชลบุรี', 'ถนนเลียบชายหาด พัทยา ชลบุรี',
      'โรงแรมวิวทะเลอ่าวพัทยา ใกล้วอล์กกิ้งสตรีทและเทอร์มินอล 21', ['สระว่ายน้ำ', 'ฟิตเนส', 'Wi-Fi ฟรี'], 330, '🌊'],
  ];

  const roomSets = [
    // [type, desc, priceFactor, capacity, total, bed, size, amenities]
    ['Standard', 'ห้องมาตรฐาน กว้างขวาง สะอาด ครบครัน', 1, 3, 6, 'เตียงควีน 1 + เตียงเสริม 1', 26, ['แอร์', 'ทีวี', 'ตู้เย็น']],
    ['Deluxe', 'ห้องดีลักซ์ พร้อมระเบียงและวิวสวย', 1.6, 5, 4, 'เตียงคิง 1 + เตียงเดี่ยว 2', 34, ['แอร์', 'ระเบียง', 'อ่างอาบน้ำ', 'มินิบาร์']],
    ['Family Suite', 'ห้องสวีทสำหรับครอบครัว มีห้องนั่งเล่นแยก', 2.6, 6, 2, 'เตียงคิง 2 + เตียงเดี่ยว 2', 58, ['แอร์', 'ห้องนั่งเล่น', 'เครื่องชงกาแฟ', 'อ่างอาบน้ำ']],
  ];
  const basePrices = [2400, 1500, 1800, 1200, 2100, 6500, 1900, 1400];

  hotels.forEach((h, i) => {
    const { lastInsertRowid: hid } = insHotel.run(h[0], h[1], h[2], h[3], JSON.stringify(h[4]), h[5], h[6]);
    roomSets.forEach((r) => {
      if (i === 5 && r[0] === 'Standard') return; // วิลล่าไม่มีห้อง standard
      insRoom.run(hid, r[0], r[1], Math.round((basePrices[i] * r[2]) / 10) * 10, r[3], r[4], r[5], r[6], JSON.stringify(r[7]));
    });
  });

  // ผู้ใช้ตัวอย่าง
  const insUser = db.prepare(`INSERT INTO users
    (username, password_hash, name, email, phone, role, gender, age, bio, interests, travel_style, buddy_enabled)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const users = [
    ['admin', 'admin123', 'ผู้ดูแลระบบ', 'admin@staybuddy.test', '020000000', 'admin', null, null, null, [], null, 0],
    ['demo', 'demo1234', 'ผู้ใช้ทดลอง', 'demo@staybuddy.test', '0810000000', 'customer', 'ไม่ระบุ', 25,
      'ชอบเที่ยวคาเฟ่และเดินป่า อยากหาเพื่อนเที่ยวเชียงใหม่', ['คาเฟ่', 'เดินป่า', 'ถ่ายรูป'], 'ชิล ๆ', 1],
    ['mali', 'mali1234', 'มะลิ', 'mali@staybuddy.test', '0811111111', 'customer', 'หญิง', 24,
      'ช่างภาพสายธรรมชาติ ตื่นเช้าไปดูทะเลหมอก', ['ถ่ายรูป', 'เดินป่า', 'คาเฟ่', 'ธรรมชาติ'], 'ชิล ๆ', 1],
    ['somchai', 'somchai1234', 'สมชาย', 'somchai@staybuddy.test', '0822222222', 'customer', 'ชาย', 29,
      'สายกินตัวจริง ตระเวนร้านอาหารท้องถิ่นและตลาดกลางคืน', ['อาหาร', 'ตลาดกลางคืน', 'คาเฟ่'], 'ลุย ๆ', 1],
    ['nok', 'nok12345', 'นก', 'nok@staybuddy.test', '0833333333', 'customer', 'หญิง', 31,
      'ชอบดำน้ำ ปีนเขา กิจกรรมเอาต์ดอร์ทุกแบบ', ['ดำน้ำ', 'ปีนเขา', 'เดินป่า', 'ทะเล'], 'ผจญภัย', 1],
    ['ploy', 'ploy1234', 'พลอย', 'ploy@staybuddy.test', '0844444444', 'customer', 'หญิง', 22,
      'นักศึกษาชอบเที่ยววัด เรียนรู้วัฒนธรรม และช้อปของแฮนด์เมด', ['วัฒนธรรม', 'วัด', 'ช้อปปิ้ง', 'คาเฟ่'], 'ชิล ๆ', 1],
    ['ton', 'ton12345', 'ต้น', 'ton@staybuddy.test', '0855555555', 'customer', 'ชาย', 35,
      'ทำงานรีโมต ชอบ co-working และปั่นจักรยาน', ['ปั่นจักรยาน', 'Co-working', 'อาหาร'], 'ชิล ๆ', 1],
  ];
  const uid = {};
  for (const u of users) {
    const r = insUser.run(u[0], hashPassword(u[1]), u[2], u[3], u[4], u[5], u[6], u[7], u[8], JSON.stringify(u[9]), u[10], u[11]);
    uid[u[0]] = Number(r.lastInsertRowid);
  }

  const t = today();
  const roomOf = (hotelId, type) =>
    db.prepare('SELECT * FROM rooms WHERE hotel_id = ? AND type = ?').get(hotelId, type);
  const insBooking = db.prepare(`INSERT INTO bookings
    (code, user_id, room_id, check_in, check_out, guests, rooms_count, guest_name, guest_phone, guest_email, total_price, paid_amount, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const mkBooking = (user, hotelId, type, inOff, nights, status) => {
    const room = roomOf(hotelId, type);
    const ci = addDays(t, inOff), co = addDays(t, inOff + nights);
    const total = room.price * nights;
    const u = users.find((x) => x[0] === user);
    const paid = status === 'pending' ? 0 : total;
    const r = insBooking.run(bookingCode(), uid[user], room.id, ci, co, 1, 1, u[2], u[4], u[3], total, paid, status);
    if (paid) {
      db.prepare(`INSERT INTO payments (booking_id, method, amount, status, transaction_ref, message)
        VALUES (?, 'card', ?, 'success', ?, 'ข้อมูลตัวอย่าง')`).run(r.lastInsertRowid, paid, 'TXN-SEED-' + r.lastInsertRowid);
    }
    return Number(r.lastInsertRowid);
  };

  // ทริปเชียงใหม่ที่เวลาทับซ้อนกัน เพื่อให้ AI Agent จับคู่ได้
  mkBooking('demo', 3, 'Deluxe', 5, 3, 'confirmed');
  mkBooking('mali', 4, 'Standard', 4, 4, 'confirmed');
  mkBooking('somchai', 3, 'Standard', 6, 2, 'confirmed');
  mkBooking('ploy', 4, 'Deluxe', 5, 3, 'confirmed');
  mkBooking('nok', 5, 'Deluxe', 10, 4, 'confirmed');
  mkBooking('ton', 4, 'Standard', 20, 5, 'confirmed');

  // การจองที่เข้าพักเสร็จแล้ว + รีวิว
  const insReview = db.prepare('INSERT INTO reviews (booking_id, user_id, hotel_id, rating, comment) VALUES (?,?,?,?,?)');
  const past = [
    ['mali', 3, 'Standard', 5, 'วิวสวยมาก ตอนเช้าเห็นทะเลหมอก พนักงานน่ารัก'],
    ['somchai', 1, 'Deluxe', 4, 'ห้องกว้าง อาหารเช้าอร่อย แต่ช่วงเย็นรถติดหน่อย'],
    ['nok', 7, 'Deluxe', 5, 'ใกล้ท่าเรือมาก ไปทัวร์เกาะสะดวก วิวหน้าผาอลังการ'],
    ['ploy', 4, 'Standard', 4, 'ทำเลดี เดินไปคาเฟ่ได้หลายร้าน ห้องเล็กไปนิด'],
    ['ton', 2, 'Standard', 4, 'เดินทางสะดวก ใกล้ BTS เน็ตแรงทำงานได้'],
    ['mali', 5, 'Deluxe', 3, 'ติดทะเลดี แต่เสียงดังตอนกลางคืน'],
    ['somchai', 8, 'Standard', 4, 'คุ้มราคา วิวทะเลสวย'],
    ['nok', 6, 'Deluxe', 5, 'วิลล่าส่วนตัวดีที่สุดที่เคยพัก พระอาทิตย์ตกสวยมาก'],
  ];
  for (const [user, hid, type, rating, comment] of past) {
    const bid = mkBooking(user, hid, type, -20, 2, 'checked_out');
    insReview.run(bid, uid[user], hid, rating, comment);
  }

  // คำขอจับคู่บัดดี้ที่รอ demo ตอบรับ
  db.prepare(`INSERT INTO buddy_matches (requester_id, target_id, score, reason, status) VALUES (?,?,?,?, 'pending')`)
    .run(uid.mali, uid.demo, 86, 'ไปเชียงใหม่ช่วงเดียวกัน และชอบถ่ายรูป เดินป่า คาเฟ่ เหมือนกัน');

  db.prepare(`INSERT INTO notifications (user_id, title, message, link) VALUES (?,?,?,?)`)
    .run(uid.demo, 'มีคำขอจับคู่บัดดี้ใหม่', 'มะลิ ส่งคำขอเป็นบัดดี้เที่ยวเชียงใหม่กับคุณ', '#/buddy');
}

// ---------- บัดดี้ตัวอย่างเพิ่มเติม ----------
// แยกจาก seed() เพื่อให้เพิ่มเข้าไปในฐานข้อมูลเดิมได้ด้วย (เพิ่มเฉพาะคนที่ยังไม่มี)
function seedExtraBuddies() {
  if (!db.prepare('SELECT COUNT(*) AS n FROM hotels').get().n) return;
  const extra = [
    // username, password, ชื่อ, เพศ, อายุ, แนะนำตัว, ความสนใจ, สไตล์, [โรงแรม, ห้อง, เริ่มอีกกี่วัน, จำนวนคืน]
    ['fah', 'fah12345', 'ฟ้า', 'หญิง', 26, 'สายคาเฟ่ตัวจริง ชอบถ่ายรูปฟิล์มและนั่งชิลดูวิวภูเขา', ['คาเฟ่', 'ถ่ายรูป', 'ธรรมชาติ'], 'ชิล ๆ', [3, 'Standard', 5, 3]],
    ['bank', 'bank1234', 'แบงค์', 'ชาย', 27, 'ชอบเดินป่าขึ้นดอย ตั้งแคมป์ และถ่ายรูปวิวพระอาทิตย์ขึ้น', ['เดินป่า', 'ปีนเขา', 'ถ่ายรูป'], 'ลุย ๆ', [4, 'Deluxe', 6, 3]],
    ['mint', 'mint1234', 'มิ้นท์', 'หญิง', 23, 'หลงรักทะเล ดำน้ำตื้นได้ทั้งวัน กลางคืนชอบไปบีชบาร์', ['ทะเล', 'ดำน้ำ', 'ปาร์ตี้'], 'ผจญภัย', [5, 'Standard', 10, 4]],
    ['pete', 'pete1234', 'พีท', 'ชาย', 30, 'เที่ยวแบบประหยัด ตระเวนกินสตรีทฟู้ดและตลาดกลางคืน', ['อาหาร', 'ตลาดกลางคืน', 'ช้อปปิ้ง'], 'ประหยัด', [2, 'Standard', 3, 2]],
    ['jane', 'jane1234', 'เจน', 'LGBTQ+', 28, 'ชอบรีสอร์ทวิวทะเล สปา และคาเฟ่สวย ๆ พักผ่อนแบบไม่เร่งรีบ', ['สปา', 'คาเฟ่', 'ทะเล'], 'หรูหรา', [7, 'Deluxe', 15, 3]],
  ];
  const insUser = db.prepare(`INSERT INTO users
    (username, password_hash, name, email, phone, role, gender, age, bio, interests, travel_style, buddy_enabled)
    VALUES (?,?,?,?,?, 'customer', ?,?,?,?,?, 1)`);
  const insBooking = db.prepare(`INSERT INTO bookings
    (code, user_id, room_id, check_in, check_out, guests, rooms_count, guest_name, guest_phone, guest_email, total_price, paid_amount, status)
    VALUES (?,?,?,?,?, 1, 1, ?,?,?,?,?, 'confirmed')`);
  const insPay = db.prepare(`INSERT INTO payments (booking_id, method, amount, status, transaction_ref, message)
    VALUES (?, 'card', ?, 'success', ?, 'ข้อมูลตัวอย่าง')`);
  extra.forEach(([username, pw, name, gender, age, bio, interests, style, [hotelId, type, inOff, nights]], i) => {
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return;
    const email = `${username}@staybuddy.test`, phone = `08${6 + i}${String(6 + i).repeat(7)}`;
    const uid = Number(insUser.run(username, hashPassword(pw), name, email, phone, gender, age, bio, JSON.stringify(interests), style).lastInsertRowid);
    const room = db.prepare('SELECT * FROM rooms WHERE hotel_id = ? AND type = ?').get(hotelId, type);
    const ci = addDays(today(), inOff), total = room.price * nights;
    const b = insBooking.run(bookingCode(), uid, room.id, ci, addDays(ci, nights), name, phone, email, total, total);
    insPay.run(b.lastInsertRowid, total, 'TXN-SEED-' + b.lastInsertRowid);
  });
}

seed();
seedExtraBuddies();
applyHotelMedia();
applyRoomSpecs();
seedRequests();
markSampleBuddies();

if (process.argv.includes('--seed-only')) {
  console.log('✅ สร้างฐานข้อมูลเรียบร้อย:', DB_PATH);
  process.exit(0);
}
