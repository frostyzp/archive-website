/**
 * Press a note while the grid is still flying in — do you get the one you
 * pressed?
 *
 * The entrance parks every tile away from its cell and animates it home, so for
 * the first second the artwork on screen is nowhere near the layout box that
 * owns it, and the tiles overlap each other on the way. A press during that
 * window goes to whichever tile is painted on top, which need not be the one
 * under the finger. Taps at a fixed point at several moments and reports what
 * was visibly there versus what opened.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9650 + (process.pid % 40);
const W = Number(process.env.W || 390);
const ATS = (process.env.ATS || '250,500,800,1200,2000').split(',').map(Number);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/tap-entr-${process.pid}`,
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

const PX = Math.round(W * 0.28);
const PY = 420;

console.log(`\n═══ PRESS DURING ENTRANCE · ${W}px · press at (${PX}, ${PY}) · ${BASE} ═══\n`);

for (const at of ATS) {
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  // Wait for tiles to exist, then press at `at` ms measured from that moment —
  // early enough that the fly-in is still running.
  for (let i = 0; i < 60; i++) {
    if (await evaluate(`document.querySelectorAll('.grid-tile').length > 4`)) break;
    await sleep(120);
  }
  await sleep(at);

  // Who is visibly at the press point, and who owns the press there.
  const scene = await evaluate(`
    (() => {
      const el = document.elementFromPoint(${PX}, ${PY});
      const tile = el && el.closest ? el.closest('.grid-tile') : null;
      const owner = tile ? (tile.querySelector('img')?.getAttribute('src') || '').split('/').pop() : null;
      /* What the eye sees there: the top-most tile whose painted (transformed)
         box covers the point. Painted last wins, so walk in reverse. */
      const tiles = [...document.querySelectorAll('.grid-tile')];
      let seen = null;
      for (let i = tiles.length - 1; i >= 0; i--) {
        const r = tiles[i].getBoundingClientRect();
        if (${PX} >= r.left && ${PX} <= r.right && ${PY} >= r.top && ${PY} <= r.bottom) {
          seen = (tiles[i].querySelector('img')?.getAttribute('src') || '').split('/').pop();
          break;
        }
      }
      /* How many tiles cover that point at all — a pile means the press is a
         coin toss regardless of which one wins. */
      const covering = tiles.filter((t) => {
        const r = t.getBoundingClientRect();
        return ${PX} >= r.left && ${PX} <= r.right && ${PY} >= r.top && ${PY} <= r.bottom;
      }).length;
      return { owner, seen, covering, tiles: tiles.length };
    })()
  `);

  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: PX, y: PY, button: 'left', clickCount: 1 });
  }
  await sleep(2600);

  const shown = await evaluate(`
    (() => {
      const mid = innerHeight / 2;
      const c = [...document.querySelectorAll('img')]
        .map((i) => ({ i, r: i.getBoundingClientRect() }))
        .filter((x) => x.r.width > 120 && x.r.top < innerHeight && x.r.bottom > 0 && !x.i.closest('.grid-tile'))
        .sort((a, b) => Math.abs(a.r.top + a.r.height / 2 - mid) - Math.abs(b.r.top + b.r.height / 2 - mid))[0];
      return c ? (c.i.getAttribute('src') || '').split('/').pop() : null;
    })()
  `);

  const ok = shown && scene.seen && shown === scene.seen;
  console.log(
    `  +${String(at).padStart(4)}ms   ${String(scene.covering).padStart(2)} tiles under the point   saw ${(scene.seen || '—').padEnd(14)} opened ${(shown || '—').padEnd(14)} ${ok ? 'ok' : '✗ NOT WHAT WAS PRESSED'}`
  );
  if (!ok && shown) {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (s?.data) {
      writeFileSync(`scripts/entrance-tap-${at}.png`, Buffer.from(s.data, 'base64'));
      console.log(`            shot → scripts/entrance-tap-${at}.png`);
    }
  }
}

console.log('');
chrome.kill();
ws.close();
process.exit(0);
