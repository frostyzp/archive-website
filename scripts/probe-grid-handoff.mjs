/**
 * Two questions about /entrance?tab=handoff.
 *
 * 1. Does the hand-off have a seam? For each of the three pile notes the print
 *    and the grid cell that replaces it are sampled every frame, and the frame
 *    where the carrier changes from one to the other is read off: if the swap
 *    is honest, the note's centre and size are unchanged across it and there is
 *    never a frame where neither element is on the screen.
 * 2. Do all three candidates fire, and do the bench's other tabs still work
 *    after the shared shell was edited.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5190';
const WANTED = Number(process.env.PORT || 9500 + (process.pid % 89));
const PROFILE = `/tmp/grid-handoff-profile-${process.pid}`;

let PORT = null;
for (let i = 0; i < 12 && PORT == null; i++) {
  try {
    await fetch(`http://127.0.0.1:${WANTED + i}/json/version`);
  } catch {
    PORT = WANTED + i;
  }
}
if (PORT == null) throw new Error(`no free debugging port near ${WANTED}`);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,900',
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
const consoleErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(
      m.params?.exceptionDetails?.exception?.description ||
        m.params?.exceptionDetails?.text ||
        'exception'
    );
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    consoleErrors.push(
      `${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '?').join(' ')}`
    );
  }
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    const timer = setTimeout(() => {
      if (pending.has(n)) {
        pending.delete(n);
        resolve({ __timeout: method });
      }
    }, 15000);
    pending.set(n, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { __error: r.exceptionDetails.text };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

const IDS = ['AC_171', 'AC_148', 'AC_185'];

const SAMPLER = `(() => {
  const ids = ${JSON.stringify(IDS)};
  window.__hs = { t0: null, samples: [] };
  const eff = (el) => { let o = 1, n = el;
    while (n && n !== document.documentElement) { o *= +getComputedStyle(n).opacity; n = n.parentElement; }
    return o; };
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    return { cx: +(r.x + r.width / 2).toFixed(2), cy: +(r.y + r.height / 2).toFixed(2),
             w: +r.width.toFixed(2), h: +r.height.toFixed(2), o: +eff(el).toFixed(4) }; };
  window.addEventListener('keydown', () => { if (window.__hs.t0 == null) window.__hs.t0 = performance.now(); }, true);
  const loop = () => {
    const t = performance.now();
    const f = { t, n: {} };
    for (const i of ids) {
      f.n[i] = { print: box(document.querySelector('img[data-print="' + i + '"]')),
                 tile: box(document.querySelector('img[data-tile="' + i + '"]')) };
    }
    window.__hs.samples.push(f);
    if (window.__hs.samples.length < 500 && (window.__hs.t0 == null || t - window.__hs.t0 < 2600)) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return ids.length;
})()`;

/* The carrier of a note on each frame is whichever of the two elements is
   actually on the screen. The hand-off is honest if that carrier changes
   without the note changing: same centre, same size, and never a frame where
   the answer is neither. */
