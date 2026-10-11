// REST API ทั้งหมดของระบบ
import { db, today, nightsBetween, parseJSON, bookingCode } from './db.js';
import { verifyPassword, hashPassword } from './password.js';
import { createSession, destroySession, publicUser } from './auth.js';
import * as gateway from './services/paymentGateway.js';
import { notify } from './services/notificationService.js';
import { suggestBuddies } from './services/buddyAgent.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const routes = [];
const route = (method, path, opts, handler) => {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth: opts.auth ?? true, admin: !!opts.admin });
};

export function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

// ---------------- helpers ----------------
const ACTIVE_STATUSES = "('pending','confirmed','checked_in')";
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s + 'T00:00:00'));
const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.trunc(Number(v)) : d);

function validateStay(checkIn, checkOut, { allowPast = false } = {}) {
  if (!isDate(checkIn) || !isDate(checkOut)) fail(400, 'กรุณาเลือกวันเช็คอินและเช็คเอาท์');
  if (!allowPast && checkIn < today()) fail(400, 'วันเช็คอินต้องไม่เป็นวันที่ผ่านมาแล้ว');
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) fail(400, 'วันเช็คเอาท์ต้องอยู่หลังวันเช็คอิน');
  if (nights > 30) fail(400, 'จองได้สูงสุด 30 คืนต่อครั้ง');
  return nights;
}

function availableRooms(roomId, checkIn, checkOut, excludeBookingId = 0) {
  const room = db.prepare('SELECT total_rooms FROM rooms WHERE id = ?').get(roomId);
  const used = db.prepare(`
    SELECT COALESCE(SUM(rooms_count),0) AS n FROM bookings
    WHERE room_id = ? AND id != ? AND status IN ${ACTIVE_STATUSES}
      AND check_in < ? AND check_out > ?`).get(roomId, excludeBookingId, checkOut, checkIn).n;
  return Math.max(0, room.total_rooms - used);
}

/** คำนวณราคา: ราคาห้อง × จำนวนคืน × จำนวนห้อง + โปรโมชั่น */
export function quote(room, checkIn, checkOut, roomsCount) {
  const nights = nightsBetween(checkIn, checkOut);
  const subtotal = room.price * nights * roomsCount;
  let discount = 0, promo = null;
  if (nights >= 3) { discount = Math.round(subtotal * 0.1); promo = 'พัก 3 คืนขึ้นไป ลด 10%'; }
  return { nights, roomsCount, pricePerNight: room.price, subtotal, discount, promo, total: subtotal - discount };
}

function refundPolicy(booking) {
  const days = nightsBetween(today(), booking.check_in);
  let percent = 0, rule = 'ยกเลิกน้อยกว่า 3 วันก่อนเช็คอิน: ไม่คืนเงิน';
  if (days >= 7) { percent = 100; rule = 'ยกเลิกล่วงหน้า 7 วันขึ้นไป: คืนเงิน 100%'; }
  else if (days >= 3) { percent = 50; rule = 'ยกเลิกล่วงหน้า 3–6 วัน: คืนเงิน 50%'; }
  return { daysBefore: days, percent, rule, paid: booking.paid_amount, refund: Math.round(booking.paid_amount * percent / 100) };
}

function hotelRating(hotelId) {
  const r = db.prepare('SELECT ROUND(AVG(rating),1) AS rating, COUNT(*) AS count FROM reviews WHERE hotel_id = ?').get(hotelId);
  return { rating: r.rating || 0, reviewCount: r.count };
}

function shapeHotel(h) {
  return { ...h, amenities: parseJSON(h.amenities), photos: parseJSON(h.photos), ...hotelRating(h.id) };
}

function loadBooking(id, user) {
  const b = db.prepare(`
    SELECT b.*, r.type AS room_type, r.price AS room_price, r.capacity, r.hotel_id,
           h.name AS hotel_name, h.city, h.address, h.hue, h.icon, h.photos,
           u.username, u.name AS user_name
    FROM bookings b JOIN rooms r ON r.id = b.room_id JOIN hotels h ON h.id = r.hotel_id
    JOIN users u ON u.id = b.user_id WHERE b.id = ?`).get(id);
  if (!b) fail(404, 'ไม่พบการจอง');
  if (user.role !== 'admin' && b.user_id !== user.id) fail(403, 'คุณไม่มีสิทธิ์เข้าถึงการจองนี้');
  b.nights = nightsBetween(b.check_in, b.check_out);
  b.amount_due = Math.max(0, b.total_price - b.paid_amount);
  b.review = db.prepare('SELECT * FROM reviews WHERE booking_id = ?').get(b.id) || null;
  return b;
}

