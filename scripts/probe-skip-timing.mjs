/**
 * When SKIP INTRO arrives, against when the wordmark finishes drawing itself.
 * Samples both every frame from before the page loads.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9610 + (process.pid % 40);
const W = Number(process.env.W || 390);
const H = Number(process.env.H || 844);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/skip-${process.pid}`,
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });

// Armed before the document exists, so the very first frames are on the record.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__skip = { t0: performance.now(), rows: [] };
    const tick = () => {
      const s = window.__skip;
      const link = [...document.querySelectorAll('a')].find((a) =>
        /skip intro/i.test(a.textContent || '')
      );
      /* The wordmark draws as SVG strokes; count the ones with ink showing. */
      const svg = document.querySelector('svg path[stroke-dasharray], svg path');
      const paths = [...document.querySelectorAll('svg path')];
      const inked = paths.filter((p) => {
        const o = parseFloat(getComputedStyle(p).strokeDashoffset || '0');
        const a = parseFloat(getComputedStyle(p).opacity || '1');
        return a > 0.05 && Math.abs(o) < 4;
      }).length;
      s.rows.push({
        t: Math.round(performance.now() - s.t0),
        skip: link ? Math.round(parseFloat(getComputedStyle(link).opacity) * 100) / 100 : null,
        paths: paths.length,
        inked,
      });
      if (performance.now() - s.t0 < 9000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  `,
});
await send('Page.navigate', { url: `${BASE}/` });
await sleep(10000);

const rows = await evaluate(`window.__skip.rows`);
const withPaths = rows.filter((r) => r.paths > 0);
const totalPaths = Math.max(...rows.map((r) => r.paths));
// The draw is done the first time every stroke is inked and stays that way.
let drawDone = null;
for (let i = 0; i < withPaths.length; i++) {
  if (withPaths[i].inked >= totalPaths && totalPaths > 0) {
    drawDone = withPaths[i].t;
    break;
  }
}
const skipUp = rows.find((r) => r.skip != null && r.skip > 0.02);
const skipFull = rows.find((r) => r.skip != null && r.skip > 0.98);

console.log(`\n═══ SKIP INTRO vs WORDMARK · ${W}×${H} · ${BASE} ═══`);
console.log(`     wordmark strokes ......... ${totalPaths}`);
console.log(`     draw completes ........... ${drawDone != null ? `${drawDone}ms` : 'not seen'}`);
console.log(`     SKIP starts to appear .... ${skipUp ? `${skipUp.t}ms` : 'never'}`);
console.log(`     SKIP fully lit ........... ${skipFull ? `${skipFull.t}ms` : 'never'}`);
if (drawDone != null && skipUp) {
  const d = skipUp.t - drawDone;
  console.log(`     SKIP arrives ............. ${d >= 0 ? `${d}ms AFTER the draw` : `${-d}ms BEFORE the draw finishes`}`);
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