const RESULT = `(() => {
  const hs = window.__hs;
  if (!hs || hs.t0 == null) return { error: 'nothing fired' };
  const out = {};
  for (const id of Object.keys(hs.samples[0].n)) {
    /* The note, frame by frame, as ONE object: whichever of the print and the
       cell is on the screen is the thing carrying it. If the hand-off is honest
       this series is continuous through the frame where the carrier changes. */
    const series = hs.samples.map((s) => {
      const p = s.n[id].print, t = s.n[id].tile;
      const pv = p && p.o > 0.02, tv = t && t.o > 0.02;
      return { ms: +(s.t - hs.t0).toFixed(1),
               carrier: pv && tv ? 'both' : pv ? 'print' : tv ? 'tile' : 'none',
               box: pv ? p : tv ? t : null };
    });
    const after = series.filter((f) => f.ms >= 0);
    const blank = after.filter((f) => f.carrier === 'none').map((f) => f.ms);
    const both = after.filter((f) => f.carrier === 'both').map((f) => f.ms);
    // The gesture's own frame: the last time the print was seen, and the first
    // time the cell stood where it had been.
    const lastPrint = [...series].reverse().find((f) => f.carrier === 'print') || null;
    const firstTile = series.find((f) => f.carrier === 'tile' && f.ms >= (lastPrint ? lastPrint.ms : -1e9)) || null;
    const a = lastPrint && lastPrint.box, b = firstTile && firstTile.box;
    const carried = after.filter((f) => f.box).map((f) => f.box);
    const steps = [];
    for (let i = 1; i < carried.length; i++)
      steps.push(+Math.hypot(carried[i].cx - carried[i - 1].cx, carried[i].cy - carried[i - 1].cy).toFixed(2));
    // One frame of the cell's own travel just after the swap, which is what the
    // jump across the swap has to be read against: a note in flight is supposed
    // to move between frames.
    const nextStep = steps.length ? steps[0] : null;
    out[id] = {
      frames: series.length,
      blankFrames: blank.length, blankAt: blank.slice(0, 5),
      overlapFrames: both.length, overlapAt: both.slice(0, 5),
      lastPrintMs: lastPrint ? lastPrint.ms : null,
      firstTileMs: firstTile ? firstTile.ms : null,
      gapMs: a && b ? +(firstTile.ms - lastPrint.ms).toFixed(1) : null,
      jumpPx: a && b ? +Math.hypot(b.cx - a.cx, b.cy - a.cy).toFixed(2) : null,
      widthDeltaPx: a && b ? +(b.w - a.w).toFixed(2) : null,
      heightDeltaPx: a && b ? +(b.h - a.h).toFixed(2) : null,
      nextFrameStepPx: nextStep,
      minOpacity: +Math.min(...after.filter((f) => f.box).map((f) => f.box.o)).toFixed(3),
      maxStepPx: steps.length ? Math.max(...steps) : null,
      startW: a ? a.w : null,
      settledW: carried.length ? carried[carried.length - 1].w : null,
    };
  }
  return out;
})()`;

const LANDED = `(() => {
  const t = document.querySelector('img[data-tile="AC_171"]');
  if (!t) return false;
  const w = t.parentElement;
  return w ? getComputedStyle(w).transform === 'none' || /matrix\\(1, 0, 0, 1, 0, 0\\)/.test(getComputedStyle(w).transform) : false;
})()`;

/* Keys are dispatched inside the page rather than through Input.dispatchKeyEvent.
   A CDP key event drops this renderer from ~120 frames a second to about one,
   for the rest of the session and on every page it then loads — so every number
   taken after the first keystroke would be read off an animation that is barely
   advancing, which is the failure mode most likely to be mistaken for a result.
   The lab listens on window, so a synthetic event drives it identically. */
