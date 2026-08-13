/**
 * Stills of one candidate's flight, so the arc can be looked at rather than
 * measured. VARIANT=handoff|fountain|spout, SLOW=6 by default.
 *
 * The page is loaded with ?slow=, not photographed at speed: a capture costs a
 * couple of hundred milliseconds of the same thread the flight is animating on,
 * so at normal speed every frame comes back looking like the wall at rest.
 *
 * Keys go in as synthetic events rather than through Input.dispatchKeyEvent —
 * a CDP key event drops this renderer to about one frame a second for the rest
 * of the session (see probe-grid-handoff.mjs).
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5190';
const VARIANT = process.env.VARIANT || 'handoff';
const SLOW = Number(process.env.SLOW || 6);
const PORT = 9800 + (process.pid % 89);
const PROFILE = `/tmp/grid-frames-${process.pid}`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=${PROFILE}`,
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
  (await send('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value;
const pressKey = (key) =>
  evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)} })), 1`);

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url: `${BASE}/entrance?tab=handoff&slow=${SLOW}` });
await sleep(2000);
await pressKey(String(['fountain', 'handoff', 'spout'].indexOf(VARIANT) + 1));
await sleep(300);

// Marked in the page's own clock so a capture's cost shows up as a late frame
// rather than as a mislabelled one.
await evaluate(`window.__t0 = null; window.addEventListener('keydown', () => { window.__t0 = performance.now(); }, true), 1`);
await pressKey(' ');
const elapsed = `Math.round(window.__t0 == null ? -1 : performance.now() - window.__t0)`;

const shots = [];
for (const at of [0, 120, 320, 700, 1400, 2600, 4200, 6000].map((ms) => ms * SLOW)) {
  for (;;) {
    const now = await evaluate(elapsed);
    if (now >= at) break;
    await sleep(30);
  }
  const real = await evaluate(elapsed);
  const path = `/tmp/grid-handoff-${VARIANT}-${String(Math.round(real / SLOW)).padStart(4, '0')}ms.png`;
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: 1440, height: 900, scale: 0.7 },
    captureBeyondViewport: false,
  });
  if (r?.data) fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
  shots.push({ path, at: Math.round(real / SLOW) });
}

console.log(`\n${VARIANT} at ${SLOW}× slow — times are in the transition's own clock`);
for (const s of shots) console.log(`  ${String(s.at).padStart(5)}ms  ${s.path}`);

chrome.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {}
process.exit(0);
