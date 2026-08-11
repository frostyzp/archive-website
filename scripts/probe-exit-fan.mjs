/**
 * One question only: which way does each print in the closing beat travel when
 * the pile clears, measured off the rendered rects.
 *
 * Split out of probe-onboarding-swipe-exit.mjs so DISPERSE.lift can be A/B'd in
 * about fifteen seconds instead of four minutes — the full probe walks every exit
 * path, and none of the other four say anything about the direction.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const TAG = process.env.TAG || 'now';
const WANTED = Number(process.env.PORT || 9500 + (process.pid % 89));
const PROFILE = `/tmp/exit-fan-profile-${process.pid}`;

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
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

const DOWN = '\\u2193';
const CUE = `[...document.querySelectorAll('span')].filter((s) => (s.textContent || '').trim() === '${DOWN}' && s.children.length === 0)`;
// The cue inside the ENTER control — the exit is only armed once it is up.
const ARROW_UP = `(() => {
  const c = ${CUE}.find((s) => s.closest('.onboarding-cta'));
  if (!c) return false;
  const w = c.closest('div');
  return w ? +getComputedStyle(w).opacity > 0.5 : false;
})()`;
// The landing page's own cue, which is what says the piece is mounted and listening.
const LANDING_ARROW_UP = `(() => {
  const c = ${CUE}.find((s) => !s.closest('.onboarding-cta'));
  if (!c) return false;
  const w = c.closest('div');
  return w ? +getComputedStyle(w).opacity > 0.5 : false;
})()`;

const SAMPLER = `(() => {
  const imgs = [...document.querySelectorAll('img')].filter((i) => /confession/i.test(i.alt || ''));
  window.__ex = { t0: null, samples: [] };
  window.addEventListener('touchend', () => { if (window.__ex.t0 == null) window.__ex.t0 = performance.now(); }, true);
  const eff = (el) => { let o = 1, n = el;
    while (n && n !== document.documentElement) { o *= +getComputedStyle(n).opacity; n = n.parentElement; }
    return o; };
  const loop = () => {
    const t = performance.now();
    window.__ex.samples.push({ t, p: imgs.map((i) => { const r = i.getBoundingClientRect();
      return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), o: +eff(i).toFixed(4) }; }) });
    if (window.__ex.samples.length < 400 && (window.__ex.t0 == null || t - window.__ex.t0 < 2500)) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return imgs.length;
})()`;

const RESULT = `(() => {
  const ex = window.__ex;
  if (!ex || ex.t0 == null) return { error: 'no gesture recorded' };
  const before = ex.samples.filter((s) => s.t <= ex.t0);
  const base = (before[before.length - 1] || ex.samples[0]).p;
  const after = ex.samples.filter((s) => s.t >= ex.t0);
  return base.map((b, i) => {
    let last = b, minY = b.y, maxYSeen = b.y, down = 0, prev = b, off = null, offAt = null;
    // The fade, read alongside the flight: when it starts, when it is half gone,
    // when there is nothing left, and how much of the print was still there at the
    // moment it crossed the edge.
    let fadeAt = null, halfAt = null, goneAt = null, oAtEdge = null;
    for (const s of after) {
      const p = s.p[i];
      if (!p || (p.w === 0 && p.h === 0)) continue; // detached: measures 0×0 at the origin
      last = p;
      if (p.y < minY) minY = p.y;
      if (p.o > 0.02) { if (p.y > maxYSeen) maxYSeen = p.y; if (p.y - prev.y > 0.25) down++; }
      const dt = +(s.t - ex.t0).toFixed(1);
      if (fadeAt == null && b.o - p.o > 0.01) fadeAt = dt;
      if (halfAt == null && p.o <= b.o * 0.5) halfAt = dt;
      if (goneAt == null && p.o <= 0.02) goneAt = dt;
      if (off == null && (p.y + p.h < 0 || p.x + p.w < 0 || p.x > innerWidth || p.y > innerHeight)) {
        off = p.y + p.h < 0 ? 'top' : p.x + p.w < 0 ? 'left' : p.x > innerWidth ? 'right' : 'bottom';
        offAt = dt;
        oAtEdge = p.o;
      }
      prev = p;
    }
    const netDy = +(last.y - b.y).toFixed(1);
    const netDx = +(last.x - b.x).toFixed(1);
    return { i, y0: +b.y.toFixed(1), yEnd: +last.y.toFixed(1), netDy, netDx,
      angleFromUp: netDy === 0 && netDx === 0 ? null : +(Math.atan2(netDx, -netDy) * 180 / Math.PI).toFixed(1),
      risePx: +(b.y - minY).toFixed(1), seenDescentPx: +(maxYSeen - b.y).toFixed(1),
      downFramesSeen: down, leftBy: off, offAtMs: offAt,
      fadeStartMs: fadeAt, halfGoneMs: halfAt, invisibleMs: goneAt,
      opacityAtEdge: oAtEdge == null ? null : +oAtEdge.toFixed(3) };
  });
})()`;

/* For stills only. A capture costs a couple of hundred milliseconds of the same
   thread the exit is animating on, and motion clamps a frame's delta to 40ms, so
   photographing the flight at normal speed advances it by 40ms per shot and every
   frame comes back looking like the pile at rest.
 *
 * So the page's clock is slowed instead — all three of them, by the same factor.
 * Motion's own loop reads performance.now(); the parts of it the browser's
 * animation engine takes over run on the document timeline, which that patch
 * cannot reach; and the hand-off to the archive is a setTimeout. Slowing any one
 * of them alone tears the exit apart — with only performance.now the notes fade
 * out at full speed while they have barely moved, and with only the timers the
 * beat unmounts with the prints still on screen. No numbers come from these runs. */
