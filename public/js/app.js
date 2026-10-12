// อัศวินรัตติกาล — Single Page App (Vanilla JS + hash router)
import { ic } from './icons.js';
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const state = { user: null, unread: 0 };
let cleanup = null; // ฟังก์ชันเคลียร์ timer ของหน้าก่อนหน้า

// ================= Utilities =================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const fmtDate = (s) => s ? new Date(s.length === 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + 'Z').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const fmtTime = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (s) => `${fmtDate(s)} ${fmtTime(s)}`;
const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const todayISO = () => isoDate(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d); };
const nights = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const IMG = (id, w = 800) => `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`;
const photosOf = (p) => { if (Array.isArray(p)) return p; try { return JSON.parse(p || '[]'); } catch { return []; } };
// รูปจริง (ถ้าโหลดไม่ได้จะเห็นพื้นหลังสี + ไอคอนแทน)
const photo = (id, { hue = 210, w = 800, cls = '' } = {}) =>
  `<div class="ph ${cls}" style="background:linear-gradient(135deg,hsl(${hue} 60% 55%),hsl(${hue + 40} 55% 38%))"><span class="ph-icon">${ic('image', 32)}</span>${id ? `<img src="${IMG(id, w)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>`;
const cover = (hue, icon, photos) => photo(photosOf(photos)[0], { hue, icon, w: 600, cls: 'cover' });
const avatarColor = (name) => `hsl(${[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 55% 50%)`;
const avatar = (name, cls = '') => `<div class="avatar ${cls}" style="background:${avatarColor(name)}">${esc(String(name).charAt(0))}</div>`;

const STATUS = {
  pending: 'รอชำระเงิน', confirmed: 'ยืนยันแล้ว', checked_in: 'เช็คอินแล้ว', checked_out: 'เช็คเอาท์แล้ว', cancelled: 'ยกเลิกแล้ว',
};
const statusPill = (s) => `<span class="pill ${s}">${STATUS[s] || s}</span>`;
// ออกใบยืนยันการจองได้เมื่อชำระเงินแล้วเท่านั้น
const hasVoucher = (b) => ['confirmed', 'checked_in', 'checked_out'].includes(b.status);
const PAY_LABEL = { card: 'บัตรเครดิต/เดบิต', qr: 'QR พร้อมเพย์', truemoney: 'TrueMoney Wallet' };

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'เกิดข้อผิดพลาด');
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3800);
}

function modal(html, { wide = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`;
  const backdrop = root.firstElementChild;
  const close = () => { root.innerHTML = ''; };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(); });
  return { el: backdrop.querySelector('.modal'), close };
}

const loading = (text = 'กำลังโหลด...') => { $app.innerHTML = `<div class="loading"><div class="spinner"></div>${text}</div>`; };
const go = (hash) => { location.hash = hash; };
const formData = (form) => Object.fromEntries(new FormData(form));

async function withButton(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = 'กำลังดำเนินการ...';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

// ================= Nav =================
function renderNav(path = '') {
  const u = state.user;
  const link = (href, label, extra = '') =>
    `<a href="${href}" class="${path.startsWith(href.slice(1)) && href !== '#/' ? 'active' : ''}">${label}${extra}</a>`;
  const bell = `<a href="#/notifications" class="${path.startsWith('/notifications') ? 'active' : ''}" title="การแจ้งเตือน">${ic('bell', 20)}${state.unread ? `<span class="badge-dot">${state.unread}</span>` : ''}</a>`;
  if (!u) {
    $nav.innerHTML = link('#/search', 'ค้นหาโรงแรม') + `<a href="#/login" class="btn outline sm">เข้าสู่ระบบ</a><a href="#/register" class="btn sm">สร้างบัญชี</a>`;
  } else if (u.role === 'admin') {
    $nav.innerHTML = link('#/admin', 'แดชบอร์ดผู้ดูแล') +
      `<span class="who">${ic('circle-user', 20)} ${esc(u.name)}</span><button class="linklike" id="logout">ออกจากระบบ</button>`;
  } else {
    $nav.innerHTML = link('#/search', 'ค้นหาโรงแรม') + link('#/bookings', 'การจองของฉัน') + link('#/buddy', 'จับคู่บัดดี้') + bell +
      `<span class="who">${ic('circle-user', 20)} ${esc(u.name)}</span><button class="linklike" id="logout">ออกจากระบบ</button>`;
  }
  document.getElementById('logout')?.addEventListener('click', async () => {
    await api('POST', '/auth/logout');
    state.user = null; state.unread = 0;
    toast('ออกจากระบบแล้ว');
    go('#/login');
  });
}

async function refreshUnread() {
  if (!state.user) return;
  try { state.unread = (await api('GET', '/notifications')).unread; } catch { /* ignore */ }
  renderNav(location.hash.slice(1));
}

// ================= Pages: Auth =================
function loginPage(q) {
  $app.innerHTML = `
    <div class="auth-wrap"><div class="card">
      <h1>เข้าสู่ระบบ</h1>
      <p class="muted">ยินดีต้อนรับกลับสู่ อัศวินรัตติกาล</p>
      <div id="err"></div>
      <form id="f">
        <div class="field"><label>ชื่อผู้ใช้</label><input name="username" autocomplete="username" required autofocus></div>
        <div class="field"><label>รหัสผ่าน</label><input name="password" type="password" autocomplete="current-password" required></div>
        <div class="field"><label class="check"><input type="checkbox" name="remember"> จดจำการเข้าสู่ระบบ (30 วัน)</label></div>
        <button class="btn block">เข้าสู่ระบบ</button>
      </form>
      <p class="small muted" style="margin-top:var(--space-4)">ยังไม่มีบัญชี? <a href="#/register">สมัครสมาชิก</a></p>
      <div class="demo-accounts">
        <b>บัญชีทดลอง</b><br>
        ลูกค้า: <code>demo</code> / <code>demo1234</code><br>
        ผู้ดูแลระบบ: <code>admin</code> / <code>admin123</code>
      </div>
    </div></div>`;
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const btn = e.target.querySelector('button');
    try {
      const { user } = await withButton(btn, () => api('POST', '/auth/login', { ...d, remember: !!d.remember }));
      state.user = user;
      toast(`ยินดีต้อนรับ ${user.name}`, 'success');
      await refreshUnread();
      // เข้าสู่หน้าหลักตามสิทธิ์ผู้ใช้
      go(q.get('next') || (user.role === 'admin' ? '#/admin' : '#/'));
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

function registerPage() {
  $app.innerHTML = `
    <div class="auth-wrap"><div class="card">
      <h1>สมัครสมาชิก</h1>
      <p class="muted">สร้างบัญชีเพื่อจองโรงแรมและหาบัดดี้ท่องเที่ยว</p>
      <div id="err"></div>
      <form id="f">
        <div class="field"><label>ชื่อ-นามสกุล *</label><input name="name" required></div>
        <div class="field"><label>ชื่อผู้ใช้ *</label><input name="username" required pattern="[A-Za-z0-9_.]{3,20}" autocomplete="username">
          <div class="hint">a-z, 0-9, _ หรือ . ความยาว 3–20 ตัว</div></div>
        <div class="grid grid-2">
          <div class="field"><label>อีเมล</label><input name="email" type="email"></div>
          <div class="field"><label>เบอร์โทรศัพท์</label><input name="phone" inputmode="tel"></div>
        </div>
        <div class="field"><label>รหัสผ่าน *</label><input name="password" type="password" minlength="6" required autocomplete="new-password"></div>
        <div class="field"><label>ยืนยันรหัสผ่าน *</label><input name="confirm" type="password" required autocomplete="new-password"></div>
        <button class="btn block">สมัครสมาชิก</button>
      </form>
      <p class="small muted" style="margin-top:var(--space-4)">มีบัญชีแล้ว? <a href="#/login">เข้าสู่ระบบ</a></p>
    </div></div>`;
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const $err = document.getElementById('err');
    if (d.password !== d.confirm) { $err.innerHTML = `<div class="alert error">รหัสผ่านทั้งสองช่องไม่ตรงกัน</div>`; return; }
    try {
      const r = await withButton(e.target.querySelector('button'), () => api('POST', '/auth/register', d));
      toast(r.message, 'success');
      go('#/login');
    } catch (err) {
      $err.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

// ================= Pages: Search =================
const $hero = document.getElementById('hero-slot');
const HERO_PHOTO = '1506665531195-3566af2b4dfa';
const CITY_PHOTOS = {
  'กรุงเทพฯ': '1508009603885-50cf7c579365', 'เชียงใหม่': '1528181304800-259b08848526', 'ภูเก็ต': '1506665531195-3566af2b4dfa',
  'กระบี่': '1552465011-b4e21bf6e79a', 'ชลบุรี': '1507525428034-b723cf961d3e',
};
const ROOM_PHOTOS = {
  Standard: '1631049307264-da0ec9d70304', Deluxe: '1618773928121-c32242e63f39', 'Family Suite': '1578683010236-d716f9a3f461',
};
const SORTS = [['rating', 'star', 'รีวิวดีที่สุด'], ['price_asc', 'arrow-down-narrow-wide', 'ราคาถูก → แพง'], ['price_desc', 'arrow-up-wide-narrow', 'ราคาแพง → ถูก']];
const PERK_CANCEL = 'ยกเลิกล่วงหน้า 7 วัน คืนเงินเต็มจำนวน';

const guestLabel = (g, r) => `ผู้เข้าพัก ${g} คน, ${r} ห้อง`;
// วันที่แบบอ่านง่าย เช่น "อ. 13 ต.ค. 69"
const WEEKDAY = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const fmtDay = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${WEEKDAY[d.getDay()]} ${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}`; };
const dateField = (name, label, value, min) => `
  <label class="sbox-field date"><span class="ico">${ic('calendar-days', 20)}</span>
    <span><small>${label}</small><b data-date-text="${name}">${fmtDay(value)}</b></span>
    <input class="date-native" type="date" name="${name}" min="${min}" value="${value}" required aria-label="${label}">
  </label>`;
// โปรโมชั่นเดียวกับฝั่ง server: พัก 3 คืนขึ้นไป ลด 10%
const promoPrice = (price, n) => (n >= 3 ? Math.round(price * 0.9) : price);

function searchForm(q, compact = false) {
  const ci = q.get('checkIn') || addDays(todayISO(), 1);
  const co = q.get('checkOut') || addDays(ci, 2);
  const g = Number(q.get('guests') || 2), r = Number(q.get('rooms') || 1);
  return `
    <form class="sbox ${compact ? 'compact' : ''}" id="search" autocomplete="off">
      <label class="sbox-dest"><span class="ico">${ic('search', 20)}</span><input name="q" list="cities" placeholder="จะไปที่ไหน? ค้นหาเมือง หรือชื่อที่พัก" value="${esc(q.get('q') || '')}"><datalist id="cities"></datalist></label>
      <div class="sbox-row">
        ${dateField('checkIn', 'เช็คอิน', ci, todayISO())}
        ${dateField('checkOut', `เช็คเอาท์ · <span data-nights>${nights(ci, co)}</span> คืน`, co, addDays(ci, 1))}
        <div class="sbox-field guests" tabindex="0"><span class="ico">${ic('users', 20)}</span><span><small>ผู้เข้าพักและห้อง</small><b class="guest-label">${guestLabel(g, r)}</b></span>
          <input type="hidden" name="guests" value="${g}"><input type="hidden" name="rooms" value="${r}">
          <div class="guest-pop" hidden>
            <div class="stepper"><span>ห้อง</span><div><button type="button" data-k="rooms" data-d="-1">−</button><output data-o="rooms">${r}</output><button type="button" data-k="rooms" data-d="1">+</button></div></div>
            <div class="stepper"><span>ผู้เข้าพัก</span><div><button type="button" data-k="guests" data-d="-1">−</button><output data-o="guests">${g}</output><button type="button" data-k="guests" data-d="1">+</button></div></div>
            <button type="button" class="btn sm block" data-done style="margin-top:var(--space-2)">เสร็จสิ้น</button>
          </div>
        </div>
      </div>
      <button class="btn sbox-go">${ic('search', 18)} ค้นหา</button>
    </form>`;
}

// ปิด popover ผู้เข้าพักเมื่อคลิกนอกกล่อง
document.addEventListener('click', (e) => {
  document.querySelectorAll('.guest-pop:not([hidden])').forEach((pop) => {
    if (!pop.parentElement.contains(e.target)) pop.hidden = true;
  });
});

function bindSearchForm(extra = {}) {
  const f = document.getElementById('search');
  api('GET', '/cities').then((cities) => {
    f.querySelector('#cities').innerHTML = cities.map((c) => `<option value="${esc(c.city)}">`).join('');
  });
  const syncDates = () => {
    if (!f.checkIn.value) f.checkIn.value = addDays(todayISO(), 1);
    f.checkOut.min = addDays(f.checkIn.value, 1);
    if (!f.checkOut.value || f.checkOut.value <= f.checkIn.value) f.checkOut.value = addDays(f.checkIn.value, 1);
    f.querySelector('[data-date-text=checkIn]').textContent = fmtDay(f.checkIn.value);
    f.querySelector('[data-date-text=checkOut]').textContent = fmtDay(f.checkOut.value);
    f.querySelector('[data-nights]').textContent = nights(f.checkIn.value, f.checkOut.value);
  };
  f.checkIn.addEventListener('change', syncDates);
  f.checkOut.addEventListener('change', syncDates);
  // คลิกตรงไหนของช่องวันที่ก็เปิดปฏิทิน
  f.querySelectorAll('.date-native').forEach((inp) => inp.addEventListener('click', () => { try { inp.showPicker(); } catch { /* เบราว์เซอร์ไม่รองรับ */ } }));

  const box = f.querySelector('.guests'), pop = box.querySelector('.guest-pop');
  const sync = () => {
    const g = Number(f.guests.value), r = Number(f.rooms.value);
    box.querySelector('.guest-label').textContent = guestLabel(g, r);
    pop.querySelector('[data-o=guests]').textContent = g;
    pop.querySelector('[data-o=rooms]').textContent = r;
    pop.querySelector('[data-k=guests][data-d="-1"]').disabled = g <= Math.max(1, r);
    pop.querySelector('[data-k=rooms][data-d="-1"]').disabled = r <= 1;
    pop.querySelector('[data-k=guests][data-d="1"]').disabled = g >= 20;
    pop.querySelector('[data-k=rooms][data-d="1"]').disabled = r >= 10;
  };
  box.addEventListener('click', (e) => {
    const step = e.target.closest('[data-k]');
    if (step) {
      const input = f[step.dataset.k];
      input.value = Number(input.value) + Number(step.dataset.d);
      if (Number(f.guests.value) < Number(f.rooms.value)) f.guests.value = f.rooms.value; // อย่างน้อย 1 คนต่อห้อง
      return sync();
    }
    if (e.target.closest('[data-done]')) { pop.hidden = true; return; }
    if (!pop.contains(e.target)) pop.hidden = !pop.hidden;
  });
  sync();

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    go('#/search?' + new URLSearchParams({ ...formData(f), ...extra }));
  });
  return f;
}

const scoreLabel = (r) => {
  const s = r * 2;
  return s >= 9.5 ? 'ยอดเยี่ยมมาก' : s >= 9 ? 'ยอดเยี่ยม' : s >= 8 ? 'ดีมาก' : s >= 7 ? 'ดี' : 'พอใช้';
};
const scoreBadge = (r, count, cls = '') => r
  ? `<div class="score-wrap ${cls}"><div class="score-text"><b>${scoreLabel(r)}</b><span>${count} รีวิว</span></div><div class="score-badge">${(r * 2).toFixed(1)}</div></div>`
  : '<span class="muted small">ยังไม่มีรีวิว</span>';
const hotelStars = (n) => `<span class="hstars" title="โรงแรมระดับ ${n} ดาว">${'★'.repeat(n || 0)}</span>`;

async function homePage(q) {
  $hero.innerHTML = `
    <section class="hero2" style="--hero:url('${IMG(HERO_PHOTO, 1800)}')">
      <div class="container">
        <h1>ที่พักถูกใจ พร้อมเพื่อนเที่ยวที่ใช่</h1>
        <p class="sub">ค้นหาโรงแรมทั่วไทย จองและชำระเงินออนไลน์ แล้วให้ AI ช่วยหาบัดดี้ที่ไปเที่ยวช่วงเดียวกัน</p>
        <div class="search-card">
          <div class="search-tabs"><button type="button" class="active">${ic('hotel')} โรงแรมและที่พัก</button><a href="#/buddy">${ic('handshake')} หาบัดดี้เที่ยว</a></div>
          ${searchForm(q)}
        </div>
      </div>
    </section>`;
  $app.innerHTML = `
    <div class="promo-strip">
      <div class="promo"><span class="big">${ic('badge-percent', 26)}</span><div><b>พัก 3 คืนขึ้นไป ลด 10%</b><span class="small muted">ลดให้อัตโนมัติตอนจอง</span></div></div>
      <div class="promo"><span class="big">${ic('shield-check', 26)}</span><div><b>ยกเลิกได้ คืนเงินเต็มจำนวน</b><span class="small muted">เมื่อยกเลิกล่วงหน้า 7 วันขึ้นไป</span></div></div>
      <div class="promo"><span class="big">${ic('bot', 26)}</span><div><b>AI จับคู่บัดดี้ฟรี</b><span class="small muted">หาเพื่อนที่ไปเที่ยวช่วงเดียวกัน</span></div></div>
    </div>
    <div class="section-title"><h2>จุดหมายยอดนิยมในประเทศไทย</h2></div>
    <div class="city-row" id="city-cards"></div>
    <div class="section-title"><h2>ที่พักยอดนิยม</h2><a href="#/search">ดูทั้งหมด →</a></div>
    <div class="hotel-grid" id="top-hotels"></div>`;
  bindSearchForm();

  const [cities, top] = await Promise.all([api('GET', '/cities'), api('GET', '/hotels?sort=rating')]);
  const ci = addDays(todayISO(), 1), co = addDays(ci, 2);
  document.getElementById('city-cards').innerHTML = cities.map((c, i) => `
    <div class="city-tile" data-city="${esc(c.city)}">
      ${photo(CITY_PHOTOS[c.city], { hue: 200 + i * 40, w: 500 })}
      <b>${esc(c.city)}</b><span>${c.hotels} ที่พัก</span>
    </div>`).join('');
  document.querySelectorAll('.city-tile').forEach((el) => el.addEventListener('click', () => {
    const f = document.getElementById('search');
    f.q.value = el.dataset.city;
    f.requestSubmit();
  }));
  document.getElementById('top-hotels').innerHTML = top.results.slice(0, 8).map((h) => `
    <a class="hotel-tile" href="#/hotel/${h.id}?checkIn=${ci}&checkOut=${co}&guests=2&rooms=1">
      ${photo(h.photos[0], { hue: h.hue, icon: h.icon, w: 600 })}
      <div class="body">
        <h3>${esc(h.name)}</h3>
        <div>${hotelStars(h.star_class)}</div>
        <div class="small" style="color:var(--primary)">${ic('map-pin', 15)} ${esc(h.city)}</div>
        <div>${scoreBadge(h.rating, h.reviewCount)}</div>
        <div class="price-line"><span class="small muted">เริ่มต้น/คืน</span><div class="price" style="color:var(--price)">${money(h.minPrice)}</div></div>
      </div>
    </a>`).join('');
}

