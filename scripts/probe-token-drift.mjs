/**
 * Did the off-token text actually land on INK / ACCENT?
 *
 * Reads the rendered colour of each element that was changed, on the real page
 * rather than from source, and crops the dial so the hue shift can be looked at
 * rather than only asserted.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9790 + (process.pid % 40);
const INK = 'rgb(207, 202, 183)';
const ACCENT = 'rgb(221, 221, 174)';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/token-drift-${process.pid}`,
  '--window-size=1440,900',
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

const rows = [];
const record = (label, got, want) => rows.push({ label, got, want });

/* THE GRID — the confessions tally. */
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`!!document.querySelector('.grid-count')`)) break;
  await sleep(500);
}
await sleep(2500);
record(
  'confessions tally',
  await evaluate(`getComputedStyle(document.querySelector('.grid-count span')).color`),
  INK
);
record(
  'grid tile number (untouched control)',
  await evaluate(`getComputedStyle(document.querySelector('.grid-tile-num')).color`),
  'any'
);

/* Hover the sidebar accordion. */
const btn = await evaluate(`
  (() => {
    const b = document.querySelector('.facet-accordion-btn');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()
`);
if (btn) {
  /* Headless hover is unreliable, so read the rule out of the stylesheet
     instead of trying to provoke it. */
  record(
    'filter accordion :hover rule',
    await evaluate(`
      (() => {
        for (const sheet of document.styleSheets) {
          let rules; try { rules = sheet.cssRules; } catch { continue; }
          for (const r of rules || []) {
            if (r.selectorText === '.facet-accordion-btn:hover') return r.style.color;
          }
        }
        return 'rule not found';
      })()
    `),
    ACCENT
  );
}

/* THE EXPLORE DIAL — category wheel. */
await send('Page.navigate', { url: `${BASE}/?view=explore` });
await sleep(4000);
const dial = await evaluate(`
  (() => {
    /* Find the wheel by its colour rather than its shape: anything wearing the
       accent and carrying a word is a dial label, and if the change didn't take
       this comes back empty, which is itself the answer. */
    const lit = [...document.querySelectorAll('span, div')]
      .filter((s) => {
        const r = s.getBoundingClientRect();
        return r.width > 20 && r.height > 6 &&
          getComputedStyle(s).color === '${ACCENT}' &&
          s.textContent.trim().length > 2 && s.textContent.trim().length < 30;
      })
      .map((s) => ({
        text: s.textContent.trim(),
        color: getComputedStyle(s).color,
        r: s.getBoundingClientRect(),
      }));
    if (!lit.length) return null;
    const xs = lit.map((l) => l.r.x), ys = lit.map((l) => l.r.y);
    return {
      color: lit[0].color,
      sample: lit.slice(0, 3).map((l) => l.text),
      box: {
        x: Math.max(0, Math.min(...xs) - 20),
        y: Math.max(0, Math.min(...ys) - 20),
        w: Math.min(520, Math.max(...lit.map((l) => l.r.right)) - Math.min(...xs) + 40),
        h: Math.min(700, Math.max(...lit.map((l) => l.r.bottom)) - Math.min(...ys) + 40),
      },
    };
  })()
`);
if (dial) {
  record('explore dial labels', dial.color, ACCENT);
  // CDP wants width/height, not w/h — a silently-empty screenshot otherwise.
  const clip = { x: dial.box.x, y: dial.box.y, width: dial.box.w, height: dial.box.h, scale: 2 };
  const shot = Object.values(clip).every((v) => Number.isFinite(v) && v >= 0)
    ? await send('Page.captureScreenshot', { format: 'png', clip })
    : await send('Page.captureScreenshot', { format: 'png' });
  if (shot?.data) writeFileSync('/tmp/dial-tokens.png', Buffer.from(shot.data, 'base64'));
  else console.log(`  (screenshot failed; clip was ${JSON.stringify(clip)})`);
}

console.log(`\n═══ TEXT COLOUR AFTER THE FIX · ${BASE} ═══\n`);
for (const r of rows) {
  const checked = r.want !== 'any';
  const ok = r.got === r.want;
  console.log(`  ${!checked ? '·' : ok ? '✓' : '✗'} ${r.label.padEnd(36)} ${r.got}`);
  if (checked && !ok) console.log(`  ${''.padEnd(38)} wanted ${r.want}`);
}
if (dial) console.log(`\n  dial crop → /tmp/dial-tokens.png  (${dial.sample.join(', ')})`);
else console.log('\n  ✗ nothing on the explore view is wearing the accent');
console.log('');

chrome.kill();
ws.close();
process.exit(0);