const pressKey = (key) =>
  evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })), 1`
  );

async function shot(path, scale = 1) {
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: 1440, height: 900, scale },
    captureBeyondViewport: false,
  });
  if (r?.data) fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
  return path;
}

const state = () => evaluate(`document.querySelector('[data-lab-state]')?.dataset.labState ?? null`);

console.log(`\n═══ GRID HAND-OFF · ${BASE}/entrance?tab=handoff ═══`);

/* ── 1. every candidate fires ─────────────────────────────────────────── */
for (const [n, name] of [['1', 'fountain'], ['2', 'handoff'], ['3', 'spout']]) {
  await send('Page.navigate', { url: `${BASE}/entrance?tab=handoff&dial=1` });
  await sleep(1200);
  await pressKey(n);
  await sleep(120);
  const before = await state();
  await pressKey(' ');
  await sleep(2200);
  const after = await state();
  const visible = await evaluate(
    `[...document.querySelectorAll('img[data-tile]')].filter((t) => +getComputedStyle(t.parentElement).opacity > 0.5).length`
  );
  const path = await shot(`/tmp/grid-handoff-${name}.png`);
  // R puts the pile back and flies the same candidate again.
  await pressKey('r');
  await sleep(2400);
  const again = await evaluate(
    `({ state: document.querySelector('[data-lab-state]').dataset.labState,
        up: [...document.querySelectorAll('img[data-tile]')].filter((t) => +getComputedStyle(t.parentElement).opacity > 0.5).length })`
  );
  console.log(
    `  ${name.padEnd(9)} ${before} → ${after} · ${visible}/12 cells up · replay → ${again.state} · ${again.up}/12 up · ${path}`
  );
}

/* ── 2. the seam ──────────────────────────────────────────────────────── */
await send('Page.navigate', { url: `${BASE}/entrance?tab=handoff` });
await sleep(1400);
await pressKey('2');
await sleep(200);
await evaluate(SAMPLER);
// A moment of the pile at rest first: the frame the gesture lands on is the
// baseline every continuity number is measured against.
await sleep(400);
await pressKey(' ');
await sleep(2800);
const v = await evaluate(RESULT);

console.log('\n  ── hand-off continuity, per print ──');
if (v.error) console.log(`  ${v.error}`);
else
  for (const [noteId, r] of Object.entries(v)) {
    console.log(
      `  ${noteId}  print last seen ${r.lastPrintMs}ms · cell first seen ${r.firstTileMs}ms (${r.gapMs}ms apart) · ` +
        `centre jumped ${r.jumpPx}px, against ${r.nextFrameStepPx}px of real travel on the next frame`
    );
    console.log(
      `          size ${r.widthDeltaPx > 0 ? '+' : ''}${r.widthDeltaPx} × ${r.heightDeltaPx > 0 ? '+' : ''}${r.heightDeltaPx}px across the swap · ` +
        `${r.blankFrames} frames with nothing on screen${r.blankFrames ? ` (${r.blankAt.join(', ')}ms)` : ''} · ` +
        `${r.overlapFrames} frames with both · lowest opacity ${r.minOpacity} · ` +
        `${r.maxStepPx}px max travel per frame · ${r.startW}px → ${r.settledW}px wide`
    );
  }

/* ── 3. at rest ───────────────────────────────────────────────────────── */
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
});
await send('Page.navigate', { url: `${BASE}/entrance?tab=handoff` });
await sleep(1500);
await pressKey('2');
await sleep(150);
await pressKey(' ');
await sleep(500);
const still = await evaluate(`(() => {
  const tiles = [...document.querySelectorAll('img[data-tile]')].map((t) => ({
    o: +getComputedStyle(t.parentElement).opacity,
    tf: getComputedStyle(t.parentElement).transform }));
  const prints = [...document.querySelectorAll('img[data-print]')].map((p) => +getComputedStyle(p.parentElement).opacity);
  return { up: tiles.filter((t) => t.o > 0.9).length,
           moved: tiles.filter((t) => t.tf !== 'none' && !/matrix\\(1, 0, 0, 1, 0, 0\\)/.test(t.tf)).length,
           printsVisible: prints.filter((o) => o > 0.02).length };
})()`);
console.log(
  `\n  ── prefers-reduced-motion ──\n  ${still.up}/12 cells up · ${still.moved} of them transformed (want 0) · ${still.printsVisible} prints still visible (want 0)`
);
await send('Emulation.setEmulatedMedia', { features: [] });

/* ── 4. the rest of the bench ─────────────────────────────────────────── */
console.log('\n  ── the other tabs, after editing the shared shell ──');
for (const tab of ['entrance', 'dial', 'about', 'about-drawer', 'about-peek', 'onboarding', 'handoff']) {
  consoleErrors.length = 0;
  await send('Page.navigate', { url: `${BASE}/entrance?tab=${tab}` });
  await sleep(1500);
  const seen = await evaluate(
    `({ nav: document.querySelectorAll('nav button').length, imgs: document.querySelectorAll('img').length, text: (document.body.innerText || '').slice(0, 40).replace(/\\n/g, ' ') })`
  );
  console.log(
    `  ${tab.padEnd(14)} ${seen.nav} tabs · ${seen.imgs} images · ${consoleErrors.length} console errors${
      consoleErrors.length ? ` → ${consoleErrors[0].slice(0, 120)}` : ''
    }`
  );
}

chrome.kill();
await sleep(400);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {}
process.exit(0);