async function searchPage(q) {
  const params = new URLSearchParams(q);
  if (!params.get('checkIn')) { params.set('checkIn', addDays(todayISO(), 1)); params.set('checkOut', addDays(todayISO(), 3)); }
  const sort = params.get('sort') || 'rating';
  const stars = new Set((params.get('stars') || '').split(',').filter(Boolean));
  const setParam = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); go('#/search?' + p); };

  $hero.innerHTML = `<div class="search-strip"><div class="container">${searchForm(params, true)}</div></div>`;
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">หน้าแรก</a> › ประเทศไทย${params.get('q') ? ` › ${esc(params.get('q'))}` : ''}</div>
    <div class="results-layout">
      <aside class="card filters" id="filters">
        <div class="fsec"><h4>งบประมาณต่อคืน</h4>
          ${[['', 'ทุกช่วงราคา'], ['1500', 'ไม่เกิน ฿1,500'], ['2500', 'ไม่เกิน ฿2,500'], ['4000', 'ไม่เกิน ฿4,000'], ['8000', 'ไม่เกิน ฿8,000']].map(([v, l]) =>
            `<label class="opt"><input type="radio" name="maxPrice" value="${v}" ${(params.get('maxPrice') || '') === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <div class="fsec"><h4>คะแนนรีวิว</h4>
          ${[['', 'ทั้งหมด'], ['4.5', 'ยอดเยี่ยม 9+'], ['4', 'ดีมาก 8+'], ['3.5', 'ดี 7+']].map(([v, l]) =>
            `<label class="opt"><input type="radio" name="minRating" value="${v}" ${(params.get('minRating') || '') === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <div class="fsec"><h4>ระดับดาว</h4>
          ${[5, 4, 3].map((n) => `<label class="opt"><input type="checkbox" name="stars" value="${n}" ${stars.has(String(n)) ? 'checked' : ''}> <span class="hstars">${'★'.repeat(n)}</span></label>`).join('')}</div>
      </aside>
      <section>
        <div class="sortbar">
          <span class="sort-label">${ic('arrow-up-down', 16)} เรียงตาม</span>
          <div class="sort-opts" role="group" aria-label="เรียงผลการค้นหา">${SORTS.map(([k, icon, l]) => `<button type="button" data-sort="${k}" class="${k === sort ? 'active' : ''}" aria-pressed="${k === sort}">${ic(icon, 16)} ${l}</button>`).join('')}</div>
        </div>
        <div id="results"><div class="loading"><div class="spinner"></div>กำลังค้นหาห้องว่าง...</div></div>
      </section>
    </div>`;

  const keep = Object.fromEntries(['sort', 'maxPrice', 'minRating', 'stars'].map((k) => [k, params.get(k)]).filter(([, v]) => v));
  bindSearchForm(keep);
  document.querySelector('.sortbar').addEventListener('click', (e) => { const b = e.target.closest('[data-sort]'); if (b) setParam('sort', b.dataset.sort); });
  document.getElementById('filters').addEventListener('change', (e) => {
    if (e.target.name === 'stars') {
      const v = [...document.querySelectorAll('#filters [name=stars]:checked')].map((x) => x.value).join(',');
      return setParam('stars', v);
    }
    setParam(e.target.name, e.target.value);
  });

  const $r = document.getElementById('results');
  try {
    const { results, nights: n } = await api('GET', '/hotels?' + params);
    const stay = new URLSearchParams(['checkIn', 'checkOut', 'guests', 'rooms'].map((k) => [k, params.get(k) || '']).filter(([, v]) => v));
    $r.innerHTML = `<p class="result-meta"><b>${results.length} ที่พัก</b>${params.get('q') ? ` ใน "${esc(params.get('q'))}"` : ''} · ${fmtDate(params.get('checkIn'))} – ${fmtDate(params.get('checkOut'))} · ${n} คืน · ${guestLabel(params.get('guests') || 2, params.get('rooms') || 1)}</p>` +
      (results.length ? results.map((h) => {
        const per = promoPrice(h.minPrice, n);
        return `
        <a class="hcard" href="#/hotel/${h.id}?${stay}">
          <div class="hcard-photo">
            ${photo(h.photos[0], { hue: h.hue, icon: h.icon, w: 600 })}
            <div class="thumbs">${h.photos.slice(1, 4).map((id) => `<img src="${IMG(id, 200)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`).join('')}</div>
          </div>
          <div class="hcard-body">
            <h3>${esc(h.name)}</h3>
            <div>${hotelStars(h.star_class)}</div>
            <div class="loc">${ic('map-pin', 15)} ${esc(h.city)} · ${esc(h.address)}</div>
            <p class="desc">${esc(h.description)}</p>
            <div class="perk">${ic('check', 15)} ${PERK_CANCEL}</div>
            <div class="perk">${ic('check', 15)} ห้องว่าง: ${h.availableTypes.map(esc).join(', ')}</div>
            <div class="feat">${h.amenities.map((a) => `<span>${esc(a)}</span>`).join('')}</div>
          </div>
          <div class="hcard-side">
            ${scoreBadge(h.rating, h.reviewCount)}
            <div class="price-box">
              ${per < h.minPrice ? `<span class="deal">ลด 10%</span><s>${money(h.minPrice)}</s>` : ''}
              <div class="price">${money(per)}</div>
              <div class="small muted">ราคาต่อคืน รวมภาษีแล้ว</div>
              ${h.roomsLeft <= 3 ? `<div class="urgent">เหลือเพียง ${h.roomsLeft} ห้องในราคานี้!</div>` : ''}
              <span class="btn" style="margin-top:var(--space-2)">ดูห้องว่าง</span>
            </div>
          </div>
        </a>`;
      }).join('')
        : `<div class="card empty"><div class="icon">${ic('search-x', 40)}</div>ไม่พบที่พักที่มีห้องว่างตามเงื่อนไข ลองเปลี่ยนวันที่หรือตัวกรอง</div>`);
  } catch (err) {
    $r.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

// ================= Pages: Hotel detail =================
async function hotelPage(id, q) {
  loading();
  const ci = q.get('checkIn') || addDays(todayISO(), 1);
  const co = q.get('checkOut') || addDays(ci, 2);
  const guests = Number(q.get('guests') || 2), rooms = Number(q.get('rooms') || 1);
  const data = await api('GET', `/hotels/${id}?checkIn=${ci}&checkOut=${co}&rooms=${rooms}`);
  const h = data.hotel;
  const n = nights(ci, co);
  const shots = [...h.photos, ...data.rooms.map((r) => ROOM_PHOTOS[r.type]).filter(Boolean)];
  const fromPrice = Math.min(...data.rooms.map((r) => r.price));

  $app.innerHTML = `
    <div class="crumbs"><a href="#/">หน้าแรก</a> › <a href="#/search?${new URLSearchParams({ q: h.city, checkIn: ci, checkOut: co, guests, rooms })}">${esc(h.city)}</a> › ${esc(h.name)}</div>
    <div class="gallery2">${shots.slice(0, 5).map((pid, i) =>
      `<div class="ph" data-shot="${i}" style="background:linear-gradient(135deg,hsl(${h.hue} 60% 55%),hsl(${h.hue + 40} 55% 38%))"><img src="${IMG(pid, i ? 600 : 1200)}" alt="" loading="lazy" onerror="this.remove()">${i === 4 && shots.length > 5 ? `<span class="more">+${shots.length - 5} รูป</span>` : ''}</div>`).join('')}</div>
    <div class="jumpbar" id="jumpbar">
      ${[['overview', 'ภาพรวม'], ['rooms', 'ห้องพัก'], ['facilities', 'สิ่งอำนวยความสะดวก'], ['reviews', 'รีวิว']].map(([k, l], i) => `<button type="button" data-jump="${k}" class="${i ? '' : 'active'}">${l}</button>`).join('')}
    </div>
    <section class="card hotel-head" id="overview">
      <div>
        <div>${hotelStars(h.star_class)}</div>
        <h1>${esc(h.name)}</h1>
        <div style="color:var(--primary)">${ic('map-pin', 16)} ${esc(h.address)}</div>
        <p style="margin-top:var(--space-3)">${esc(h.description)}</p>
        <div class="highlights">${h.amenities.slice(0, 5).map((a) => `<span>${ic('check', 14)} ${esc(a)}</span>`).join('')}</div>
      </div>
      <div class="side">
        ${scoreBadge(h.rating, h.reviewCount, 'lg')}
        <div><div class="small muted">ราคาเริ่มต้นต่อคืน</div><div class="price" style="color:var(--price);font-size:1.6rem">${money(promoPrice(fromPrice, n))}</div></div>
        <button type="button" class="btn" data-jump="rooms">เลือกห้องพัก</button>
      </div>
    </section>

    <section class="card" id="rooms">
      <h2>เลือกห้องพัก</h2>
      <form class="datebar" id="dates">
        <div class="field"><label>เช็คอิน</label><input type="date" name="checkIn" min="${todayISO()}" value="${ci}"></div>
        <div class="field"><label>เช็คเอาท์</label><input type="date" name="checkOut" min="${addDays(ci, 1)}" value="${co}"></div>
        <div class="field"><label>ผู้เข้าพัก</label><input type="number" name="guests" min="1" value="${guests}"></div>
        <div class="field"><label>ห้อง</label><input type="number" name="rooms" min="1" value="${rooms}"></div>
        <button class="btn">ค้นหาห้องว่าง</button>
      </form>
      ${data.rooms.map((r) => {
        const fits = r.capacity * rooms >= guests;
        const ok = r.available >= rooms && fits;
        const qt = r.quote;
        return `
        <div class="room2">
          <div class="room2-head"><h3>${esc(r.type)}</h3><span class="small muted">${r.size} ตร.ม. · ${esc(r.bed)}</span></div>
          <div class="room2-grid">
            <div class="room2-info">
              ${photo(ROOM_PHOTOS[r.type], { hue: h.hue, w: 500 })}
              <ul><li>${ic('users', 15)} สูงสุด ${r.capacity} คน/ห้อง</li>${r.amenities.map((a) => `<li>• ${esc(a)}</li>`).join('')}</ul>
            </div>
            <div class="room2-perks">
              <div class="small muted" style="margin-bottom:6px">${esc(r.description)}</div>
              <ul>
                <li class="ok">${ic('check', 15)} ${PERK_CANCEL}</li>
                <li class="ok">${ic('check', 15)} ชำระด้วยบัตร, QR พร้อมเพย์ หรือ TrueMoney</li>
                <li class="ok">${ic('check', 15)} ยืนยันการจองทันที</li>
                ${qt?.promo ? `<li class="ok">${ic('check', 15)} ${qt.promo}</li>` : ''}
              </ul>
            </div>
            <div class="room2-price">
              ${qt?.discount ? `<span class="deal">ลด 10%</span><s class="muted small">${money(r.price)}</s>` : ''}
              <div class="price">${money(promoPrice(r.price, n))}</div>
              <div class="small muted">ต่อห้องต่อคืน</div>
              ${qt ? `<div class="small">รวม ${qt.nights} คืน × ${rooms} ห้อง: <b>${money(qt.total)}</b></div>` : ''}
              ${r.available && r.available <= 3 ? `<div class="urgent">เหลือเพียง ${r.available} ห้อง!</div>` : ''}
              <div style="margin-top:var(--space-2)">${ok
                ? `<a class="btn" href="#/book?${new URLSearchParams({ hotel: h.id, room: r.id, checkIn: ci, checkOut: co, guests, rooms })}">จองเลย</a>`
                : `<button class="btn" disabled>${!r.available ? 'ห้องเต็ม' : fits ? 'ห้องไม่พอ' : 'จำนวนคนเกิน'}</button>`}</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </section>

    <section class="card" id="facilities">
      <h2>สิ่งอำนวยความสะดวก</h2>
      <div class="fac-grid">${[...new Set([...h.amenities, ...data.rooms.flatMap((r) => r.amenities)])].map((a) => `<span>${esc(a)}</span>`).join('')}</div>
    </section>

    <section class="card" id="reviews">
      <h2>รีวิวจากผู้เข้าพัก</h2>
      ${data.reviews.length ? `
        <div class="review-summary">
          <div class="big">${(h.rating * 2).toFixed(1)}</div>
          <div><b style="font-size:1.2rem;color:var(--primary)">${scoreLabel(h.rating)}</b><div class="muted">จาก ${h.reviewCount} รีวิวของผู้เข้าพักจริง</div></div>
        </div>
        ${data.reviews.map((rv) => `
          <div class="review2">
            <div class="who">${avatar(rv.name, 'sm')}<div><b>${esc(rv.name)}</b><div class="small muted">${fmtDate(rv.created_at)}</div></div></div>
            <div><span class="mini-score">${(rv.rating * 2).toFixed(1)}</span><b>${scoreLabel(rv.rating)}</b><p style="margin-top:var(--space-2)">${esc(rv.comment) || '<span class="muted">-</span>'}</p></div>
          </div>`).join('')}`
        : '<p class="muted">ยังไม่มีรีวิว</p>'}
    </section>`;

  document.getElementById('dates').addEventListener('submit', (e) => {
    e.preventDefault();
    go(`#/hotel/${h.id}?` + new URLSearchParams(formData(e.target)));
  });
  $app.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
    const el = document.getElementById(b.dataset.jump);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 130, behavior: 'smooth' });
    document.querySelectorAll('#jumpbar button').forEach((x) => x.classList.toggle('active', x.dataset.jump === b.dataset.jump));
  }));
  $app.querySelectorAll('.gallery2 .ph').forEach((el) => el.addEventListener('click', () => {
    let i = Number(el.dataset.shot);
    const m = modal(`<div class="ph" style="height:min(70vh,520px);background:#111"><img id="lb-img" src="${IMG(shots[i], 1400)}" alt="" style="object-fit:contain"></div>
      <div class="row between" style="margin-top:var(--space-3)"><button class="btn secondary sm" id="lb-prev">‹ ก่อนหน้า</button><b id="lb-count">${i + 1} / ${shots.length}</b><button class="btn secondary sm" id="lb-next">ถัดไป ›</button><button class="btn sm" data-close>ปิด</button></div>`, { wide: true });
    const show = (d) => { i = (i + d + shots.length) % shots.length; m.el.querySelector('#lb-img').src = IMG(shots[i], 1400); m.el.querySelector('#lb-count').textContent = `${i + 1} / ${shots.length}`; };
    m.el.querySelector('#lb-prev').addEventListener('click', () => show(-1));
    m.el.querySelector('#lb-next').addEventListener('click', () => show(1));
  }));
}

