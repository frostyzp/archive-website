/**
 * Where the drawer ends up after a close, sampled defensively: the earlier
 * frame-by-frame recorder stopped dead partway through an ESC dismiss, so this
 * one catches its own errors, counts the tabs in the DOM, and watches for the
 * panel element being swapped out from under it. Closes both ways — ESC and the
 * backdrop — and reports the resting x each time.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9373;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-close-settle-profile',
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
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, buttons: 0 });
};
const key = async (k, code, keyCode) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
};

await send('Page.enable');
await send('Runtime.enable');
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push(m.params.args.map((a) => a.value || a.description).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION ' + m.params.exceptionDetails?.exception?.description?.split('\n')[0]);
  }
});
await send('Page.navigate', { url: `${BASE}/?view=grid` });
// Headless only produces frames when something asks it to, and an idle page
// starves requestAnimationFrame — which froze the last recorder partway through
// a close slide and made a mid-flight x look like the drawer's resting place. A
// screencast keeps BeginFrames coming for the length of the run.
await send('Page.startScreencast', { format: 'jpeg', quality: 1, everyNthFrame: 1 });

const ready = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) { if (document.querySelector('.about-drawer-tab')) break; await sleep(100); }
  await sleep(6000);
  window.__probe = {
    panel: () => document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]'),
    read() {
      const p = this.panel();
      const tabs = document.querySelectorAll('.about-drawer-tab');
      const out = {
        t: +(performance.now() - (this.t0 ?? performance.now())).toFixed(1),
        panelLeft: p ? +p.getBoundingClientRect().left.toFixed(2) : null,
        panelSame: p ? p === this.pin : null,
        tabs: tabs.length,
        modal: p?.getAttribute('aria-modal'),
      };
      try { out.labelColor = getComputedStyle(tabs[0].querySelector('span')).color; } catch (e) { out.labelColor = 'ERR:' + e.message; }
      return out;
    },
    start() { this.samples = []; this.on = true; this.t0 = performance.now(); this.pin = this.panel(); this.err = null;
      const tick = () => {
        if (!this.on) return;
        try { this.samples.push(this.read()); } catch (e) { this.err = e.message + ' @' + (performance.now() - this.t0).toFixed(0) + 'ms'; return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick); },
    stop() { this.on = false; return { samples: this.samples, err: this.err }; },
  };
  const p = window.__probe.panel().getBoundingClientRect();
  const tb = document.querySelector('.about-drawer-tab').getBoundingClientRect();
  return { restX: +p.left.toFixed(2), cx: (tb.left + tb.right) / 2, cy: (tb.top + tb.bottom) / 2 };
})()`);
console.log('\n══ rest', JSON.stringify(ready));

const summarise = (label, restX, r, openX) => {
  const s = r.samples || [];
  if (!s.length) {
    console.log(`\n══ ${label}\n{ "frames": 0, "recorderError": ${JSON.stringify(r.err)} }`);
    return;
  }
  const last = s[s.length - 1];
  const first = s.find((v) => Math.abs(v.panelLeft - openX) > 0.5);
  const end = [...s].reverse().find((v) => Math.abs(v.panelLeft - last.panelLeft) > 0.05);
  console.log(`\n══ ${label}`);
  console.log(JSON.stringify({
    recorderError: r.err,
    frames: s.length,
    spanMs: Math.round(last.t),
    firstMovementMs: first ? Math.round(first.t) : null,
    lastMovementMs: end ? Math.round(end.t) : null,
    slideMs: first && end ? Math.round(end.t - first.t) : null,
    finalX: last.panelLeft,
    backAtRest: Math.abs(last.panelLeft - restX) < 0.5,
    panelStillTheSameElement: last.panelSame,
    tabsInDom: last.tabs,
    trace: s.filter((_, i) => i % 10 === 0).map((v) => `${Math.round(v.t)}ms ${v.panelLeft} tabs:${v.tabs}`),
  }, null, 1));
};

// ── ESC ─────────────────────────────────────────────────────────────────────
await move(ready.cx, ready.cy);
await sleep(900);
await click(ready.cx, ready.cy);
await sleep(1600);
const openX = (await evaluate('window.__probe.read()')).panelLeft;
await move(420, 460);
await sleep(300);
await evaluate('window.__probe.start()');
await key('Escape', 'Escape', 27);
await sleep(4000);
summarise('close by ESC', ready.restX, await evaluate('window.__probe.stop()'), openX);

// ── Backdrop ────────────────────────────────────────────────────────────────
await move(ready.cx, ready.cy);
await sleep(1200);
await click(ready.cx, ready.cy);
await sleep(1600);
await move(300, 400);
await sleep(200);
await evaluate('window.__probe.start()');
await click(300, 400);
await sleep(4000);
summarise('close by backdrop', ready.restX, await evaluate('window.__probe.stop()'), openX);

// ── Hover again, after both round trips ────────────────────────────────────
await evaluate('window.__probe.start()');
await move(ready.cx, ready.cy);
await sleep(1500);
const re = await evaluate('window.__probe.stop()');
const reLast = re.samples[re.samples.length - 1];
console.log('\n══ hover after two open/close cycles');
console.log(JSON.stringify({ x: reLast.panelLeft, nudgePx: +(ready.restX - reLast.panelLeft).toFixed(2), colour: reLast.labelColor, recorderError: re.err }, null, 1));
await move(420, 460);
await sleep(1200);
console.log('\n══ settled', JSON.stringify(await evaluate('window.__probe.read()')));

console.log('\n══ page errors', JSON.stringify(logs.slice(0, 8), null, 1));

ws.close();
chrome.kill();
