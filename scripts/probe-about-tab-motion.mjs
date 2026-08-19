/**
 * What the ABOUT tab does across the two moments it might be asked to fade:
 * opening the drawer, and switching INDEX ↔ EXPLORE. Samples the tab's opacity
 * and x each frame through both.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9670 + (process.pid % 40);
const W = 1440;
const H = 900;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/tabm-${process.pid}`,
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

const RECORD = (ms) => `
  (() => {
    const runId = Math.random();
    window.__tab = { runId, t0: performance.now(), rows: [] };
    const tick = () => {
      if (!window.__tab || window.__tab.runId !== runId) return;
      const t = performance.now() - window.__tab.t0;
      if (t > ${ms}) return;
      const tabs = [...document.querySelectorAll('.about-drawer-tab')];
      window.__tab.rows.push({
        t: Math.round(t),
        n: tabs.length,
        tabs: tabs.map((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            label: (el.textContent || '').trim(),
            op: +(+cs.opacity).toFixed(2),
            x: Math.round(r.left),
            w: Math.round(r.width),
          };
        }),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()
`;
const dump = async (title) => {
  const rows = await evaluate(`window.__tab ? window.__tab.rows : []`);
  console.log(`\n  ${title}`);
  let last = '';
  for (const r of rows) {
    const sig = r.tabs.map((t) => `${t.label}:${t.op}@${t.x}`).join(' ');
    if (sig !== last) {
      console.log(`     ${String(r.t).padStart(5)}ms  ${sig || '(none)'}`);
      last = sig;
    }
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 60; i++) {
  if (await evaluate(`document.querySelectorAll('.grid-tile').length > 4`)) break;
  await sleep(400);
}
await sleep(2500);

console.log(`\n═══ ABOUT TAB MOTION · ${BASE} ═══`);

await evaluate(RECORD(2200));
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^about$/i.test((x.textContent || '').trim()));
    if (b) b.click();
  })()
`);
await sleep(2400);
await dump('OPEN the drawer');

await evaluate(RECORD(2200));
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^about$/i.test((x.textContent || '').trim()));
    if (b) b.click();
  })()
`);
await sleep(2400);
await dump('CLOSE the drawer');

await evaluate(RECORD(2600));
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('a, button')].find((x) => /^explore$/i.test((x.textContent || '').trim()));
    if (b) b.click();
  })()
`);
await sleep(2800);
await dump('INDEX → EXPLORE');

console.log('');
chrome.kill();
ws.close();
process.exit(0);