// ================= Pages: Booking form =================
async function bookPage(q) {
  if (!requireLogin()) return;
  loading();
  const ci = q.get('checkIn'), co = q.get('checkOut');
  const guests = Number(q.get('guests') || 1), rooms = Number(q.get('rooms') || 1);
  const data = await api('GET', `/hotels/${q.get('hotel')}?checkIn=${ci}&checkOut=${co}&rooms=${rooms}`);
  const room = data.rooms.find((r) => String(r.id) === q.get('room'));
  if (!room) { $app.innerHTML = `<div class="alert error">ไม่พบห้องพัก</div>`; return; }
  const h = data.hotel, qt = room.quote, u = state.user;

  $app.innerHTML = `
    <p><a href="#/hotel/${h.id}?${new URLSearchParams({ checkIn: ci, checkOut: co, guests, rooms })}">← กลับไปเลือกห้อง</a></p>
    <h1>กรอกข้อมูลการจอง</h1>
    <div class="two-col">
      <form class="card" id="f">
        <div id="err"></div>
        <h3>ข้อมูลผู้เข้าพัก</h3>
        <div class="field"><label>ชื่อ-นามสกุลผู้เข้าพัก *</label><input name="guestName" required value="${esc(u.name)}"></div>
        <div class="grid grid-2">
          <div class="field"><label>เบอร์โทรศัพท์ *</label><input name="guestPhone" required inputmode="tel" value="${esc(u.phone || '')}"></div>
          <div class="field"><label>อีเมล</label><input name="guestEmail" type="email" value="${esc(u.email || '')}"></div>
        </div>
        <div class="grid grid-2">
          <div class="field"><label>จำนวนผู้เข้าพัก</label><input name="guests" type="number" min="1" max="${room.capacity * rooms}" value="${Math.min(guests, room.capacity * rooms)}"></div>
          <div class="field"><label>จำนวนห้อง</label><input type="number" value="${rooms}" disabled></div>
        </div>
        <h3 style="margin-top:var(--space-2)">ความต้องการพิเศษ</h3>
        <div class="field"><textarea name="specialRequest" placeholder="เช่น ขอห้องชั้นสูง, เตียงเสริม, เช็คอินดึก"></textarea>
          <div class="hint">ทางโรงแรมจะพยายามจัดให้ตามความเหมาะสม</div></div>
        <hr>
        <h3>เงื่อนไขการจอง</h3>
        <ul class="small muted">
          <li>ยกเลิกล่วงหน้า 7 วันขึ้นไป คืนเงิน 100%</li>
          <li>ยกเลิกล่วงหน้า 3–6 วัน คืนเงิน 50%</li>
          <li>ยกเลิกน้อยกว่า 3 วันก่อนเช็คอิน ไม่คืนเงิน</li>
        </ul>
        <label class="check"><input type="checkbox" required> ฉันยอมรับเงื่อนไขการจองและนโยบายการยกเลิก</label>
        <button class="btn block" style="margin-top:var(--space-4)">ยืนยันการจองและไปหน้าชำระเงิน →</button>
      </form>
      <div class="summary"><div class="card">
        ${cover(h.hue, h.icon, h.photos)}
        <h3 style="margin-top:var(--space-3)">${esc(h.name)}</h3>
        <div class="muted small">${esc(room.type)} · ${esc(room.bed)}</div>
        <hr>
        <div class="line"><span>เช็คอิน</span><b>${fmtDate(ci)}</b></div>
        <div class="line"><span>เช็คเอาท์</span><b>${fmtDate(co)}</b></div>
        <hr>
        <div class="line"><span>${money(qt.pricePerNight)} × ${qt.nights} คืน × ${rooms} ห้อง</span><span>${money(qt.subtotal)}</span></div>
        ${qt.discount ? `<div class="line discount"><span>${ic('badge-percent', 15)} ${qt.promo}</span><span>-${money(qt.discount)}</span></div>` : ''}
        <div class="line total"><span>ราคารวม</span><span>${money(qt.total)}</span></div>
        <div class="small muted">ราคารวมภาษีและค่าบริการแล้ว</div>
      </div></div>
    </div>`;

  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    try {
      const b = await withButton(e.target.querySelector('button.btn'), () => api('POST', '/bookings', {
        ...d, roomId: room.id, checkIn: ci, checkOut: co, roomsCount: rooms,
      }));
      toast(`สร้างการจอง ${b.code} แล้ว กรุณาชำระเงิน`, 'success');
      go(`#/pay/${b.id}`);
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

// ================= Pages: Payment =================
function fakeQr(seed) {
  // ภาพ QR จำลอง (สร้างจาก reference) — ไม่ใช่ QR จริง
  let x = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const N = 25, cells = [];
  const finder = (r, c) => [[0, 0], [0, N - 7], [N - 7, 0]].some(([fr, fc]) => r >= fr && r < fr + 7 && c >= fc && c < fc + 7);
  const finderOn = (r, c) => { const [fr, fc] = [[0, 0], [0, N - 7], [N - 7, 0]].find(([a, b]) => r >= a && r < a + 7 && c >= b && c < b + 7); const i = r - fr, j = c - fc; return i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4); };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (finder(r, c) ? finderOn(r, c) : rnd() > 0.5) cells.push(`<rect x="${c}" y="${r}" width="1" height="1"/>`);
  }
  return `<svg viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" fill="#111">${cells.join('')}</svg>`;
}

const PAY_METHODS = [
  { key: 'card', icon: 'credit-card', title: 'บัตรเครดิต/เดบิต', sub: 'Visa · Mastercard · JCB' },
  { key: 'qr', icon: 'qr-code', title: 'QR พร้อมเพย์', sub: 'สแกนจ่ายผ่านแอปธนาคารใดก็ได้' },
  { key: 'truemoney', icon: 'smartphone', title: 'TrueMoney Wallet', sub: 'ชำระด้วยเบอร์มือถือที่ผูกกับ Wallet' },
];
const payOption = (m) => `<span class="dd-ic pm-${m.key}">${ic(m.icon, 20)}</span><span class="dd-text"><b>${m.title}</b><small>${m.sub}</small></span>`;

async function payPage(id) {
  if (!requireLogin()) return;
  loading();
  const b = await api('GET', `/bookings/${id}`);
  if (b.status !== 'pending' || b.amount_due <= 0) { go(`#/booking/${b.id}`); return; }

  $app.innerHTML = `
    <h1>ชำระเงิน</h1>
    <div class="two-col">
      <div class="card" id="pay-card">
        <div id="err"></div>
        <div class="field">
          <label id="pm-label">วิธีการชำระเงิน</label>
          <div class="dropdown" id="method">
            <button type="button" class="dd-toggle" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="pm-label">
              <span class="dd-current">${payOption(PAY_METHODS[0])}</span><span class="dd-caret">${ic('chevron-down', 18)}</span>
            </button>
            <ul class="dd-menu" role="listbox" aria-labelledby="pm-label" hidden>
              ${PAY_METHODS.map((m, i) => `<li role="option" data-m="${m.key}" aria-selected="${i === 0}" tabindex="-1">${payOption(m)}<span class="dd-check">${ic('check', 16)}</span></li>`).join('')}
            </ul>
          </div>
        </div>
        <hr>
        <div id="method-body"></div>
      </div>
      <div class="summary"><div class="card">
        <div class="small muted">รหัสการจอง</div>
        <div class="code-big">${esc(b.code)}</div>
        <hr>
        <b>${esc(b.hotel_name)}</b>
        <div class="small muted">${esc(b.room_type)} · ${b.rooms_count} ห้อง · ${b.guests} คน</div>
        <div class="line"><span>เข้าพัก</span><span>${fmtDate(b.check_in)} – ${fmtDate(b.check_out)}</span></div>
        <div class="line"><span>ราคารวม</span><span>${money(b.total_price)}</span></div>
        ${b.paid_amount ? `<div class="line"><span>ชำระแล้ว</span><span>-${money(b.paid_amount)}</span></div>` : ''}
        <div class="line total"><span>ยอดที่ต้องชำระ</span><span>${money(b.amount_due)}</span></div>
      </div></div>
    </div>`;

  const $body = document.getElementById('method-body');
  const $err = document.getElementById('err');

  const showResult = (r) => {
    if (r.status === 'success') {
      document.getElementById('pay-card').innerHTML = `
        <div class="result-icon ok">${ic('circle-check', 56)}</div>
        <h2 style="text-align:center">ชำระเงินสำเร็จ</h2>
        <p class="muted" style="text-align:center">${esc(r.message)}<br>การจองของคุณได้รับการยืนยันแล้ว และระบบได้ส่งการแจ้งเตือนทางอีเมล/SMS</p>
        <a class="btn block" href="#/voucher/${b.id}">${ic('ticket')} เปิดใบยืนยันการจอง</a>
        <a class="btn ghost block" style="margin-top:var(--space-2)" href="#/booking/${b.id}">ดูรายละเอียดการจอง</a>`;
      refreshUnread();
    } else {
      $err.innerHTML = `<div class="alert error">${ic('circle-x', 16)} ชำระเงินไม่สำเร็จ: ${esc(r.message)}<br><span class="small">กรุณาตรวจสอบข้อมูลแล้วลองใหม่ หรือเปลี่ยนวิธีชำระเงิน</span></div>`;
    }
  };

  const renderCard = () => {
    $body.innerHTML = `
      <form id="card-form">
        <div class="field"><label>หมายเลขบัตร</label><input name="number" inputmode="numeric" placeholder="4242 4242 4242 4242" maxlength="23" required></div>
        <div class="field"><label>ชื่อบนบัตร</label><input name="name" placeholder="SOMCHAI JAIDEE" required></div>
        <div class="grid grid-2">
          <div class="field"><label>วันหมดอายุ (MM/YY)</label><input name="exp" placeholder="12/28" maxlength="5" required></div>
          <div class="field"><label>CVV</label><input name="cvv" inputmode="numeric" placeholder="123" maxlength="4" required></div>
        </div>
        <div class="alert info small">${ic('info', 15)} ระบบทดสอบ: <b>4242 4242 4242 4242</b> = สำเร็จ · <b>4000 0000 0000 0002</b> = ถูกปฏิเสธ · <b>4000 0000 0000 9995</b> = เงินไม่พอ</div>
        <button class="btn block">ยืนยันการชำระเงิน ${money(b.amount_due)}</button>
      </form>`;
    const f = document.getElementById('card-form');
    f.number.addEventListener('input', () => { f.number.value = f.number.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim(); });
    f.exp.addEventListener('input', () => { f.exp.value = f.exp.value.replace(/\D/g, '').slice(0, 4).replace(/^(\d{2})(\d)/, '$1/$2'); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      $err.innerHTML = '';
      try {
        const r = await withButton(f.querySelector('button'), () => api('POST', `/bookings/${b.id}/pay`, { card: formData(f) }));
        showResult(r);
      } catch (err) { $err.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    });
  };

  const renderQr = async () => {
    $body.innerHTML = `<div class="loading"><div class="spinner"></div>กำลังสร้าง QR...</div>`;
    try {
      const qr = await api('POST', `/bookings/${b.id}/qr`);
      $body.innerHTML = `
        <div class="qr-box">
          ${fakeQr(qr.transactionRef)}
          <p style="margin-top:var(--space-3)"><b>${money(qr.amount)}</b><br><span class="small muted">อ้างอิง ${esc(qr.transactionRef)} · หมดอายุใน 15 นาที</span></p>
          <p class="small muted">สแกนด้วยแอปธนาคารเพื่อชำระเงิน (QR จำลองสำหรับระบบทดสอบ)</p>
          <button class="btn" id="qr-done">ฉันชำระเงินแล้ว — ตรวจสอบสถานะ</button>
        </div>`;
      document.getElementById('qr-done').addEventListener('click', async (e) => {
        try { showResult(await withButton(e.target, () => api('POST', `/payments/${qr.paymentId}/qr-confirm`))); }
        catch (err) { $err.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
      });
    } catch (err) { $body.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  };

  const renderTrueMoney = () => {
    $body.innerHTML = `
      <form id="tm-form">
        <div class="field"><label>เบอร์โทรศัพท์ที่ผูกกับ TrueMoney Wallet</label><input name="phone" inputmode="tel" placeholder="08x-xxx-xxxx" maxlength="12" value="${esc(state.user.phone || '')}" required>
          <div class="hint">ระบบจะส่งคำขอชำระเงินไปที่แอป TrueMoney ของเบอร์นี้</div></div>
        <div class="alert info small">${ic('info', 15)} ระบบทดสอบ: เบอร์ 10 หลักใดก็ได้ = สำเร็จ · เบอร์ลงท้าย <b>0000</b> = ยอดเงินใน Wallet ไม่พอ</div>
        <button class="btn block">ชำระด้วย TrueMoney ${money(b.amount_due)}</button>
      </form>`;
    const f = document.getElementById('tm-form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      $err.innerHTML = '';
      try { showResult(await withButton(f.querySelector('button'), () => api('POST', `/bookings/${b.id}/truemoney`, formData(f)))); }
      catch (err) { $err.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    });
  };
  const renderers = { card: renderCard, qr: renderQr, truemoney: renderTrueMoney };

  // dropdown เลือกวิธีชำระเงิน
  const $dd = document.getElementById('method');
  const $toggle = $dd.querySelector('.dd-toggle'), $menu = $dd.querySelector('.dd-menu');
  const options = [...$menu.querySelectorAll('[role=option]')];
  const setOpen = (open) => {
    $menu.hidden = !open;
    $toggle.setAttribute('aria-expanded', open);
    if (open) ($menu.querySelector('[aria-selected=true]') || options[0]).focus();
  };
  const choose = (li) => {
    options.forEach((o) => o.setAttribute('aria-selected', o === li));
    $dd.querySelector('.dd-current').innerHTML = payOption(PAY_METHODS.find((m) => m.key === li.dataset.m));
    setOpen(false); $toggle.focus();
    $err.innerHTML = '';
    renderers[li.dataset.m]();
  };
  $toggle.addEventListener('click', () => setOpen($menu.hidden));
  $menu.addEventListener('click', (e) => { const li = e.target.closest('[role=option]'); if (li) choose(li); });
  $dd.addEventListener('keydown', (e) => {
    const i = options.indexOf(document.activeElement);
    if (e.key === 'Escape') { setOpen(false); $toggle.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if ($menu.hidden) return setOpen(true);
      options[(i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); choose(options[i]); }
  });
  const outside = (e) => { if (!$dd.contains(e.target)) setOpen(false); };
  document.addEventListener('click', outside);
  cleanup = () => document.removeEventListener('click', outside);
  renderCard();
}

// ================= Pages: Booking detail / manage =================
function timeline(b) {
  const steps = [['จอง', true], ['ชำระเงิน', b.paid_amount > 0], ['ยืนยัน', ['confirmed', 'checked_in', 'checked_out'].includes(b.status)],
    ['เช็คอิน', ['checked_in', 'checked_out'].includes(b.status)], ['เช็คเอาท์', b.status === 'checked_out']];
  return `<div class="timeline">${steps.map(([l, done], i) => `<div class="step ${done ? 'done' : ''}"><div class="dot">${done ? ic('check', 14) : i + 1}</div>${l}</div>`).join('')}</div>`;
}

function starInput(name = 'rating') {
  return `<div class="star-input" data-name="${name}">${[1, 2, 3, 4, 5].map((i) => `<span data-v="${i}">★</span>`).join('')}</div><input type="hidden" name="${name}" value="0">`;
}
function bindStarInput(root) {
  const box = root.querySelector('.star-input');
  const input = root.querySelector(`input[name="${box.dataset.name}"]`);
  const paint = (v) => box.querySelectorAll('span').forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= v));
  box.addEventListener('mouseover', (e) => e.target.dataset.v && paint(Number(e.target.dataset.v)));
  box.addEventListener('mouseleave', () => paint(Number(input.value)));
  box.addEventListener('click', (e) => { if (e.target.dataset.v) { input.value = e.target.dataset.v; paint(Number(input.value)); } });
}

async function bookingPage(id) {
  if (!requireLogin()) return;
  loading();
  const b = await api('GET', `/bookings/${id}`);
  const isAdmin = state.user.role === 'admin';
  const pr = b.pending_request;
  const canEdit = ['pending', 'confirmed'].includes(b.status) && !pr;

  $app.innerHTML = `
    <p><a href="${isAdmin ? '#/admin' : '#/bookings'}">← ${isAdmin ? 'กลับแดชบอร์ด' : 'การจองทั้งหมดของฉัน'}</a></p>
    <div class="two-col">
      <div>
        <div class="card">
          <div class="row between">
            <div><div class="small muted">รหัสการจอง</div><div class="code-big">${esc(b.code)}</div></div>
            ${statusPill(b.status)}
          </div>
          ${b.status !== 'cancelled' ? timeline(b) : `<div class="alert error" style="margin-top:var(--space-3)">การจองนี้ถูกยกเลิกเมื่อ ${fmtDateTime(b.cancelled_at)}</div>`}
          ${b.status === 'pending' ? `<div class="alert warning" style="margin-top:var(--space-3)">รอชำระเงิน ${money(b.amount_due)} เพื่อยืนยันการจอง</div>` : ''}
          ${b.status === 'confirmed' ? `<div class="alert success" style="margin-top:var(--space-3)">${ic('circle-check', 16)} การจองได้รับการยืนยันแล้ว — แสดงรหัสการจองนี้ที่เคาน์เตอร์เมื่อเช็คอิน</div>` : ''}
          ${pr ? `<div class="alert warning" style="margin-top:var(--space-3)">
            <div class="row between"><b>${ic('clock', 16)} ${pr.type === 'edit' ? 'คำขอแก้ไข' : 'คำขอยกเลิก'}รอแอดมินตรวจสอบ</b>
              ${!isAdmin ? `<button class="btn secondary sm" id="withdraw">ถอนคำขอ</button>` : `<a class="btn sm" href="#/admin/requests/${pr.type}?id=${pr.id}">ไปตรวจสอบ</a>`}</div>
            <div class="small" style="margin-top:4px">${pr.type === 'edit'
              ? `ขอเปลี่ยนเป็น ${esc(pr.data.after.roomType)} · ${pr.data.after.guests} คน · ${fmtDate(pr.data.after.checkIn)} – ${fmtDate(pr.data.after.checkOut)} · ราคาใหม่ ${money(pr.data.after.total)}`
              : `ยอดคืนเงินโดยประมาณ ${money(pr.data.refund)} (${esc(pr.data.rule)})`} · ส่งเมื่อ ${fmtDateTime(pr.created_at)}</div>
          </div>` : ''}
        </div>
        <div class="card">
          <h2>รายละเอียดการเข้าพัก</h2>
          <div class="grid grid-2">
            <div><div class="small muted">โรงแรม</div><b>${esc(b.hotel_name)}</b><div class="small muted">${esc(b.address)}</div></div>
            <div><div class="small muted">ประเภทห้อง</div><b>${esc(b.room_type)}</b> × ${b.rooms_count} ห้อง</div>
            <div><div class="small muted">เช็คอิน</div><b>${fmtDate(b.check_in)}</b> <span class="small muted">หลัง 14:00</span>${b.checked_in_at ? `<div class="small muted">เช็คอินแล้ว ${fmtDateTime(b.checked_in_at)}</div>` : ''}</div>
            <div><div class="small muted">เช็คเอาท์</div><b>${fmtDate(b.check_out)}</b> <span class="small muted">ก่อน 12:00</span>${b.checked_out_at ? `<div class="small muted">เช็คเอาท์แล้ว ${fmtDateTime(b.checked_out_at)}</div>` : ''}</div>
            <div><div class="small muted">ผู้เข้าพัก</div><b>${esc(b.guest_name)}</b> (${b.guests} คน)<div class="small muted">${esc(b.guest_phone || '')} ${esc(b.guest_email || '')}</div></div>
            <div><div class="small muted">ความต้องการพิเศษ</div>${esc(b.special_request) || '<span class="muted">-</span>'}</div>
          </div>
        </div>
        ${b.requests.some((r) => r.status !== 'pending') ? `<div class="card">
          <h3>ประวัติคำขอเปลี่ยนแปลง</h3>
          ${b.requests.filter((r) => r.status !== 'pending').map((r) => `<div class="req-hist">
            <div class="row between"><b>${r.type === 'edit' ? 'คำขอแก้ไข' : 'คำขอยกเลิก'}</b>${reqPill(r.status)}</div>
            <div class="small muted">ส่งเมื่อ ${fmtDateTime(r.created_at)}${r.decided_at ? ` · พิจารณาเมื่อ ${fmtDateTime(r.decided_at)}` : ''}</div>
            ${r.admin_note ? `<div class="small">หมายเหตุจากแอดมิน: ${esc(r.admin_note)}</div>` : ''}
          </div>`).join('')}
        </div>` : ''}
        <div class="card" id="review-card"></div>
        <div class="card">
          <h3>ประวัติการชำระเงิน</h3>
          ${b.payments.length ? `<div class="table-wrap"><table><tr><th>วันที่</th><th>รายการ</th><th>จำนวน</th><th>สถานะ</th><th>อ้างอิง</th></tr>
            ${b.payments.map((p) => `<tr><td>${fmtDateTime(p.created_at)}</td><td>${p.kind === 'refund' ? `${ic('undo-2', 15)} คืนเงิน` : p.method === 'qr' ? `${ic('qr-code', 15)} QR` : p.method === 'truemoney' ? `${ic('wallet', 15)} TrueMoney` : `${ic('credit-card', 15)} บัตร`}<div class="small muted">${esc(p.message || '')}</div></td>
              <td>${p.kind === 'refund' ? '-' : ''}${money(p.amount)}</td>
              <td><span class="pill ${p.status === 'success' ? 'confirmed' : p.status === 'failed' ? 'cancelled' : 'pending'}">${{ success: 'สำเร็จ', failed: 'ไม่สำเร็จ', pending: 'รอดำเนินการ' }[p.status]}</span></td>
              <td class="small">${esc(p.transaction_ref || '-')}</td></tr>`).join('')}</table></div>` : '<p class="muted small">ยังไม่มีรายการ</p>'}
        </div>
      </div>
      <div class="summary">
        <div class="card">
          ${cover(b.hue, b.icon, b.photos)}
          <div class="line" style="margin-top:var(--space-3)"><span>ราคารวม</span><b>${money(b.total_price)}</b></div>
          <div class="line"><span>ชำระแล้ว (สุทธิ)</span><span>${money(b.paid_amount)}</span></div>
          ${b.amount_due > 0 && b.status === 'pending' ? `<div class="line total"><span>คงค้าง</span><span>${money(b.amount_due)}</span></div>` : ''}
          <div class="stack" style="margin-top:var(--space-4)" id="actions">
            ${b.status === 'pending' && !isAdmin ? `<a class="btn block" href="#/pay/${b.id}">${ic('credit-card')} ชำระเงิน</a>` : ''}
            ${hasVoucher(b) ? `<a class="btn ${isAdmin ? 'secondary' : ''} block" href="#/voucher/${b.id}">${ic('ticket')} เปิดใบยืนยันการจอง</a>` : ''}
            ${b.status === 'confirmed' && isAdmin ? `<button class="btn block" data-act="checkin">${ic('concierge-bell')} เช็คอิน</button>` : ''}
            ${b.status === 'checked_in' && isAdmin ? `<button class="btn block" data-act="checkout">${ic('luggage')} เช็คเอาท์</button>` : ''}
            ${['confirmed', 'checked_in'].includes(b.status) && !isAdmin ? `<div class="alert info small">${ic('concierge-bell', 15)} ${b.status === 'confirmed' ? 'เช็คอินที่เคาน์เตอร์โรงแรม' : 'เช็คเอาท์ที่เคาน์เตอร์โรงแรม'} โดยเจ้าหน้าที่จะอัปเดตสถานะให้</div>` : ''}
            ${canEdit && !isAdmin ? `<button class="btn secondary block" data-act="edit">${ic('pencil')} ขอแก้ไขการจอง</button>` : ''}
            ${canEdit && !isAdmin ? `<button class="btn ghost block" style="color:var(--danger)" data-act="cancel">ขอยกเลิกการจอง</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;

  // รีวิว
  const $rv = document.getElementById('review-card');
  if (b.review) {
    $rv.innerHTML = `<h3>รีวิวของคุณ</h3><div class="stars" style="font-size:1.3rem">${stars(b.review.rating)}</div><p>${esc(b.review.comment) || ''}</p><div class="small muted">${fmtDate(b.review.created_at)}</div>`;
  } else if (b.status === 'checked_out' && !isAdmin) {
    $rv.innerHTML = `<h3>ให้คะแนนและรีวิว</h3>
      <form id="rv-form">${starInput()}
        <div class="field" style="margin-top:var(--space-3)"><textarea name="comment" placeholder="เล่าประสบการณ์การเข้าพักของคุณ..."></textarea></div>
        <button class="btn">ยืนยันการให้คะแนนและรีวิว</button></form>`;
    const f = document.getElementById('rv-form');
    bindStarInput(f);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(f);
      if (d.rating === '0') return toast('กรุณาเลือกจำนวนดาว', 'error');
      try { await withButton(f.querySelector('button'), () => api('POST', `/bookings/${b.id}/review`, d)); toast('ขอบคุณสำหรับรีวิว!', 'success'); bookingPage(b.id); }
      catch (err) { toast(err.message, 'error'); }
    });
  } else {
    $rv.remove();
  }

  document.getElementById('withdraw')?.addEventListener('click', async (e) => {
    try { const r = await withButton(e.target, () => api('POST', `/requests/${pr.id}/withdraw`)); toast(r.message, 'success'); bookingPage(b.id); }
    catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('actions').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'checkin' || act === 'checkout') {
      try {
        await withButton(e.target, () => api('POST', `/bookings/${b.id}/${act}`));
        toast(act === 'checkin' ? 'เช็คอินสำเร็จ ยินดีต้อนรับ!' : 'เช็คเอาท์เรียบร้อย ขอบคุณที่ใช้บริการ', 'success');
        refreshUnread(); bookingPage(b.id);
      } catch (err) { toast(err.message, 'error'); }
    }
    if (act === 'edit') editBookingModal(b);
    if (act === 'cancel') cancelModal(b);
  });
}

