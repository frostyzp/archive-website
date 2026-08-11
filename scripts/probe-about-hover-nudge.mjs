/**
 * The shut About drawer's hover invitation: how far it leans out, over how long,
 * and whether the tab's lettering fades to the accent while it does. Samples the
 * panel's left edge and the tab label's computed colour every frame, drives the
 * pointer from the tab onto the sliver to prove the two are one hover region,
 * and checks the lean stays out of the open / closing / entrance states.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9371;
const REDUCE = process.env.REDUCE === '1';

// A run that throws never reaches chrome.kill(), and the next one then finds the
// port taken, attaches to the *old* browser, and reads a frozen page from the
// last session as if it were this one — which is how a 6px lift measured as 0.
try { execSync(`pkill -f "remote-debugging-port=${PORT}"`); } catch {}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/about-hover-nudge-profile${REDUCE ? '-rm' : ''}`,
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
const move = (x, y) =>
  send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), buttons: 0 });
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
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
}
await send('Page.navigate', { url: `${BASE}/?view=grid` });
// Headless produces frames only when something asks it to, and an idle page
// starves requestAnimationFrame: without this the recorder froze partway through
// a slide and a mid-flight x read as the drawer's resting place. A screencast
// keeps BeginFrames coming, which is also what keeps framer's own clock running.
await send('Page.startScreencast', { format: 'jpeg', quality: 1, everyNthFrame: 1 });

// The peek entrance is ~1.83s of delay plus a 0.48s slide, and the nudge is
// deliberately refused until it has landed, so nothing is measured before then.
const ready = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) {
    if (document.querySelector('.about-drawer-tab')) break;
    await sleep(100);
  }
  await sleep(REDUCE_HOLD);
  const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
  const tab = document.querySelector('.about-drawer-tab');
  if (!panel || !tab) return { error: 'drawer not found' };

  // Headless draws on demand, and under load it stops asking altogether: framer's
  // clock is requestAnimationFrame, so a stalled page froze a slide partway and
  // the recorder read the mid-flight x as a resting place. A hair off-screen,
  // changing every few ms, keeps damage — and therefore frames — coming.
  const pump = document.createElement('div');
  pump.style.cssText = 'position:fixed;left:-4px;top:-4px;width:1px;height:1px;pointer-events:none;background:#000;';
  document.body.appendChild(pump);
  setInterval(() => { pump.style.opacity = pump.style.opacity === '0.5' ? '0.6' : '0.5'; }, 8);

  window.__probe = {
    panel: () => document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]'),
    tab: () => document.querySelector('.about-drawer-tab'),
    read() {
      const p = this.panel(), t = this.tab();
      const pb = p.getBoundingClientRect(), tb = t.getBoundingClientRect();
      const label = t.querySelector('span');
      return {
        t: +(performance.now() - (this.t0 ?? performance.now())).toFixed(1),
        panelLeft: +pb.left.toFixed(2),
        tabLeft: +tb.left.toFixed(2),
        tabRight: +tb.right.toFixed(2),
        labelColor: getComputedStyle(label).color,
        peekAttr: t.getAttribute('data-peek'),
      };
    },
    start() { this.samples = []; this.on = true; this.t0 = performance.now();
      const tick = () => { if (!this.on) return; this.samples.push(this.read()); requestAnimationFrame(tick); };
      requestAnimationFrame(tick); },
    stop() { this.on = false; return this.samples; },
  };

  const pb = panel.getBoundingClientRect(), tb = tab.getBoundingClientRect();
  // Where the copy column's own left edge sits, to prove the lean never drags it
  // out from behind the screen edge.
  const col = document.getElementById('about-panel-body');
  return {
    vw: window.innerWidth,
    panelLeft: +pb.left.toFixed(2), panelWidth: +pb.width.toFixed(2),
    sliverPx: +(window.innerWidth - pb.left).toFixed(2),
    tab: { left: +tb.left.toFixed(2), right: +tb.right.toFixed(2), top: +tb.top.toFixed(2), bottom: +tb.bottom.toFixed(2) },
    columnLeft: col ? +col.getBoundingClientRect().left.toFixed(2) : null,
    labelColor: getComputedStyle(tab.querySelector('span')).color,
    peekAttr: tab.getAttribute('data-peek'),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
})()`.replace('REDUCE_HOLD', REDUCE ? '1200' : '6000'));

console.log('\n══ at rest');
console.log(JSON.stringify(ready, null, 1));
if (ready?.error) { ws.close(); chrome.kill(); process.exit(1); }

const tabCx = (ready.tab.left + ready.tab.right) / 2;
const tabCy = (ready.tab.top + ready.tab.bottom) / 2;
const away = { x: 420, y: 460 };

// ── 1. Lean out, hold, settle back ─────────────────────────────────────────
await move(away.x, away.y);
await sleep(400);
await evaluate('window.__probe.start()');
await move(tabCx, tabCy);
await sleep(1500);
const outSamples = await evaluate('window.__probe.stop()');
const restX = outSamples[0].panelLeft;
const peakX = Math.min(...outSamples.map((s) => s.panelLeft));
const firstMove = outSamples.find((s) => Math.abs(s.panelLeft - restX) > 0.05);
// An ease-out spends its last fraction of a pixel asymptotically, so the tween's
// length is read two ways: to the point it is visually there (0.1px), and to the
// last frame that moved at all.
const nearlyThere = outSamples.find((s) => Math.abs(s.panelLeft - peakX) <= 0.1);
const settled = outSamples.find((s) => s.panelLeft === peakX);
const outMs = firstMove && settled ? Math.round(settled.t - firstMove.t) : null;
const outMs99 = firstMove && nearlyThere ? Math.round(nearlyThere.t - firstMove.t) : null;

await evaluate('window.__probe.start()');
await move(away.x, away.y);
await sleep(1500);
const backSamples = await evaluate('window.__probe.stop()');
const backX = backSamples[backSamples.length - 1].panelLeft;
const backFirst = backSamples.find((s) => Math.abs(s.panelLeft - peakX) > 0.05);
const backLast = [...backSamples].reverse().find((s) => Math.abs(s.panelLeft - backX) > 0.05);

console.log('\n══ 1. lean / settle');
console.log(JSON.stringify({
  restX, peakX, nudgePx: +(restX - peakX).toFixed(2),
  leanOutMsToWithin0_1px: outMs99,
  leanOutMsToLastMovedFrame: outMs,
  frames: outSamples.length,
  leanTrace: outSamples.filter((_, i) => i % 6 === 0).map((s) => `${Math.round(s.t)}ms ${s.panelLeft}`),
  returnedToX: backX,
  returnCleanlyToRest: Math.abs(backX - restX) < 0.5,
  settleBackMs: backFirst && backLast ? Math.round(backLast.t - backFirst.t) : 0,
}, null, 1));

// ── 3. The colour, sampled across frames ───────────────────────────────────
const colours = outSamples.map((s) => s.labelColor);
const distinct = [...new Set(colours)];
console.log('\n══ 3. tab label colour');
console.log(JSON.stringify({
  atRest: colours[0],
  atPeak: colours[colours.length - 1],
  distinctValuesDuringFade: distinct.length,
  snapped: distinct.length <= 2,
  sampled: colours.filter((_, i) => i % 6 === 0).slice(0, 14),
  dimmedBackTo: backSamples[backSamples.length - 1].labelColor,
}, null, 1));

// ── 2. Tab and sliver as one region ────────────────────────────────────────
await move(tabCx, tabCy);
await sleep(1200);
const nudged = await evaluate('window.__probe.read()');
await evaluate('window.__probe.start()');
// Out of the tab, across the spine, then down the length of the sliver.
const sliverX = nudged.panelLeft + 8;
for (const p of [
  [tabCx + 10, tabCy], [nudged.panelLeft - 2, tabCy], [sliverX, tabCy],
  [sliverX, tabCy + 120], [sliverX, 500], [sliverX, 760],
]) {
  await move(p[0], p[1]);
  await sleep(120);
}
await sleep(300);
const crossing = await evaluate('window.__probe.stop()');
const crossMax = Math.max(...crossing.map((s) => s.panelLeft));
console.log('\n══ 2. tab → sliver crossing');
console.log(JSON.stringify({
  nudgedX: nudged.panelLeft,
  worstXDuringCrossing: crossMax,
  driftPx: +(crossMax - nudged.panelLeft).toFixed(2),
  heldThroughout: crossMax - nudged.panelLeft < 0.5,
  colourHeld: [...new Set(crossing.map((s) => s.labelColor))],
  endsOnSliver: await evaluate(`(() => {
    const el = document.elementFromPoint(${Math.round(sliverX)}, 760);
    const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
    return { hit: el?.tagName.toLowerCase() + '.' + (el?.className||'').toString().slice(0,22), insidePanel: !!(el && panel.contains(el)) };
  })()`),
}, null, 1));

// ── 7. Stills: at rest and at hover peak ───────────────────────────────────
const shoot = async (file, r, scale = 3) => {
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale },
  });
  if (s?.data) fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  return file;
};
const strip = { x: ready.vw - 150, y: 40, w: 150, h: 300 };
const suffix = REDUCE ? '-reduced' : '';
await move(tabCx, tabCy);
await sleep(1200);
const peakShot = await shoot(`/tmp/about-hover-peak${suffix}.png`, strip);
await move(away.x, away.y);
await sleep(1400);
const restShot = await shoot(`/tmp/about-hover-rest${suffix}.png`, strip);
console.log('\n══ 7. stills');
console.log(JSON.stringify({ restShot, peakShot, clip: strip, scale: 3 }, null, 1));

// ── 6. Reduced motion stops here: no travel is the whole assertion ─────────
if (REDUCE) {
  console.log('\n══ 6. reduced motion');
  console.log(JSON.stringify({
    restX, peakX, travelPx: +(restX - peakX).toFixed(2),
    didNotTravel: Math.abs(restX - peakX) < 0.5,
    colourStillLifted: colours[0] !== colours[colours.length - 1],
    atRest: colours[0], atPeak: colours[colours.length - 1],
  }, null, 1));
  ws.close();
  chrome.kill();
  process.exit(0);
}

// ── 5. Click from the nudged state, and keyboard reach ─────────────────────
await move(tabCx, tabCy);
await sleep(1000);
const beforeClick = await evaluate('window.__probe.read()');
await evaluate('window.__probe.start()');
await click(tabCx, tabCy);
await sleep(1400);
const opening = await evaluate('window.__probe.stop()');
const openState = await evaluate(`(() => {
  const p = window.__probe.panel();
  return { ...window.__probe.read(), ariaModal: p.getAttribute('aria-modal'), width: +p.getBoundingClientRect().width.toFixed(1) };
})()`);
console.log('\n══ 5a. click from the nudged state');
console.log(JSON.stringify({
  nudgedXBeforeClick: beforeClick.panelLeft,
  openedToX: openState.panelLeft,
  openWidth: openState.width,
  ariaModal: openState.ariaModal,
  monotonicSlide: opening.every((s, i, a) => i === 0 || s.panelLeft <= a[i - 1].panelLeft + 0.5),
  slideMs: (() => {
    const f = opening.find((s) => Math.abs(s.panelLeft - beforeClick.panelLeft) > 0.5);
    const l = [...opening].reverse().find((s) => Math.abs(s.panelLeft - openState.panelLeft) > 0.05);
    return f && l ? Math.round(l.t - f.t) : null;
  })(),
}, null, 1));

// ── 4. Hover does nothing while open ───────────────────────────────────────
await evaluate('window.__probe.start()');
for (const p of [[openState.panelLeft + 40, 300], [openState.panelLeft + 4, 500], [openState.panelLeft - 20, 200], [openState.panelLeft + 200, 700]]) {
  await move(p[0], p[1]);
  await sleep(200);
}
await sleep(400);
const whileOpen = await evaluate('window.__probe.stop()');
const openXs = whileOpen.map((s) => s.panelLeft);
console.log('\n══ 4a. hover while open');
console.log(JSON.stringify({
  openX: openState.panelLeft,
  minX: Math.min(...openXs), maxX: Math.max(...openXs),
  panelHeldStill: Math.max(...openXs) - Math.min(...openXs) < 0.5,
  peekAttrWhileOpen: whileOpen[0].peekAttr,
}, null, 1));

// The stylesheet's hover lift still belongs to the open drawer's unread sections:
// the peeking tab is exempted by [data-peek], which is only set while shut.
const unread = await evaluate(`(() => {
  const t = document.getElementById('about-tab-process');
  const b = t.getBoundingClientRect();
  return { cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2, peekAttr: t.getAttribute('data-peek'), colour: getComputedStyle(t.querySelector('span')).color };
})()`);
await move(unread.cx, unread.cy);
await sleep(500);
const unreadHovered = await evaluate(`getComputedStyle(document.getElementById('about-tab-process').querySelector('span')).color`);
console.log('\n══ 4c. the open drawer\'s other tabs keep the stylesheet lift');
console.log(JSON.stringify({
  peekAttr: unread.peekAttr,
  colourAtRest: unread.colour,
  colourHovered: unreadHovered,
  stillLifts: unread.colour !== unreadHovered,
}, null, 1));

// Close with ESC, pointer parked off the drawer, and confirm it lands on the
// resting sliver rather than the nudged one.
await move(away.x, away.y);
await sleep(200);
// Sampled rather than read once: a pending rAF is what keeps headless asking for
// frames, and without one the close slide freezes wherever it had got to.
await evaluate('window.__probe.start()');
await key('Escape', 'Escape', 27);
await sleep(2000);
const closing = await evaluate('window.__probe.stop()');
const afterClose = closing[closing.length - 1];
console.log('\n══ 4b. after close');
console.log(JSON.stringify({
  x: afterClose.panelLeft,
  backAtRest: Math.abs(afterClose.panelLeft - restX) < 0.5,
  labelColor: afterClose.labelColor,
  peekAttr: afterClose.peekAttr,
  closeSlideMs: (() => {
    const f = closing.find((s) => Math.abs(s.panelLeft - openState.panelLeft) > 0.5);
    const l = closing.find((s) => s.panelLeft === afterClose.panelLeft);
    return f && l ? Math.round(l.t - f.t) : null;
  })(),
}, null, 1));

// ── 5b. Keyboard: can the tab be reached, and does focus lift it ───────────
const reach = await evaluate(`(() => { document.body.focus?.(); (document.activeElement||document.body).blur?.(); return document.activeElement?.tagName; })()`);
let reachedAfter = null;
for (let i = 1; i <= 90 && reachedAfter === null; i++) {
  await key('Tab', 'Tab', 9);
  const who = await evaluate(`(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) + '' : null; })()`);
  if (typeof who === 'string' && who.includes('about-tab-about')) reachedAfter = i;
}
await evaluate('window.__probe.start()');
await sleep(1600);
const focusSamples = await evaluate('window.__probe.stop()');
const focused = await evaluate(`(() => ({ ...window.__probe.read(), focusVisible: document.activeElement?.matches(':focus-visible'), activeId: document.activeElement?.id }))()`);
console.log('\n══ 5b. keyboard');
console.log(JSON.stringify({
  startedFrom: reach,
  tabPressesToReachTab: reachedAfter,
  activeId: focused.activeId,
  focusVisible: focused.focusVisible,
  xWhileFocused: focused.panelLeft,
  focusLiftPx: +(restX - focused.panelLeft).toFixed(2),
  labelColorWhileFocused: focused.labelColor,
  focusTrace: focusSamples.filter((_, i) => i % 10 === 0).map((s) => `${Math.round(s.t)}ms ${s.panelLeft}`),
}, null, 1));

ws.close();
chrome.kill();
