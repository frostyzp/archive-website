/**
 * The open drawer's folder tabs: how far the unread ones sit filed behind the
 * spine, how far they come back out when reached for, and on what clock. Samples
 * each tab's left edge and label colour every frame, hands the pointer from one
 * tab to the next, selects a tab that was being hovered, and checks the label
 * still clears the cut at the new resting offset.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9375;
const REDUCE = process.env.REDUCE === '1';

// A run that throws never reaches chrome.kill(), and the next one then attaches to
// the old browser and reads a frozen page from the last session as if it were this
// one — which is how a 6px lean once measured as 0.
try { execSync(`pkill -f "remote-debugging-port=${PORT}"`); } catch {}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/about-tab-tuck-profile${REDUCE ? '-rm' : ''}`,
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
if (REDUCE) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
}
await send('Page.navigate', { url: `${BASE}/?view=grid` });
await send('Page.startScreencast', { format: 'jpeg', quality: 1, everyNthFrame: 1 });

const ready = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) { if (document.querySelector('.about-drawer-tab')) break; await sleep(100); }
  await sleep(REDUCE_HOLD);

  // Headless draws on demand and an idle page starves requestAnimationFrame,
  // which is framer's clock — a stalled page freezes a lean mid-flight and the
  // recorder reads it as a resting place.
  const pump = document.createElement('div');
  pump.style.cssText = 'position:fixed;left:-4px;top:-4px;width:1px;height:1px;pointer-events:none;background:#000;';
  document.body.appendChild(pump);
  setInterval(() => { pump.style.opacity = pump.style.opacity === '0.5' ? '0.6' : '0.5'; }, 8);

  window.__probe = {
    panel: () => document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]'),
    tab: (id) => document.getElementById('about-tab-' + id),
    one(id) {
      const t = this.tab(id);
      const b = t.getBoundingClientRect();
      const span = t.querySelector('span');
      const sb = span.getBoundingClientRect();
      return {
        left: +b.left.toFixed(2),
        right: +b.right.toFixed(2),
        width: +b.width.toFixed(2),
        selected: t.getAttribute('aria-selected'),
        colour: getComputedStyle(span).color,
        labelLeft: +sb.left.toFixed(2),
        labelRight: +sb.right.toFixed(2),
      };
    },
    read() {
      return {
        t: +(performance.now() - (this.t0 ?? performance.now())).toFixed(1),
        panelLeft: +this.panel().getBoundingClientRect().left.toFixed(2),
        about: this.one('about'), process: this.one('process'), why: this.one('why'),
      };
    },
    opacity(i) { return +(+getComputedStyle(this.tab(i)).opacity).toFixed(3); },
    start() { this.samples = []; this.on = true; this.t0 = performance.now();
      const tick = () => { if (!this.on) return; this.samples.push(this.read()); requestAnimationFrame(tick); };
      requestAnimationFrame(tick); },
    stop() { this.on = false; return this.samples; },
  };

  // The staged entrance, sampled through the open: the two filed tabs must still
  // travel out from behind the spine on their own beats rather than being at their
  // resting offset before they are even visible.
  const strip = () => ({
    t: +(performance.now() - t0).toFixed(1),
    panelLeft: +window.__probe.panel().getBoundingClientRect().left.toFixed(2),
    process: { left: +window.__probe.tab('process').getBoundingClientRect().left.toFixed(2), o: window.__probe.opacity('process') },
    why: { left: +window.__probe.tab('why').getBoundingClientRect().left.toFixed(2), o: window.__probe.opacity('why') },
  });
  const arrival = [];
  const t0 = performance.now();
  let watching = true;
  const atick = () => { if (!watching) return; arrival.push(strip()); requestAnimationFrame(atick); };
  requestAnimationFrame(atick);
  document.querySelector('.about-drawer-tab').click();
  await sleep(2600);
  watching = false;

  const state = window.__probe.read();
  // The stock each tab wears: its own seeded crop, and it must still line up with
  // the tab now that the tab rests short of the strip's edge.
  const paper = ['about', 'process', 'why'].map((id) => {
    const t = window.__probe.tab(id);
    const layer = [...t.children].find((el) => getComputedStyle(el).filter.includes('roughpaper'));
    if (!layer) return { id, layer: false };
    const lb = layer.getBoundingClientRect(), tb = t.getBoundingClientRect();
    return {
      id,
      filter: getComputedStyle(layer).filter,
      alignsWithTab: Math.abs(lb.left - tb.left) < 0.5 && Math.abs(lb.width - tb.width) < 0.5
        && Math.abs(lb.top - tb.top) < 0.5 && Math.abs(lb.height - tb.height) < 0.5,
    };
  });
  // Relative to the strip's edge (where the open section's tab rests), so the
  // numbers read as "how far behind the spine" rather than as page coordinates.
  const edge = state.about.left;
  const beats = ['process', 'why'].map((k) => {
    const firstVisible = arrival.find((s) => s[k].o > 0.01);
    const firstMoved = arrival.find((s, i) => i > 0 && Math.abs(s[k].left - arrival[0][k].left) > 0.05);
    const lastMoved = [...arrival].reverse().find((s) => Math.abs(s[k].left - arrival[arrival.length - 1][k].left) > 0.05);
    return {
      id: k,
      startedBehindSpineBy: +(arrival[0][k].left - edge).toFixed(2),
      travelStartedAtMs: firstMoved ? Math.round(firstMoved.t) : null,
      travelEndedAtMs: lastMoved ? Math.round(lastMoved.t) : null,
      firstVisibleAtMs: firstVisible ? Math.round(firstVisible.t) : null,
      // Was it still travelling when it became visible? That is the entrance.
      movedWhileVisible: !!(firstVisible && lastMoved && lastMoved.t > firstVisible.t),
      restsBehindSpineBy: +(arrival[arrival.length - 1][k].left - edge).toFixed(2),
    };
  });
  return { ...state, paper, arrivalFrames: arrival.length, beats, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
})()`.replace('REDUCE_HOLD', REDUCE ? '1200' : '6000'));

if (ready?.error) { console.log(JSON.stringify(ready, null, 1)); ws.close(); chrome.kill(); process.exit(1); }

// The strip's own edge: where every tab used to rest, and where the open section's
// tab still does.
const stripEdge = ready.about.left;
const centre = (t) => ({ x: (t.left + t.right) / 2, y: 0 });
const rectOf = await evaluate(`(() => {
  const ids = ['about','process','why'];
  return ids.map((id) => { const b = document.getElementById('about-tab-' + id).getBoundingClientRect(); return { id, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2 }; });
})()`);
const at = (id) => rectOf.find((r) => r.id === id);

console.log('\n══ at rest, drawer open');
console.log(JSON.stringify({
  panelLeft: ready.panelLeft,
  reduced: ready.reduced,
  openSectionTab: { id: 'about', ...ready.about },
  filedTabs: [
    { id: 'process', ...ready.process },
    { id: 'why', ...ready.why },
  ],
  // The open section's tab is the reference: it never moved, so its left edge is
  // where all three used to sit.
  tuckPx: {
    process: +(ready.process.left - stripEdge).toFixed(2),
    why: +(ready.why.left - stripEdge).toFixed(2),
  },
  spineAt: ready.panelLeft,
  labelClearsTheCut: {
    process: +(ready.panelLeft - ready.process.labelRight).toFixed(2),
    why: +(ready.panelLeft - ready.why.labelRight).toFixed(2),
  },
  paper: ready.paper,
  arrivalFrames: ready.arrivalFrames,
  stagedEntrance: ready.beats,
}, null, 1));

// ── The lean, frame by frame ────────────────────────────────────────────────
await move(300, 400);
await sleep(400);
await evaluate('window.__probe.start()');
await move(at('process').cx, at('process').cy);
await sleep(1500);
const out = await evaluate('window.__probe.stop()');
const restL = out[0].process.left;
const peakL = Math.min(...out.map((s) => s.process.left));
const first = out.find((s) => Math.abs(s.process.left - restL) > 0.05);
const within = out.find((s) => Math.abs(s.process.left - peakL) <= 0.1);
const done = out.find((s) => s.process.left === peakL);

await evaluate('window.__probe.start()');
await move(300, 400);
await sleep(1500);
const back = await evaluate('window.__probe.stop()');
const backL = back[back.length - 1].process.left;
const backFirst = back.find((s) => Math.abs(s.process.left - peakL) > 0.05);
const backDone = back.find((s) => s.process.left === backL);

console.log('\n══ PROCESS reached for');
console.log(JSON.stringify({
  restingLeft: restL,
  hoveredLeft: peakL,
  travelPx: +(restL - peakL).toFixed(2),
  landsOnStripEdge: Math.abs(peakL - stripEdge) < 0.5,
  msToWithin0_1px: first && within ? Math.round(within.t - first.t) : null,
  msToLastMovedFrame: first && done ? Math.round(done.t - first.t) : null,
  colourAtRest: out[0].process.colour,
  colourHovered: out[out.length - 1].process.colour,
  colourSteps: new Set(out.map((s) => s.process.colour)).size,
  trace: out.filter((_, i) => i % 8 === 0).map((s) => `${Math.round(s.t)}ms ${s.process.left}`),
  settledBackTo: backL,
  returnedToTuck: Math.abs(backL - restL) < 0.5,
  settleBackMs: backFirst && backDone ? Math.round(backDone.t - backFirst.t) : 0,
  colourDimmedBackTo: back[back.length - 1].process.colour,
  otherTabsUnmoved: {
    about: back[back.length - 1].about.left === ready.about.left,
    why: back[back.length - 1].why.left === ready.why.left,
  },
}, null, 1));

// ── Hand-off: PROCESS → THE WHY ─────────────────────────────────────────────
await move(at('process').cx, at('process').cy);
await sleep(1200);
await evaluate('window.__probe.start()');
await move(at('why').cx, at('process').cy + 40);
await sleep(200);
await move(at('why').cx, at('why').cy);
await sleep(1400);
const cross = await evaluate('window.__probe.stop()');
const end = cross[cross.length - 1];
console.log('\n══ hand-off from PROCESS to THE WHY');
console.log(JSON.stringify({
  processEndsAt: end.process.left,
  processBackInTuck: Math.abs(end.process.left - ready.process.left) < 0.5,
  whyEndsAt: end.why.left,
  whyOutOnStripEdge: Math.abs(end.why.left - stripEdge) < 0.5,
  neitherStuckOut: Math.abs(end.process.left - ready.process.left) < 0.5 && Math.abs(end.why.left - stripEdge) < 0.5,
  colours: { process: end.process.colour, why: end.why.colour },
}, null, 1));

// ── Stills ─────────────────────────────────────────────────────────────────
const shoot = async (file, r, scale = 3) => {
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale } });
  if (s?.data) fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  return file;
};
const strip = { x: ready.panelLeft - 70, y: 0, w: 120, h: 380 };
const sfx = REDUCE ? '-reduced' : '';
await move(300, 400);
await sleep(1200);
const restShot = await shoot(`/tmp/about-tabs-rest${sfx}.png`, strip);
await move(at('process').cx, at('process').cy);
await sleep(1200);
const processShot = await shoot(`/tmp/about-tabs-process-hover${sfx}.png`, strip);
await move(at('why').cx, at('why').cy);
await sleep(1200);
const whyShot = await shoot(`/tmp/about-tabs-why-hover${sfx}.png`, strip);
console.log('\n══ stills');
console.log(JSON.stringify({ restShot, processShot, whyShot, clip: strip, scale: 3 }, null, 1));

if (REDUCE) {
  console.log('\n══ reduced motion');
  console.log(JSON.stringify({
    restingLeft: restL,
    hoveredLeft: peakL,
    travelPx: +(restL - peakL).toFixed(2),
    didNotTravel: Math.abs(restL - peakL) < 0.5,
    stillFiledBehindSpine: +(restL - stripEdge).toFixed(2),
    colourStillLifted: out[0].process.colour !== out[out.length - 1].process.colour,
  }, null, 1));
  ws.close();
  chrome.kill();
  process.exit(0);
}

// ── Selecting a tab you were hovering ──────────────────────────────────────
await move(at('why').cx, at('why').cy);
await sleep(1000);
await evaluate('window.__probe.start()');
await click(at('why').cx, at('why').cy);
await sleep(1600);
const picked = await evaluate('window.__probe.stop()');
const pickedEnd = picked[picked.length - 1];
const whyLefts = picked.map((s) => s.why.left);
console.log('\n══ selecting THE WHY while hovering it');
console.log(JSON.stringify({
  selected: pickedEnd.why.selected,
  leftBefore: picked[0].why.left,
  leftAfter: pickedEnd.why.left,
  flushWithStripEdge: Math.abs(pickedEnd.why.left - stripEdge) < 0.5,
  overhangPastSpine: +(pickedEnd.why.right - pickedEnd.panelLeft).toFixed(2),
  movedDuringSelection: +(Math.max(...whyLefts) - Math.min(...whyLefts)).toFixed(2),
  colour: pickedEnd.why.colour,
  aboutNowFiled: +(pickedEnd.about.left - stripEdge).toFixed(2),
}, null, 1));

// ── Keyboard ───────────────────────────────────────────────────────────────
await move(300, 400);
await sleep(600);
const seen = [];
let processPresses = null;
for (let i = 1; i <= 40; i++) {
  await key('Tab', 'Tab', 9);
  const who = await evaluate(`document.activeElement?.id || document.activeElement?.tagName`);
  if (typeof who === 'string') {
    seen.push(who);
    if (who === 'about-tab-process') { processPresses = i; break; }
  }
}
await evaluate('window.__probe.start()');
await sleep(1400);
const kb = await evaluate('window.__probe.stop()');
const kbEnd = kb[kb.length - 1] || {};
const focusVisible = await evaluate(`!!document.activeElement?.matches(':focus-visible')`);
console.log('\n══ keyboard');
console.log(JSON.stringify({
  tabOrder: seen,
  pressesToProcess: processPresses,
  focusVisible,
  processLeftWhileFocused: kbEnd.process?.left,
  liftPx: kbEnd.process ? +(ready.process.left - kbEnd.process.left).toFixed(2) : null,
  colour: kbEnd.process?.colour,
}, null, 1));
await key('Tab', 'Tab', 9);
await sleep(1200);
const afterBlur = await evaluate('window.__probe.read()');
console.log('\n══ focus moves on');
console.log(JSON.stringify({
  activeId: await evaluate(`document.activeElement?.id || document.activeElement?.tagName`),
  processLeft: afterBlur.process.left,
  backInTuck: Math.abs(afterBlur.process.left - ready.process.left) < 0.5,
  nextTabLeft: afterBlur.why.left,
}, null, 1));

ws.close();
chrome.kill();