function editBookingModal(b) {
  const m = modal(`
    <h2>ขอแก้ไขการจอง</h2>
    <p class="muted small">${esc(b.hotel_name)} · ${b.rooms_count} ห้อง</p>
    <form id="ed">
      <div class="grid grid-2">
        <div class="field"><label>เช็คอิน</label><input type="date" name="checkIn" min="${todayISO()}" value="${b.check_in}" required></div>
        <div class="field"><label>เช็คเอาท์</label><input type="date" name="checkOut" min="${addDays(b.check_in, 1)}" value="${b.check_out}" required></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>จำนวนผู้เข้าพัก</label><input type="number" name="guests" min="1" value="${b.guests}" required></div>
        <div class="field"><label>ประเภทห้อง</label><select name="roomId"><option value="${b.room_id}">${esc(b.room_type)}</option></select></div>
      </div>
      <div class="hint" id="room-hint" style="margin:-6px 0 var(--space-3)"></div>
      <div id="qt" class="card" style="box-shadow:none;background:var(--surface-2)"></div>
      <div class="field" style="margin-top:var(--space-4)"><label>เหตุผล / ข้อความถึงแอดมิน (ไม่บังคับ)</label><textarea name="reason" placeholder="เช่น มีเพื่อนมาเพิ่ม 2 คน"></textarea></div>
      <div class="small muted">${ic('info', 14)} การแก้ไขจะมีผลเมื่อแอดมินอนุมัติ ส่วนต่างราคาจะเรียกเก็บหรือคืนให้หลังอนุมัติ</div>
      <div class="row" style="justify-content:flex-end;margin-top:var(--space-4)">
        <button type="button" class="btn secondary" data-close>ยกเลิก</button>
        <button class="btn" id="save" disabled>ส่งคำขอแก้ไข</button>
      </div>
    </form>`);
  const f = m.el.querySelector('#ed'), $qt = m.el.querySelector('#qt'), $save = m.el.querySelector('#save');
  const $hint = m.el.querySelector('#room-hint');
  let seq = 0;
  const preview = async () => {
    if (f.checkOut.value <= f.checkIn.value) f.checkOut.value = addDays(f.checkIn.value, 1);
    f.checkOut.min = addDays(f.checkIn.value, 1);
    const guests = Math.max(1, Number(f.guests.value) || 1);
    const my = ++seq;
    try {
      const params = (roomId) => new URLSearchParams({ checkIn: f.checkIn.value, checkOut: f.checkOut.value, guests, roomId });
      let q = await api('GET', `/bookings/${b.id}/quote?${params(f.roomId.value)}`);
      if (my !== seq) return;
      f.guests.max = q.maxGuests;
      if (guests > q.maxGuests) { f.guests.value = q.maxGuests; return preview(); }
      // ประเภทห้องที่เลือกไว้รองรับจำนวนคนไม่พอ → เปลี่ยนเป็นห้องที่เหมาะสมและว่างที่ถูกที่สุด
      const options = q.rooms.filter((r) => r.fits);
      if (!q.fits) {
        const pick = options.find((r) => r.available) || options[0];
        if (pick) {
          q = await api('GET', `/bookings/${b.id}/quote?${params(pick.id)}`);
          if (my !== seq) return;
        }
      }
      f.roomId.innerHTML = options.map((r) => `<option value="${r.id}" ${r.id === q.roomId ? 'selected' : ''} ${r.available ? '' : 'disabled'}>
        ${esc(r.type)} · สูงสุด ${r.capacity} คน/ห้อง · ${money(r.total)}${r.available ? '' : ' (ไม่ว่าง)'}</option>`).join('');
      const hidden = q.rooms.length - options.length;
      $hint.textContent = hidden ? `แสดงเฉพาะห้องที่รองรับ ${guests} คน (${b.rooms_count} ห้อง)` : '';
      const unchanged = f.checkIn.value === b.check_in && f.checkOut.value === b.check_out
        && guests === b.guests && q.roomId === b.room_id;
      $save.disabled = !q.available || unchanged;
      $qt.innerHTML = `
        <div class="line"><span>${esc(q.rooms.find((r) => r.id === q.roomId)?.type)} · ${q.nights} คืน × ${b.rooms_count} ห้อง</span><span>${money(q.subtotal)}</span></div>
        ${q.discount ? `<div class="line discount"><span>${q.promo}</span><span>-${money(q.discount)}</span></div>` : ''}
        <div class="line total"><span>ราคาใหม่</span><span>${money(q.total)}</span></div>
        <div class="line"><span>ชำระแล้ว</span><span>${money(q.paid)}</span></div>
        ${!q.available ? `<div class="alert error" style="margin:8px 0 0">ห้องประเภทนี้ไม่ว่างในช่วงวันที่เลือก</div>`
          : q.paid > 0 && q.difference > 0 ? `<div class="alert warning" style="margin:8px 0 0">หากอนุมัติ ต้องชำระส่วนต่างเพิ่ม ${money(q.difference)}</div>`
          : q.difference < 0 && q.paid > 0 ? `<div class="alert success" style="margin:8px 0 0">หากอนุมัติ จะได้รับเงินคืนส่วนต่าง ${money(-q.difference)}</div>` : ''}`;
    } catch (err) {
      if (my !== seq) return;
      $save.disabled = true; $qt.innerHTML = `<div class="alert error" style="margin:0">${esc(err.message)}</div>`;
    }
  };
  f.addEventListener('change', preview);
  f.guests.addEventListener('input', () => { if (f.guests.value) preview(); });
  preview();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await withButton($save, () => api('POST', `/bookings/${b.id}/requests`, { type: 'edit', ...formData(f) }));
      m.close(); toast(r.message, 'success'); bookingPage(b.id);
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function cancelModal(b) {
  const p = await api('GET', `/bookings/${b.id}/refund-preview`);
  const m = modal(`
    <h2>ขอยกเลิกการจอง ${esc(b.code)}?</h2>
    <p class="muted">เหลืออีก ${p.daysBefore} วันก่อนวันเช็คอิน</p>
    <div class="card" style="box-shadow:none;background:var(--surface-2)">
      <div class="small">${ic('file-text', 15)} ${esc(p.rule)}</div>
      <div class="line" style="margin-top:var(--space-2)"><span>ยอดที่ชำระแล้ว</span><span>${money(p.paid)}</span></div>
      <div class="line"><span>อัตราคืนเงิน</span><span>${p.percent}%</span></div>
      <div class="line total"><span>ยอดเงินที่จะได้รับคืน</span><span style="color:var(--success)">${money(p.refund)}</span></div>
    </div>
    <div class="field" style="margin-top:var(--space-4)"><label>เหตุผลที่ยกเลิก (ไม่บังคับ)</label><textarea id="reason"></textarea></div>
    <p class="small muted">${ic('info', 14)} อัตราคืนเงินคิดตามวันที่ส่งคำขอ การยกเลิกจะมีผลเมื่อแอดมินอนุมัติ และเงินจะคืนเข้าช่องทางเดิมภายใน 7–14 วันทำการ</p>
    <div class="row" style="justify-content:flex-end;margin-top:var(--space-4)">
      <button class="btn secondary" data-close>ไม่ยกเลิก</button>
      <button class="btn danger" id="yes">ส่งคำขอยกเลิก</button>
    </div>`);
  m.el.querySelector('#yes').addEventListener('click', async (e) => {
    try {
      const r = await withButton(e.target, () => api('POST', `/bookings/${b.id}/requests`, { type: 'cancel', reason: m.el.querySelector('#reason').value }));
      m.close(); toast(r.message, 'success'); bookingPage(b.id);
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ================= Pages: Voucher (ใบยืนยันการจอง) =================
async function voucherPage(id) {
  if (!requireLogin()) return;
  loading();
  const b = await api('GET', `/bookings/${id}`);
  const back = `<a href="#/booking/${b.id}">← กลับไปหน้ารายละเอียดการจอง</a>`;
  if (!hasVoucher(b)) {
    $app.innerHTML = `<p>${back}</p><div class="card empty"><div class="icon">${ic('ticket', 40)}</div>
      ${b.status === 'cancelled' ? 'การจองนี้ถูกยกเลิกแล้ว จึงไม่มีใบยืนยันการจอง' : 'ใบยืนยันการจองจะออกให้หลังชำระเงินเรียบร้อยแล้ว'}
      ${b.status === 'pending' && state.user.role !== 'admin' ? `<br><a class="btn" style="margin-top:var(--space-3)" href="#/pay/${b.id}">${ic('credit-card')} ชำระเงิน</a>` : ''}</div>`;
    return;
  }
  const paid = b.payments.find((p) => p.kind !== 'refund' && p.status === 'success');
  const issued = new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  const item = (label, value, sub = '') => `<div class="v-item"><div class="v-label">${label}</div><div class="v-value">${value}</div>${sub ? `<div class="v-sub">${sub}</div>` : ''}</div>`;

  $app.innerHTML = `
    <div class="v-toolbar no-print">
      ${back}
      <button class="btn" id="print">${ic('printer')} พิมพ์ / บันทึกเป็น PDF</button>
    </div>
    <article class="voucher">
      <header class="v-head">
        <div class="v-brand"><img class="brand-logo" src="/img/logo.png" alt="" width="40" height="40"><div><b>อัศวินรัตติกาล</b><div class="v-sub">ใบยืนยันการจอง · Booking Voucher</div></div></div>
        ${statusPill(b.status)}
      </header>

      <section class="v-code">
        <div>
          <div class="v-label">รหัสการจอง</div>
          <div class="code-big">${esc(b.code)}</div>
          <p class="v-sub">แสดงรหัสหรือ QR นี้ที่เคาน์เตอร์โรงแรมเมื่อเช็คอิน พร้อมบัตรประชาชน/พาสปอร์ตของผู้เข้าพัก</p>
          <div class="v-paid">${ic('circle-check', 16)} ชำระเงินครบแล้ว ${money(b.paid_amount)}</div>
        </div>
        <div class="v-qr">${fakeQr(b.code)}</div>
      </section>

      <section class="v-section">
        <h3>ที่พัก</h3>
        <div class="v-hotel"><b>${esc(b.hotel_name)}</b><div class="v-sub">${ic('map-pin', 14)} ${esc(b.address || b.city)}</div></div>
        <div class="v-grid">
          ${item('เช็คอิน', fmtDate(b.check_in), 'ตั้งแต่ 14:00 น.')}
          ${item('เช็คเอาท์', fmtDate(b.check_out), 'ก่อน 12:00 น.')}
          ${item('ระยะเวลา', `${b.nights} คืน`)}
          ${item('ห้องพัก', `${esc(b.room_type)} × ${b.rooms_count} ห้อง`)}
        </div>
      </section>

      <section class="v-section">
        <h3>ผู้เข้าพัก</h3>
        <div class="v-grid">
          ${item('ชื่อผู้เข้าพักหลัก', esc(b.guest_name), `${b.guests} คน`)}
          ${item('ติดต่อ', esc(b.guest_phone || '-'), esc(b.guest_email || ''))}
          ${item('วันที่จอง', fmtDateTime(b.created_at))}
          ${item('ความต้องการพิเศษ', esc(b.special_request) || '-')}
        </div>
      </section>

      <section class="v-section">
        <h3>การชำระเงิน</h3>
        <div class="line"><span>ราคารวม (${b.nights} คืน × ${b.rooms_count} ห้อง)</span><span>${money(b.total_price)}</span></div>
        ${paid ? `<div class="line"><span>ชำระด้วย</span><span>${PAY_LABEL[paid.method] || esc(paid.method)}</span></div>
        <div class="line"><span>เลขอ้างอิง</span><span>${esc(paid.transaction_ref || '-')}</span></div>` : ''}
        <div class="line total"><span>ชำระแล้ว</span><span>${money(b.paid_amount)}</span></div>
      </section>

      <footer class="v-foot">
        <div><b>นโยบายการยกเลิก:</b> ยกเลิกล่วงหน้า 7 วันขึ้นไป คืนเงิน 100% · 3–6 วัน คืนเงิน 50% · น้อยกว่า 3 วัน ไม่คืนเงิน</div>
        <div>เอกสารนี้ออกโดยระบบอัตโนมัติ ใช้เป็นหลักฐานการจองได้โดยไม่ต้องมีลายเซ็น · ออกเมื่อ ${issued}</div>
      </footer>
    </article>`;
  document.getElementById('print').addEventListener('click', () => window.print());
}

// แท็บแบบมีตัวนับ ใช้ร่วมกันหลายหน้า
const pageTabs = (items, active, attr = 'data-tab') => `<nav class="page-tabs" role="tablist">${items.map(([k, label, count, icon]) =>
  `<button type="button" role="tab" ${attr}="${k}" class="${k === active ? 'active' : ''}" aria-selected="${k === active}">${icon ? ic(icon, 16) : ''} ${label}${count != null ? ` <span class="tab-count">${count}</span>` : ''}</button>`).join('')}</nav>`;

const daysUntil = (iso) => nights(todayISO(), iso);
function tripCountdown(b) {
  if (b.status === 'checked_in') return { cls: 'live', text: 'กำลังเข้าพักอยู่' };
  const d = daysUntil(b.check_in);
  return { cls: d <= 3 ? 'soon' : '', text: d <= 0 ? 'เช็คอินวันนี้' : d === 1 ? 'เช็คอินพรุ่งนี้' : `อีก ${d} วันเช็คอิน` };
}

function bookingCard(b, tab) {
  const n = nights(b.check_in, b.check_out);
  const cd = tab === 'upcoming' ? tripCountdown(b) : null;
  return `
    <article class="bk-card ${b.status === 'cancelled' ? 'is-cancelled' : ''}">
      <a class="bk-photo" href="#/booking/${b.id}">${photo(photosOf(b.photos)[0], { hue: b.hue, w: 500 })}<span class="bk-status">${statusPill(b.status)}</span></a>
      <div class="bk-main">
        <div class="bk-top">
          <h3><a href="#/booking/${b.id}">${esc(b.hotel_name)}</a></h3>
          ${cd ? `<span class="countdown ${cd.cls}">${ic('calendar-days', 14)} ${cd.text}</span>` : ''}
        </div>
        <div class="bk-loc">${ic('map-pin', 14)} ${esc(b.city)}</div>
        <div class="bk-dates">
          <div><small>เช็คอิน</small><b>${fmtDay(b.check_in)}</b></div>
          <div class="bk-nights"><span>${n} คืน</span></div>
          <div><small>เช็คเอาท์</small><b>${fmtDay(b.check_out)}</b></div>
        </div>
        <div class="bk-meta">
          <span>${ic('bed-double', 14)} ${esc(b.room_type)} × ${b.rooms_count}</span>
          <span>${ic('users', 14)} ${b.guests} คน</span>
          <span>${ic('ticket', 14)} <code>${esc(b.code)}</code></span>
          ${b.pending_request ? `<span class="pill pending">${ic('clock', 13)} ${b.pending_request === 'edit' ? 'ขอแก้ไข' : 'ขอยกเลิก'} รอแอดมินตรวจสอบ</span>` : ''}
        </div>
      </div>
      <div class="bk-side">
        <div><small class="muted">${b.status === 'pending' ? 'ยอดที่ต้องชำระ' : 'ราคารวม'}</small><div class="bk-price">${money(b.status === 'pending' ? b.total_price - b.paid_amount : b.total_price)}</div></div>
        <div class="bk-actions">
          ${b.status === 'pending' ? `<a class="btn sm" href="#/pay/${b.id}">${ic('credit-card', 15)} ชำระเงิน</a>` : ''}
          ${hasVoucher(b) && b.status !== 'checked_out' ? `<a class="btn sm" href="#/voucher/${b.id}">${ic('ticket', 15)} ใบจอง</a>` : ''}
          ${b.status === 'checked_out' && !b.reviewed ? `<a class="btn sm" href="#/booking/${b.id}">${ic('star', 15)} เขียนรีวิว</a>` : ''}
          ${b.status === 'checked_out' ? `<a class="btn secondary sm" href="#/voucher/${b.id}">${ic('ticket', 15)} ใบจอง</a>` : ''}
          <a class="btn secondary sm" href="#/booking/${b.id}">${['pending', 'confirmed'].includes(b.status) ? `${ic('pencil', 15)} จัดการ` : 'รายละเอียด'}</a>
        </div>
      </div>
    </article>`;
}

async function bookingsPage(q) {
  if (!requireLogin()) return;
  loading();
  const all = await api('GET', '/bookings');
  const tab = q.get('tab') || 'upcoming';
  const groups = {
    upcoming: all.filter((b) => ['pending', 'confirmed', 'checked_in'].includes(b.status)).sort((a, b) => a.check_in.localeCompare(b.check_in)),
    past: all.filter((b) => b.status === 'checked_out'),
    cancelled: all.filter((b) => b.status === 'cancelled'),
  };
  const spent = all.reduce((sum, b) => sum + (b.paid_amount || 0), 0);
  const nightsStayed = groups.past.reduce((sum, b) => sum + nights(b.check_in, b.check_out), 0);
  // ทริปถัดไป: ที่พักอยู่ตอนนี้ หรือที่ยืนยันแล้วและใกล้ที่สุด
  const next = tab === 'upcoming' ? groups.upcoming.find((b) => b.status !== 'pending') : null;
  const list = groups[tab].filter((b) => b !== next);
  const empty = {
    upcoming: ['luggage', 'ยังไม่มีทริปที่กำลังจะมาถึง', 'เริ่มวางแผนทริปถัดไป แล้วให้ AI ช่วยหาเพื่อนเที่ยวด้วยกัน'],
    past: ['hotel', 'ยังไม่มีประวัติการเข้าพัก', 'เมื่อเช็คเอาท์แล้ว คุณจะรีวิวที่พักได้จากตรงนี้'],
    cancelled: ['circle-check', 'ไม่มีการจองที่ถูกยกเลิก', 'ดีมาก! ทุกทริปของคุณยังอยู่ครบ'],
  }[tab];

  $app.innerHTML = `
    <div class="page-head">
      <div><h1>การจองของฉัน</h1><p class="muted">ดูทริปที่กำลังจะมาถึง เปิดใบจอง และจัดการการจองทั้งหมดได้ที่นี่</p></div>
      <a class="btn" href="#/search">${ic('search', 16)} จองที่พักใหม่</a>
    </div>

    <div class="mini-stats">
      <div class="mini-stat"><span class="ms-ic">${ic('plane', 20)}</span><div><b>${groups.upcoming.length}</b><small>ทริปที่กำลังจะมาถึง</small></div></div>
      <div class="mini-stat"><span class="ms-ic">${ic('bed-double', 20)}</span><div><b>${nightsStayed}</b><small>คืนที่เข้าพักแล้ว</small></div></div>
      <div class="mini-stat"><span class="ms-ic">${ic('wallet', 20)}</span><div><b>${money(spent)}</b><small>ยอดชำระสุทธิทั้งหมด</small></div></div>
    </div>

    ${pageTabs([['upcoming', 'กำลังจะมาถึง', groups.upcoming.length, 'calendar-days'], ['past', 'เข้าพักแล้ว', groups.past.length, 'circle-check'], ['cancelled', 'ยกเลิก', groups.cancelled.length, 'circle-x']], tab)}

    ${next ? (() => {
      const cd = tripCountdown(next);
      return `
      <section class="next-trip" style="--trip:url('${IMG(photosOf(next.photos)[0], 1200)}')">
        <div class="nt-body">
          <span class="nt-kicker">${ic('plane', 16)} ทริปถัดไปของคุณ</span>
          <h2>${esc(next.hotel_name)}</h2>
          <div class="nt-loc">${ic('map-pin', 15)} ${esc(next.city)} · ${esc(next.room_type)} × ${next.rooms_count}</div>
          <div class="nt-dates">${fmtDay(next.check_in)} → ${fmtDay(next.check_out)} · ${nights(next.check_in, next.check_out)} คืน</div>
          <div class="nt-actions">
            <a class="btn" href="#/voucher/${next.id}">${ic('ticket', 16)} เปิดใบจอง</a>
            <a class="btn nt-ghost" href="#/booking/${next.id}">ดูรายละเอียด</a>
          </div>
        </div>
        <div class="nt-count ${cd.cls}">${next.status === 'checked_in' ? `${ic('concierge-bell', 28)}<span>กำลังเข้าพัก</span>` : (() => { const d = daysUntil(next.check_in); return d <= 0 ? `<b>วันนี้</b><span>เช็คอิน</span>` : `<b>${d}</b><span>วันก่อนเช็คอิน</span>`; })()}</div>
      </section>
      ${list.length ? '<h3 class="list-title">ทริปอื่น ๆ</h3>' : ''}`;
    })() : ''}

    ${list.length ? `<div class="bk-list">${list.map((b) => bookingCard(b, tab)).join('')}</div>`
      : next ? '' : `<div class="card empty"><div class="icon">${ic(empty[0], 40)}</div><b>${empty[1]}</b><p class="muted small">${empty[2]}</p><a class="btn" href="#/search">${ic('search', 16)} ค้นหาโรงแรม</a></div>`}`;

  $app.querySelector('.page-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) go(`#/bookings?tab=${t.dataset.tab}`);
  });
}

// ================= Pages: Buddy =================
// คัดเฉพาะความสนใจยอดนิยม 8 อย่าง — อย่างอื่นพิมพ์เพิ่มเองได้
const INTEREST_PRESETS = ['คาเฟ่', 'อาหาร', 'ทะเล', 'ธรรมชาติ', 'เดินป่า', 'ถ่ายรูป', 'วัฒนธรรม', 'ช้อปปิ้ง'];
const compatLabel = (s) => (s >= 80 ? 'เข้ากันได้ดีมาก' : s >= 60 ? 'เข้ากันได้ดี' : s >= 40 ? 'พอเข้ากันได้' : 'เข้ากันได้น้อย');

const TRAVEL_STYLES = ['ชิล ๆ', 'ลุย ๆ', 'ผจญภัย', 'หรูหรา', 'ประหยัด'];
const compatLevel = (s) => (s >= 80 ? 'high' : s >= 60 ? 'mid' : 'low');
const personMeta = (u) => [u.age ? u.age + ' ปี' : '', esc(u.gender || ''), esc(u.travel_style || '')].filter(Boolean).join(' · ');
let buddyCache = null; // ผลการจับคู่ล่าสุด (ไม่ต้องให้ AI วิเคราะห์ใหม่ทุกครั้งที่เปิดหน้า)
const shortDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const tripText = (t) => `${esc(t.city)} · ${shortDate(t.check_in)} – ${shortDate(t.check_out)}`;

// ฟอร์มโปรไฟล์บัดดี้ (ใช้ทั้งตอนเริ่มต้นใช้งานและในหน้าต่างแก้ไข)
function profileFields(me, { withToggle = true } = {}) {
  const allInterests = [...new Set([...INTEREST_PRESETS, ...me.interests])];
  return `
    ${withToggle ? `<label class="switch-box ${me.buddy_enabled ? 'on' : ''}">
      <span class="switch"><input type="checkbox" name="buddy_enabled" ${me.buddy_enabled ? 'checked' : ''}></span>
      <span><b>เปิดให้คนอื่นเห็นและส่งคำขอจับคู่ได้</b><small>ปิดเมื่อไม่ต้องการหาบัดดี้ชั่วคราว</small></span>
    </label>` : '<input type="hidden" name="buddy_enabled" value="1">'}
    <div class="field">
      <div class="row between"><label style="margin:0">1. คุณชอบเที่ยวแบบไหน? <span class="muted">(เลือกได้หลายอย่าง)</span></label><span class="small muted" data-chip-count></span></div>
      <div class="interest-grid" data-chips>${allInterests.map((i) => `<button type="button" class="chip ${me.interests.includes(i) ? 'on' : ''}" data-i="${esc(i)}" aria-pressed="${me.interests.includes(i)}">${esc(i)}</button>`).join('')}</div>
      <div class="add-row"><input data-new-interest placeholder="ไม่มีในรายการ? พิมพ์เพิ่ม เช่น ดำน้ำ"><button type="button" class="btn secondary sm" data-add-interest>เพิ่ม</button></div>
    </div>
    <div class="field"><label>2. สไตล์การเที่ยว</label>
      <div class="seg-pills">${TRAVEL_STYLES.map((t) => `<label><input type="radio" name="travel_style" value="${t}" ${me.travel_style === t ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
    <details class="more-fields" ${me.age || me.gender || me.bio ? 'open' : ''}>
      <summary>3. ข้อมูลเพิ่มเติม <span class="muted">(ไม่บังคับ แต่ช่วยให้จับคู่แม่นขึ้น)</span></summary>
      <div class="grid grid-2">
        <div class="field"><label>เพศ</label><select name="gender">${['', 'ชาย', 'หญิง', 'LGBTQ+', 'ไม่ระบุ'].map((g) => `<option ${me.gender === g ? 'selected' : ''} value="${g}">${g || 'เลือก'}</option>`).join('')}</select></div>
        <div class="field"><label>อายุ</label><input type="number" name="age" min="18" max="99" value="${me.age || ''}" placeholder="เช่น 25"></div>
      </div>
      <div class="field"><label>แนะนำตัวสั้น ๆ</label><textarea name="bio" maxlength="300" placeholder="เช่น ชอบเที่ยวคาเฟ่ ถ่ายรูป หาเพื่อนไปเชียงใหม่ช่วงปลายเดือน">${esc(me.bio || '')}</textarea></div>
    </details>`;
}

function bindProfileForm(f, me, onSaved) {
  const interests = new Set(me.interests);
  const chips = f.querySelector('[data-chips]');
  const count = () => { f.querySelector('[data-chip-count]').textContent = `เลือกแล้ว ${interests.size}`; };
  count();
  f.querySelector('.switch-box input')?.addEventListener('change', (e) => f.querySelector('.switch-box').classList.toggle('on', e.target.checked));
  chips.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const on = c.classList.toggle('on');
    c.setAttribute('aria-pressed', on);
    on ? interests.add(c.dataset.i) : interests.delete(c.dataset.i);
    count();
  });
  const inp = f.querySelector('[data-new-interest]');
  const add = () => {
    const v = inp.value.trim();
    inp.value = '';
    if (!v || interests.has(v)) return;
    interests.add(v);
    const existing = [...chips.children].find((c) => c.dataset.i === v);
    if (existing) { existing.classList.add('on'); existing.setAttribute('aria-pressed', true); }
    else chips.insertAdjacentHTML('beforeend', `<button type="button" class="chip on" data-i="${esc(v)}" aria-pressed="true">${esc(v)}</button>`);
    count();
  };
  f.querySelector('[data-add-interest]').addEventListener('click', add);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(f);
    if (d.buddy_enabled && !interests.size) return toast('กรุณาเลือกความสนใจอย่างน้อย 1 อย่าง', 'error');
    try {
      state.user = await withButton(f.querySelector('[type=submit]'), () => api('PUT', '/buddy/profile', { ...d, travel_style: d.travel_style || '', buddy_enabled: !!d.buddy_enabled, interests: [...interests] }));
      buddyCache = null;
      onSaved();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function buddyPage(q = new URLSearchParams()) {
  if (!requireLogin()) return;
  loading();
  const [me, matches] = await Promise.all([api('GET', '/buddy/profile'), api('GET', '/buddy/matches')]);

  // ยังไม่ได้ตั้งค่า → แสดงหน้าเริ่มต้นใช้งานแบบง่าย ๆ หน้าเดียว
  if (!me.buddy_enabled || !me.interests.length) {
    $app.innerHTML = `
      <form class="card onboard" id="onboard">
        <div class="onboard-head">
          <div class="onboard-ic">${ic('handshake', 32)}</div>
          <h1>หาเพื่อนเที่ยวที่ใช่ ใน 1 นาที</h1>
          <p class="muted">บอกเราว่าคุณชอบเที่ยวแบบไหน แล้ว AI จะหาคนที่ไปที่เดียวกัน ช่วงเวลาเดียวกัน และชอบอะไรคล้ายกันให้</p>
        </div>
        ${profileFields(me, { withToggle: false })}
        <button type="submit" class="btn block lg">${ic('sparkles', 18)} เริ่มหาบัดดี้</button>
        <p class="hint" style="text-align:center;margin-top:var(--space-3)">${ic('lock', 13)} ผู้ใช้อื่นจะเห็นเฉพาะชื่อ อายุ ความสนใจ และเมือง/วันที่ของทริปคุณ · ปิดได้ทุกเมื่อ</p>
      </form>`;
    bindProfileForm(document.getElementById('onboard'), me, () => { toast('พร้อมแล้ว! กำลังหาบัดดี้ให้คุณ', 'success'); buddyPage(); });
    return;
  }

  const contacted = new Map([...matches.outgoing.map((m) => [m.other.id, 'sent']), ...matches.incoming.map((m) => [m.other.id, 'incoming']), ...matches.accepted.map((m) => [m.other.id, 'buddy'])]);
  const people = [...matches.accepted.map((m) => ({ m, pending: false })), ...matches.outgoing.map((m) => ({ m, pending: true }))];

  $app.innerHTML = `
    <div class="page-head">
      <div><h1>จับคู่บัดดี้ท่องเที่ยว</h1><p class="muted">ให้ AI แนะนำ หรือค้นหาเองตามเมืองและวันที่จะไป กดส่งคำขอ เมื่ออีกฝ่ายตอบรับก็แชทวางแผนทริปได้เลย</p></div>
    </div>

    <section class="agent-bar">
      <div class="agent-ic">${ic('bot', 28)}</div>
      <div class="grow">
        <div class="agent-title"><b>AI Agent จับคู่บัดดี้</b><span class="agent-badge">${ic('sparkles', 12)} AI</span></div>
        <div class="agent-basis">วิเคราะห์จาก: ${me.interests.map((i) => `<span class="tag">${esc(i)}</span>`).join('')}${me.travel_style ? `<span class="tag">${esc(me.travel_style)}</span>` : ''}<span class="tag">${ic('plane', 12)} ทริปที่จองไว้</span></div>
      </div>
      <div class="agent-actions">
        <button class="btn secondary" id="edit-profile">${ic('pencil', 16)} แก้ไขโปรไฟล์</button>
        <button class="btn agent-go" id="suggest">${ic('sparkles', 16)} ให้ AI หาบัดดี้ใหม่</button>
      </div>
    </section>

    ${matches.incoming.length ? `
    <section class="req-box" id="requests">
      <h2>${ic('bell', 20)} มีคนอยากเป็นบัดดี้กับคุณ <span class="tab-count">${matches.incoming.length}</span></h2>
      ${matches.incoming.map((m) => `
        <div class="req-row">
          ${avatar(m.other.name)}
          <div class="grow">
            <div class="row" style="gap:var(--space-2)"><b>${esc(m.other.name)}</b>${m.score != null ? `<span class="pct-pill ${compatLevel(m.score)}">เข้ากันได้ ${m.score}%</span>` : ''}</div>
            <div class="small muted">${personMeta(m.other)}</div>
            ${m.reason ? `<div class="small">${ic('bot', 14)} ${esc(m.reason)}</div>` : ''}
          </div>
          <div class="req-actions">
            <button class="btn secondary sm" data-respond="${m.id}" data-accept="0">ปฏิเสธ</button>
            <button class="btn sm" data-respond="${m.id}" data-accept="1">${ic('check', 15)} ตอบรับ</button>
          </div>
        </div>`).join('')}
    </section>` : ''}

    ${people.length ? `
    <section class="section-block">
      <h2 class="sec-title">บัดดี้ของฉัน</h2>
      <div class="buddy-strip">${people.map(({ m, pending }) => pending
        ? `<div class="bs-item pending" title="รอ ${esc(m.other.name)} ตอบรับ">${avatar(m.other.name)}<b>${esc(m.other.name)}</b><small>รอตอบรับ</small></div>`
        : `<a class="bs-item" href="#/chat/${m.id}">${avatar(m.other.name)}<b>${esc(m.other.name)}</b><small>${ic('message-circle', 13)} แชท</small></a>`).join('')}</div>
    </section>` : ''}

    <section class="section-block">
      <div class="find-head">
        <h2 class="sec-title" style="margin:0">หาบัดดี้</h2>
        <div class="mode-switch" role="tablist" aria-label="วิธีหาบัดดี้">
          <button type="button" role="tab" data-mode="ai" title="AI เลือกคนที่เข้ากับคุณที่สุดให้">${ic('sparkles', 16)} AI แนะนำให้</button>
          <button type="button" role="tab" data-mode="search" title="เลือกเมือง วันที่ และความสนใจเอง">${ic('search', 16)} ค้นหาเอง</button>
        </div>
      </div>
      <div data-pane="ai"><div id="suggestions"></div></div>
      <div data-pane="search" hidden>
        <form class="card browse-filters" id="browse" autocomplete="off">
          <div class="bf-row">
            <label class="bf-field bf-q">${ic('search', 18)}<input name="q" placeholder="ค้นหาชื่อ หรือคำในแนะนำตัว เช่น ช่างภาพ"></label>
            <label class="bf-field bf-city">${ic('map-pin', 18)}<select name="city"><option value="">ทุกเมืองปลายทาง</option></select></label>
            <label class="bf-field"><small>ไปตั้งแต่</small><input type="date" name="from"></label>
            <label class="bf-field"><small>ถึง</small><input type="date" name="to"></label>
          </div>
          <div class="bf-interests">
            <span class="small muted">ความสนใจ:</span>
            ${[...new Set([...me.interests, ...INTEREST_PRESETS])].map((i) => `<button type="button" class="chip" data-bi="${esc(i)}" aria-pressed="false">${esc(i)}</button>`).join('')}
          </div>
          <details class="bf-more">
            <summary>ตัวกรองเพิ่มเติม (เพศ · อายุ · สไตล์)</summary>
            <div class="bf-row">
              <label class="bf-field"><small>เพศ</small><select name="gender"><option value="">ทุกเพศ</option>${['ชาย', 'หญิง', 'LGBTQ+', 'ไม่ระบุ'].map((g) => `<option>${g}</option>`).join('')}</select></label>
              <label class="bf-field"><small>อายุตั้งแต่</small><input type="number" name="ageMin" min="18" max="99" placeholder="18"></label>
              <label class="bf-field"><small>ถึง</small><input type="number" name="ageMax" min="18" max="99" placeholder="99"></label>
              <label class="bf-field"><small>สไตล์การเที่ยว</small><select name="style"><option value="">ทุกสไตล์</option>${TRAVEL_STYLES.map((t) => `<option>${t}</option>`).join('')}</select></label>
            </div>
          </details>
        </form>
        <div class="row between bf-head">
          <span id="browse-count" class="muted"></span>
          <div class="row" style="gap:var(--space-2)">
            <button type="button" class="btn ghost sm" id="browse-reset">ล้างตัวกรอง</button>
            <select id="browse-sort" style="width:auto"><option value="score">เรียง: เข้ากันได้มากสุด</option><option value="trip">เรียง: ทริปใกล้ที่สุด</option><option value="name">เรียง: ชื่อ ก–ฮ</option></select>
          </div>
        </div>
        <div id="browse-results"></div>
      </div>
    </section>`;

  document.getElementById('edit-profile').addEventListener('click', () => {
    const m = modal(`<h2>โปรไฟล์ของฉัน</h2><form id="pf">${profileFields(me)}
      <div class="row" style="justify-content:flex-end;margin-top:var(--space-4)"><button type="button" class="btn secondary" data-close>ยกเลิก</button><button type="submit" class="btn">บันทึก</button></div></form>`, { wide: true });
    bindProfileForm(m.el.querySelector('#pf'), me, () => { m.close(); toast('บันทึกโปรไฟล์แล้ว', 'success'); buddyPage(); });
  });

  $app.querySelectorAll('[data-respond]').forEach((btn) => btn.addEventListener('click', async () => {
    const accept = btn.dataset.accept === '1';
    try {
      await withButton(btn, () => api('POST', `/buddy/matches/${btn.dataset.respond}/respond`, { accept }));
      toast(accept ? 'จับคู่สำเร็จ! เริ่มแชทได้เลย' : 'ปฏิเสธคำขอแล้ว', accept ? 'success' : '');
      accept ? go(`#/chat/${btn.dataset.respond}`) : buddyPage();
    } catch (err) { toast(err.message, 'error'); }
  }));
  if (q.get('tab') === 'requests') document.getElementById('requests')?.scrollIntoView({ behavior: 'smooth' });

  const chatOf = new Map(matches.accepted.map((m) => [m.other.id, m.id]));
  const card = (x, mine, why = 'ทำไม AI ถึงแนะนำคนนี้?') => {
    const u = x.user, common = u.interests.filter((i) => mine.has(i)), status = contacted.get(u.id);
    return `
      <article class="sg-card">
        <div class="sg-top">${avatar(u.name)}<div class="sg-pct ${compatLevel(x.score)}"><b>${x.score}%</b><small>${compatLabel(x.score)}</small></div></div>
        <div><b class="sg-name">${esc(u.name)}</b><div class="small muted">${personMeta(u) || '&nbsp;'}</div></div>
        <ul class="sg-facts">
          <li>${ic('heart', 15)} <span>${common.length ? `ชอบ${common.map(esc).join(', ')}เหมือนคุณ` : '<span class="muted">ความสนใจไม่ตรงกัน</span>'}</span></li>
          <li>${ic('plane', 15)} <span>${x.trips.length ? x.trips.map(tripText).join('<br>') : '<span class="muted">ยังไม่มีทริปที่จองไว้</span>'}</span></li>
        </ul>
        <details class="sg-more">
          <summary>${why}</summary>
          <p>${ic('bot', 14)} ${esc(x.reason)}</p>
          ${u.bio ? `<p class="match-bio">“${esc(u.bio)}”</p>` : ''}
          <div>${u.interests.map((i) => `<span class="tag ${mine.has(i) ? '' : 'muted-tag'}">${esc(i)}</span>`).join('')}</div>
          <button class="linklike small report-link" data-report="${u.id}" data-name="${esc(u.name)}">${ic('flag', 13)} รายงานผู้ใช้นี้</button>
        </details>
        ${status === 'buddy' ? `<a class="btn secondary block" href="#/chat/${chatOf.get(u.id)}">${ic('message-circle', 16)} เป็นบัดดี้แล้ว · แชท</a>`
          : status === 'incoming' ? `<a class="btn block" href="#/buddy?tab=requests" data-scroll-req>${ic('bell', 16)} เขาส่งคำขอมาแล้ว</a>`
          : status === 'sent' ? `<button class="btn block" disabled>${ic('check', 16)} ส่งคำขอแล้ว · รอตอบรับ</button>`
          : `<button class="btn block" data-req="${u.id}" data-score="${x.score}" data-reason="${esc(x.reason)}">${ic('handshake', 16)} ส่งคำขอจับคู่</button>`}
      </article>`;
  };
  const bindCards = ($root) => {
    $root.querySelectorAll('[data-req]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await withButton(b, () => api('POST', '/buddy/request', { userId: Number(b.dataset.req), score: Number(b.dataset.score), reason: b.dataset.reason }));
        if (r.accepted) {
          // บัดดี้ตัวอย่างตอบรับทันที
          b.outerHTML = `<a class="btn secondary block" href="#/chat/${r.matchId}">${ic('message-circle', 16)} เป็นบัดดี้แล้ว · แชท</a>`;
          contacted.set(Number(b.dataset.req), 'buddy');
          buddyCache = null;
          toast(`${r.name} ตอบรับเป็นบัดดี้แล้ว เริ่มแชทได้เลย`, 'success');
          refreshUnread();
          return;
        }
        b.innerHTML = `${ic('check', 16)} ส่งคำขอแล้ว · รอตอบรับ`; b.disabled = true;
        contacted.set(Number(b.dataset.req), 'sent');
        toast('ส่งคำขอแล้ว เราจะแจ้งเตือนเมื่ออีกฝ่ายตอบรับ', 'success');
      } catch (err) { toast(err.message, 'error'); }
    }));
    $root.querySelectorAll('[data-scroll-req]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('requests')?.scrollIntoView({ behavior: 'smooth' }); }));
    $root.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => reportModal(Number(b.dataset.report), b.dataset.name, () => { buddyCache = null; buddyPage(); })));
  };

  const renderSuggestions = (r) => {
    const $s = document.getElementById('suggestions');
    const mine = new Set(r.me.interests);
    const all = r.suggestions.filter((x) => contacted.get(x.user.id) !== 'buddy');
    // คนที่ไม่มีจุดร่วมเลย (0%) ซ่อนไว้ก่อน ให้เห็นเฉพาะคนที่น่าสนใจจริง ๆ
    const top = all.filter((x) => x.score > 0), low = all.filter((x) => x.score <= 0);
    $s.innerHTML = `
      ${!r.me.trips.length ? `<div class="alert info small">${ic('info', 15)} ยังไม่มีทริปที่จองไว้ ผลจึงอิงจากความสนใจเป็นหลัก — <a href="#/search">จองโรงแรม</a> เพื่อเจอคนที่ไปช่วงเดียวกัน</div>` : ''}
      ${top.length ? `<div class="sg-grid">${top.map((x) => card(x, mine)).join('')}</div>`
        : `<div class="card empty slim"><div class="icon">${ic('search-x', 32)}</div><b>ยังไม่เจอคนที่มีจุดร่วมกับคุณ</b><p class="muted small">ลองเลือกความสนใจเพิ่ม หรือจองทริปเพื่อเจอคนที่ไปช่วงเดียวกัน</p><button class="btn secondary sm" data-edit>${ic('pencil', 15)} แก้ไขความสนใจ</button></div>`}
      ${low.length ? `<div class="show-more"><button class="btn ghost sm" id="show-low">แสดงคนอื่นที่ยังไม่มีจุดร่วม (${low.length} คน)</button></div><div class="sg-grid" id="low-list" hidden>${low.map((x) => card(x, mine)).join('')}</div>` : ''}
      <p class="engine-note">${r.engine === 'claude' ? `${ic('sparkles', 13)} วิเคราะห์โดย Claude AI` : `${ic('list-checks', 13)} วิเคราะห์ด้วยกฎภายในระบบ`} จากความสนใจ สไตล์การเที่ยว และทริปที่จองไว้</p>`;
    document.getElementById('show-low')?.addEventListener('click', (e) => { document.getElementById('low-list').hidden = false; e.target.closest('.show-more').remove(); });
    $s.querySelector('[data-edit]')?.addEventListener('click', () => document.getElementById('edit-profile').click());
    bindCards($s);
  };
  const runSuggest = async () => {
    const $s = document.getElementById('suggestions');
    $s.innerHTML = `<div class="card loading"><div class="spinner"></div>AI Agent กำลังวิเคราะห์ความสนใจและทริปของคุณ...</div>`;
    try {
      buddyCache = await withButton(document.getElementById('suggest'), () => api('POST', '/buddy/suggest'));
      renderSuggestions(buddyCache);
    } catch (err) { $s.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  };

  // ---------- ค้นหาเอง ----------
  const bf = document.getElementById('browse'), $res = document.getElementById('browse-results');
  const picked = new Set();
  let browseTimer, browseSeq = 0, browseLoaded = false;
  const runBrowse = async () => {
    const seq = ++browseSeq;
    const d = formData(bf);
    const params = new URLSearchParams({ ...Object.fromEntries(Object.entries(d).filter(([, v]) => v)), sort: document.getElementById('browse-sort').value });
    if (picked.size) params.set('interests', [...picked].join(','));
    $res.innerHTML = `<div class="card loading"><div class="spinner"></div>กำลังค้นหา...</div>`;
    try {
      const r = await api('GET', `/buddy/browse?${params}`);
      if (seq !== browseSeq) return; // มีการค้นหาใหม่กว่าแล้ว
      const mine = new Set(r.me.interests);
      document.getElementById('browse-count').innerHTML = `พบ <b>${r.total}</b> คน`;
      $res.innerHTML = r.results.length
        ? `<div class="sg-grid">${r.results.map((x) => card(x, mine, 'ดูโปรไฟล์และจุดร่วม')).join('')}</div>`
        : `<div class="card empty slim"><div class="icon">${ic('search-x', 32)}</div><b>ไม่พบคนที่ตรงกับตัวกรอง</b><p class="muted small">ลองเลือกเมืองหรือช่วงวันที่ให้กว้างขึ้น หรือลดความสนใจที่เลือก</p></div>`;
      bindCards($res);
      browseLoaded = true;
    } catch (err) { $res.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  };
  const queueBrowse = (ms = 300) => { clearTimeout(browseTimer); browseTimer = setTimeout(runBrowse, ms); };
  bf.addEventListener('input', () => queueBrowse());
  bf.addEventListener('change', () => queueBrowse(0));
  bf.addEventListener('submit', (e) => { e.preventDefault(); queueBrowse(0); });
  document.getElementById('browse-sort').addEventListener('change', () => queueBrowse(0));
  bf.querySelector('.bf-interests').addEventListener('click', (e) => {
    const c = e.target.closest('[data-bi]');
    if (!c) return;
    const on = c.classList.toggle('on');
    c.setAttribute('aria-pressed', on);
    on ? picked.add(c.dataset.bi) : picked.delete(c.dataset.bi);
    queueBrowse(0);
  });
  document.getElementById('browse-reset').addEventListener('click', () => {
    bf.reset(); picked.clear();
    bf.querySelectorAll('[data-bi].on').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-pressed', false); });
    queueBrowse(0);
  });
  api('GET', '/buddy/cities').then((cities) => {
    bf.city.insertAdjacentHTML('beforeend', cities.map((c) => `<option>${esc(c)}</option>`).join(''));
  }).catch(() => {});

  const setMode = (mode, autoload = true) => {
    $app.querySelectorAll('[data-mode]').forEach((b) => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-selected', b.dataset.mode === mode); });
    $app.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== mode; });
    history.replaceState(null, '', mode === 'search' ? '#/buddy?mode=search' : '#/buddy');
    if (autoload && mode === 'search' && !browseLoaded) runBrowse();
    if (autoload && mode === 'ai' && !document.getElementById('suggestions').innerHTML) buddyCache ? renderSuggestions(buddyCache) : runSuggest();
  };
  $app.querySelector('.mode-switch').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
  document.getElementById('suggest').addEventListener('click', () => { setMode('ai', false); runSuggest(); });
  setMode(q.get('mode') === 'search' ? 'search' : 'ai');
}

