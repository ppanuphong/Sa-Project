// อัศวินรัตติกาล — เว็บจองโรงแรม + จับคู่บัดดี้ท่องเที่ยว
// รัน: npm start  แล้วเปิด http://localhost:3000
import { createServer } from 'node:http';
import handle from './src/app.js';

const PORT = Number(process.env.PORT) || 3000;

createServer(handle).listen(PORT, () => {
  const ai = process.env.AI_AGENT !== 'local' && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.AI_AGENT === 'claude');
  console.log(`🏨 อัศวินรัตติกาล พร้อมใช้งานที่ http://localhost:${PORT}`);
  console.log(`🤖 AI Agent จับคู่บัดดี้: ${ai ? 'Claude (claude-opus-5-5)' : 'โหมดกฎภายในเครื่อง (ตั้ง ANTHROPIC_API_KEY เพื่อใช้ Claude)'}`);
});
