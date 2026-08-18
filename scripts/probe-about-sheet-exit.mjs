/**
 * The phone About sheet, on the way out. Samples the panel's travel and the
 * scrim's fade frame by frame so the two can be compared against the entrance —
 * looking for what reads as a blink at the end of the dismissal.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9880 + (process.pid % 40);
const W = 390;
const H = 844;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/sheet-exit-${process.pid}`,
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

/* Records the sheet and the scrim every frame under a run id, so a later run
   can't be read as part of an earlier one. */
const RECORD = (runId, ms) => `
  (() => {
    const run = ${JSON.stringify(runId)};
    window.__sheet = { run, t0: performance.now(), rows: [] };
    const tick = () => {
      const s = window.__sheet;
      if (!s || s.run !== run) return;
      const panel = document.querySelector('[aria-label="About What We Tell AI"]');
      /* The scrim is the fixed full-bleed layer directly under the panel. */
      const scrim = [...document.querySelectorAll('div')].find((d) => {
        const c = getComputedStyle(d);
        return c.position === 'fixed' && d.getBoundingClientRect().height >= innerHeight - 1 &&
          c.zIndex === '1000';
      });
      s.rows.push({
        t: Math.round(performance.now() - s.t0),
        top: panel ? Math.round(panel.getBoundingClientRect().top) : null,
        op: panel ? Math.round(parseFloat(getComputedStyle(panel).opacity) * 100) / 100 : null,
        scrim: scrim ? Math.round(parseFloat(getComputedStyle(scrim).opacity) * 100) / 100 : null,
        inDom: !!panel,
      });
      if (performance.now() - s.t0 < ${ms}) requestAnimationFrame(tick);
      else s.done = true;
    };
    requestAnimationFrame(tick);
  })()
`;

const report = async (label) => {
  const rows = await evaluate(`window.__sheet.rows`);
  const vh = await evaluate(`innerHeight`);
  console.log(`\n  ── ${label} ──`);
  // Where the travel starts and ends, and how the distance is spent over time.
  const moving = rows.filter((r) => r.top != null);
  if (!moving.length) return console.log('     nothing captured');
  const first = moving[0];
  const last = moving[moving.length - 1];
  const startTop = first.top;
  const endTop = last.top;
  console.log(`     panel top ${startTop} → ${endTop}   (viewport ${vh})`);

  const gone = rows.find((r) => !r.inDom);
  const settled = moving.find((r, i) => i > 2 && Math.abs(r.top - endTop) < 2);
  console.log(`     travel ends .......... ${settled ? `${settled.t}ms` : 'not reached'}`);
  console.log(`     panel leaves the DOM . ${gone ? `${gone.t}ms` : 'still mounted'}`);

  const scrimGone = rows.find((r) => r.scrim != null && r.scrim <= 0.02);
  const scrimOut = rows.find((r) => r.scrim == null);
  console.log(`     scrim reaches 0 ...... ${scrimGone ? `${scrimGone.t}ms` : scrimOut ? `unmounted by ${scrimOut.t}ms` : 'still up'}`);

  // Distance covered in each fifth of the move — an ease-out front-loads it.
  const span = (settled ? settled.t : last.t) || 1;
  const dist = Math.abs(endTop - startTop) || 1;
  const buckets = [0.2, 0.4, 0.6, 0.8, 1].map((f) => {
    const at = moving.filter((r) => r.t <= span * f).pop();
    return at ? Math.round((Math.abs(at.top - startTop) / dist) * 100) : 0;
  });
  console.log(`     distance covered by 20/40/60/80/100% of the time:`);
  console.log(`       ${buckets.map((b) => `${String(b).padStart(3)}%`).join('  ')}`);
  const opDip = moving.filter((r) => r.op != null && r.op < 0.99);
  if (opDip.length) console.log(`     panel opacity dips ... ${opDip.length} frames, min ${Math.min(...opDip.map((r) => r.op))}`);
  else console.log(`     panel opacity ........ held at 1 throughout`);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
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

console.log(`\n═══ PHONE ABOUT SHEET · ${W}×${H} · ${BASE} ═══`);

// Warm up: the first open pays for the paper-stock filters and stalls the
// main thread, which would be read as animation timing.
await evaluate(openSheet);
await sleep(2600);
await evaluate(closeSheet);
await sleep(1800);

await evaluate(RECORD('rise', 2200));
await evaluate(openSheet);
await sleep(2600);
await report('coming up');

await evaluate(RECORD('fall', 2200));
await evaluate(closeSheet);
await sleep(2600);
await report('going down');

console.log('');
chrome.kill();
ws.close();
process.exit(0);