function reportModal(userId, name, after) {
  const m = modal(`
    <h2>${ic('flag', 22)} รายงานผู้ใช้ ${esc(name)}</h2>
    <p class="muted small">ทีมงานจะตรวจสอบภายใน 24 ชั่วโมง และคุณจะไม่เห็นผู้ใช้นี้ในผลการจับคู่อีก</p>
    <form id="rp">
      <div class="field"><label>เหตุผล</label>
        <select name="type">${['พฤติกรรมไม่เหมาะสม/คุกคาม', 'ข้อความสแปมหรือหลอกลวง', 'โปรไฟล์ปลอม', 'อื่น ๆ'].map((x) => `<option>${x}</option>`).join('')}</select></div>
      <div class="field"><label>รายละเอียดเพิ่มเติม</label><textarea name="detail"></textarea></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" data-close>ยกเลิก</button><button class="btn danger">ส่งรายงาน</button></div>
    </form>`);
  m.el.querySelector('#rp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    try {
      await api('POST', '/buddy/report', { userId, reason: `${d.type}${d.detail ? ': ' + d.detail : ''}` });
      m.close(); toast('ส่งรายงานแล้ว ขอบคุณที่ช่วยให้ชุมชนปลอดภัย', 'success'); after?.();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function chatPage(id) {
  if (!requireLogin()) return;
  loading();
  let data;
  try { data = await api('GET', `/buddy/matches/${id}/messages`); }
  catch (err) { $app.innerHTML = `<div class="alert error">${esc(err.message)}</div><a href="#/buddy">← กลับ</a>`; return; }
  const o = data.match.other;
  let lastId = 0;

  $app.innerHTML = `
    <p><a href="#/buddy">← กลับไปหน้าบัดดี้</a></p>
    <div class="card chat">
      <div class="chat-head">
        ${avatar(o.name, 'sm')}
        <div style="flex:1"><b>${esc(o.name)}</b>${o.auto_reply ? ` <span class="pill" title="บัญชีตัวอย่างสำหรับทดลองใช้งาน ข้อความตอบกลับสร้างโดยระบบ">${ic('bot', 13)} บัดดี้ตัวอย่าง · ตอบอัตโนมัติ</span>` : ''}<div class="small muted">${o.interests.map(esc).join(' · ')}</div></div>
        <button class="btn ghost sm" id="report">${ic('flag', 15)} รายงาน</button>
      </div>
      <div class="chat-body" id="msgs"><div class="muted small" style="text-align:center">${ic('lock', 13)} แชทนี้เห็นเฉพาะคุณและ ${esc(o.name)} · อย่าแชร์ข้อมูลส่วนตัวที่ละเอียดอ่อน</div></div>
      <div class="chat-typing" id="typing" hidden><span class="dots"><i></i><i></i><i></i></span> ${esc(o.name)} กำลังพิมพ์...</div>
      <form class="chat-form" id="send"><input name="text" placeholder="พิมพ์ข้อความ..." autocomplete="off" required><button class="btn">ส่ง</button></form>
    </div>`;
  const $msgs = document.getElementById('msgs');
  const append = (list) => {
    if (!list.length) return;
    const atBottom = $msgs.scrollHeight - $msgs.scrollTop - $msgs.clientHeight < 60;
    $msgs.insertAdjacentHTML('beforeend', list.map((m) =>
      `<div class="msg ${m.sender_id === state.user.id ? 'me' : 'them'}">${esc(m.text)}<time>${fmtTime(m.created_at)}</time></div>`).join(''));
    lastId = list[list.length - 1].id;
    if (atBottom || list.some((m) => m.sender_id === state.user.id)) $msgs.scrollTop = $msgs.scrollHeight;
  };
  const $typing = document.getElementById('typing');
  const refresh = async () => {
    const r = await api('GET', `/buddy/matches/${id}/messages?after=${lastId}`);
    append(r.messages);
    $typing.hidden = !r.typing;
  };
  append(data.messages);
  $typing.hidden = !data.typing;
  $msgs.scrollTop = $msgs.scrollHeight;

  const poll = setInterval(() => refresh().catch(() => { /* ignore */ }), o.auto_reply ? 1200 : 3000);
  cleanup = () => clearInterval(poll);

  document.getElementById('send').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.text;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await api('POST', `/buddy/matches/${id}/messages`, { text });
      await refresh();
    } catch (err) { toast(err.message, 'error'); input.value = text; }
  });
  document.getElementById('report').addEventListener('click', () => reportModal(o.id, o.name, () => go('#/buddy')));
}

