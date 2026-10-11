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
    $nav.innerHTML = link('#/admin', 'แดชบอร์ดผู้ดูแล') + link('#/search', 'ค้นหาโรงแรม') + bell +
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
      <p class="small muted" style="margin-top:14px">ยังไม่มีบัญชี? <a href="#/register">สมัครสมาชิก</a></p>
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
      <p class="small muted" style="margin-top:14px">มีบัญชีแล้ว? <a href="#/login">เข้าสู่ระบบ</a></p>
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
const SORTS = [['rating', 'คะแนนรีวิวสูงสุด'], ['price_asc', 'ราคาต่ำสุดก่อน'], ['price_desc', 'ราคาสูงสุดก่อน']];
const PERK_CANCEL = 'ยกเลิกล่วงหน้า 7 วัน คืนเงินเต็มจำนวน';

const guestLabel = (g, r) => `ผู้เข้าพัก ${g} คน, ${r} ห้อง`;
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
        <label class="sbox-field"><span class="ico">${ic('calendar-days', 20)}</span><span><small>เช็คอิน</small><input type="date" name="checkIn" min="${todayISO()}" value="${ci}" required></span></label>
        <label class="sbox-field"><span class="ico">${ic('calendar-days', 20)}</span><span><small>เช็คเอาท์</small><input type="date" name="checkOut" min="${addDays(ci, 1)}" value="${co}" required></span></label>
        <div class="sbox-field guests" tabindex="0"><span class="ico">${ic('users', 20)}</span><span><small>ผู้เข้าพักและห้อง</small><b class="guest-label">${guestLabel(g, r)}</b></span>
          <input type="hidden" name="guests" value="${g}"><input type="hidden" name="rooms" value="${r}">
          <div class="guest-pop" hidden>
            <div class="stepper"><span>ห้อง</span><div><button type="button" data-k="rooms" data-d="-1">−</button><output data-o="rooms">${r}</output><button type="button" data-k="rooms" data-d="1">+</button></div></div>
            <div class="stepper"><span>ผู้เข้าพัก</span><div><button type="button" data-k="guests" data-d="-1">−</button><output data-o="guests">${g}</output><button type="button" data-k="guests" data-d="1">+</button></div></div>
            <button type="button" class="btn sm block" data-done style="margin-top:8px">เสร็จสิ้น</button>
          </div>
        </div>
      </div>
      <button class="btn sbox-go">ค้นหา</button>
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
  f.checkIn.addEventListener('change', () => {
    f.checkOut.min = addDays(f.checkIn.value, 1);
    if (f.checkOut.value <= f.checkIn.value) f.checkOut.value = addDays(f.checkIn.value, 1);
  });

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
        <div class="sortbar"><span>เรียงตาม</span>${SORTS.map(([k, l]) => `<button type="button" data-sort="${k}" class="${k === sort ? 'active' : ''}">${l}</button>`).join('')}</div>
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
              <span class="btn" style="margin-top:6px">ดูห้องว่าง</span>
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
        <p style="margin-top:10px">${esc(h.description)}</p>
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
                <li class="ok">${ic('check', 15)} ชำระด้วยบัตรหรือ QR พร้อมเพย์</li>
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
              <div style="margin-top:6px">${ok
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
            <div><span class="mini-score">${(rv.rating * 2).toFixed(1)}</span><b>${scoreLabel(rv.rating)}</b><p style="margin-top:6px">${esc(rv.comment) || '<span class="muted">-</span>'}</p></div>
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
      <div class="row between" style="margin-top:12px"><button class="btn secondary sm" id="lb-prev">‹ ก่อนหน้า</button><b id="lb-count">${i + 1} / ${shots.length}</b><button class="btn secondary sm" id="lb-next">ถัดไป ›</button><button class="btn sm" data-close>ปิด</button></div>`, { wide: true });
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
        <h3 style="margin-top:8px">ความต้องการพิเศษ</h3>
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
        <button class="btn block" style="margin-top:16px">ยืนยันการจองและไปหน้าชำระเงิน →</button>
      </form>
      <div class="summary"><div class="card">
        ${cover(h.hue, h.icon, h.photos)}
        <h3 style="margin-top:12px">${esc(h.name)}</h3>
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
        <div class="tabs" id="method">
          <button type="button" data-m="card" class="active">${ic('credit-card')} บัตรเครดิต/เดบิต</button>
          <button type="button" data-m="qr">${ic('qr-code')} QR พร้อมเพย์</button>
        </div>
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
        <a class="btn block" href="#/booking/${b.id}">ดูใบยืนยันการจอง</a>`;
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
          <p style="margin-top:12px"><b>${money(qr.amount)}</b><br><span class="small muted">อ้างอิง ${esc(qr.transactionRef)} · หมดอายุใน 15 นาที</span></p>
          <p class="small muted">สแกนด้วยแอปธนาคารเพื่อชำระเงิน (QR จำลองสำหรับระบบทดสอบ)</p>
          <button class="btn" id="qr-done">ฉันชำระเงินแล้ว — ตรวจสอบสถานะ</button>
        </div>`;
      document.getElementById('qr-done').addEventListener('click', async (e) => {
        try { showResult(await withButton(e.target, () => api('POST', `/payments/${qr.paymentId}/qr-confirm`))); }
        catch (err) { $err.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
      });
    } catch (err) { $body.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  };

  document.getElementById('method').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-m]');
    if (!btn) return;
    document.querySelectorAll('#method button').forEach((x) => x.classList.toggle('active', x === btn));
    $err.innerHTML = '';
    btn.dataset.m === 'card' ? renderCard() : renderQr();
  });
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
  const canEdit = ['pending', 'confirmed'].includes(b.status);

  $app.innerHTML = `
    <p><a href="${isAdmin ? '#/admin' : '#/bookings'}">← ${isAdmin ? 'กลับแดชบอร์ด' : 'การจองทั้งหมดของฉัน'}</a></p>
    <div class="two-col">
      <div>
        <div class="card">
          <div class="row between">
            <div><div class="small muted">รหัสการจอง</div><div class="code-big">${esc(b.code)}</div></div>
            ${statusPill(b.status)}
          </div>
          ${b.status !== 'cancelled' ? timeline(b) : `<div class="alert error" style="margin-top:12px">การจองนี้ถูกยกเลิกเมื่อ ${fmtDateTime(b.cancelled_at)}</div>`}
          ${b.status === 'pending' ? `<div class="alert warning" style="margin-top:12px">รอชำระเงิน ${money(b.amount_due)} เพื่อยืนยันการจอง</div>` : ''}
          ${b.status === 'confirmed' ? `<div class="alert success" style="margin-top:12px">${ic('circle-check', 16)} การจองได้รับการยืนยันแล้ว — แสดงรหัสการจองนี้ที่เคาน์เตอร์เมื่อเช็คอิน</div>` : ''}
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
        <div class="card" id="review-card"></div>
        <div class="card">
          <h3>ประวัติการชำระเงิน</h3>
          ${b.payments.length ? `<div class="table-wrap"><table><tr><th>วันที่</th><th>รายการ</th><th>จำนวน</th><th>สถานะ</th><th>อ้างอิง</th></tr>
            ${b.payments.map((p) => `<tr><td>${fmtDateTime(p.created_at)}</td><td>${p.kind === 'refund' ? `${ic('undo-2', 15)} คืนเงิน` : p.method === 'qr' ? `${ic('qr-code', 15)} QR` : `${ic('credit-card', 15)} บัตร`}<div class="small muted">${esc(p.message || '')}</div></td>
              <td>${p.kind === 'refund' ? '-' : ''}${money(p.amount)}</td>
              <td><span class="pill ${p.status === 'success' ? 'confirmed' : p.status === 'failed' ? 'cancelled' : 'pending'}">${{ success: 'สำเร็จ', failed: 'ไม่สำเร็จ', pending: 'รอดำเนินการ' }[p.status]}</span></td>
              <td class="small">${esc(p.transaction_ref || '-')}</td></tr>`).join('')}</table></div>` : '<p class="muted small">ยังไม่มีรายการ</p>'}
        </div>
      </div>
      <div class="summary">
        <div class="card">
          ${cover(b.hue, b.icon, b.photos)}
          <div class="line" style="margin-top:12px"><span>ราคารวม</span><b>${money(b.total_price)}</b></div>
          <div class="line"><span>ชำระแล้ว (สุทธิ)</span><span>${money(b.paid_amount)}</span></div>
          ${b.amount_due > 0 && b.status === 'pending' ? `<div class="line total"><span>คงค้าง</span><span>${money(b.amount_due)}</span></div>` : ''}
          <div class="stack" style="margin-top:14px" id="actions">
            ${b.status === 'pending' && !isAdmin ? `<a class="btn block" href="#/pay/${b.id}">${ic('credit-card')} ชำระเงิน</a>` : ''}
            ${b.status === 'confirmed' ? `<button class="btn block" data-act="checkin">${ic('concierge-bell')} เช็คอิน</button>` : ''}
            ${b.status === 'checked_in' ? `<button class="btn block" data-act="checkout">${ic('luggage')} เช็คเอาท์</button>` : ''}
            ${canEdit && !isAdmin ? `<button class="btn secondary block" data-act="edit">${ic('pencil')} แก้ไขวันเข้าพัก</button>` : ''}
            ${canEdit && !isAdmin ? `<button class="btn ghost block" style="color:var(--danger)" data-act="cancel">ยกเลิกการจอง</button>` : ''}
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
        <div class="field" style="margin-top:10px"><textarea name="comment" placeholder="เล่าประสบการณ์การเข้าพักของคุณ..."></textarea></div>
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
    if (act === 'edit') editDatesModal(b);
    if (act === 'cancel') cancelModal(b);
  });
}