function bookingDetail(id, user) {
  const b = loadBooking(id, user);
  b.payments = db.prepare('SELECT * FROM payments WHERE booking_id = ? ORDER BY id DESC').all(b.id);
  return b;
}

const touch = (id) => db.prepare("UPDATE bookings SET updated_at = datetime('now') WHERE id = ?").run(id);

function confirmPayment(booking, payment, user) {
  db.prepare('UPDATE bookings SET paid_amount = paid_amount + ?, status = ? WHERE id = ?')
    .run(payment.amount, 'confirmed', booking.id);
  touch(booking.id);
  notify(booking.user_id, {
    title: 'ยืนยันการจองสำเร็จ',
    message: `การจอง ${booking.code} ที่ ${booking.hotel_name} (${booking.check_in} – ${booking.check_out}) ได้รับการยืนยันแล้ว ชำระเงิน ${payment.amount.toLocaleString()} บาท`,
    link: `#/booking/${booking.id}`,
    channels: ['in_app', 'email', 'sms'],
  });
  return bookingDetail(booking.id, user);
}

// ---------------- Auth ----------------
route('POST', '/api/auth/register', { auth: false }, ({ body }) => {
  const username = String(body.username || '').trim().toLowerCase();
  const { password, name, email, phone } = body;
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) fail(400, 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _ หรือ . ความยาว 3–20 ตัว');
  if (!password || password.length < 6) fail(400, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  if (!name?.trim()) fail(400, 'กรุณากรอกชื่อ-นามสกุล');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'รูปแบบอีเมลไม่ถูกต้อง');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'ชื่อผู้ใช้นี้ถูกใช้แล้ว');
  db.prepare('INSERT INTO users (username, password_hash, name, email, phone) VALUES (?,?,?,?,?)')
    .run(username, hashPassword(password), name.trim(), email || null, phone || null);
  return { ok: true, message: 'สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบ' };
});

