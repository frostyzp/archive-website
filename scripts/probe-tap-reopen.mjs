/**
 * Open a note, go back, then open a different one — how soon can you tap the
 * second one before you get the first one again?
 *
 * The viewer is keyed by note id inside an AnimatePresence, so while the first
 * one is still playing its exit there are two of them mounted. Tapping during
 * that window is the ordinary way to use the grid, and it is the one sequence
 * a single-tap test never covers. Sweeps the delay between BACK and the next
 * tap and reports the first delay that comes back clean.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9610 + (process.pid % 40);
const W = Number(process.env.W || 390);
const GAPS = (process.env.GAPS || '0,120,300,600,1200').split(',').map(Number);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/tap-reopen-${process.pid}`,
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

const tapTile = async (n) => {
  const pt = await evaluate(`
    (() => {
      const t = document.querySelectorAll('.grid-tile')[${n}];
      if (!t) return null;
      t.scrollIntoView({ block: 'center' });
      const r = t.getBoundingClientRect();
      const img = t.querySelector('img');
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        file: (img.getAttribute('src') || '').split('/').pop(),
      };
    })()
  `);
  if (!pt) return null;
  await sleep(500);
  const pt2 = await evaluate(`
    (() => {
      const r = document.querySelectorAll('.grid-tile')[${n}].getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()
  `);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: pt2.x, y: pt2.y, button: 'left', clickCount: 1 });
  }
  return pt.file;
};

const shownFile = () =>
  evaluate(`
    (() => {
      const mid = innerHeight / 2;
      const c = [...document.querySelectorAll('img')]
        .map((i) => ({ i, r: i.getBoundingClientRect() }))
        .filter((x) => x.r.width > 120 && x.r.top < innerHeight && x.r.bottom > 0 && !x.i.closest('.grid-tile'))
        .sort((a, b) => Math.abs(a.r.top + a.r.height / 2 - mid) - Math.abs(b.r.top + b.r.height / 2 - mid))[0];
      return c ? (c.i.getAttribute('src') || '').split('/').pop() : null;
    })()
  `);

const goBack = () =>
  evaluate(`
    (() => {
      const b = [...document.querySelectorAll('button, a')].find(
        (x) => /^back$/i.test((x.textContent || '').trim())
      );
      if (b) { b.click(); return true; }
      return false;
    })()
  `);

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: 844, deviceScaleFactor: 1, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

console.log(`\n═══ OPEN → BACK → OPEN ANOTHER · ${W}px · ${BASE} ═══\n`);

for (const gap of GAPS) {
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`document.querySelectorAll('.grid-tile').length > 12`)) break;
    await sleep(400);
  }
  await sleep(2800);

  const first = await tapTile(0);
  await sleep(2200);
  const firstShown = await shownFile();

  const backed = await goBack();
  await sleep(gap);

  const second = await tapTile(6);
  await sleep(2500);
  const secondShown = await shownFile();

  const ok = secondShown === second;
  console.log(
    `  wait ${String(gap).padStart(4)}ms after BACK   tapped ${second}  →  showing ${secondShown || '—'}   ${ok ? 'ok' : `✗ WRONG NOTE (it is still ${firstShown})`}`
  );
  if (!backed) console.log('        (BACK control not found — closed some other way)');
  if (!ok) {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (s?.data) {
      writeFileSync(`scripts/reopen-wrong-${gap}.png`, Buffer.from(s.data, 'base64'));
      console.log(`        shot → scripts/reopen-wrong-${gap}.png`);
    }
  }
}

console.log('');
chrome.kill();
ws.close();
process.exit(0);