const SLOWMO = (f) => `(() => {
  const raw = performance.now.bind(performance), t0 = raw();
  performance.now = () => t0 + (raw() - t0) / ${f};
  const st = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) => st(fn, (ms || 0) * ${f}, ...a);
  return ${f};
})()`;

const pressKey = async (key) => {
  const code = { ArrowDown: 40 }[key];
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
};

async function swipe({ x = 60, y = 700, dy = -140, steps = 5 } = {}) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y + (dy * i) / steps), id: 1 }] });
    await sleep(14);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function waitFor(expr, label, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    if (await evaluate(`!!(${expr})`)) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

async function shot(path, scale = 2) {
  const vp = await evaluate('({ w: innerWidth, h: innerHeight })');
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: vp.w, height: vp.h, scale }, captureBeyondViewport: false });
  if (r?.data) fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
  return path;
}

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE });
await sleep(600);
// Not a fixed wait: a key pressed before the piece is listening is simply lost,
// and the walk then stops a beat short of the closing one.
await waitFor(LANDING_ARROW_UP, 'landing arrow (beat 0)');
for (let i = 0; i < 4; i++) {
  await pressKey('ArrowDown');
  await sleep(1600);
}
await waitFor(ARROW_UP, 'closing arrow');
await sleep(300);
const n = await evaluate(SAMPLER);
const SLOW = process.env.SHOTS ? 8 : 1;
if (process.env.SHOTS) {
  await shot(`/tmp/exit-fan-${TAG}-0-rest.png`);
  await send('Animation.enable');
  await send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
  await evaluate(SLOWMO(SLOW));
}
const t0 = Date.now();
await swipe();
/* Stills and numbers can't come out of the same run: a capture costs a couple of
   hundred milliseconds and it spends them on the thread the sampler's rAF loop is
   waiting for, so a run that photographs the exit also loses most of it. */
const frames = [];
if (process.env.SHOTS) {
  // Wanted moments in the exit's own time; waited out in the page's, which is
  // running SLOW× slower.
  /* Waited out and labelled on the exit's own clock, read from the page. Wall
     time won't do for either: a capture still costs the flight ~30ms of its own
     time, so five of them scheduled off Date.now() land progressively later than
     asked and are then filed under the times they were asked for.
   *
   * The targets bunch around 150–210ms, where the three overlap — the last note
   * is authored to go at 180ms and the first is over the top edge by ~205. */
  const elapsed = `(() => { const e = window.__ex; return e && e.t0 != null ? Math.round(performance.now() - e.t0) : -1; })()`;
  for (const at of [70, 120, 160, 200, 260, 400]) {
    for (;;) {
      const now = await evaluate(elapsed);
      if (now >= at) break;
      await sleep(20);
    }
    const real = await evaluate(elapsed);
    frames.push({
      p: await shot(`/tmp/exit-fan-${TAG}-${String(real).padStart(3, '0')}ms.png`),
      at: real,
      asked: at,
    });
  }
}
await sleep(2600);
const v = await evaluate(RESULT);

console.log(`\n═══ DISPERSE fan · ${TAG} · ${n} prints ═══`);
for (const p of v) {
  const name = p.i === 0 ? 'booth ' : `note ${p.i}`;
  console.log(
    `  ${name}  y ${p.y0} → ${p.yEnd}  net Δy ${p.netDy > 0 ? '+' : ''}${p.netDy}px  net Δx ${p.netDx > 0 ? '+' : ''}${p.netDx}px  ` +
      `${p.angleFromUp == null ? 'held still' : `${Math.abs(p.angleFromUp)}° ${p.angleFromUp < 0 ? 'left' : 'right'} of up`}` +
      `  rise ${p.risePx}px · visible descent ${p.seenDescentPx}px over ${p.downFramesSeen} frames · off by ${p.leftBy ?? 'fading'}${p.offAtMs ? ` @${p.offAtMs}ms` : ''}`
  );
  console.log(
    `          fade starts ${p.fadeStartMs}ms · half gone ${p.halfGoneMs}ms · nothing left ${p.invisibleMs}ms` +
      (p.opacityAtEdge == null
        ? ' · never reached an edge'
        : ` · ${Math.round(p.opacityAtEdge * 100)}% still there at the edge`)
  );
}
console.log(`  descending notes: ${v.filter((p) => p.i > 0 && p.netDy > 0).map((p) => `note ${p.i} (+${p.netDy}px)`).join(', ') || 'none'}`);
for (const f of frames) console.log(`  ${f.at}ms into the exit (asked for ${f.asked}): ${f.p}`);

chrome.kill();
await sleep(400);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {}
process.exit(0);
