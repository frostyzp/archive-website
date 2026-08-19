/**
 * The index tile placeholder, caught before the images land: blocks the note
 * images at the network layer so the grid renders its waiting state and holds
 * it, then crops a couple of tiles.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9590 + (process.pid % 40);
const W = Number(process.env.W || 1440);
const H = Number(process.env.H || 900);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/tile-${process.pid}`,
  `--window-size=${W},${H}`,
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
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 60; i++) {
  if (await evaluate(`document.querySelectorAll('.grid-tile').length > 4`)) break;
  await sleep(400);
}
await sleep(3000);

// Now starve the connection and jump far down the sheet. The tiles down there
// load lazily, so they are the ones that sit in the waiting state long enough to
// photograph. Throttling from the start never gets the app itself booted, and
// blocking the images makes the grid drop those notes entirely (a failed image
// is filtered out), so neither shows the state we're after.
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 900,
  downloadThroughput: (20 * 1024) / 8,
  uploadThroughput: (20 * 1024) / 8,
});
await evaluate(`
  (() => {
    const sc = [...document.querySelectorAll('*')].find((el) => {
      const s = getComputedStyle(el);
      return /auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1000;
    });
    (sc || window).scrollTo(0, 9000);
  })()
`);
await sleep(2500);

const m = await evaluate(`
  (() => {
    const frame = document.querySelector('.grid-tile-ascii');
    const t = frame ? frame.closest('.grid-tile') : document.querySelectorAll('.grid-tile')[0];
    const r = t ? t.getBoundingClientRect() : null;
    const f = frame ? frame.getBoundingClientRect() : null;
    const runs = [...document.querySelectorAll('.grid-tile-ascii-h, .grid-tile-ascii-v')].slice(0, 4)
      .map((s) => {
        const rr = s.getBoundingClientRect();
        return {
          cls: s.className,
          w: Math.round(rr.width), h: Math.round(rr.height),
          chars: (s.textContent || '').replace(/\\n/g, '').length,
        };
      });
    return {
      tiles: document.querySelectorAll('.grid-tile').length,
      frames: document.querySelectorAll('.grid-tile-ascii').length,
      greySquares: document.querySelectorAll('.grid-tile-loading').length,
      tile: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) } : null,
      frame: f ? { w: Math.round(f.width), h: Math.round(f.height) } : null,
      runs,
    };
  })()
`);

console.log(`\n═══ INDEX TILE PLACEHOLDER · ${W}×${H} · ${BASE} ═══`);
console.log(`     tiles ................ ${m.tiles}`);
console.log(`     ascii frames ......... ${m.frames}`);
console.log(`     grey squares left .... ${m.greySquares}`);
console.log(`     tile ................. ${m.tile?.w}×${m.tile?.h}`);
console.log(`     frame ................ ${m.frame?.w}×${m.frame?.h}`);
for (const r of m.runs) console.log(`       ${r.cls.padEnd(20)} ${String(r.w).padStart(4)}×${String(r.h).padStart(4)}  ${r.chars} chars`);

if (m.tile) {
  const pad = 14;
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: Math.max(0, m.tile.x - pad),
      y: Math.max(0, m.tile.y - pad),
      width: m.tile.w + pad * 2,
      height: m.tile.h + pad * 2,
      scale: 2,
    },
  });
  if (s?.data) writeFileSync('scripts/tile-placeholder.png', Buffer.from(s.data, 'base64'));
  console.log(`\n  crop → scripts/tile-placeholder.png`);
}
const full = await send('Page.captureScreenshot', { format: 'png' });
if (full?.data) writeFileSync('scripts/tile-placeholder-full.png', Buffer.from(full.data, 'base64'));
console.log(`  full → scripts/tile-placeholder-full.png\n`);

chrome.kill();
ws.close();
process.exit(0);