route('POST', '/api/auth/login', { auth: false }, ({ body, res }) => {
  const username = String(body.username || '').trim().toLowerCase();
  if (!username || !body.password) fail(400, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !verifyPassword(body.password, u.password_hash)) fail(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  res.setHeader('Set-Cookie', createSession(u.id, !!body.remember));
  return { user: publicUser(u) };
});

route('POST', '/api/auth/logout', { auth: false }, ({ req, res }) => {
  res.setHeader('Set-Cookie', destroySession(req));
  return { ok: true };
});

route('GET', '/api/auth/me', { auth: false }, ({ user }) => ({ user: publicUser(user) }));

// ---------------- Hotels ----------------
route('GET', '/api/cities', { auth: false }, () =>
  db.prepare('SELECT city, COUNT(*) AS hotels FROM hotels GROUP BY city ORDER BY hotels DESC').all());

route('GET', '/api/hotels', { auth: false }, ({ query }) => {
  const q = (query.q || '').trim();
  const { checkIn, checkOut } = query;
  const guests = Math.max(1, int(query.guests, 1));
  const roomsCount = Math.max(1, int(query.rooms, 1));
  const hasDates = !!(checkIn && checkOut);
  if (hasDates) validateStay(checkIn, checkOut);

  let hotels = db.prepare(`SELECT * FROM hotels WHERE (? = '' OR city LIKE ? OR name LIKE ? OR address LIKE ?)`)
    .all(q, `%${q}%`, `%${q}%`, `%${q}%`).map(shapeHotel);

  hotels = hotels.map((h) => {
    const rooms = db.prepare('SELECT * FROM rooms WHERE hotel_id = ?').all(h.id);
    const fit = rooms
      .map((r) => ({ r, left: hasDates ? availableRooms(r.id, checkIn, checkOut) : r.total_rooms }))
      .filter(({ r, left }) => r.capacity * roomsCount >= guests && left >= roomsCount)
      .sort((a, b) => a.r.price - b.r.price);
    return { ...h, minPrice: fit[0]?.r.price ?? null, roomsLeft: fit[0]?.left ?? 0, availableTypes: fit.map(({ r }) => r.type) };
  }).filter((h) => h.minPrice !== null);

  const maxPrice = int(query.maxPrice, 0);
  const minRating = Number(query.minRating || 0);
  if (maxPrice) hotels = hotels.filter((h) => h.minPrice <= maxPrice);
  if (minRating) hotels = hotels.filter((h) => h.rating >= minRating);
  if (query.stars) {
    const wanted = new Set(String(query.stars).split(',').map(Number));
    hotels = hotels.filter((h) => wanted.has(h.star_class));
  }

  const sorters = {
    price_asc: (a, b) => a.minPrice - b.minPrice,
    price_desc: (a, b) => b.minPrice - a.minPrice,
    rating: (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
  };
  hotels.sort(sorters[query.sort] || sorters.rating);
  return { results: hotels, nights: hasDates ? nightsBetween(checkIn, checkOut) : null };
});

route('GET', '/api/hotels/:id', { auth: false }, ({ params, query }) => {
  const h = db.prepare('SELECT * FROM hotels WHERE id = ?').get(params.id);
  if (!h) fail(404, 'ไม่พบโรงแรม');
  const { checkIn, checkOut } = query;
  const roomsCount = Math.max(1, int(query.rooms, 1));
  const hasDates = isDate(checkIn) && isDate(checkOut) && checkOut > checkIn;
  const rooms = db.prepare('SELECT * FROM rooms WHERE hotel_id = ? ORDER BY price').all(h.id).map((r) => ({
    ...r,
    amenities: parseJSON(r.amenities),
    available: hasDates ? availableRooms(r.id, checkIn, checkOut) : r.total_rooms,
    quote: hasDates ? quote(r, checkIn, checkOut, roomsCount) : null,
  }));
  const reviews = db.prepare(`
    SELECT rv.rating, rv.comment, rv.created_at, u.name FROM reviews rv JOIN users u ON u.id = rv.user_id
    WHERE rv.hotel_id = ? ORDER BY rv.id DESC`).all(h.id);
  return { hotel: shapeHotel(h), rooms, reviews };
});

// ---------------- Bookings ----------------
route('POST', '/api/bookings', ({ body, user }) => {
  const room = db.prepare('SELECT r.*, h.name AS hotel_name FROM rooms r JOIN hotels h ON h.id = r.hotel_id WHERE r.id = ?').get(body.roomId);
  if (!room) fail(404, 'ไม่พบห้องพัก');
  validateStay(body.checkIn, body.checkOut);
  const roomsCount = Math.max(1, int(body.roomsCount, 1));
  const guests = Math.max(1, int(body.guests, 1));
  if (guests > room.capacity * roomsCount) fail(400, `ห้อง ${room.type} รองรับได้ ${room.capacity} คนต่อห้อง กรุณาเพิ่มจำนวนห้อง`);
  if (!body.guestName?.trim()) fail(400, 'กรุณากรอกชื่อผู้เข้าพัก');
  if (!body.guestPhone?.trim()) fail(400, 'กรุณากรอกเบอร์โทรศัพท์ผู้เข้าพัก');
  if (availableRooms(room.id, body.checkIn, body.checkOut) < roomsCount) fail(409, 'ขออภัย ห้องว่างไม่เพียงพอในช่วงวันที่เลือก');

  const q = quote(room, body.checkIn, body.checkOut, roomsCount);
  const r = db.prepare(`INSERT INTO bookings
    (code, user_id, room_id, check_in, check_out, guests, rooms_count, guest_name, guest_phone, guest_email, special_request, total_price, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`).run(
    bookingCode(), user.id, room.id, body.checkIn, body.checkOut, guests, roomsCount,
    body.guestName.trim(), body.guestPhone.trim(), body.guestEmail || null, body.specialRequest || null, q.total);
  return bookingDetail(Number(r.lastInsertRowid), user);
});

route('GET', '/api/bookings', ({ user }) =>
  db.prepare(`
    SELECT b.*, r.type AS room_type, h.name AS hotel_name, h.city, h.hue, h.icon, h.photos,
      (SELECT COUNT(*) FROM reviews rv WHERE rv.booking_id = b.id) AS reviewed
    FROM bookings b JOIN rooms r ON r.id = b.room_id JOIN hotels h ON h.id = r.hotel_id
    WHERE b.user_id = ? ORDER BY b.check_in DESC, b.id DESC`).all(user.id));

route('GET', '/api/bookings/:id', ({ params, user }) => bookingDetail(params.id, user));

// ชำระเงินด้วยบัตร
route('POST', '/api/bookings/:id/pay', async ({ params, body, user }) => {
  const b = loadBooking(params.id, user);
  if (b.status !== 'pending' || b.amount_due <= 0) fail(400, 'การจองนี้ไม่มียอดที่ต้องชำระ');
  const result = await gateway.chargeCard({ amount: b.amount_due, card: body.card });
  const p = db.prepare(`INSERT INTO payments (booking_id, method, amount, status, transaction_ref, message) VALUES (?, 'card', ?, ?, ?, ?)`)
    .run(b.id, b.amount_due, result.status, result.transactionRef || null, result.message);
  if (result.status !== 'success') return { status: 'failed', message: result.message, booking: bookingDetail(b.id, user) };
  return { status: 'success', message: result.message, booking: confirmPayment(b, { id: p.lastInsertRowid, amount: b.amount_due }, user) };
});

// สร้าง QR พร้อมเพย์
route('POST', '/api/bookings/:id/qr', ({ params, user }) => {
  const b = loadBooking(params.id, user);
  if (b.status !== 'pending' || b.amount_due <= 0) fail(400, 'การจองนี้ไม่มียอดที่ต้องชำระ');
  const qr = gateway.createQrPayment({ amount: b.amount_due });
  const p = db.prepare(`INSERT INTO payments (booking_id, method, amount, status, transaction_ref, message) VALUES (?, 'qr', ?, 'pending', ?, 'รอสแกนชำระ')`)
    .run(b.id, b.amount_due, qr.transactionRef);
  return { paymentId: Number(p.lastInsertRowid), ...qr };
});

// ตรวจสอบผลการชำระผ่าน QR
route('POST', '/api/payments/:id/qr-confirm', async ({ params, user }) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(params.id);
  if (!p || p.method !== 'qr') fail(404, 'ไม่พบรายการชำระเงิน');
  const b = loadBooking(p.booking_id, user);
  if (p.status !== 'pending' || b.status !== 'pending') fail(400, 'รายการนี้ดำเนินการไปแล้ว');
  const result = await gateway.verifyQrPayment({ transactionRef: p.transaction_ref });
  db.prepare('UPDATE payments SET status = ?, message = ? WHERE id = ?').run(result.status, result.message, p.id);
  if (result.status !== 'success') return { status: 'failed', message: result.message, booking: bookingDetail(b.id, user) };
  return { status: 'success', message: result.message, booking: confirmPayment(b, p, user) };
});

// ดูราคาใหม่ก่อนแก้ไขวันที่
route('GET', '/api/bookings/:id/quote', ({ params, query, user }) => {
  const b = loadBooking(params.id, user);
  validateStay(query.checkIn, query.checkOut);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(b.room_id);
  const q = quote(room, query.checkIn, query.checkOut, b.rooms_count);
  return { ...q, available: availableRooms(room.id, query.checkIn, query.checkOut, b.id) >= b.rooms_count, paid: b.paid_amount, difference: q.total - b.paid_amount };
});

// แก้ไขวันเข้าพัก
route('PATCH', '/api/bookings/:id', async ({ params, body, user }) => {
  const b = loadBooking(params.id, user);
  if (!['pending', 'confirmed'].includes(b.status)) fail(400, 'แก้ไขได้เฉพาะการจองที่ยังไม่เช็คอิน');
  validateStay(body.checkIn, body.checkOut);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(b.room_id);
  if (availableRooms(room.id, body.checkIn, body.checkOut, b.id) < b.rooms_count) fail(409, 'ห้องไม่ว่างในช่วงวันที่ใหม่');
  const q = quote(room, body.checkIn, body.checkOut, b.rooms_count);

  let message = 'แก้ไขวันเข้าพักเรียบร้อย';
  let status = b.status;
  let paid = b.paid_amount;
  if (paid > q.total) {
    const refundAmt = paid - q.total;
    const rf = await gateway.refund({ amount: refundAmt, originalRef: b.code });
    db.prepare(`INSERT INTO payments (booking_id, kind, method, amount, status, transaction_ref, message) VALUES (?, 'refund', 'refund', ?, 'success', ?, ?)`)
      .run(b.id, refundAmt, rf.transactionRef, 'คืนส่วนต่างจากการแก้ไขวันเข้าพัก');
    paid = q.total;
    message += ` และคืนเงินส่วนต่าง ${refundAmt.toLocaleString()} บาท`;
  } else if (paid > 0 && paid < q.total) {
    status = 'pending';
    message += ` กรุณาชำระส่วนต่าง ${(q.total - paid).toLocaleString()} บาท`;
  }
  db.prepare('UPDATE bookings SET check_in = ?, check_out = ?, total_price = ?, paid_amount = ?, status = ? WHERE id = ?')
    .run(body.checkIn, body.checkOut, q.total, paid, status, b.id);
  touch(b.id);
  notify(b.user_id, { title: 'แก้ไขการจองแล้ว', message: `การจอง ${b.code}: ${body.checkIn} – ${body.checkOut}. ${message}`, link: `#/booking/${b.id}` });
  return { message, booking: bookingDetail(b.id, user) };
});

route('GET', '/api/bookings/:id/refund-preview', ({ params, user }) => refundPolicy(loadBooking(params.id, user)));

route('POST', '/api/bookings/:id/cancel', async ({ params, user }) => {
  const b = loadBooking(params.id, user);
  if (!['pending', 'confirmed'].includes(b.status)) fail(400, 'ไม่สามารถยกเลิกการจองนี้ได้');
  const policy = refundPolicy(b);
  if (policy.refund > 0) {
    const rf = await gateway.refund({ amount: policy.refund, originalRef: b.code });
    db.prepare(`INSERT INTO payments (booking_id, kind, method, amount, status, transaction_ref, message) VALUES (?, 'refund', 'refund', ?, 'success', ?, ?)`)
      .run(b.id, policy.refund, rf.transactionRef, policy.rule);
  }
  db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now'), paid_amount = paid_amount - ? WHERE id = ?")
    .run(policy.refund, b.id);
  touch(b.id);
  notify(b.user_id, {
    title: 'ยกเลิกการจองแล้ว',
    message: `การจอง ${b.code} ถูกยกเลิก${policy.refund ? ` ระบบจะคืนเงิน ${policy.refund.toLocaleString()} บาท` : ''}`,
    link: `#/booking/${b.id}`,
  });
  return { policy, booking: bookingDetail(b.id, user) };
});

route('POST', '/api/bookings/:id/checkin', ({ params, user }) => {
  const b = loadBooking(params.id, user);
  if (b.status !== 'confirmed') fail(400, 'เช็คอินได้เฉพาะการจองที่ยืนยันและชำระเงินครบแล้ว');
  db.prepare("UPDATE bookings SET status = 'checked_in', checked_in_at = datetime('now') WHERE id = ?").run(b.id);
  touch(b.id);
  notify(b.user_id, { title: 'เช็คอินสำเร็จ', message: `ยินดีต้อนรับสู่ ${b.hotel_name} ขอให้มีความสุขกับการเข้าพัก`, link: `#/booking/${b.id}` });
  return bookingDetail(b.id, user);
});

route('POST', '/api/bookings/:id/checkout', ({ params, user }) => {
  const b = loadBooking(params.id, user);
  if (b.status !== 'checked_in') fail(400, 'ต้องเช็คอินก่อนจึงจะเช็คเอาท์ได้');
  db.prepare("UPDATE bookings SET status = 'checked_out', checked_out_at = datetime('now') WHERE id = ?").run(b.id);
  touch(b.id);
  notify(b.user_id, { title: 'เช็คเอาท์เรียบร้อย', message: `ขอบคุณที่เข้าพักกับ ${b.hotel_name} ร่วมให้คะแนนและรีวิวได้เลย`, link: `#/booking/${b.id}` });
  return bookingDetail(b.id, user);
});

route('POST', '/api/bookings/:id/review', ({ params, body, user }) => {
  const b = loadBooking(params.id, user);
  if (b.user_id !== user.id) fail(403, 'รีวิวได้เฉพาะผู้จอง');
  if (b.status !== 'checked_out') fail(400, 'รีวิวได้หลังจากเช็คเอาท์แล้ว');
  if (b.review) fail(409, 'คุณรีวิวการเข้าพักนี้ไปแล้ว');
  const rating = int(body.rating, 0);
  if (rating < 1 || rating > 5) fail(400, 'กรุณาให้คะแนน 1–5 ดาว');
  db.prepare('INSERT INTO reviews (booking_id, user_id, hotel_id, rating, comment) VALUES (?,?,?,?,?)')
    .run(b.id, user.id, b.hotel_id, rating, String(body.comment || '').trim().slice(0, 1000));
  return bookingDetail(b.id, user);
});

// ---------------- Notifications ----------------
route('GET', '/api/notifications', ({ user }) => ({
  items: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id),
  unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).n,
}));
route('POST', '/api/notifications/read', ({ user }) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
  return { ok: true };
});

