/**
 * Pixel-level version of the tap check: crop the tile you press, then crop the
 * note that opens, and put them side by side for a human to compare.
 *
 * Comparing `src` strings can pass while the eye disagrees — a reused <img>
 * keeps painting its previous bitmap until the new one decodes, so the attribute
 * and the picture can differ. This trusts the pixels instead.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9570 + (process.pid % 40);
const W = Number(process.env.W || 390);
const TAPS = (process.env.TAPS || '1,8').split(',').map(Number);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/tap-px-${process.pid}`,
  `--window-size=${W},844`,
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
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: 844, deviceScaleFactor: 1, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

console.log(`\n═══ TAP → PREVIEW, PIXELS · ${W}px · ${BASE} ═══\n`);

for (const n of TAPS) {
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`document.querySelectorAll('.grid-tile').length > 12`)) break;
    await sleep(400);
  }
  await sleep(3000);

  await evaluate(`
    (() => {
      const t = document.querySelectorAll('.grid-tile')[${n}];
      if (t) t.scrollIntoView({ block: 'center' });
    })()
  `);
  await sleep(900);

  const tile = await evaluate(`
    (() => {
      const t = document.querySelectorAll('.grid-tile')[${n}];
      const img = t.querySelector('img');
      const r = img.getBoundingClientRect();
      return {
        file: (img.getAttribute('src') || '').split('/').pop(),
        alt: img.getAttribute('alt'),
        complete: img.complete,
        natural: img.naturalWidth + 'x' + img.naturalHeight,
        x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    })()
  `);

  const before = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: tile.x, y: tile.y, width: tile.w, height: tile.h, scale: 2 },
  });
  if (before?.data) {
    writeFileSync(`scripts/tap-${n}-a-tile.png`, Buffer.from(before.data, 'base64'));
  }

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: tile.x + tile.w / 2, y: tile.y + tile.h / 2,
    button: 'left', clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: tile.x + tile.w / 2, y: tile.y + tile.h / 2,
    button: 'left', clickCount: 1,
  });
  await sleep(3500);

  const shown = await evaluate(`
    (() => {
      const mid = innerHeight / 2;
      const c = [...document.querySelectorAll('img')]
        .map((i) => ({ i, r: i.getBoundingClientRect() }))
        .filter((x) => x.r.width > 120 && x.r.top < innerHeight && x.r.bottom > 0 && !x.i.closest('.grid-tile'))
        .sort((a, b) => Math.abs(a.r.top + a.r.height / 2 - mid) - Math.abs(b.r.top + b.r.height / 2 - mid))[0];
      if (!c) return null;
      return {
        file: (c.i.getAttribute('src') || '').split('/').pop(),
        alt: c.i.getAttribute('alt'),
        complete: c.i.complete,
        natural: c.i.naturalWidth + 'x' + c.i.naturalHeight,
        x: Math.round(c.r.left), y: Math.round(c.r.top),
        w: Math.round(c.r.width), h: Math.round(c.r.height),
      };
    })()
  `);

  if (shown) {
    const after = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: shown.x, y: shown.y, width: shown.w, height: shown.h, scale: 2 },
    });
    if (after?.data) {
      writeFileSync(`scripts/tap-${n}-b-preview.png`, Buffer.from(after.data, 'base64'));
    }
  }

  console.log(`  tile #${n}`);
  console.log(`    pressed  ${tile.file}  alt "${tile.alt}"  decoded ${tile.complete} ${tile.natural}`);
  console.log(`    opened   ${shown ? shown.file : '—'}  alt "${shown ? shown.alt : '—'}"  decoded ${shown ? shown.complete : '—'} ${shown ? shown.natural : ''}`);
  console.log(`    crops → scripts/tap-${n}-a-tile.png  vs  scripts/tap-${n}-b-preview.png`);
}

console.log('');
chrome.kill();
ws.close();
process.exit(0);
