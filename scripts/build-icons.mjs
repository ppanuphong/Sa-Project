// สร้าง public/js/icons.js จาก lucide-static (เฉพาะไอคอนที่ใช้) — รัน: npm run icons
import { readFileSync, writeFileSync } from 'node:fs';

const NAMES = [
  'hotel', 'bell', 'bell-off', 'circle-user', 'search', 'search-x', 'calendar-days', 'users', 'user', 'handshake',
  'badge-percent', 'shield-check', 'bot', 'sparkles', 'map-pin', 'check', 'bed-double', 'credit-card', 'qr-code',
  'circle-check', 'circle-x', 'info', 'undo-2', 'concierge-bell', 'luggage', 'pencil', 'file-text', 'star',
  'message-circle', 'list-checks', 'plane', 'flag', 'lock', 'compass', 'image', 'log-out', 'arrow-right',
  'wallet', 'arrow-up-down', 'chevron-down', 'smartphone', 'heart', 'arrow-down-narrow-wide', 'arrow-up-wide-narrow',
  'printer', 'ticket',
];

const icons = {};
for (const name of NAMES) {
  const svg = readFileSync(new URL(`../node_modules/lucide-static/icons/${name}.svg`, import.meta.url), 'utf8');
  icons[name] = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '');
}

writeFileSync(new URL('../public/js/icons.js', import.meta.url), `// ไอคอนจาก Lucide (https://lucide.dev) — ISC License · สร้างโดย scripts/build-icons.mjs
const ICONS = ${JSON.stringify(icons, null, 1)};

export function ic(name, size = 18, cls = '') {
  return \`<svg class="ic \${cls}" width="\${size}" height="\${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\${ICONS[name] || ''}</svg>\`;
}
`);
console.log(`icons.js: ${NAMES.length} ไอคอน`);
