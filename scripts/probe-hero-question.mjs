/**
 * How big is the hero question, and does it still break in two lines?
 *
 * Size alone isn't the whole answer: the question sits in a fixed measure and
 * breaks after "ABOUT", so growing the type without growing the measure turns
 * two lines into three. Reads the computed size and counts real line boxes via
 * client rects at a few widths.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9320 + (process.pid % 40);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/hero-q-${process.pid}`,
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

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${BASE}/` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`/CONFESS/i.test(document.body.textContent || '')`)) break;
  await sleep(500);
}
await sleep(2500);

const READ = `
  (() => {
    const p = [...document.querySelectorAll('p')]
      .find((el) => /what do you have to confess/i.test(el.getAttribute('aria-label') || ''));
    if (!p) return null;
    const cs = getComputedStyle(p);
    const r = p.getBoundingClientRect();
    /* Group the word spans by their top edge — one group per line box, which is
       what the eye counts, rather than trusting height / line-height. */
    const tops = [...p.querySelectorAll('span')].map((s) =>
      Math.round(s.getBoundingClientRect().top)
    );
    const lines = [...new Set(tops)].sort((a, b) => a - b);
    const byLine = lines.map((top) =>
      [...p.querySelectorAll('span')]
        .filter((s) => Math.round(s.getBoundingClientRect().top) === top)
        .map((s) => s.textContent)
        .join(' ')
    );
    return {
      fontSize: cs.fontSize,
      maxWidth: cs.maxWidth,
      width: Math.round(r.width),
      lines: byLine.length,
      text: byLine,
    };
  })()
`;

console.log(`\n═══ HERO QUESTION · ${BASE} ═══\n`);
for (const w of [1440, 1024, 768, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: 900,
    deviceScaleFactor: 1,
    mobile: w <= 768,
  });
  await sleep(900);
  const r = await evaluate(READ);
  if (!r) {
    console.log(`  ${String(w).padStart(4)}px  question not found`);
    continue;
  }
  console.log(`  ${String(w).padStart(4)}px  ${r.fontSize.padStart(6)}  box ${String(r.width).padStart(3)}px  ${r.lines} line${r.lines === 1 ? '' : 's'}`);
  for (const l of r.text) console.log(`          │ ${l}`);
}

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 2, mobile: false,
});
await sleep(900);
const box = await evaluate(`
  (() => {
    const p = [...document.querySelectorAll('p')]
      .find((el) => /what do you have to confess/i.test(el.getAttribute('aria-label') || ''));
    const r = p.getBoundingClientRect();
    return { x: Math.max(0, r.x - 120), y: Math.max(0, r.y - 150), w: r.width + 240, h: r.height + 190 };
  })()
`);
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 },
});
if (shot?.data) {
  writeFileSync('scripts/hero-question.png', Buffer.from(shot.data, 'base64'));
  console.log('\n  crop → scripts/hero-question.png');
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