// ---------------- Buddy ----------------
route('GET', '/api/buddy/profile', ({ user }) => publicUser(user));

route('PUT', '/api/buddy/profile', ({ body, user }) => {
  const interests = Array.isArray(body.interests)
    ? [...new Set(body.interests.map((s) => String(s).trim()).filter(Boolean))].slice(0, 12) : [];
  const age = body.age ? int(body.age, null) : null;
  if (age !== null && (age < 18 || age > 99)) fail(400, 'ฟีเจอร์จับคู่บัดดี้สำหรับผู้มีอายุ 18 ปีขึ้นไป');
  if (body.buddy_enabled && !interests.length) fail(400, 'กรุณาเลือกความสนใจอย่างน้อย 1 อย่าง');
  db.prepare('UPDATE users SET gender = ?, age = ?, bio = ?, interests = ?, travel_style = ?, buddy_enabled = ? WHERE id = ?')
    .run(body.gender || null, age, String(body.bio || '').slice(0, 300), JSON.stringify(interests), body.travel_style || null, body.buddy_enabled ? 1 : 0, user.id);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
});

route('POST', '/api/buddy/suggest', async ({ user }) => {
  if (!user.buddy_enabled) fail(400, 'กรุณาเปิดใช้งานและกรอกโปรไฟล์บัดดี้ก่อน');
  return suggestBuddies(user.id);
});

