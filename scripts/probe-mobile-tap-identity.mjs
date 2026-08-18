/**
 * On a phone, does tapping a grid tile open THAT note?
 *
 * Taps several tiles in turn and compares the tile's own identity (its printed
 * number and image file) against whatever the opened view ends up showing.
 * Reports both the note the overlay is seeded to and the note actually on
 * screen, since a correct seed that then scrolls elsewhere looks identical to
 * the user but is a different bug.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9490 + (process.pid % 40);
const W = Number(process.env.W || 390);
const TAPS = (process.env.TAPS || '0,2,5,9').split(',').map(Number);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/tap-id-${process.pid}`,
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

const fileOf = `((s) => (s || '').split('/').pop().split('?')[0])`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: 844, deviceScaleFactor: 1, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// A phone is the case that matters and localhost is nothing like one. The stack
// centres itself by measuring the note it is seeded to, so anything that lets
// layout move after that measurement — images still decoding, a main thread too
// busy to run the correction — is exactly where a correct seed drifts.
if (process.env.SLOW) {
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1500 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

console.log(`\n═══ MOBILE TAP IDENTITY · ${W}px${process.env.SLOW ? ' · SLOW 3G + 6x CPU' : ''} · ${BASE} ═══\n`);

for (const n of TAPS) {
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  const tries = process.env.SLOW ? 120 : 40;
  for (let i = 0; i < tries; i++) {
    if (await evaluate(`document.querySelectorAll('.grid-tile').length > 12`)) break;
    await sleep(600);
  }
  await sleep(process.env.SLOW ? 6000 : 2600);

  // Optionally narrow the grid first — the tapped note and the list handed to
  // the viewer are computed from the same filtered array, so a stale one shows
  // up here and nowhere else.
  if (process.env.FILTER) {
    await evaluate(`
      (() => {
        const b = [...document.querySelectorAll('button')].find((x) =>
          /^${process.env.FILTER}/i.test((x.textContent || '').trim())
        );
        if (b) b.click();
      })()
    `);
    await sleep(700);
    await evaluate(`
      (() => {
        const item = document.querySelector('[role="menuitemcheckbox"]');
        if (item) item.click();
      })()
    `);
    await sleep(400);
    await evaluate(`document.body.click()`);
    await sleep(1400);
  }

  // What we are about to tap.
  const tile = await evaluate(`
    (() => {
      const t = document.querySelectorAll('.grid-tile')[${n}];
      if (!t) return null;
      const img = t.querySelector('img');
      const num = [...t.querySelectorAll('*')]
        .map((el) => (el.textContent || '').trim())
        .find((s) => /^\\d{1,4}$/.test(s));
      const r = t.getBoundingClientRect();
      return {
        num,
        file: ${fileOf}(img && img.getAttribute('src')),
        alt: img && img.getAttribute('alt'),
        cx: Math.round(r.left + r.width / 2),
        cy: Math.round(r.top + r.height / 2),
        onScreen: r.top > 0 && r.bottom < 844,
      };
    })()
  `);
  if (!tile) {
    console.log(`  tile #${n}: not found`);
    continue;
  }
  if (!tile.onScreen) {
    await evaluate(`document.querySelectorAll('.grid-tile')[${n}].scrollIntoView({block:'center'})`);
    await sleep(700);
  }
  const pt = await evaluate(`
    (() => {
      const r = document.querySelectorAll('.grid-tile')[${n}].getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()
  `);

  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: pt.x, y: pt.y, id: 1 }],
  });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: pt.x, y: pt.y, button: 'left', clickCount: 1,
    });
  }

  // What opened. The overlay's biggest image is the note being previewed.
  const READ_OPEN = `
    (() => {
      /* The note being previewed is the one parked in the middle of the screen,
         NOT the largest image in the document: the stack keeps its neighbours
         mounted at full size just outside the viewport, and the grid is still
         behind the overlay, so "biggest" picks the wrong one constantly. */
      const mid = innerHeight / 2;
      const imgs = [...document.querySelectorAll('img')]
        .map((i) => ({ i, r: i.getBoundingClientRect() }))
        .filter((x) =>
          x.r.width > 120 && x.r.height > 120 &&
          x.r.top < innerHeight && x.r.bottom > 0 &&
          /* Anything still sitting in a grid cell is the index underneath. */
          !x.i.closest('.grid-tile')
        )
        .sort(
          (a, b) =>
            Math.abs(a.r.top + a.r.height / 2 - mid) -
            Math.abs(b.r.top + b.r.height / 2 - mid)
        );
      const big = imgs[0];
      /* The counter tells us where the stack thinks it is, independent of which
         image happens to be painted. */
      const counter = [...document.querySelectorAll('*')]
        .map((el) => (el.childElementCount === 0 ? (el.textContent || '').trim() : ''))
        .find((s) => /^\\d+\\s*(\\/|of)\\s*\\d+$/i.test(s));
      return {
        gridTiles: document.querySelectorAll('.grid-tile').length,
        file: big ? ${fileOf}(big.i.getAttribute('src')) : null,
        alt: big ? big.i.getAttribute('alt') : null,
        w: big ? Math.round(big.r.width) : 0,
        counter: counter || null,
        /* Every note file currently in the DOM at a readable size — a stack
           renders neighbours too, so this shows what it seeded around. */
        near: imgs.slice(0, 4).map((x) => ${fileOf}(x.i.getAttribute('src'))),
      };
    })()
  `;

  console.log(`  tile #${String(n).padStart(2)}  tapped ${String(tile.num).padStart(4)} (${tile.file})  [scrolled ${tile.onScreen ? 'no' : 'yes'}]`);
  // Sampled over time: a correct seed that then slides to a neighbour reads to
  // the eye exactly like a wrong seed, and only a second look tells them apart.
  let last;
  for (const at of [900, 2400, 5000]) {
    await sleep(at - (last || 0));
    last = at;
    const o = await evaluate(READ_OPEN);
    const hit = o.file && tile.file && o.file === tile.file;
    console.log(
      `            @${String(at).padStart(4)}ms  showing ${(o.file || '—').padEnd(14)} counter ${(o.counter || '—').padEnd(9)} ${hit ? 'match' : '✗ MISMATCH'}   [${o.near.join(' ')}]`
    );
    if (!hit) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        writeFileSync(`scripts/tap-mismatch-${n}-${at}.png`, Buffer.from(shot.data, 'base64'));
        console.log(`            shot → scripts/tap-mismatch-${n}-${at}.png`);
      }
    }
  }
}

console.log('');
chrome.kill();
ws.close();
process.exit(0);
