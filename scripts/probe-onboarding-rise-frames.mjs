/**
 * Frames of one photograph's rise into the onboarding pile, at known moments.
 *
 * The companion probe (probe-onboarding-rise.mjs) has the numbers; this one is
 * for looking at. Two things had to be worked around to get a picture of the
 * paper actually in the air:
 *
 *  · `Page.captureScreenshot` cannot be aimed. Its round trip in headless is
 *    ~300ms against a 620ms front-loaded throw, so every shot lands in the
 *    settling tail — the first attempt at this probe put four "mid-rise" shots
 *    within 80px of the landing place.
 *  · `Emulation.setVirtualTimePolicy` does not drive Motion. Pausing virtual
 *    time and advancing it in slices produced seven identical frames of a note
 *    sitting offstage: the animation loop reads a clock virtual time doesn't
 *    own.
 *
 * So the rise is recorded off the compositor with `Page.startScreencast`, which
 * pushes every frame it draws with a swap timestamp, and the frames nearest a
 * set of offsets from the step are kept. The device scale factor is set to 2 for
 * the recording, so those frames are 2× images; the settled pile afterwards is a
 * plain `Page.captureScreenshot` at `scale: 2`.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9349;
const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'phone', width: 390, height: 844 },
];
/** ms into the flight the page-side trace reports its position at. */
const TARGETS = [0, 60, 120, 200, 340, 620];
const RECORD_MS = 1500;
/* Every composited frame in this window is kept. A frame's swap timestamp runs
   a frame or two ahead of the state it is showing, and the throw covers most of
   its distance inside 150ms, so picking one frame per target offset by timestamp
   picked frames of a print still offstage — the whole window is saved and the
   ones with paper in the air are the ones to look at. */
const KEEP_FROM = -60;
const KEEP_TO = 760;
/* ms after the step to fire a scale-2 capture. These are not the moments the
   stills show: a capture round trip is ~200-300ms, so each frame lands that much
   later than its number — the bracket printed alongside is what places it. */
