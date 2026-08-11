/**
 * Tracks the About drawer's peeking tab across EXPLORE → INDEX. Samples the
 * ABOUT tab's on-screen position every frame through the switch and reports how
 * long it spends off the right edge — i.e. how long the tab is missing from a
 * page that had it a moment ago.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9353;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-tab-transition-profile',
  '--window-size=1440,900',
  '--force-device-scale-factor=1',
  'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) return p;
    } catch {}
    await sleep(100);
  }
  throw new Error('no devtools target');
}

const page = await target();
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
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { error: r.exceptionDetails.text };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${BASE}/?view=grid` });

// Settle on the index with the drawer peeking, then cross to EXPLORE and back.
const report = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const byText = (re) => [...document.querySelectorAll('button, a')]
    .find(b => re.test((b.textContent||'').trim()));
  const tab = () => document.querySelector('.about-drawer-tab');
  // The peeking tab: visible means any part of it is inside the viewport.
  const state = () => {
    const t = tab();
    if (!t) return { present: false, right: null, onScreen: false };
    const b = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    return {
      present: true,
      left: +b.left.toFixed(1),
      onScreen: b.left < window.innerWidth - 1 && b.width > 0 && +cs.opacity > 0.01,
      opacity: +(+cs.opacity).toFixed(2),
    };
  };

  // First arrival: the peek is supposed to slide in behind the filter rail, so
  // the tab starting off-edge and landing a beat later is the correct reading.
  const arrival = [];
  const a0 = performance.now();
  let watchingArrival = true;
  const arrivalTick = () => {
    if (!watchingArrival) return;
    arrival.push({ t: +(performance.now() - a0).toFixed(1), ...state() });
    requestAnimationFrame(arrivalTick);
  };
  requestAnimationFrame(arrivalTick);
  await sleep(9000); // the index's own entrance, then the peek landing
  watchingArrival = false;
  const landed = arrival.find(s => s.present && s.onScreen);
  const firstArrival = {
    startedOffEdge: !!arrival[0] && !arrival[0].onScreen,
    landedAtMs: landed ? Math.round(landed.t) : null,
    entrancePlayed: !!landed && landed.t > 300,
  };
  const onIndex = state();

  byText(/^explore$/i)?.click();
  await sleep(4000);
  const onExplore = state();

  // Now the move under test, sampled every frame.
  const samples = [];
  const t0 = performance.now();
  let sampling = true;
  const tick = () => {
    if (!sampling) return;
    samples.push({ t: +(performance.now() - t0).toFixed(1), ...state() });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  byText(/^index$/i)?.click();
  await sleep(9000);
  sampling = false;

  const gaps = [];
  let start = null;
  for (const s of samples) {
    const missing = !s.present || !s.onScreen;
    if (missing && start === null) start = s.t;
    if (!missing && start !== null) { gaps.push([start, s.t]); start = null; }
  }
  if (start !== null) gaps.push([start, samples[samples.length - 1].t]);

  return {
    firstArrival, onIndex, onExplore,
    frames: samples.length,
    tabMissingWindowsMs: gaps.map(([a, b]) => ({ fromMs: Math.round(a), toMs: Math.round(b), forMs: Math.round(b - a) })),
    firstSamples: samples.slice(0, 3),
    lastSample: samples[samples.length - 1],
  };
})()`);

console.log(JSON.stringify(report, null, 1));

ws.close();
chrome.kill();