// ================= Pages: Notifications =================
async function notificationsPage() {
  if (!requireLogin()) return;
  loading();
  const { items } = await api('GET', '/notifications');
  $app.innerHTML = `
    <h1>การแจ้งเตือน</h1>
    <div class="card">${items.length ? items.map((n) => `
      <div class="notif ${n.is_read ? '' : 'unread'}">
        <div class="notif-ic">${ic(n.title.includes('บัดดี้') || n.title.includes('จับคู่') ? 'handshake' : n.title.includes('ยกเลิก') ? 'circle-x' : n.title.includes('รายงาน') ? 'flag' : n.title.includes('ยืนยัน') || n.title.includes('สำเร็จ') ? 'circle-check' : 'bell', 20)}</div>
        <div style="flex:1">
          <b>${esc(n.title)}</b>
          <div class="small">${esc(n.message)}</div>
          <div class="small muted">${fmtDateTime(n.created_at)} · ส่งทาง ${esc(n.channel.replace('in_app', 'ในระบบ').replace('email', 'อีเมล').replace('sms', 'SMS'))}</div>
        </div>
        ${n.link ? `<a class="btn secondary sm" href="${esc(n.link)}">ดู</a>` : ''}
      </div>`).join('') : `<div class="empty"><div class="icon">${ic('bell-off', 40)}</div>ยังไม่มีการแจ้งเตือน</div>`}</div>`;
  if (items.some((n) => !n.is_read)) {
    await api('POST', '/notifications/read');
    state.unread = 0;
    renderNav('/notifications');
  }
}

