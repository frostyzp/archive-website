/**
 * Is the note's LOCATION value rendered in caps on both viewers, and did the
 * row width hold?
 *
 * Width matters as much as case here: the DATE / LOCATION block is a fixed
 * scaffold sitting over the card, so a value that grows on transform would
 * shift the divider. Courier is monospace and shouldn't, but this measures it
 * rather than assuming. Checks EXPLORE (NoteMeta) and INDEX (the lightbox,
 * which wears the same exported style).
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9370 + (process.pid % 40);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/meta-caps-${process.pid}`,
  '--window-size=1440,900',
  '--force-device-scale-factor=1',
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

/** Find the LOCATION label, then read the sibling that carries the value. */
const READ = `
  (() => {
    const labels = [...document.querySelectorAll('span')].filter(
      (s) => (s.textContent || '').trim() === 'LOCATION'
    );
    return labels.map((label) => {
      const row = label.parentElement;
      const value = [...row.children].find((el) => el !== label);
      if (!value) return null;
      const cs = getComputedStyle(value);
      const r = row.getBoundingClientRect();
      return {
        /* textContent is the SOURCE string; what the eye sees is the transform,
           so report both — a caps-looking value with title-case text means the
           transform is doing the work rather than the data. */
        text: (value.textContent || '').trim(),
        transform: cs.textTransform,
        tracking: cs.letterSpacing,
        size: cs.fontSize,
        rowWidth: Math.round(r.width),
        valueWidth: Math.round(value.getBoundingClientRect().width),
      };
    }).filter(Boolean);
  })()
`;

const shot = async (name, clip) => {
  const s = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
  if (s?.data) {
    writeFileSync(`scripts/${name}.png`, Buffer.from(s.data, 'base64'));
    console.log(`      crop → scripts/${name}.png`);
  }
};

const clipAroundLocation = async () =>
  evaluate(`
    (() => {
      const label = [...document.querySelectorAll('span')].find(
        (s) => (s.textContent || '').trim() === 'LOCATION'
      );
      if (!label) return null;
      const r = label.parentElement.parentElement.getBoundingClientRect();
      return { x: Math.max(0, r.x - 30), y: Math.max(0, r.y - 24), width: r.width + 60, height: r.height + 48, scale: 3 };
    })()
  `);

await send('Page.enable');
await send('Runtime.enable');

console.log(`\n═══ LOCATION VALUE CASE · ${BASE} ═══`);

// ── EXPLORE ───────────────────────────────────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=explore` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`/LOCATION/.test(document.body.textContent || '')`)) break;
  await sleep(500);
}
await sleep(1200);
// The first-look overlay holds the carousel back; click through it.
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('button')].find(
      (x) => /click anywhere/i.test(x.textContent || '')
    );
    if (b) b.click();
  })()
`);
await sleep(2600);
console.log('\n  EXPLORE');
for (const r of (await evaluate(READ)) || []) {
  console.log(`    "${r.text}"  transform:${r.transform}  ${r.size}/${r.tracking}  row ${r.rowWidth}px  value ${r.valueWidth}px`);
}
const c1 = await clipAroundLocation();
if (c1) await shot('meta-caps-explore', c1);

// ── INDEX (lightbox) ──────────────────────────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`document.querySelectorAll('img').length > 4`)) break;
  await sleep(500);
}
await sleep(2500);
const opened = await evaluate(`
  (() => {
    const imgs = [...document.querySelectorAll('img')].filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 60 && r.top > 80 && r.top < window.innerHeight - 100;
    });
    const t = imgs[2] || imgs[0];
    if (!t) return false;
    (t.closest('button') || t.parentElement || t).click();
    return true;
  })()
`);
await sleep(2200);
console.log(`\n  INDEX (lightbox${opened ? '' : ' — no tile found'})`);
for (const r of (await evaluate(READ)) || []) {
  console.log(`    "${r.text}"  transform:${r.transform}  ${r.size}/${r.tracking}  row ${r.rowWidth}px  value ${r.valueWidth}px`);
}
const c2 = await clipAroundLocation();
if (c2) await shot('meta-caps-index', c2);

console.log('');
chrome.kill();
ws.close();
process.exit(0);
