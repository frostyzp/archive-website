/**
 * Stills through the phone About sheet's dismissal, to see what the blink is.
 * Screenshots cost time, so the timestamps drift — these are for looking at,
 * not for measuring (probe-about-sheet-exit.mjs does the measuring).
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9930 + (process.pid % 40);
const W = 390;
const H = 844;
const TAG = process.env.TAG || 'now';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/sheet-fr-${process.pid}`,
  `--window-size=${W},${H}`,
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 50; i++) {
  if (await evaluate(`document.querySelectorAll('.grid-tile').length > 12`)) break;
  await sleep(400);
}
await sleep(2400);

const openSheet = `
  (() => {
    const burger = [...document.querySelectorAll('button')].find((b) =>
      /menu/i.test(b.getAttribute('aria-label') || '')
    );
    if (burger) burger.click();
    setTimeout(() => {
      const item = [...document.querySelectorAll('button, a')].find(
        (b) => (b.textContent || '').trim().toUpperCase() === 'ABOUT'
      );
      if (item) item.click();
    }, 420);
  })()
`;
const closeSheet = `
  (() => {
    const scrim = [...document.querySelectorAll('div')].find((d) => {
      const c = getComputedStyle(d);
      return c.position === 'fixed' && c.zIndex === '1000';
    });
    if (scrim) scrim.click();
  })()
`;

// Warm the filters first; a cold open stalls the thread.
await evaluate(openSheet);
await sleep(2600);
await evaluate(closeSheet);
await sleep(1600);
await evaluate(openSheet);
await sleep(2600);

await evaluate(closeSheet);
const t0 = Date.now();
for (let i = 0; i < 7; i++) {
  const s = await send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  const at = Date.now() - t0;
  if (s?.data) writeFileSync(`scripts/sheet-fall-${TAG}-${i}.png`, Buffer.from(s.data, 'base64'));
  console.log(`  frame ${i} at ~${at}ms`);
  await sleep(50);
}

chrome.kill();
ws.close();
process.exit(0);