// ================= Pages: Admin =================
// ================= Pages: Admin =================
const REQ_STATUS = { pending: 'รอตรวจสอบ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธแล้ว', withdrawn: 'ลูกค้าถอนคำขอ' };
const REQ_PILL = { pending: 'pending', approved: 'confirmed', rejected: 'cancelled', withdrawn: 'checked_out' };
const reqPill = (s) => `<span class="pill ${REQ_PILL[s]}">${REQ_STATUS[s]}</span>`;
const ago = (s) => {
  const d = new Date(s.replace(' ', 'T') + 'Z'), days = nights(isoDate(d), todayISO());
  return `${days === 0 ? 'วันนี้' : days === 1 ? 'เมื่อวาน' : fmtDate(isoDate(d))} ${fmtTime(s)}`;
};

// โครงหน้าแอดมิน: เมนูด้านซ้าย + หัวข้อหน้า
async function adminShell(active, title, subtitle = '') {
  const c = await api('GET', '/admin/counts');
  const items = [
    ['dashboard', '#/admin', 'layout-dashboard', 'แดชบอร์ด', 0],
    ['bookings', '#/admin/bookings', 'list', 'การจองทั้งหมด', 0],
    ['edit', '#/admin/requests/edit', 'pencil', 'คำขอแก้ไข', c.edit],
    ['cancel', '#/admin/requests/cancel', 'rotate-ccw', 'คำขอยกเลิก/คืนเงิน', c.cancel],
    ['hotels', '#/admin/hotels', 'building-2', 'โรงแรมและห้องพัก', 0],
    ['reports', '#/admin/reports', 'flag', 'รายงานผู้ใช้', c.reports],
  ];
  const u = state.user;
  $app.innerHTML = `
    <div class="admin-layout">
      <aside class="admin-side">
        <div class="admin-side-label">ผู้ดูแลระบบ</div>
        <nav>${items.map(([k, href, icon, label, n]) => `<a href="${href}" class="${k === active ? 'active' : ''}">${ic(icon, 19)}<span>${label}</span>${n ? `<b class="admin-badge">${n}</b>` : ''}</a>`).join('')}</nav>
      </aside>
      <section class="admin-main">
        <header class="admin-head">
          <div><h1>${title}</h1>${subtitle ? `<div class="muted">${subtitle}</div>` : ''}</div>
          <div class="admin-me">${avatar(u.name)}<div><b>${esc(u.name)}</b><div class="small muted">@${esc(u.username)} · ผู้ดูแลระบบ</div></div></div>
        </header>
        <div id="admin-body"><div class="loading"><div class="spinner"></div>กำลังโหลด...</div></div>
      </section>
    </div>`;
  return document.getElementById('admin-body');
}

async function adminRouter(seg, q) {
  if (!requireLogin()) return;
  if (state.user.role !== 'admin') { $app.innerHTML = `<div class="alert error">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div>`; return; }
  document.body.classList.add('admin-mode');
  switch (seg[1]) {
    case undefined: return adminDashboard();
    case 'bookings': return adminBookings(q);
    case 'requests': return adminRequests(seg[2] === 'cancel' ? 'cancel' : 'edit', q);
    case 'hotels': return adminHotels();
    case 'reports': return adminReports();
    default: go('#/admin');
  }
}

// ---------- แดชบอร์ด ----------
function barChart(rows, unit) {
  const max = Math.max(4, ...rows.map((r) => r.n));
  const top = Math.ceil(max / 4) * 4, ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  return `
    <div class="bars" role="img" aria-label="${rows.map((r) => `${r.label} ${r.n} ${unit}`).join(', ')}">
      <div class="bars-grid">${ticks.reverse().map((t) => `<div><span>${t}</span></div>`).join('')}</div>
      <div class="bars-cols">${rows.map((r, i) => `
        <div class="bar-col ${i === rows.length - 1 ? 'is-today' : ''}" tabindex="0">
          <div class="bar-tip"><b>${r.n} ${unit}</b>${r.full}</div>
          <div class="bar-track"><div class="bar" style="height:${(r.n / top) * 100}%"><span>${r.n}</span></div></div>
          <div class="bar-label">${r.label}</div>
        </div>`).join('')}</div>
    </div>`;
}

function todoItem(r) {
  const sub = r.type === 'cancel'
    ? `${esc(r.user_name)} · คืน ${r.data.percent}% = ${money(Math.round(r.paid_amount * r.data.percent / 100))}`
    : `${esc(r.user_name)} · ${ago(r.created_at)}`;
  return `<a class="todo-item" href="#/admin/requests/${r.type}?id=${r.id}">
    <b>${r.type === 'edit' ? 'คำขอแก้ไข' : 'ขอยกเลิก'} ${esc(r.code)}</b>
    <div>${reqPill('pending')}</div>
    <div class="small muted">${sub}</div></a>`;
}

async function adminDashboard() {
  const dayName = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const $b = await adminShell('dashboard', 'แดชบอร์ด', `ภาพรวม${dayName}`);
  const d = await api('GET', '/admin/dashboard');
  const diff = d.bookingsLastWeek ? Math.round(((d.bookingsToday - d.bookingsLastWeek) / d.bookingsLastWeek) * 100) : null;
  const weekday = new Date(d.today + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'long' });
  const trend = diff === null ? `<span class="muted">${weekday}ที่แล้ว ${d.bookingsLastWeek} รายการ</span>`
    : `<span class="${diff >= 0 ? 'up' : 'down'}">${ic(diff >= 0 ? 'trending-up' : 'trending-down', 15)} ${Math.abs(diff)}% จาก${weekday}ที่แล้ว</span>`;
  const total7 = d.last7.reduce((s, r) => s + r.n, 0);
  const rows = d.last7.map((r) => {
    const dt = new Date(r.date + 'T00:00:00');
    return { n: r.n, label: dt.toLocaleDateString('th-TH', { weekday: 'short' }), full: fmtDate(r.date) };
  });

  $b.innerHTML = `
    <div class="grid grid-4 kpis">
      <div class="card kpi"><div class="kpi-label">การจองวันนี้</div><div class="kpi-num">${d.bookingsToday}</div><div class="kpi-sub">${trend}</div></div>
      <a class="card kpi" href="#/admin/requests/edit"><div class="kpi-label">คำขอแก้ไขรอตรวจสอบ</div><div class="kpi-num">${d.pendingEdit}</div><div class="kpi-sub">${d.pendingEdit ? '<span class="down">ต้องจัดการ</span>' : '<span class="muted">ไม่มีงานค้าง</span>'}</div></a>
      <a class="card kpi" href="#/admin/requests/cancel"><div class="kpi-label">คำขอยกเลิกรอตรวจสอบ</div><div class="kpi-num">${d.pendingCancel}</div><div class="kpi-sub">${d.pendingCancel ? '<span class="down">ต้องจัดการ</span>' : '<span class="muted">ไม่มีงานค้าง</span>'}</div></a>
      <div class="card kpi"><div class="kpi-label">ยอดคืนเงินเดือนนี้</div><div class="kpi-num">${money(d.refundMonth.sum)}</div><div class="kpi-sub muted">จาก ${d.refundMonth.count} รายการ</div></div>
    </div>
    <div class="admin-split">
      <div>
        <div class="card">
          <div class="row between"><h2 style="margin:0">การจอง 7 วันล่าสุด</h2><span class="muted small">รวม ${total7} รายการ</span></div>
          ${barChart(rows, 'การจอง')}
        </div>
        <div class="grid grid-3 mini-stats">
          <a class="card" href="#/admin/bookings?status=confirmed">${ic('door-open', 20)}<div><b>${d.arrivals}</b><span>เช็คอินวันนี้</span></div></a>
          <a class="card" href="#/admin/bookings?status=checked_in">${ic('luggage', 20)}<div><b>${d.departures}</b><span>เช็คเอาท์วันนี้</span></div></a>
          <a class="card" href="#/admin/reports">${ic('flag', 20)}<div><b>${d.openReports}</b><span>รายงานผู้ใช้รอตรวจ</span></div></a>
        </div>
      </div>
      <div class="card todo">
        <h2>ต้องจัดการ</h2>
        ${d.todo.length ? d.todo.map(todoItem).join('') : `<div class="empty slim"><div class="icon">${ic('inbox', 30)}</div>ไม่มีคำขอที่รอตรวจสอบ</div>`}
      </div>
    </div>`;
}

// ---------- การจองทั้งหมด ----------
async function adminBookings(q) {
  const status = q.get('status') || '', text = q.get('q') || '';
  const $b = await adminShell('bookings', 'การจองทั้งหมด');
  const list = await api('GET', `/admin/bookings?${new URLSearchParams({ status, q: text })}`);
  $b.innerHTML = `
    <div class="card">
      <form class="row admin-filter" id="flt">
        <input name="q" value="${esc(text)}" placeholder="ค้นหารหัสการจอง ชื่อลูกค้า หรือโรงแรม">
        <select name="status">${[['', 'ทุกสถานะ'], ...Object.entries(STATUS)].map(([k, l]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn">${ic('search', 16)} ค้นหา</button>
      </form>
      <div class="small muted" style="margin:var(--space-3) 0">พบ ${list.length} รายการ</div>
      <div class="table-wrap"><table>
        <tr><th>รหัส</th><th>ลูกค้า</th><th>โรงแรม / ห้อง</th><th>วันที่เข้าพัก</th><th>ยอด</th><th>สถานะ</th><th></th></tr>
        ${list.map((b) => `<tr>
          <td><a href="#/booking/${b.id}">${esc(b.code)}</a>${b.pending_request ? `<div><a class="pill pending" href="#/admin/requests/${b.pending_request}">${b.pending_request === 'edit' ? 'ขอแก้ไข' : 'ขอยกเลิก'}</a></div>` : ''}</td>
          <td>${esc(b.guest_name)}<div class="small muted">@${esc(b.username)} · ${b.guests} คน</div></td>
          <td>${esc(b.hotel_name)}<div class="small muted">${esc(b.room_type)} × ${b.rooms_count}</div></td>
          <td class="small">${fmtDate(b.check_in)} – ${fmtDate(b.check_out)}</td>
          <td>${money(b.total_price)}${b.total_price > b.paid_amount && b.status === 'pending' ? `<div class="small" style="color:var(--warning)">ค้าง ${money(b.total_price - b.paid_amount)}</div>` : ''}</td>
          <td>${statusPill(b.status)}</td>
          <td>${b.status === 'confirmed' ? `<button class="btn sm" data-act="checkin" data-id="${b.id}">เช็คอิน</button>` : b.status === 'checked_in' ? `<button class="btn sm" data-act="checkout" data-id="${b.id}">เช็คเอาท์</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">ไม่พบการจอง</td></tr>'}
      </table></div>
    </div>`;
  const f = document.getElementById('flt');
  f.addEventListener('submit', (e) => { e.preventDefault(); go('#/admin/bookings?' + new URLSearchParams(formData(f))); });
  f.status.addEventListener('change', () => f.requestSubmit());
  $b.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await withButton(btn, () => api('POST', `/bookings/${btn.dataset.id}/${btn.dataset.act}`)); toast('อัปเดตสถานะการจองแล้ว', 'success'); adminBookings(q); }
    catch (err) { toast(err.message, 'error'); }
  }));
}