const matchView = (m, me) => {
  const otherId = m.requester_id === me ? m.target_id : m.requester_id;
  const o = db.prepare('SELECT id, name, age, gender, bio, interests, travel_style FROM users WHERE id = ?').get(otherId);
  const last = db.prepare('SELECT text, created_at, sender_id FROM messages WHERE match_id = ? ORDER BY id DESC LIMIT 1').get(m.id);
  return { ...m, direction: m.requester_id === me ? 'outgoing' : 'incoming', other: { ...o, interests: parseJSON(o.interests) }, last_message: last || null };
};

route('GET', '/api/buddy/matches', ({ user }) => {
  const rows = db.prepare(`SELECT * FROM buddy_matches WHERE (requester_id = ? OR target_id = ?) AND status != 'rejected' ORDER BY id DESC`)
    .all(user.id, user.id).map((m) => matchView(m, user.id));
  return {
    incoming: rows.filter((m) => m.status === 'pending' && m.direction === 'incoming'),
    outgoing: rows.filter((m) => m.status === 'pending' && m.direction === 'outgoing'),
    accepted: rows.filter((m) => m.status === 'accepted'),
  };
});

route('POST', '/api/buddy/request', ({ body, user }) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ? AND buddy_enabled = 1 AND role = 'customer'").get(body.userId);
  if (!target || target.id === user.id) fail(404, 'ไม่พบผู้ใช้');
  const exists = db.prepare(`SELECT 1 FROM buddy_matches WHERE status IN ('pending','accepted')
    AND ((requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?))`).get(user.id, target.id, target.id, user.id);
  if (exists) fail(409, 'มีคำขอจับคู่กับผู้ใช้นี้อยู่แล้ว');
  db.prepare('INSERT INTO buddy_matches (requester_id, target_id, score, reason) VALUES (?,?,?,?)')
    .run(user.id, target.id, int(body.score, null), String(body.reason || '').slice(0, 300));
  notify(target.id, { title: 'มีคำขอจับคู่บัดดี้ใหม่', message: `${user.name} อยากเป็นบัดดี้ท่องเที่ยวกับคุณ`, link: '#/buddy' });
  return { ok: true };
});

