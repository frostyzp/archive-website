/**
 * Two loose ends from probe-about-hover-nudge: whether keyboard focus on the
 * peeking tab lifts the drawer the way hover does, and how long the close slide
 * actually takes when it is dismissed with ESC (sampled every frame rather than
 * read once). Also re-hovers after an open/close cycle, to catch an invitation
 * left stale by the round trip.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn, execSync } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9372;

// A run that throws never reaches chrome.kill(), and the next one then finds the
// port taken, attaches to the *old* browser, and reads a frozen page from the
// last session as if it were this one — which is how a 6px lift measured as 0.
try { execSync(`pkill -f "remote-debugging-port=${PORT}"`); } catch {}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-hover-focus-profile',
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
  // Screencast frames only keep coming while each one is acknowledged, and the
  // frames are what keep requestAnimationFrame — and so framer's clock — running.
  if (m.method === 'Page.screencastFrame') {
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
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
await send('Page.navigate', { url: `${BASE}/?view=grid` });
// Headless produces frames only on demand, and an idle page starves
// requestAnimationFrame — which froze framer's own clock partway through a slide
// and made a mid-flight x read as a resting place. A screencast keeps them coming.
await send('Page.startScreencast', { format: 'jpeg', quality: 1, everyNthFrame: 1 });

const ready = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) {
    if (document.querySelector('.about-drawer-tab')) break;
    await sleep(100);
  }
  await sleep(6000);
  window.__probe = {
    panel: () => document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]'),
    tab: () => document.querySelector('.about-drawer-tab'),
    read() {
      const p = this.panel(), t = this.tab();
      return {
        t: +(performance.now() - (this.t0 ?? performance.now())).toFixed(1),
        panelLeft: +p.getBoundingClientRect().left.toFixed(2),
        labelColor: getComputedStyle(t.querySelector('span')).color,
        activeId: document.activeElement?.id || null,
        focusVisible: !!document.activeElement?.matches(':focus-visible'),
      };
    },
    start() { this.samples = []; this.on = true; this.t0 = performance.now();
      const tick = () => { if (!this.on) return; this.samples.push(this.read()); requestAnimationFrame(tick); };
      requestAnimationFrame(tick); },
    stop() { this.on = false; return this.samples; },
  };
  // What the tab's focus handler is being asked: does :focus-visible hold at the
  // moment focusin runs, or only once the frame has settled?
  window.__focusLog = [];
  const t = document.querySelector('.about-drawer-tab');
  t.addEventListener('focus', () => window.__focusLog.push({ phase: 'focus', fv: t.matches(':focus-visible') }));
  t.addEventListener('focusin', () => window.__focusLog.push({ phase: 'focusin', fv: t.matches(':focus-visible') }));
  const b = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]').getBoundingClientRect();
  const tb = t.getBoundingClientRect();
  return { restX: +b.left.toFixed(2), tab: { cx: (tb.left + tb.right) / 2, cy: (tb.top + tb.bottom) / 2 } };
})()`);
console.log('\n══ rest', JSON.stringify(ready));

const restX = ready.restX;
const { cx, cy } = ready.tab;
const away = [420, 460];

// ── Keyboard focus, in a session that has not been through an open yet ──────
let presses = null;
for (let i = 1; i <= 90 && presses === null; i++) {
  await key('Tab', 'Tab', 9);
  const who = await evaluate(`document.activeElement?.id || document.activeElement?.tagName`);
  if (typeof who === 'string' && who.includes('about-tab-about')) presses = i;
}
await evaluate('window.__probe.start()');
await sleep(1600);
const focusSamples = await evaluate('window.__probe.stop()');
const focusLog = await evaluate('window.__focusLog');
console.log('\n══ keyboard focus on the peeking tab');
console.log(JSON.stringify({
  presses,
  frames: focusSamples.length,
  focusEvents: focusLog,
  trace: focusSamples.filter((_, i) => i % 8 === 0).map((s) => `${Math.round(s.t)}ms ${s.panelLeft} ${s.labelColor}`),
  xFirst: focusSamples[0]?.panelLeft,
  xLast: focusSamples[focusSamples.length - 1]?.panelLeft,
  liftPx: +(restX - focusSamples[focusSamples.length - 1]?.panelLeft).toFixed(2),
  colourFirst: focusSamples[0]?.labelColor,
  colourLast: focusSamples[focusSamples.length - 1]?.labelColor,
  activeId: focusSamples[focusSamples.length - 1]?.activeId,
  focusVisible: focusSamples[focusSamples.length - 1]?.focusVisible,
}, null, 1));

// Focus away again: the drawer should settle back.
await key('Tab', 'Tab', 9);
await sleep(1200);
const afterBlur = await evaluate('window.__probe.read()');
console.log('\n══ after focus moves on', JSON.stringify({ x: afterBlur.panelLeft, backAtRest: Math.abs(afterBlur.panelLeft - restX) < 0.5, colour: afterBlur.labelColor }));

// ── The close slide, frame by frame ─────────────────────────────────────────
await move(cx, cy);
await sleep(1000);
await click(cx, cy);
await sleep(1600);
const openX = (await evaluate('window.__probe.read()')).panelLeft;
await move(away[0], away[1]);
await sleep(300);
await evaluate('window.__probe.start()');
await key('Escape', 'Escape', 27);
await sleep(3500);
const closeSamples = (await evaluate('window.__probe.stop()')) || [];
const closeLast = closeSamples[closeSamples.length - 1] || {};
const startMove = closeSamples.find((s) => Math.abs(s.panelLeft - openX) > 0.5);
const endMove = [...closeSamples].reverse().find((s) => Math.abs(s.panelLeft - closeLast.panelLeft) > 0.05);
console.log('\n══ close slide (ESC)');
console.log(JSON.stringify({
  openX,
  firstMovementAtMs: startMove ? Math.round(startMove.t) : null,
  lastMovementAtMs: endMove ? Math.round(endMove.t) : null,
  slideMs: startMove && endMove ? Math.round(endMove.t - startMove.t) : null,
  frames: closeSamples.length,
  finalX: closeLast.panelLeft,
  backAtRest: Math.abs(closeLast.panelLeft - restX) < 0.5,
  trace: closeSamples.filter((_, i) => i % 20 === 0).map((s) => `${Math.round(s.t)}ms ${s.panelLeft}`),
}, null, 1));

// ── Hover once more, after the round trip ──────────────────────────────────
await evaluate('window.__probe.start()');
await move(cx, cy);
await sleep(1400);
const rehover = (await evaluate('window.__probe.stop()')) || [];
const reLast = rehover[rehover.length - 1] || {};
console.log('\n══ hover after an open/close cycle');
console.log(JSON.stringify({
  frames: rehover.length,
  x: reLast.panelLeft,
  nudgePx: +(restX - reLast.panelLeft).toFixed(2),
  colour: reLast.labelColor,
}, null, 1));

// ── A click focuses too: that must not count as an invitation ──────────────
// Open from the nudged state, close with ESC while the pointer is elsewhere, and
// check the tab still holds focus with the drawer sitting at its resting x.
await evaluate('window.__probe.start()');
await click(cx, cy);
await sleep(1500);
await move(away[0], away[1]);
await sleep(300);
await key('Escape', 'Escape', 27);
await sleep(2200);
const afterClickCycle = await evaluate('window.__probe.stop()');
const acLast = (afterClickCycle || []).slice(-1)[0] || {};
console.log('\n══ focus left behind by a click');
console.log(JSON.stringify({
  frames: (afterClickCycle || []).length,
  activeId: acLast.activeId,
  focusVisible: acLast.focusVisible,
  x: acLast.panelLeft,
  atRestNotLifted: Math.abs(acLast.panelLeft - restX) < 0.5,
  colour: acLast.labelColor,
}, null, 1));

ws.close();
chrome.kill();
