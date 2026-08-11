/**
 * Which way the closing beat's cue arrow rides, and what it has to spare.
 *
 * The arrow loops on a transform rather than on layout, so its box moves while
 * nothing around it does: the numbers that matter are the extremes of that
 * transform (negative = it climbs) and, at its highest point, the air between it
 * and the line above it, the control it sits in, and the top of the window.
 *
 * Same recording trick as probe-onboarding-rise-frames.mjs — `Page.captureScreenshot`
 * has a round trip far longer than the 1.6s loop is worth aiming inside, so the
 * bob is taken off the compositor with `Page.startScreencast` and a still of the
 * whole beat is taken afterwards for the layout.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9351;
const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'phone', width: 390, height: 844 },
];
const BOB_MS = 1600; // one full loop
const KEEP = 6; // frames spread across the loop

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/onboarding-closing-cue-profile',
  '--window-size=2880,1800',
  '--force-device-scale-factor=1',
  'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 80; i++) {
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
const handlers = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  } else if (m.method && handlers.has(m.method)) {
    handlers.get(m.method)(m.params);
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

const HELPERS = `
  const PRINTS = () => [...document.querySelectorAll('img')]
    .filter((im) => /intro-booth-park|confession_notes_2/.test(im.src))
    .filter((im) => im.closest('[style*="will-change"]'));
  const stepKey = (key) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const ARROW = () => {
    const arrows = [...document.querySelectorAll('span')].filter(
      (s) => (s.textContent || '').trim() === '\\u2193'
    );
    return arrows.find((s) => s.closest('.onboarding-cta')) || null;
  };
`;

const READY = `(async () => {
  ${HELPERS}
  const deadline = performance.now() + 25000;
  while (performance.now() < deadline && PRINTS().length < 4) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  if (PRINTS().length < 4) return { error: 'prints never mounted' };
  await new Promise((r) => setTimeout(r, 7500));
  return { ok: true };
})()`;

/** Waits out the beat's hold and the exit arming, then samples the loop. */
const CUE = `(async () => {
  ${HELPERS}
  const el = ARROW();
  if (!el) return { error: 'no cue arrow inside the CTA' };
  const visible = performance.now() + 12000;
  while (performance.now() < visible) {
    const o = parseFloat(getComputedStyle(el.parentElement).opacity);
    if (o > 0.5) break;
    await new Promise((r) => requestAnimationFrame(r));
  }
  const btn = el.closest('.onboarding-cta');
  const copy = document.querySelector('h2[aria-label]');
  const samples = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ${BOB_MS * 2}) {
    samples.push({
      at: Math.round(performance.now() - t0),
      y: +new DOMMatrixReadOnly(getComputedStyle(el).transform || '').f.toFixed(2),
      top: Math.round(el.getBoundingClientRect().top),
    });
    await new Promise((r) => requestAnimationFrame(r));
  }
  const ys = samples.map((s) => s.y);
  const tops = samples.map((s) => s.top);
  const br = btn.getBoundingClientRect();
  const cr = copy ? copy.getBoundingClientRect() : null;
  return {
    frames: samples.length,
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    highestTop: Math.min(...tops),
    restTop: Math.max(...tops),
    copyBottom: cr ? Math.round(cr.bottom) : null,
    copyText: copy ? copy.getAttribute('aria-label') : null,
    button: { top: Math.round(br.top), bottom: Math.round(br.bottom) },
    viewportH: window.innerHeight,
  };
})()`;

for (const vp of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await send('Page.navigate', { url: BASE });
  const ready = await evaluate(READY);
  if (ready?.error) {
    console.log(`${vp.label}: ${ready.error}`);
    continue;
  }
  // Four steps deal the pile out and land on the closing beat.
  for (let i = 0; i < 4; i++) {
    await evaluate(`(() => { ${HELPERS} stepKey('ArrowDown'); return true; })()`);
    await sleep(1400);
  }

  console.log(`\n══ ${vp.label} ${vp.width}×${vp.height} — the closing beat's cue`);

  const frames = [];
  handlers.set('Page.screencastFrame', (p) => {
    frames.push({ t: p.metadata.timestamp * 1000, data: p.data });
    send('Page.screencastFrameAck', { sessionId: p.sessionId });
  });
  await send('Page.startScreencast', {
    format: 'png',
    everyNthFrame: 1,
    maxWidth: vp.width * 2,
    maxHeight: vp.height * 2,
  });
  await sleep(400);
  frames.length = 0;
  const t0 = Date.now();
  const cue = await evaluate(CUE);
  await send('Page.stopScreencast');
  handlers.delete('Page.screencastFrame');

  if (cue?.error) {
    console.log(`   ${cue.error}`);
    continue;
  }
  const climbs = cue.minY < 0 && cue.maxY <= 0.5;
  console.log(
    `   loop: transform y runs ${cue.minY}px → ${cue.maxY}px over ${cue.frames} frames  ` +
      `→ ${climbs ? 'CLIMBS from rest and returns; never below it' : 'DESCENDS from rest'}`
  );
  console.log(
    `   the copy above it: "${cue.copyText}" ends at ${cue.copyBottom}px; ` +
      `the arrow at its highest is ${cue.highestTop}px (gap ${cue.highestTop - cue.copyBottom}px), ` +
      `at rest ${cue.restTop}px`
  );
  console.log(
    `   the control runs ${cue.button.top}..${cue.button.bottom}px in a ${cue.viewportH}px window, ` +
      `so the arrow stays ${cue.highestTop - cue.button.top}px inside its top edge and ` +
      `${cue.highestTop}px clear of the top of the window`
  );

  // Frames spread across one loop, so the climb can be seen rather than read.
  const offsets = frames.map((f) => f.t - t0);
  const span = Math.max(...offsets);
  for (let k = 0; k < KEEP; k++) {
    const want = (span * k) / (KEEP - 1);
    let best = 0;
    for (let i = 1; i < offsets.length; i++) {
      if (Math.abs(offsets[i] - want) < Math.abs(offsets[best] - want)) best = i;
    }
    const file = `/tmp/onboarding-cue-${vp.label}-f${String(Math.round(offsets[best])).padStart(4, '0')}ms.png`;
    fs.writeFileSync(file, Buffer.from(frames[best].data, 'base64'));
  }
  console.log(`   ${KEEP} frames of the loop as /tmp/onboarding-cue-${vp.label}-f<offset>ms.png`);

  await send('Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(500);
  const still = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 2 },
  });
  const out = `/tmp/onboarding-closing-${vp.label}.png`;
  fs.writeFileSync(out, Buffer.from(still.data, 'base64'));
  console.log(`   the whole beat  ${out}`);
}

ws.close();
chrome.kill();
