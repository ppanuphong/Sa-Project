// Notification Service — บันทึกการแจ้งเตือนในระบบ และจำลองการส่งอีเมล/SMS (พิมพ์ลง console)
import { db } from '../db.js';

export function notify(userId, { title, message, link = null, channels = ['in_app', 'email'] }) {
  db.prepare('INSERT INTO notifications (user_id, title, message, channel, link) VALUES (?,?,?,?,?)')
    .run(userId, title, message, channels.join(','), link);

  const user = db.prepare('SELECT email, phone FROM users WHERE id = ?').get(userId);
  if (channels.includes('email') && user?.email) {
    console.log(`📧 [EMAIL → ${user.email}] ${title}: ${message}`);
  }
  if (channels.includes('sms') && user?.phone) {
    console.log(`📱 [SMS → ${user.phone}] ${title}: ${message}`);
  }
}
