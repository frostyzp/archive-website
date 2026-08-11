/**
 * Two things the tuck could have broken and the main probe couldn't see: whether
 * each tab's seeded paper crop still sits on its tab now that the filed ones rest
 * short of the strip's edge, and whether the shut drawer's ABOUT tab is still
 * where it was — the peek is a different case and must not pick up the tuck.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn, execSync } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9376;

try { execSync(`pkill -f "remote-debugging-port=${PORT}"`); } catch {}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-tab-tuck-checks-profile',
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
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { error: r.exceptionDetails.text, detail: r.exceptionDetails?.exception?.description };
  return r?.result?.value;
};
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), buttons: 0 });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${BASE}/?view=grid` });

const setup = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) { if (document.querySelector('.about-drawer-tab')) break; await sleep(100); }
  await sleep(6000);
  const pump = document.createElement('div');
  pump.style.cssText = 'position:fixed;left:-4px;top:-4px;width:1px;height:1px;pointer-events:none;background:#000;';
  document.body.appendChild(pump);
  setInterval(() => { pump.style.opacity = pump.style.opacity === '0.5' ? '0.6' : '0.5'; }, 8);

  window.__q = {
    panel: () => document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]'),
    tab: (i) => document.getElementById('about-tab-' + i),
    // The crop's offset from its own tab: whatever inset the layer carries, it
    // must be the same on a filed tab as on the one standing at full width, or
    // the tuck has slid the grain off the surface it belongs to.
    crop(i) {
      const t = this.tab(i);
      const layer = [...t.children].find((el) => getComputedStyle(el).filter.includes('roughpaper'));
      if (!layer) return { id: i, layer: false };
      const lb = layer.getBoundingClientRect(), tb = t.getBoundingClientRect();
      return {
        id: i,
        filter: getComputedStyle(layer).filter.match(/#([\\w-]+)/)?.[1],
        dLeft: +(lb.left - tb.left).toFixed(2),
        dTop: +(lb.top - tb.top).toFixed(2),
        dWidth: +(lb.width - tb.width).toFixed(2),
        dHeight: +(lb.height - tb.height).toFixed(2),
        clip: getComputedStyle(layer).clipPath,
      };
    },
    shut() {
      const p = this.panel().getBoundingClientRect();
      const t = this.tab('about').getBoundingClientRect();
      return {
        panelLeft: +p.left.toFixed(2),
        tabLeft: +t.left.toFixed(2),
        tabProtrusion: +(p.left - t.left).toFixed(2),
      };
    },
  };
  return window.__q.shut();
})()`);

console.log('\n══ shut drawer, ABOUT tab at rest');
console.log(JSON.stringify(setup, null, 1));

// The peek's own lean, to confirm the tuck did not double up on it.
await move(setup.panelLeft - 24, 54);
await sleep(1400);
const shutHover = await evaluate('window.__q.shut()');
console.log('\n══ shut drawer, ABOUT tab hovered');
console.log(JSON.stringify({
  ...shutHover,
  panelLeanPx: +(setup.panelLeft - shutHover.panelLeft).toFixed(2),
  tabProtrusionUnchanged: shutHover.tabProtrusion === setup.tabProtrusion,
}, null, 1));

await move(300, 400);
await sleep(1200);

// Open, let the tabs land, then compare crops.
const crops = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  document.querySelector('.about-drawer-tab').click();
  await sleep(2200);
  return {
    lefts: ['about','process','why'].map((i) => ({ id: i, left: +window.__q.tab(i).getBoundingClientRect().left.toFixed(2) })),
    crops: ['about','process','why'].map((i) => window.__q.crop(i)),
  };
})()`);
console.log('\n══ open drawer, paper crop vs its tab');
console.log(JSON.stringify(crops, null, 1));

const same = crops.crops.every(
  (c) => c.dLeft === crops.crops[0].dLeft && c.dTop === crops.crops[0].dTop
    && c.dWidth === crops.crops[0].dWidth && c.dHeight === crops.crops[0].dHeight
);
console.log(JSON.stringify({
  everyCropSitsOnItsTabTheSameWay: same,
  cropInsetIsTheTabsOwnBorder: crops.crops.every((c) => c.dLeft === 1 && c.dTop === 1),
  seedsStillDistinct: new Set(crops.crops.map((c) => c.filter)).size === 3,
}, null, 1));

// Selecting a filed tab with the pointer nowhere near it — a touch screen, or a
// keyboard Enter. Nothing here should be waiting out the entrance's stagger.
const swap = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const left = (i) => +window.__q.tab(i).getBoundingClientRect().left.toFixed(2);
  const t0 = performance.now();
  const s = [];
  let on = true;
  const tick = () => { if (!on) return; s.push({ t: +(performance.now() - t0).toFixed(1), process: left('process'), about: left('about') }); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await sleep(120);
  window.__q.tab('process').click();
  await sleep(1600);
  on = false;
  const moved = (k) => {
    const start = s[0][k], end = s[s.length - 1][k];
    const first = s.find((f) => Math.abs(f[k] - start) > 0.05);
    const last = [...s].reverse().find((f) => Math.abs(f[k] - end) > 0.05);
    return { from: start, to: end, startedAtMs: first ? Math.round(first.t) : null, endedAtMs: last ? Math.round(last.t) : null };
  };
  return { clickedAtMs: 120, process: moved('process'), about: moved('about'), selected: window.__q.tab('process').getAttribute('aria-selected') };
})()`);
console.log('\n══ PROCESS selected with the pointer away');
console.log(JSON.stringify(swap, null, 1));

ws.close();
chrome.kill();