// ---------- คำขอแก้ไข / ยกเลิก ----------
function editCompare(r) {
  const a = r.data.before, b = r.data.after;
  const rowsDef = [
    ['เช็คอิน', fmtDate(a.checkIn), fmtDate(b.checkIn)],
    ['เช็คเอาท์', fmtDate(a.checkOut), fmtDate(b.checkOut)],
    ['จำนวนคืน', `${nights(a.checkIn, a.checkOut)} คืน`, `${nights(b.checkIn, b.checkOut)} คืน`],
    ['ประเภทห้อง', `${esc(a.roomType)} × ${r.rooms_count}`, `${esc(b.roomType)} × ${r.rooms_count}`],
    ['ผู้เข้าพัก', `${a.guests} คน`, `${b.guests} คน`],
    ['ราคารวม', money(a.total), money(r.check?.total ?? b.total)],
  ];
  return `<div class="table-wrap"><table class="compare">
    <tr><th></th><th>เดิม</th><th></th><th>ขอเปลี่ยนเป็น</th></tr>
    ${rowsDef.map(([k, x, y]) => `<tr class="${x !== y ? 'changed' : ''}"><td class="muted">${k}</td><td>${x}</td><td class="muted">${x !== y ? ic('arrow-right', 14) : ''}</td><td>${y}</td></tr>`).join('')}
  </table></div>`;
}

function requestMoney(r) {
  if (r.type === 'edit') {
    const total = r.check?.total ?? r.data.after.total, diff = total - r.paid_amount;
    return `<div class="line"><span>ลูกค้าชำระแล้ว</span><span>${money(r.paid_amount)}</span></div>
      ${r.paid_amount > 0 && diff > 0 ? `<div class="line total"><span>ลูกค้าต้องชำระเพิ่ม</span><span style="color:var(--warning)">${money(diff)}</span></div>` : ''}
      ${r.paid_amount > 0 && diff < 0 ? `<div class="line total"><span>ระบบจะคืนเงินส่วนต่าง</span><span style="color:var(--success)">${money(-diff)}</span></div>` : ''}
      ${r.paid_amount > 0 && diff === 0 ? `<div class="line total"><span>ส่วนต่าง</span><span>${money(0)}</span></div>` : ''}`;
  }
  const refund = r.check?.refund ?? r.data.refund;
  return `<div class="small">${ic('file-text', 14)} ${esc(r.data.rule)} <span class="muted">(ขอล่วงหน้า ${r.data.daysBefore} วัน)</span></div>
    <div class="line"><span>ลูกค้าชำระแล้ว</span><span>${money(r.status === 'pending' ? r.paid_amount : r.data.paid)}</span></div>
    <div class="line"><span>อัตราคืนเงิน</span><span>${r.data.percent}%</span></div>
    <div class="line total"><span>ยอดคืนเงิน</span><span style="color:var(--success)">${money(refund)}</span></div>`;
}

function requestCard(r, focus) {
  const warn = r.status === 'pending' && r.type === 'edit' && r.check
    ? r.check.error ? `<div class="alert error">${esc(r.check.error)}</div>`
      : !r.check.fits ? `<div class="alert error">ห้องที่ขอรองรับผู้เข้าพักไม่พอ</div>`
      : !r.check.available ? `<div class="alert error">${ic('circle-x', 15)} ห้องที่ขอไม่ว่างแล้วในช่วงวันที่นี้ — ควรปฏิเสธคำขอ</div>`
      : `<div class="alert success">${ic('circle-check', 15)} ตรวจสอบแล้ว ห้องว่างและรองรับจำนวนผู้เข้าพัก</div>` : '';
  return `
    <article class="card req ${focus ? 'focus' : ''}" id="req-${r.id}">
      <div class="row between">
        <div><h3 style="margin:0">${r.type === 'edit' ? 'คำขอแก้ไข' : 'ขอยกเลิก'} <a href="#/booking/${r.booking_id}">${esc(r.code)}</a></h3>
          <div class="small muted">${esc(r.user_name)} (@${esc(r.username)}) · ${esc(r.hotel_name)} · ส่งเมื่อ ${ago(r.created_at)}</div></div>
        <div class="row">${statusPill(r.booking_status)}${reqPill(r.status)}</div>
      </div>
      ${r.reason ? `<div class="req-reason">${ic('message-circle', 15)} <span>“${esc(r.reason)}”</span></div>` : ''}
      <div class="req-grid">
        <div>${r.type === 'edit' ? editCompare(r) : `
          <div class="line"><span>เข้าพัก</span><b>${fmtDate(r.check_in)} – ${fmtDate(r.check_out)}</b></div>
          <div class="line"><span>ผู้เข้าพัก</span><span>${esc(r.guest_name)} · ${r.guests} คน · ${r.rooms_count} ห้อง</span></div>
          <div class="line"><span>ราคารวม</span><span>${money(r.total_price)}</span></div>`}</div>
        <div class="req-money">${requestMoney(r)}</div>
      </div>
      ${warn}
      ${r.status === 'pending' ? `
        <div class="row" style="justify-content:flex-end">
          <button class="btn secondary" data-reject="${r.id}">${ic('circle-x', 16)} ปฏิเสธ</button>
          <button class="btn ${r.type === 'cancel' ? 'danger' : ''}" data-approve="${r.id}" ${r.type === 'edit' && r.check && !(r.check.fits && r.check.available) ? 'disabled' : ''}>${ic('circle-check', 16)} ${r.type === 'edit' ? 'อนุมัติการแก้ไข' : 'อนุมัติยกเลิกและคืนเงิน'}</button>
        </div>`
      : r.decided_at ? `<div class="small muted req-decided">${REQ_STATUS[r.status]} ${ago(r.decided_at)}${r.decided_by_name ? ` โดย ${esc(r.decided_by_name)}` : ''}${r.admin_note ? ` — หมายเหตุ: ${esc(r.admin_note)}` : ''}</div>` : ''}
    </article>`;
}

async function adminRequests(type, q) {
  const status = q.get('status') ?? 'pending', focus = Number(q.get('id')) || 0;
  const title = type === 'edit' ? 'คำขอแก้ไขการจอง' : 'คำขอยกเลิก/คืนเงิน';
  const $b = await adminShell(type, title, type === 'edit' ? 'ตรวจสอบการเปลี่ยนวันที่ ประเภทห้อง และจำนวนผู้เข้าพัก' : 'ตรวจสอบการยกเลิกและยอดคืนเงินตามนโยบาย');
  const list = await api('GET', `/admin/requests?type=${type}&status=${status}`);
  const tabs = [['pending', 'รอตรวจสอบ'], ['approved', 'อนุมัติแล้ว'], ['rejected', 'ปฏิเสธแล้ว'], ['', 'ทั้งหมด']];
  $b.innerHTML = `
    <div class="seg-tabs">${tabs.map(([k, l]) => `<a href="#/admin/requests/${type}${k === 'pending' ? '' : `?status=${k}`}" class="${k === status ? 'active' : ''}">${l}</a>`).join('')}</div>
    ${list.length ? list.map((r) => requestCard(r, r.id === focus)).join('')
      : `<div class="card empty"><div class="icon">${ic('inbox', 36)}</div>${status === 'pending' ? 'ไม่มีคำขอที่รอตรวจสอบ' : 'ไม่มีรายการ'}</div>`}`;
  if (focus) document.getElementById(`req-${focus}`)?.scrollIntoView({ block: 'center' });

  const decide = (id, decision, note) => api('POST', `/admin/requests/${id}/${decision}`, { note });
  $b.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => {
    const r = list.find((x) => x.id === Number(btn.dataset.approve));
    const m = modal(`
      <h2>${r.type === 'edit' ? 'อนุมัติการแก้ไข' : 'อนุมัติการยกเลิก'} ${esc(r.code)}?</h2>
      <p class="muted">${r.type === 'edit' ? 'ระบบจะเปลี่ยนการจองตามคำขอ และคืนเงิน/เรียกเก็บส่วนต่างอัตโนมัติ' : `ระบบจะยกเลิกการจองและคืนเงิน ${money(r.check.refund)} ให้ลูกค้า`}</p>
      <div class="field"><label>หมายเหตุถึงลูกค้า (ไม่บังคับ)</label><textarea id="note"></textarea></div>
      <div class="row" style="justify-content:flex-end"><button class="btn secondary" data-close>ยกเลิก</button><button class="btn" id="ok">ยืนยันอนุมัติ</button></div>`);
    m.el.querySelector('#ok').addEventListener('click', async (e) => {
      try { const res = await withButton(e.target, () => decide(r.id, 'approve', m.el.querySelector('#note').value)); m.close(); toast(res.message, 'success'); adminRequests(type, q); }
      catch (err) { toast(err.message, 'error'); }
    });
  }));
  $b.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => {
    const r = list.find((x) => x.id === Number(btn.dataset.reject));
    const m = modal(`
      <h2>ปฏิเสธคำขอ ${esc(r.code)}</h2>
      <form id="rj"><div class="field"><label>เหตุผลที่ปฏิเสธ (ลูกค้าจะเห็นข้อความนี้) *</label>
        <textarea name="note" required placeholder="เช่น ห้องประเภทที่ขอเต็มแล้วในช่วงวันที่เลือก"></textarea></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn secondary" data-close>ยกเลิก</button><button class="btn danger">ยืนยันปฏิเสธ</button></div></form>`);
    const f = m.el.querySelector('#rj');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const res = await withButton(f.querySelector('.danger'), () => decide(r.id, 'reject', f.note.value)); m.close(); toast(res.message, 'success'); adminRequests(type, q); }
      catch (err) { toast(err.message, 'error'); }
    });
  }));
}

// ---------- โรงแรมและห้องพัก ----------
async function adminHotels() {
  const $b = await adminShell('hotels', 'โรงแรมและห้องพัก', 'ราคา ความจุ จำนวนห้อง และห้องที่มีผู้เข้าพักวันนี้');
  const hotels = await api('GET', '/admin/hotels');
  const rooms = hotels.flatMap((h) => h.rooms);
  const totalRooms = rooms.reduce((s, r) => s + r.total_rooms, 0), occ = rooms.reduce((s, r) => s + r.occupiedToday, 0);
  $b.innerHTML = `
    <div class="grid grid-3 kpis">
      <div class="card kpi"><div class="kpi-label">โรงแรม</div><div class="kpi-num">${hotels.length}</div><div class="kpi-sub muted">${rooms.length} ประเภทห้อง</div></div>
      <div class="card kpi"><div class="kpi-label">ห้องทั้งหมด</div><div class="kpi-num">${totalRooms}</div><div class="kpi-sub muted">ห้อง</div></div>
      <div class="card kpi"><div class="kpi-label">อัตราเข้าพักวันนี้</div><div class="kpi-num">${totalRooms ? Math.round((occ / totalRooms) * 100) : 0}%</div><div class="kpi-sub muted">${occ} จาก ${totalRooms} ห้อง</div></div>
    </div>
    ${hotels.map((h) => `
      <div class="card">
        <div class="row between">
          <div><h2 style="margin:0">${esc(h.name)}</h2><div class="small muted">${ic('map-pin', 13)} ${esc(h.city)} · ${'★'.repeat(h.star_class)} · คะแนน ${h.rating || '-'} (${h.reviewCount} รีวิว)</div></div>
          <a class="btn secondary sm" href="#/hotel/${h.id}">ดูหน้าโรงแรม</a>
        </div>
        <div class="table-wrap" style="margin-top:var(--space-3)"><table>
          <tr><th>ประเภทห้อง</th><th>ราคา/คืน</th><th>ความจุ</th><th>จำนวนห้อง</th><th>ไม่ว่างวันนี้</th><th>การจองที่จะมาถึง</th><th></th></tr>
          ${h.rooms.map((r) => `<tr>
            <td><b>${esc(r.type)}</b><div class="small muted">${esc(r.bed || '')}</div></td>
            <td>${money(r.price)}</td>
            <td>${r.capacity} คน/ห้อง</td>
            <td>${r.total_rooms} ห้อง</td>
            <td><div class="occ"><div class="occ-bar"><span style="width:${(r.occupiedToday / r.total_rooms) * 100}%"></span></div>${r.occupiedToday}/${r.total_rooms}</div></td>
            <td>${r.upcoming} รายการ</td>
            <td><button class="btn secondary sm" data-room="${r.id}">${ic('pencil', 14)} แก้ไข</button></td>
          </tr>`).join('')}
        </table></div>
      </div>`).join('')}`;

  $b.querySelectorAll('[data-room]').forEach((btn) => btn.addEventListener('click', () => {
    const r = rooms.find((x) => x.id === Number(btn.dataset.room)), h = hotels.find((x) => x.id === r.hotel_id);
    const m = modal(`
      <h2>แก้ไขห้อง ${esc(r.type)}</h2>
      <p class="muted small">${esc(h.name)}</p>
      <form id="rm">
        <div class="grid grid-3">
          <div class="field"><label>ราคาต่อคืน (บาท)</label><input type="number" name="price" min="1" step="10" value="${r.price}" required></div>
          <div class="field"><label>ความจุ (คน/ห้อง)</label><input type="number" name="capacity" min="1" max="20" value="${r.capacity}" required></div>
          <div class="field"><label>จำนวนห้อง</label><input type="number" name="total_rooms" min="1" max="500" value="${r.total_rooms}" required></div>
        </div>
        <div class="hint">ลดความจุหรือจำนวนห้องให้ต่ำกว่าการจองที่มีอยู่แล้วไม่ได้ · ราคาใหม่ใช้กับการจองใหม่เท่านั้น</div>
        <div class="row" style="justify-content:flex-end;margin-top:var(--space-4)"><button type="button" class="btn secondary" data-close>ยกเลิก</button><button class="btn">บันทึก</button></div>
      </form>`);
    const f = m.el.querySelector('#rm');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const res = await withButton(f.querySelector('button:not([type])'), () => api('PATCH', `/admin/rooms/${r.id}`, formData(f))); m.close(); toast(res.message, 'success'); adminHotels(); }
      catch (err) { toast(err.message, 'error'); }
    });
  }));
}

// ---------- รายงานผู้ใช้ ----------
async function adminReports() {
  const $b = await adminShell('reports', 'รายงานผู้ใช้ไม่เหมาะสม', 'จากฟีเจอร์จับคู่บัดดี้');
  const reports = await api('GET', '/admin/reports');
  $b.innerHTML = `<div class="card">
    ${reports.length ? `<div class="table-wrap"><table><tr><th>วันที่</th><th>ผู้รายงาน</th><th>ผู้ถูกรายงาน</th><th>เหตุผล</th><th>สถานะ</th><th></th></tr>
      ${reports.map((r) => `<tr>
        <td class="small">${fmtDateTime(r.created_at)}</td><td>${esc(r.reporter_name)}</td>
        <td>${esc(r.reported_name)} <span class="small muted">@${esc(r.reported_username)}</span>${r.buddy_enabled ? '' : '<div class="small" style="color:var(--danger)">ระงับฟีเจอร์บัดดี้แล้ว</div>'}</td>
        <td class="small">${esc(r.reason)}</td>
        <td><span class="pill ${r.status === 'open' ? 'pending' : 'confirmed'}">${r.status === 'open' ? 'รอตรวจสอบ' : 'ดำเนินการแล้ว'}</span></td>
        <td>${r.status === 'open' ? `<div class="row"><button class="btn danger sm" data-resolve="${r.id}" data-suspend="1">ระงับผู้ใช้</button><button class="btn secondary sm" data-resolve="${r.id}">ปิดเรื่อง</button></div>` : ''}</td>
      </tr>`).join('')}</table></div>` : `<div class="empty slim"><div class="icon">${ic('inbox', 30)}</div>ไม่มีรายงาน</div>`}
  </div>`;
  $b.querySelectorAll('[data-resolve]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await withButton(btn, () => api('POST', `/admin/reports/${btn.dataset.resolve}/resolve`, { suspend: !!btn.dataset.suspend })); toast('ดำเนินการแล้ว', 'success'); adminReports(); }
    catch (err) { toast(err.message, 'error'); }
  }));
}

// ================= Router =================
function requireLogin() {
  if (state.user) return true;
  toast('กรุณาเข้าสู่ระบบก่อน');
  go('#/login?next=' + encodeURIComponent(location.hash));
  return false;
}

async function router() {
  cleanup?.(); cleanup = null;
  document.getElementById('modal-root').innerHTML = '';
  document.body.classList.remove('admin-mode');
  $hero.innerHTML = '';
  const raw = location.hash.slice(1) || '/';
  const [path, qs = ''] = raw.split('?');
  const q = new URLSearchParams(qs);
  renderNav(path);
  window.scrollTo(0, 0);
  const seg = path.split('/').filter(Boolean);
  try {
    switch (seg[0]) {
      case undefined: return state.user?.role === 'admin' ? go('#/admin') : await homePage(q);
      case 'login': return await loginPage(q);
      case 'register': return await registerPage();
      case 'search': return await searchPage(q);
      case 'hotel': return await hotelPage(seg[1], q);
      case 'book': return await bookPage(q);
      case 'pay': return await payPage(seg[1]);
      case 'booking': return await bookingPage(seg[1]);
      case 'bookings': return await bookingsPage(q);
      case 'voucher': return await voucherPage(seg[1]);
      case 'buddy': return await buddyPage(q);
      case 'chat': return await chatPage(seg[1]);
      case 'notifications': return await notificationsPage();
      case 'admin': return await adminRouter(seg, q);
      default: $app.innerHTML = `<div class="empty"><div class="icon">${ic('compass', 40)}</div>ไม่พบหน้าที่ต้องการ<br><a href="#/">กลับหน้าแรก</a></div>`;
    }
  } catch (err) {
    if (err.status === 401) { state.user = null; return requireLogin(); }
    $app.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', router);
(async () => {
  try { state.user = (await api('GET', '/auth/me')).user; } catch { state.user = null; }
  await refreshUnread();
  router();
  setInterval(refreshUnread, 20000);
})();
