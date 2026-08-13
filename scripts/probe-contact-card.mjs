/**
 * How does the new contact card sit against the mailing list above it?
 *
 * Opens the About drawer, scrolls the column to the foot, and crops the two
 * slabs plus the credits under them so the three can be compared as one run.
 * Also reports each card's box and tilt, since the two slabs are meant to lean
 * against each other rather than share an angle.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9640 + (process.pid % 40);
const COMPACT = process.env.COMPACT === '1';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/contact-card-${process.pid}`,
  `--window-size=${COMPACT ? '414,896' : '1440,900'}`,
  '--force-device-scale-factor=2',
  'about:blank',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 80 && !page; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
  } catch {}
  if (!page) await sleep(100);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (e) =>
  (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))
    ?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
if (COMPACT) {
  /* --window-size alone doesn't reliably give a phone viewport in headless, and
     a card that fits a 500px "phone" tells you nothing. */
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
}
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`/EXPLORE/.test(document.body.textContent || '')`)) break;
  await sleep(500);
}
await sleep(2000);

/* Open the drawer. On a phone it lives behind the menu button first. */
const clickText = async (re) =>
  evaluate(`
    (() => {
      const el = [...document.querySelectorAll('button, a, [role="button"]')]
        .find((b) => ${re}.test((b.textContent || b.getAttribute('aria-label') || '').trim()));
      if (!el) return false;
      el.click();
      return true;
    })()
  `);
if (COMPACT) {
  await clickText('/menu/i');
  await sleep(900);
}
await clickText('/^about$/i');
await sleep(1800);

const body = await evaluate(`
  (() => {
    const b = document.querySelector('#about-panel-body');
    if (!b) return null;
    b.scrollTop = b.scrollHeight;
    return true;
  })()
`);
if (!body) {
  console.log('\n  about panel never opened\n');
  chrome.kill();
  ws.close();
  process.exit(0);
}
await sleep(900);

const cards = await evaluate(`
  (() => {
    const read = (sel, label) => {
      const el = document.querySelector(sel);
      if (!el) return { label, missing: true };
      const r = el.getBoundingClientRect();
      const t = getComputedStyle(el).transform;
      let deg = 0;
      const m = t.match(/matrix\\(([^)]+)\\)/);
      if (m) {
        const [a, b] = m[1].split(',').map(Number);
        deg = Math.round(Math.atan2(b, a) * (180 / Math.PI) * 100) / 100;
      }
      return {
        label,
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        deg,
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 90),
      };
    };
    return [
      read('.about-subscribe', 'mailing list'),
      read('.about-contact-card', 'contact card'),
      read('.about-credits-card', 'credits'),
    ];
  })()
`);

const vp = await evaluate(`
  ({ w: innerWidth, scrollW: document.documentElement.scrollWidth })
`);
console.log(`\n═══ CONTACT CARD · ${COMPACT ? 'phone' : 'desktop'} · ${BASE} ═══\n`);
console.log(`  viewport ${vp.w}px · document scroll width ${vp.scrollW}px` +
  `  ${vp.scrollW > vp.w ? '✗ overflows' : '✓ no horizontal overflow'}\n`);
for (const c of cards) {
  if (c.missing) {
    console.log(`  ✗ ${c.label} — not found`);
    continue;
  }
  console.log(`  ${c.label.padEnd(13)} ${String(c.w).padStart(4)}×${String(c.h).padStart(3)} at x${c.x}  tilt ${c.deg}°`);
  console.log(`  ${''.padEnd(13)} "${c.text}"`);
}
const [ml, cc] = cards;
if (!ml.missing && !cc.missing) {
  console.log(`\n  gap between the two slabs   ${cc.y - (ml.y + ml.h)}px`);
  console.log(`  same width                  ${ml.w === cc.w ? '✓' : `✗ ${ml.w} vs ${cc.w}`}`);
  console.log(`  leaning apart               ${Math.sign(ml.deg) !== Math.sign(cc.deg) ? '✓' : '✗ same direction'}`);
}

/* Label and value are meant to sit on one baseline. Compare the bottom of each
   one's text box rather than the element box, which the link's inline-block and
   the label's different casing both distort. */
const baselines = await evaluate(`
  (() => {
    const card = document.querySelector('.about-contact-card');
    if (!card) return [];
    const rows = [...card.querySelectorAll('div')].filter((d) => d.querySelector('a'));
    /* Control: the mailing list's own title row is a known-good baseline pair
       on a card tilted the OTHER way. If that reads as much drift with the
       opposite sign, the drift is the rotation and not the alignment. */
    const ml = document.querySelector('.about-subscribe > div');
    const ctrl = ml && ml.querySelector('p') && ml.querySelector('span')
      ? (() => {
          const b = (el) => {
            const r = document.createRange();
            r.selectNodeContents(el);
            return r.getBoundingClientRect().bottom;
          };
          return Math.round((b(ml.querySelector('span')) - b(ml.querySelector('p'))) * 10) / 10;
        })()
      : null;
    if (ctrl !== null) rows.ctrl = ctrl;
    const out = rows.map((row) => {
      const label = row.querySelector('span');
      const value = row.querySelector('a');
      const box = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10 };
      };
      const l = box(label), v = box(value);
      return {
        label: label.textContent.trim(),
        drift: Math.round((v.bottom - l.bottom) * 10) / 10,
        display: getComputedStyle(value).display,
      };
    });
    out.ctrl = rows.ctrl;
    return { rows: out, ctrl: rows.ctrl };
  })()
`);
if (baselines?.rows?.length) {
  console.log('');
  for (const b of baselines.rows) {
    console.log(`  ${b.label.padEnd(11)} value sits ${b.drift > 0 ? '+' : ''}${b.drift}px below the label (${b.display})`);
  }
  if (baselines.ctrl != null) {
    console.log(`  ${'CONTROL'.padEnd(11)} mailing list's own title row: ${baselines.ctrl > 0 ? '+' : ''}${baselines.ctrl}px`);
    const tilt = Math.sign(baselines.ctrl) !== Math.sign(baselines.rows[0].drift);
    console.log(
      `\n  ${tilt ? '✓ drift is the card tilt, not the alignment' : '✗ real baseline mismatch'}`
    );
  }
}

const clipTop = Math.max(0, Math.min(...cards.filter((c) => !c.missing).map((c) => c.y)) - 24);
const clipBot = Math.max(...cards.filter((c) => !c.missing).map((c) => c.y + c.h)) + 30;
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: {
    x: Math.max(0, ml.x - 26),
    y: clipTop,
    width: Math.min(560, ml.w + 52),
    height: Math.min(1400, clipBot - clipTop),
    scale: 2,
  },
});
const out = `scripts/contact-card${COMPACT ? '-phone' : ''}.png`;
if (shot?.data) {
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`\n  crop → ${out}`);
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
