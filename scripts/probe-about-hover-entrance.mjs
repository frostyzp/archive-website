/**
 * The adversarial case for the hover lean: a pointer already parked where the
 * sliver is about to arrive, so the drawer slides in under it and the hover fires
 * mid-entrance. The entrance must land on its resting x regardless, and the lean
 * must only become available afterwards.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn, execSync } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9374;

try { execSync(`pkill -f "remote-debugging-port=${PORT}"`); } catch {}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-hover-entrance-profile',
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
  if (r?.exceptionDetails) return { error: r.exceptionDetails.text, detail: r.exceptionDetails?.exception?.description };
  return r?.result?.value;
};
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), buttons: 0 });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${BASE}/?view=grid` });

// Pointer parked in the strip the tab and sliver will occupy, before either is on
// screen: the drawer's entrance then slides in under a stationary cursor.
await move(1400, 54);

const report = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 200; i++) {
    if (document.querySelector('.about-drawer-tab')) break;
    await sleep(50);
  }
  // Frames on demand starve an idle headless page, and framer's clock is rAF.
  const pump = document.createElement('div');
  pump.style.cssText = 'position:fixed;left:-4px;top:-4px;width:1px;height:1px;pointer-events:none;background:#000;';
  document.body.appendChild(pump);
  setInterval(() => { pump.style.opacity = pump.style.opacity === '0.5' ? '0.6' : '0.5'; }, 8);

  const panel = () => document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
  const tab = () => document.querySelector('.about-drawer-tab');
  const samples = [];
  const t0 = performance.now();
  let on = true;
  const tick = () => {
    if (!on) return;
    const p = panel(), t = tab();
    if (p && t) samples.push({
      t: +(performance.now() - t0).toFixed(1),
      x: +p.getBoundingClientRect().left.toFixed(2),
      tabLeft: +t.getBoundingClientRect().left.toFixed(2),
      colour: getComputedStyle(t.querySelector('span')).color,
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Short on purpose: other agents are editing this app, and a Vite page reload
  // in the middle of a long in-page await discards the execution context and the
  // evaluate never comes back. The entrance is over inside ~2.5s.
  await sleep(4500);
  on = false;

  const moved = samples.filter((s, i, a) => i > 0 && Math.abs(s.x - a[i - 1].x) > 0.01);
  const last = samples[samples.length - 1];
  // The entrance is one monotonic run to the left; a nudge landing mid-slide
  // would show up as a stall (the entrance delay re-queued) or as an overshoot
  // past the resting x.
  const minX = Math.min(...samples.map((s) => s.x));
  return {
    frames: samples.length,
    firstX: samples[0]?.x,
    restingX: last.x,
    tabLeftAtRest: last.tabLeft,
    furthestLeftDuringEntrance: minX,
    overshotResting: minX < last.x - 0.5,
    colourDuringEntrance: [...new Set(samples.slice(0, Math.max(1, moved.length)).map((s) => s.colour))].slice(0, 4),
    colourAtRest: last.colour,
    movementSpanMs: moved.length ? Math.round(moved[moved.length - 1].t - moved[0].t) : 0,
    trace: samples.filter((_, i) => i % 25 === 0).map((s) => \`\${Math.round(s.t)}ms \${s.x}\`),
  };
})()`);

console.log('\n══ entrance with the pointer already parked on the strip');
console.log(JSON.stringify(report, null, 1));

// Now that it has landed, the lean should be available: jog the pointer inside
// the region so a fresh pointerenter is generated, then read the settled x.
await move(700, 400);
await sleep(400);
await move(1400, 54);
await sleep(1400);
const after = await evaluate(`(() => {
  const p = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
  const t = document.querySelector('.about-drawer-tab');
  return { x: +p.getBoundingClientRect().left.toFixed(2), colour: getComputedStyle(t.querySelector('span')).color };
})()`);
console.log('\n══ lean after the entrance has landed');
console.log(JSON.stringify({ ...after, nudgePx: +(report.restingX - after.x).toFixed(2) }, null, 1));

ws.close();
chrome.kill();
