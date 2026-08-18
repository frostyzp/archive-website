/**
 * Does the note you can SEE at a point own the tap at that point?
 *
 * A correct click handler still opens the wrong note if the tile's hit box has
 * drifted off the artwork it draws — you press one print and another tile's box
 * takes the press. For every visible note this walks the image's own rectangle
 * (centre plus its four quadrants) and asks the document who would receive a
 * press there, then compares that against the note actually painted.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9530 + (process.pid % 40);
const W = Number(process.env.W || 390);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/hit-align-${process.pid}`,
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
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`document.querySelectorAll('.grid-tile').length > 12`)) break;
  await sleep(400);
}
await sleep(3000);

const REPORT = `
  (() => {
    const noteOf = (el) => {
      const tile = el && el.closest ? el.closest('.grid-tile') : null;
      if (!tile) return null;
      const img = tile.querySelector('img');
      return img ? (img.getAttribute('alt') || '').replace('Note ', '') : null;
    };
    const rows = [];
    const tiles = [...document.querySelectorAll('.grid-tile')];
    for (const tile of tiles) {
      const img = tile.querySelector('img');
      if (!img) continue;
      const ir = img.getBoundingClientRect();
      const tr = tile.getBoundingClientRect();
      if (ir.width < 20 || ir.bottom < 0 || ir.top > innerHeight) continue;
      const mine = (img.getAttribute('alt') || '').replace('Note ', '');
      /* Centre, then inside each corner — a small offset shows up at the edges
         long before it reaches the middle. */
      const pts = [
        ['centre', ir.left + ir.width / 2, ir.top + ir.height / 2],
        ['tl', ir.left + ir.width * 0.2, ir.top + ir.height * 0.2],
        ['tr', ir.left + ir.width * 0.8, ir.top + ir.height * 0.2],
        ['bl', ir.left + ir.width * 0.2, ir.top + ir.height * 0.8],
        ['br', ir.left + ir.width * 0.8, ir.top + ir.height * 0.8],
      ];
      const bad = [];
      for (const [name, x, y] of pts) {
        if (y < 0 || y > innerHeight) continue;
        const got = noteOf(document.elementFromPoint(x, y));
        if (got !== mine) bad.push(name + '→' + (got == null ? 'nothing' : got));
      }
      rows.push({
        note: mine,
        /* How far the artwork sits from the box that receives the press. */
        dx: Math.round((ir.left + ir.width / 2) - (tr.left + tr.width / 2)),
        dy: Math.round((ir.top + ir.height / 2) - (tr.top + tr.height / 2)),
        imgH: Math.round(ir.height),
        tileH: Math.round(tr.height),
        bad,
      });
    }
    return rows;
  })()
`;

const rows = await evaluate(REPORT);
console.log(`\n═══ TAP TARGET vs ARTWORK · ${W}px · ${BASE} ═══\n`);
let bad = 0;
for (const r of rows) {
  const flag = r.bad.length ? `  ✗ ${r.bad.join(' ')}` : '';
  if (r.bad.length) bad++;
  console.log(
    `  note ${String(r.note).padStart(4)}   art offset from hit box  dx ${String(r.dx).padStart(4)}  dy ${String(r.dy).padStart(4)}   art ${String(r.imgH).padStart(3)}px in ${String(r.tileH).padStart(3)}px box${flag}`
  );
}
console.log(`\n  ${bad} of ${rows.length} visible notes take a press meant for another\n`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) {
  writeFileSync('scripts/hit-align.png', Buffer.from(shot.data, 'base64'));
  console.log('  shot → scripts/hit-align.png\n');
}

chrome.kill();
ws.close();
process.exit(0);