route('POST', '/api/buddy/matches/:id/respond', ({ params, body, user }) => {
  const m = db.prepare('SELECT * FROM buddy_matches WHERE id = ?').get(params.id);
  if (!m || m.target_id !== user.id) fail(404, 'ไม่พบคำขอจับคู่');
  if (m.status !== 'pending') fail(400, 'ตอบรับคำขอนี้ไปแล้ว');
  const status = body.accept ? 'accepted' : 'rejected';
  db.prepare("UPDATE buddy_matches SET status = ?, responded_at = datetime('now') WHERE id = ?").run(status, m.id);
  notify(m.requester_id, {
    title: body.accept ? 'จับคู่บัดดี้สำเร็จ' : 'คำขอจับคู่ถูกปฏิเสธ',
    message: body.accept ? `${user.name} ตอบรับเป็นบัดดี้แล้ว เริ่มแชทกันได้เลย` : `${user.name} ปฏิเสธคำขอจับคู่`,
    link: body.accept ? `#/chat/${m.id}` : '#/buddy',
  });
  return { ok: true, status };
});

function acceptedMatch(id, user) {
  const m = db.prepare("SELECT * FROM buddy_matches WHERE id = ? AND status = 'accepted'").get(id);
  if (!m || (m.requester_id !== user.id && m.target_id !== user.id)) fail(404, 'ไม่พบห้องแชท');
  return m;
}

