// Payment Gateway จำลอง (Mock) — โครงสร้างเหมือนการเรียก API ของผู้ให้บริการจริง
// บัตรทดสอบ:
//   4242 4242 4242 4242  → ชำระสำเร็จ
//   4000 0000 0000 0002  → บัตรถูกปฏิเสธ
//   4000 0000 0000 9995  → ยอดเงินไม่เพียงพอ
import { randomBytes } from 'node:crypto';

const ref = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function luhnValid(num) {
  let sum = 0, dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return num.length >= 13 && sum % 10 === 0;
}

function expiryValid(exp) {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(exp || '');
  if (!m) return false;
  const month = Number(m[1]), year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

/** ตัดบัตรเครดิต/เดบิต */
export async function chargeCard({ amount, card }) {
  await delay(600); // จำลองเวลาเรียก API
  const number = String(card?.number || '').replace(/\s+/g, '');
  if (!/^\d+$/.test(number) || !luhnValid(number)) return { status: 'failed', message: 'หมายเลขบัตรไม่ถูกต้อง' };
  if (!expiryValid(card?.exp)) return { status: 'failed', message: 'วันหมดอายุบัตรไม่ถูกต้องหรือบัตรหมดอายุแล้ว' };
  if (!/^\d{3,4}$/.test(String(card?.cvv || ''))) return { status: 'failed', message: 'รหัส CVV ไม่ถูกต้อง' };
  if (!card?.name?.trim()) return { status: 'failed', message: 'กรุณากรอกชื่อบนบัตร' };
  if (number.endsWith('0002')) return { status: 'failed', message: 'ธนาคารปฏิเสธการทำรายการ' };
  if (number.endsWith('9995')) return { status: 'failed', message: 'ยอดเงินในบัญชีไม่เพียงพอ' };
  return { status: 'success', transactionRef: ref('TXN'), message: `ตัดบัตรลงท้าย ${number.slice(-4)} สำเร็จ`, amount };
}

/** สร้างรายการ QR พร้อมเพย์ (จำลอง) */
export function createQrPayment({ amount }) {
  return { status: 'pending', transactionRef: ref('QR'), amount, expiresInSec: 900 };
}

/** ตรวจสอบผลการสแกน QR (จำลองว่าผู้ใช้สแกนจ่ายแล้ว) */
export async function verifyQrPayment({ transactionRef }) {
  await delay(500);
  return { status: 'success', transactionRef, message: 'ได้รับเงินผ่าน QR พร้อมเพย์แล้ว' };
}

/** คืนเงิน */
export async function refund({ amount, originalRef }) {
  await delay(300);
  return { status: 'success', transactionRef: ref('RFD'), message: `คืนเงิน ${amount} บาท (อ้างอิง ${originalRef || '-'})` };
}
