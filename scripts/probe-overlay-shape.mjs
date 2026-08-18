/**
 * The other mobile note surface: tapping a tile on the INDEX. It renders no
 * dock, so it should keep the full height — this checks the dock change didn't
 * leak into it, and that the shorter card cap still leaves it looking right.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9770 + (process.pid % 40);
const W = 390;
const H = Number(process.env.H || 667);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/ovl-${process.pid}`,
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
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 50; i++) {
  if (await evaluate(`document.querySelectorAll('.grid-tile').length > 12`)) break;
  await sleep(400);
}
await sleep(2600);

await evaluate(`
  (() => {
    const t = document.querySelectorAll('.grid-tile')[4];
    if (t) t.click();
  })()
`);
await sleep(2800);

const m = await evaluate(`
  (() => {
    const stage = [...document.querySelectorAll('div')].find((d) => {
      const s = getComputedStyle(d);
      return s.position === 'absolute' && s.zIndex === '1' && d.querySelector('.transcript-reveal');
    });
    const t = [...document.querySelectorAll('.transcript-reveal')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    const prev = document.querySelector('[aria-label="Previous category"]');
    const r = stage ? stage.getBoundingClientRect() : null;
    return {
      stage: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null,
      transcriptBottom: t ? Math.round(t.getBoundingClientRect().bottom) : null,
      hasDock: !!prev,
      vh: innerHeight,
    };
  })()
`);

console.log(`\n═══ MOBILE INDEX → NOTE OVERLAY · ${W}×${H} ═══`);
console.log(`     stage ............ ${m.stage ? `y ${m.stage.top}–${m.stage.bottom}` : '—'}  (should be 0–${m.vh})`);
console.log(`     transcript ends .. y ${m.transcriptBottom}`);
console.log(`     category dock .... ${m.hasDock ? 'PRESENT (unexpected)' : 'none, as designed'}\n`);

const s = await send('Page.captureScreenshot', { format: 'png' });
if (s?.data) writeFileSync('scripts/overlay-shape.png', Buffer.from(s.data, 'base64'));

chrome.kill();
ws.close();
process.exit(0);