function editDatesModal(b) {
  const m = modal(`
    <h2>แก้ไขวันเข้าพัก</h2>
    <p class="muted small">${esc(b.hotel_name)} · ${esc(b.room_type)} × ${b.rooms_count} ห้อง</p>
    <form id="ed">
      <div class="grid grid-2">
        <div class="field"><label>เช็คอินใหม่</label><input type="date" name="checkIn" min="${todayISO()}" value="${b.check_in}" required></div>
        <div class="field"><label>เช็คเอาท์ใหม่</label><input type="date" name="checkOut" min="${addDays(b.check_in, 1)}" value="${b.check_out}" required></div>
      </div>
      <div id="qt" class="card" style="box-shadow:none;background:var(--surface-2)"></div>
      <div class="row" style="justify-content:flex-end;margin-top:16px">
        <button type="button" class="btn secondary" data-close>ยกเลิก</button>
        <button class="btn" id="save" disabled>บันทึกการแก้ไข</button>
      </div>
    </form>`);
  const f = m.el.querySelector('#ed'), $qt = m.el.querySelector('#qt'), $save = m.el.querySelector('#save');
  const preview = async () => {
    if (f.checkOut.value <= f.checkIn.value) f.checkOut.value = addDays(f.checkIn.value, 1);
    f.checkOut.min = addDays(f.checkIn.value, 1);
    try {
      const q = await api('GET', `/bookings/${b.id}/quote?checkIn=${f.checkIn.value}&checkOut=${f.checkOut.value}`);
      const unchanged = f.checkIn.value === b.check_in && f.checkOut.value === b.check_out;
      $save.disabled = !q.available || unchanged;
      $qt.innerHTML = `
        <div class="line"><span>${q.nights} คืน × ${b.rooms_count} ห้อง</span><span>${money(q.subtotal)}</span></div>
        ${q.discount ? `<div class="line discount"><span>${q.promo}</span><span>-${money(q.discount)}</span></div>` : ''}
        <div class="line total"><span>ราคาใหม่</span><span>${money(q.total)}</span></div>
        <div class="line"><span>ชำระแล้ว</span><span>${money(q.paid)}</span></div>
        ${!q.available ? `<div class="alert error" style="margin:8px 0 0">ห้องไม่ว่างในช่วงวันที่นี้</div>`
          : q.paid > 0 && q.difference > 0 ? `<div class="alert warning" style="margin:8px 0 0">ต้องชำระส่วนต่างเพิ่ม ${money(q.difference)}</div>`
          : q.difference < 0 && q.paid > 0 ? `<div class="alert success" style="margin:8px 0 0">จะได้รับเงินคืนส่วนต่าง ${money(-q.difference)}</div>` : ''}`;
    } catch (err) { $save.disabled = true; $qt.innerHTML = `<div class="alert error" style="margin:0">${esc(err.message)}</div>`; }
  };
  f.addEventListener('change', preview);
  preview();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await withButton($save, () => api('PATCH', `/bookings/${b.id}`, formData(f)));
      m.close(); toast(r.message, 'success'); refreshUnread();
      r.booking.status === 'pending' ? go(`#/pay/${b.id}`) : bookingPage(b.id);
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function cancelModal(b) {
  const p = await api('GET', `/bookings/${b.id}/refund-preview`);
  const m = modal(`
    <h2>ยกเลิกการจอง ${esc(b.code)}?</h2>
    <p class="muted">เหลืออีก ${p.daysBefore} วันก่อนวันเช็คอิน</p>
    <div class="card" style="box-shadow:none;background:var(--surface-2)">
      <div class="small">${ic('file-text', 15)} ${esc(p.rule)}</div>
      <div class="line" style="margin-top:8px"><span>ยอดที่ชำระแล้ว</span><span>${money(p.paid)}</span></div>
      <div class="line"><span>อัตราคืนเงิน</span><span>${p.percent}%</span></div>
      <div class="line total"><span>ยอดเงินที่จะได้รับคืน</span><span style="color:var(--success)">${money(p.refund)}</span></div>
    </div>
    <p class="small muted" style="margin-top:10px">เงินจะถูกคืนเข้าช่องทางเดิมภายใน 7–14 วันทำการ</p>
    <div class="row" style="justify-content:flex-end;margin-top:16px">
      <button class="btn secondary" data-close>ไม่ยกเลิก</button>
      <button class="btn danger" id="yes">ยืนยันการยกเลิก</button>
    </div>`);
  m.el.querySelector('#yes').addEventListener('click', async (e) => {
    try {
      const r = await withButton(e.target, () => api('POST', `/bookings/${b.id}/cancel`));
      m.close(); toast(`ยกเลิกแล้ว${r.policy.refund ? ` คืนเงิน ${money(r.policy.refund)}` : ''}`, 'success'); refreshUnread(); bookingPage(b.id);
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function bookingsPage(q) {
  if (!requireLogin()) return;
  loading();
  const all = await api('GET', '/bookings');
  const tab = q.get('tab') || 'upcoming';
  const groups = {
    upcoming: all.filter((b) => ['pending', 'confirmed', 'checked_in'].includes(b.status)),
    past: all.filter((b) => b.status === 'checked_out'),
    cancelled: all.filter((b) => b.status === 'cancelled'),
  };
  const list = groups[tab];
  $app.innerHTML = `
    <h1>การจองของฉัน</h1>
    <div class="tabs" style="max-width:520px">
      ${[['upcoming', 'กำลังจะมาถึง'], ['past', 'เข้าพักแล้ว'], ['cancelled', 'ยกเลิก']].map(([k, l]) =>
        `<button class="${k === tab ? 'active' : ''}" onclick="location.hash='#/bookings?tab=${k}'">${l} (${groups[k].length})</button>`).join('')}
    </div>
    ${list.length ? list.map((b) => `
      <div class="card booking-row">
        ${cover(b.hue, b.icon, b.photos)}
        <div>
          <div class="row"><b>${esc(b.hotel_name)}</b>${statusPill(b.status)}</div>
          <div class="small muted">${esc(b.code)} · ${esc(b.room_type)} × ${b.rooms_count} · ${fmtDate(b.check_in)} – ${fmtDate(b.check_out)} (${nights(b.check_in, b.check_out)} คืน)</div>
          <div class="small">ราคารวม <b>${money(b.total_price)}</b></div>
        </div>
        <div class="row">
          ${b.status === 'pending' ? `<a class="btn sm" href="#/pay/${b.id}">ชำระเงิน</a>` : ''}
          ${b.status === 'checked_out' && !b.reviewed ? `<a class="btn sm" href="#/booking/${b.id}">${ic('star', 15)} รีวิว</a>` : ''}
          <a class="btn secondary sm" href="#/booking/${b.id}">${['pending', 'confirmed'].includes(b.status) ? 'จัดการ' : 'รายละเอียด'}</a>
        </div>
      </div>`).join('')
      : `<div class="card empty"><div class="icon">${ic('luggage', 40)}</div>ยังไม่มีการจองในหมวดนี้<br><a class="btn" style="margin-top:12px" href="#/search">ค้นหาโรงแรม</a></div>`}`;
}

// ================= Pages: Buddy =================
const INTEREST_PRESETS = ['คาเฟ่', 'อาหาร', 'ตลาดกลางคืน', 'ถ่ายรูป', 'เดินป่า', 'ธรรมชาติ', 'ทะเล', 'ดำน้ำ', 'ปีนเขา', 'วัฒนธรรม', 'วัด', 'ช้อปปิ้ง', 'ปั่นจักรยาน', 'Co-working', 'ปาร์ตี้', 'สปา'];

async function buddyPage() {
  if (!requireLogin()) return;
  loading();
  const [me, matches] = await Promise.all([api('GET', '/buddy/profile'), api('GET', '/buddy/matches')]);
  const interests = new Set(me.interests);
  const allInterests = [...new Set([...INTEREST_PRESETS, ...me.interests])];

  $app.innerHTML = `
    <h1>จับคู่บัดดี้ท่องเที่ยว</h1>
    <p class="muted">หาเพื่อนร่วมทริปที่ไปเที่ยวที่เดียวกัน ช่วงเวลาเดียวกัน และชอบอะไรคล้ายกัน</p>
    <div class="buddy-layout">
      <form class="card" id="profile">
        <h3>โปรไฟล์ของฉัน</h3>
        <label class="switch"><input type="checkbox" name="buddy_enabled" ${me.buddy_enabled ? 'checked' : ''}> เปิดใช้งานการจับคู่บัดดี้</label>
        <p class="hint">เมื่อเปิด ผู้ใช้อื่นจะเห็นชื่อ อายุ ความสนใจ และทริปของคุณ</p>
        <div class="grid grid-2" style="margin-top:12px">
          <div class="field"><label>เพศ</label><select name="gender">${['', 'ชาย', 'หญิง', 'LGBTQ+', 'ไม่ระบุ'].map((g) => `<option ${me.gender === g ? 'selected' : ''} value="${g}">${g || '-'}</option>`).join('')}</select></div>
          <div class="field"><label>อายุ</label><input type="number" name="age" min="18" max="99" value="${me.age || ''}"></div>
        </div>
        <div class="field"><label>สไตล์การเที่ยว</label><select name="travel_style">${['', 'ชิล ๆ', 'ลุย ๆ', 'ผจญภัย', 'หรูหรา', 'ประหยัด'].map((s) => `<option ${me.travel_style === s ? 'selected' : ''} value="${s}">${s || '-'}</option>`).join('')}</select></div>
        <div class="field"><label>ความสนใจ</label>
          <div class="chips" id="chips">${allInterests.map((i) => `<button type="button" class="chip ${interests.has(i) ? 'on' : ''}" data-i="${esc(i)}">${esc(i)}</button>`).join('')}</div>
          <div class="row" style="margin-top:8px;flex-wrap:nowrap"><input id="new-interest" placeholder="เพิ่มความสนใจอื่น ๆ"><button type="button" class="btn secondary sm" id="add-interest">เพิ่ม</button></div>
        </div>
        <div class="field"><label>แนะนำตัว</label><textarea name="bio" maxlength="300" placeholder="เล่าเกี่ยวกับตัวคุณและสไตล์การเที่ยว">${esc(me.bio || '')}</textarea></div>
        <button class="btn block">บันทึกโปรไฟล์</button>
      </form>

      <div>
        <div class="ai-banner">
          <div class="icon">${ic('bot', 30)}</div>
          <div style="flex:1"><b>AI Agent จับคู่บัดดี้</b><div class="small muted">วิเคราะห์ทริปที่จองไว้ ความสนใจ และสไตล์การเที่ยว เพื่อประเมินความเข้ากันได้</div></div>
          <button class="btn" id="suggest" ${me.buddy_enabled ? '' : 'disabled'}>${ic('sparkles')} หาบัดดี้ให้ฉัน</button>
        </div>
        <div id="suggestions">${me.buddy_enabled ? '' : '<div class="alert info">เปิดใช้งานการจับคู่และเลือกความสนใจในโปรไฟล์ก่อน แล้วกดบันทึก</div>'}</div>

        <div class="card">
          <h3>คำขอที่ได้รับ (${matches.incoming.length})</h3>
          ${matches.incoming.length ? matches.incoming.map((m) => `
            <div class="buddy-card" style="margin-top:12px">
              ${avatar(m.other.name)}
              <div>
                <b>${esc(m.other.name)}</b> <span class="muted small">${m.other.age ? m.other.age + ' ปี' : ''} ${esc(m.other.gender || '')}</span>
                <div class="small">${esc(m.other.bio || '')}</div>
                <div>${m.other.interests.map((i) => `<span class="tag">${esc(i)}</span>`).join('')}</div>
                ${m.reason ? `<div class="ai-reason">${ic('bot', 15)} ${esc(m.reason)}</div>` : ''}
              </div>
              <div class="stack">
                <button class="btn sm" data-respond="${m.id}" data-accept="1">${ic('check', 15)} ยืนยันจับคู่</button>
                <button class="btn secondary sm" data-respond="${m.id}" data-accept="0">ปฏิเสธ</button>
              </div>
            </div>`).join('') : '<p class="muted small">ยังไม่มีคำขอใหม่</p>'}
        </div>

        <div class="card">
          <h3>บัดดี้ของฉัน (${matches.accepted.length})</h3>
          ${matches.accepted.length ? matches.accepted.map((m) => `
            <a class="row" href="#/chat/${m.id}" style="color:inherit;padding:10px 0;border-top:1px solid var(--border);flex-wrap:nowrap;text-decoration:none">
              ${avatar(m.other.name, 'sm')}
              <div style="flex:1;min-width:0"><b>${esc(m.other.name)}</b>
                <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.last_message ? esc(m.last_message.text) : 'เริ่มบทสนทนาได้เลย'}</div></div>
              <span class="btn secondary sm">${ic('message-circle', 15)} แชท</span>
            </a>`).join('') : '<p class="muted small">ยังไม่มีบัดดี้ ลองให้ AI Agent ช่วยหาดูสิ</p>'}
        </div>

        ${matches.outgoing.length ? `<div class="card"><h3>คำขอที่ส่งไปแล้ว (รอการตอบรับ)</h3>
          ${matches.outgoing.map((m) => `<div class="row" style="padding:6px 0">${avatar(m.other.name, 'sm')}<b>${esc(m.other.name)}</b><span class="pill pending">รอตอบรับ</span></div>`).join('')}</div>` : ''}
      </div>
    </div>`;

  // โปรไฟล์
  const f = document.getElementById('profile');
  const chips = document.getElementById('chips');
  chips.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    c.classList.toggle('on');
    c.classList.contains('on') ? interests.add(c.dataset.i) : interests.delete(c.dataset.i);
  });
  document.getElementById('add-interest').addEventListener('click', () => {
    const inp = document.getElementById('new-interest');
    const v = inp.value.trim();
    if (!v || interests.has(v)) return;
    interests.add(v);
    chips.insertAdjacentHTML('beforeend', `<button type="button" class="chip on" data-i="${esc(v)}">${esc(v)}</button>`);
    inp.value = '';
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(f);
    try {
      state.user = await withButton(f.querySelector('button.btn.block'), () => api('PUT', '/buddy/profile', { ...d, buddy_enabled: !!d.buddy_enabled, interests: [...interests] }));
      toast('บันทึกโปรไฟล์แล้ว', 'success');
      buddyPage();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ตอบรับ/ปฏิเสธ
  $app.querySelectorAll('[data-respond]').forEach((btn) => btn.addEventListener('click', async () => {
    const accept = btn.dataset.accept === '1';
    try {
      await withButton(btn, () => api('POST', `/buddy/matches/${btn.dataset.respond}/respond`, { accept }));
      toast(accept ? 'จับคู่สำเร็จ! เริ่มแชทได้เลย' : 'ปฏิเสธคำขอแล้ว', accept ? 'success' : '');
      accept ? go(`#/chat/${btn.dataset.respond}`) : buddyPage();
    } catch (err) { toast(err.message, 'error'); }
  }));

  // AI Agent
  document.getElementById('suggest').addEventListener('click', async (e) => {
    const $s = document.getElementById('suggestions');
    $s.innerHTML = `<div class="card loading"><div class="spinner"></div>AI Agent กำลังวิเคราะห์โปรไฟล์และทริปของคุณ...</div>`;
    try {
      const r = await withButton(e.target, () => api('POST', '/buddy/suggest'));
      const scoreRing = (s) => `<div class="score" style="background:conic-gradient(var(--primary) ${s * 3.6}deg, var(--surface-2) 0)"><div style="position:absolute;inset:6px;background:var(--surface);border-radius:50%"></div><span>${s}<small>คะแนน</small></span></div>`;
      $s.innerHTML = `<div class="card">
        <div class="row between"><h3>บัดดี้ที่แนะนำสำหรับคุณ</h3><span class="pill">${r.engine === 'claude' ? `${ic('sparkles', 14)} วิเคราะห์โดย Claude AI` : `${ic('list-checks', 14)} วิเคราะห์ด้วยกฎภายในระบบ`}</span></div>
        ${!r.me.trips.length ? `<div class="alert info small">คุณยังไม่มีทริปที่จองไว้ ผลการจับคู่จะอิงจากความสนใจเป็นหลัก — <a href="#/search">จองโรงแรม</a> เพื่อให้จับคู่ได้แม่นยำขึ้น</div>` : ''}
        ${r.suggestions.length ? r.suggestions.map((s) => `
          <div class="buddy-card" style="padding-top:14px;border-top:1px solid var(--border)">
            ${avatar(s.user.name)}
            <div>
              <b>${esc(s.user.name)}</b> <span class="muted small">${s.user.age ? s.user.age + ' ปี' : ''} ${esc(s.user.gender || '')} ${s.user.travel_style ? '· ' + esc(s.user.travel_style) : ''}</span>
              <div class="small">${esc(s.user.bio || '')}</div>
              <div>${s.user.interests.map((i) => `<span class="tag">${esc(i)}</span>`).join('')}</div>
              ${s.trips.length ? `<div class="small muted">${ic('plane', 14)} ${s.trips.map((t) => `${esc(t.city)} ${fmtDate(t.check_in)}–${fmtDate(t.check_out)}`).join(' · ')}</div>` : ''}
              <div class="ai-reason">${ic('bot', 15)} ${esc(s.reason)}</div>
              <div class="row" style="margin-top:10px">
                <button class="btn sm" data-req="${s.user.id}" data-score="${s.score}" data-reason="${esc(s.reason)}">${ic('handshake', 15)} ส่งคำขอจับคู่</button>
                <button class="btn ghost sm" data-report="${s.user.id}" data-name="${esc(s.user.name)}">${ic('flag', 15)} รายงาน</button>
              </div>
            </div>
            ${scoreRing(s.score)}
          </div>`).join('') : '<p class="muted">ยังไม่พบผู้ใช้ที่เหมาะสมในตอนนี้ ลองเพิ่มความสนใจหรือจองทริปเพิ่ม</p>'}
      </div>`;
      $s.querySelectorAll('[data-req]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await withButton(b, () => api('POST', '/buddy/request', { userId: Number(b.dataset.req), score: Number(b.dataset.score), reason: b.dataset.reason }));
          b.innerHTML = `${ic('check', 15)} ส่งคำขอแล้ว`; b.disabled = true;
          toast('ส่งคำขอจับคู่แล้ว รอการตอบรับ', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }));
      $s.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => reportModal(Number(b.dataset.report), b.dataset.name, () => buddyPage())));
    } catch (err) {
      $s.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
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
        <div style="flex:1"><b>${esc(o.name)}</b><div class="small muted">${o.interests.map(esc).join(' · ')}</div></div>
        <button class="btn ghost sm" id="report">${ic('flag', 15)} รายงาน</button>
      </div>
      <div class="chat-body" id="msgs"><div class="muted small" style="text-align:center">${ic('lock', 13)} แชทนี้เห็นเฉพาะคุณและ ${esc(o.name)} · อย่าแชร์ข้อมูลส่วนตัวที่ละเอียดอ่อน</div></div>
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
  append(data.messages);
  $msgs.scrollTop = $msgs.scrollHeight;

  const poll = setInterval(async () => {
    try { append((await api('GET', `/buddy/matches/${id}/messages?after=${lastId}`)).messages); } catch { /* ignore */ }
  }, 3000);
  cleanup = () => clearInterval(poll);

  document.getElementById('send').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.text;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await api('POST', `/buddy/matches/${id}/messages`, { text });
      append((await api('GET', `/buddy/matches/${id}/messages?after=${lastId}`)).messages);
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
async function adminPage(q) {
  if (!requireLogin()) return;
  if (state.user.role !== 'admin') { $app.innerHTML = `<div class="alert error">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div>`; return; }
  loading();
  const status = q.get('status') || '';
  const [stats, bookings, reports] = await Promise.all([
    api('GET', '/admin/stats'), api('GET', `/admin/bookings?status=${status}`), api('GET', '/admin/reports'),
  ]);
  const count = (s) => stats.bookings.find((x) => x.status === s)?.n || 0;
  $app.innerHTML = `
    <h1>แดชบอร์ดผู้ดูแลระบบ</h1>
    <div class="grid grid-4">
      <div class="card stat"><div class="small muted">รายได้สุทธิ</div><div class="num">${money(stats.revenue)}</div></div>
      <div class="card stat"><div class="small muted">ลูกค้าทั้งหมด</div><div class="num">${stats.users}</div></div>
      <div class="card stat"><div class="small muted">รอเช็คอิน / พักอยู่</div><div class="num">${count('confirmed')} / ${count('checked_in')}</div></div>
      <div class="card stat"><div class="small muted">รายงานที่รอตรวจสอบ</div><div class="num" style="color:${stats.openReports ? 'var(--danger)' : ''}">${stats.openReports}</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="row between"><h2>การจองทั้งหมด</h2>
        <select id="st" style="width:auto">${[['', 'ทุกสถานะ'], ...Object.entries(STATUS)].map(([k, l]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="table-wrap"><table>
        <tr><th>รหัส</th><th>ลูกค้า</th><th>โรงแรม / ห้อง</th><th>วันที่เข้าพัก</th><th>ยอด</th><th>สถานะ</th><th></th></tr>
        ${bookings.map((b) => `<tr>
          <td><a href="#/booking/${b.id}">${esc(b.code)}</a></td>
          <td>${esc(b.guest_name)}<div class="small muted">@${esc(b.username)}</div></td>
          <td>${esc(b.hotel_name)}<div class="small muted">${esc(b.room_type)} × ${b.rooms_count}</div></td>
          <td class="small">${fmtDate(b.check_in)} – ${fmtDate(b.check_out)}</td>
          <td>${money(b.total_price)}</td>
          <td>${statusPill(b.status)}</td>
          <td>${b.status === 'confirmed' ? `<button class="btn sm" data-act="checkin" data-id="${b.id}">เช็คอิน</button>` : b.status === 'checked_in' ? `<button class="btn sm" data-act="checkout" data-id="${b.id}">เช็คเอาท์</button>` : ''}</td>
        </tr>`).join('')}
      </table></div>
    </div>
    <div class="card">
      <h2>รายงานผู้ใช้ไม่เหมาะสม</h2>
      ${reports.length ? `<div class="table-wrap"><table><tr><th>วันที่</th><th>ผู้รายงาน</th><th>ผู้ถูกรายงาน</th><th>เหตุผล</th><th>สถานะ</th><th></th></tr>
        ${reports.map((r) => `<tr>
          <td class="small">${fmtDateTime(r.created_at)}</td><td>${esc(r.reporter_name)}</td>
          <td>${esc(r.reported_name)} <span class="small muted">@${esc(r.reported_username)}</span>${r.buddy_enabled ? '' : '<div class="small" style="color:var(--danger)">ระงับฟีเจอร์บัดดี้แล้ว</div>'}</td>
          <td class="small">${esc(r.reason)}</td>
          <td><span class="pill ${r.status === 'open' ? 'pending' : 'confirmed'}">${r.status === 'open' ? 'รอตรวจสอบ' : 'ดำเนินการแล้ว'}</span></td>
          <td>${r.status === 'open' ? `<div class="row"><button class="btn danger sm" data-resolve="${r.id}" data-suspend="1">ระงับผู้ใช้</button><button class="btn secondary sm" data-resolve="${r.id}">ปิดเรื่อง</button></div>` : ''}</td>
        </tr>`).join('')}</table></div>` : '<p class="muted">ไม่มีรายงาน</p>'}
    </div>`;

  document.getElementById('st').addEventListener('change', (e) => go('#/admin' + (e.target.value ? `?status=${e.target.value}` : '')));
  $app.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await withButton(btn, () => api('POST', `/bookings/${btn.dataset.id}/${btn.dataset.act}`)); toast('อัปเดตสถานะการจองแล้ว', 'success'); adminPage(q); }
    catch (err) { toast(err.message, 'error'); }
  }));
  $app.querySelectorAll('[data-resolve]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await withButton(btn, () => api('POST', `/admin/reports/${btn.dataset.resolve}/resolve`, { suspend: !!btn.dataset.suspend })); toast('ดำเนินการแล้ว', 'success'); adminPage(q); }
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
      case 'buddy': return await buddyPage();
      case 'chat': return await chatPage(seg[1]);
      case 'notifications': return await notificationsPage();
      case 'admin': return await adminPage(q);
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