const STILLS = [0, 40, 90, 200, 420];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/onboarding-rise-frames-profile',
  /* Twice the widest viewport tested, because a screencast frame cannot be
     larger than the window's own surface: with a 1440×900 window the stream came
     back at CSS size however high the emulated device scale factor was set. */
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
const handlers = new Map(); // CDP event name → callback
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
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
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
  const where = (k) => {
    const im = PRINTS()[k];
    if (!im) return null;
    const r = im.getBoundingClientRect();
    const cs = getComputedStyle(im.closest('[style*="will-change"]'));
    const vh = window.innerHeight;
    const visibleH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return {
      top: Math.round(r.top),
      topVsBottom: Math.round(r.top - vh),
      inFramePct: r.height ? Math.round((visibleH / r.height) * 100) : 0,
      opacityPct: Math.round(parseFloat(cs.opacity) * 100),
    };
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

/* Steps the beat and reports where the arriving print is at each target offset,
   read on the page's own clock — the labels on the frames below come from the
   compositor's, and the two should agree. */
const TRACE = `(async () => {
  ${HELPERS}
  const targets = ${JSON.stringify(TARGETS)};
  const im = PRINTS()[3];
  const vh = window.innerHeight;
  const out = [];
  const t0 = performance.now();
  stepKey('ArrowDown');
  let next = 0;
  while (performance.now() - t0 < ${RECORD_MS}) {
    const t = performance.now() - t0;
    if (next < targets.length && t >= targets[next]) {
      const r = im.getBoundingClientRect();
      const visibleH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      out.push({
        target: targets[next],
        at: Math.round(t),
        top: Math.round(r.top),
        topVsBottom: Math.round(r.top - vh),
        inFramePct: r.height ? Math.round((visibleH / r.height) * 100) : 0,
        opacityPct: Math.round(parseFloat(getComputedStyle(im.closest('[style*="will-change"]')).opacity) * 100),
      });
      next++;
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return out;
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
  // Three prints down; the fourth is the one photographed on its way in.
  for (let i = 0; i < 3; i++) {
    await evaluate(`(() => { ${HELPERS} stepKey('ArrowDown'); return true; })()`);
    await sleep(900);
  }

  console.log(`\n══ ${vp.label} ${vp.width}×${vp.height} — the last note's rise`);

  const frames = [];
  handlers.set('Page.screencastFrame', (p) => {
    frames.push({ t: p.metadata.timestamp * 1000, data: p.data });
    send('Page.screencastFrameAck', { sessionId: p.sessionId });
  });
  /* maxWidth/maxHeight in device pixels, or the stream comes back at CSS size
     and the device scale factor above buys nothing. */
  await send('Page.startScreencast', {
    format: 'png',
    everyNthFrame: 1,
    maxWidth: vp.width * 2,
    maxHeight: vp.height * 2,
  });
  await sleep(400); // let the first frames flow before the step
  frames.length = 0;
  const t0 = Date.now();
  const trace = await evaluate(TRACE);
  await send('Page.stopScreencast');
  handlers.delete('Page.screencastFrame');

  const offsets = frames.map((f) => f.t - t0);
  console.log(`   ${frames.length} composited frames recorded over ${RECORD_MS}ms`);
  if (!Array.isArray(trace)) {
    console.log(`   trace failed: ${JSON.stringify(trace)}`);
    continue;
  }
  for (const row of trace) {
    console.log(
      `   page clock +${String(row.target).padStart(3)}ms (sampled ${String(row.at).padStart(4)}ms)  ` +
        `top ${String(row.top).padStart(5)}px (${row.topVsBottom > 0 ? '+' : ''}${row.topVsBottom}px vs the bottom edge)  ` +
        `${String(row.inFramePct).padStart(3)}% in frame  ${String(row.opacityPct).padStart(3)}% opaque`
    );
  }
  let kept = 0;
  for (let i = 0; i < frames.length; i++) {
    const off = Math.round(offsets[i]);
    if (off < KEEP_FROM || off > KEEP_TO) continue;
    const name = `${off < 0 ? 'm' : ''}${String(Math.abs(off)).padStart(3, '0')}`;
    fs.writeFileSync(
      `/tmp/onboarding-rise-${vp.label}-f${name}ms.png`,
      Buffer.from(frames[i].data, 'base64')
    );
    kept++;
  }
  console.log(
    `   ${kept} frames kept as /tmp/onboarding-rise-${vp.label}-f<offset>ms.png ` +
      `(${Math.round(1000 / (RECORD_MS / frames.length))}fps recorded, at CSS size — ` +
      `the stream is capped there in headless whatever the device scale factor)`
  );

  /* The same climb again at scale 2. A capture cannot be aimed, so each still is
     BRACKETED instead: the print's position is read immediately before the
     request goes out and immediately after the image comes back, and the frame
     is somewhere between the two.
     Freezing the page first was the obvious idea and does not work in either
     form. `Debugger.pause` leaves `Page.captureScreenshot` hanging forever, and
     blocking the main thread with a busy loop only queues the capture until the
     loop ends — the animation is on wall-clock time, so it catches up and the
     still shows the pile landed, several hundred ms after the moment asked for.
     A screenshot needs a live renderer; the only honest way to place it is to
     measure either side of it. */
  /* Back to a 1× device before any of this: with the recording's scale factor
     still in force a `clip.scale` of 2 asks for a 4× image, which took ~4s per
     capture and made the bracket below useless. */
  await send('Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const t of STILLS) {
    await evaluate(`(() => { ${HELPERS} stepKey('ArrowUp'); return true; })()`);
    await sleep(1200);
    await evaluate(`(() => { ${HELPERS} stepKey('ArrowDown'); return true; })()`);
    await sleep(t);
    const before = await evaluate(`(() => { ${HELPERS} return where(3); })()`);
    const sent = Date.now();
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 2 },
    });
    const rtt = Date.now() - sent;
    const after = await evaluate(`(() => { ${HELPERS} return where(3); })()`);
    const path = `/tmp/onboarding-rise-${vp.label}-t${String(t).padStart(3, '0')}ms.png`;
    if (shot?.data) fs.writeFileSync(path, Buffer.from(shot.data, 'base64'));
    console.log(
      `   still fired at +${String(t).padStart(3)}ms (capture took ${String(rtt).padStart(3)}ms)  ` +
        `print top between ${String(before?.top).padStart(4)}px and ${String(after?.top).padStart(4)}px, ` +
        `${String(before?.inFramePct).padStart(3)}–${String(after?.inFramePct).padStart(3)}% in frame  ${path}`
    );
    await sleep(900);
  }

  /* The settled pile, as a plain screenshot at scale 2 — which lives inside
     `clip`, not beside it: a top-level `scale` is ignored and hands back a 1×
     image that looks like it worked. */
  await sleep(600);
  const settled = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 2 },
  });
  const settledPath = `/tmp/onboarding-rise-${vp.label}-settled.png`;
  if (settled?.data) fs.writeFileSync(settledPath, Buffer.from(settled.data, 'base64'));
  console.log(`   settled pile  ${settledPath}`);
}

ws.close();
chrome.kill();