route('GET', '/api/buddy/matches/:id/messages', ({ params, query, user }) => {
  const m = acceptedMatch(params.id, user);
  return {
    match: matchView(m, user.id),
    messages: db.prepare('SELECT * FROM messages WHERE match_id = ? AND id > ? ORDER BY id').all(m.id, int(query.after, 0)),
  };
});

route('POST', '/api/buddy/matches/:id/messages', ({ params, body, user }) => {
  const m = acceptedMatch(params.id, user);
  const text = String(body.text || '').trim().slice(0, 1000);
  if (!text) fail(400, 'กรุณาพิมพ์ข้อความ');
  const r = db.prepare('INSERT INTO messages (match_id, sender_id, text) VALUES (?,?,?)').run(m.id, user.id, text);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid);
});

route('POST', '/api/buddy/report', ({ body, user }) => {
  const reason = String(body.reason || '').trim();
  if (!reason) fail(400, 'กรุณาระบุเหตุผลในการรายงาน');
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(body.userId);
  if (!target || target.id === user.id) fail(404, 'ไม่พบผู้ใช้');
  db.prepare('INSERT INTO reports (reporter_id, reported_id, reason) VALUES (?,?,?)').run(user.id, target.id, reason.slice(0, 500));
  db.prepare(`UPDATE buddy_matches SET status = 'rejected' WHERE status IN ('pending','accepted')
    AND ((requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?))`).run(user.id, target.id, target.id, user.id);
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin'").all()) {
    notify(a.id, { title: 'มีรายงานผู้ใช้ไม่เหมาะสม', message: reason.slice(0, 120), link: '#/admin', channels: ['in_app'] });
  }
  return { ok: true };
});

// ---------------- Admin ----------------
route('GET', '/api/admin/stats', { admin: true }, () => ({
  bookings: db.prepare('SELECT status, COUNT(*) AS n FROM bookings GROUP BY status').all(),
  revenue: db.prepare("SELECT COALESCE(SUM(paid_amount),0) AS n FROM bookings WHERE status != 'pending'").get().n,
  users: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n,
  openReports: db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n,
}));

route('GET', '/api/admin/bookings', { admin: true }, ({ query }) =>
  db.prepare(`
    SELECT b.*, r.type AS room_type, h.name AS hotel_name, u.username
    FROM bookings b JOIN rooms r ON r.id = b.room_id JOIN hotels h ON h.id = r.hotel_id JOIN users u ON u.id = b.user_id
    WHERE (? = '' OR b.status = ?) ORDER BY b.check_in DESC LIMIT 200`).all(query.status || '', query.status || ''));

route('GET', '/api/admin/reports', { admin: true }, () =>
  db.prepare(`
    SELECT rp.*, a.name AS reporter_name, b.name AS reported_name, b.username AS reported_username, b.buddy_enabled
    FROM reports rp JOIN users a ON a.id = rp.reporter_id JOIN users b ON b.id = rp.reported_id ORDER BY rp.id DESC`).all());

route('POST', '/api/admin/reports/:id/resolve', { admin: true }, ({ params, body }) => {
  const rp = db.prepare('SELECT * FROM reports WHERE id = ?').get(params.id);
  if (!rp) fail(404, 'ไม่พบรายงาน');
  if (body.suspend) {
    db.prepare('UPDATE users SET buddy_enabled = 0 WHERE id = ?').run(rp.reported_id);
    notify(rp.reported_id, { title: 'บัญชีถูกระงับการใช้ฟีเจอร์บัดดี้', message: 'เนื่องจากได้รับรายงานพฤติกรรมไม่เหมาะสม', channels: ['in_app', 'email'] });
  }
  db.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").run(rp.id);
  return { ok: true };
});

