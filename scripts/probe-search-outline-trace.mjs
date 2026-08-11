/**
 * The index rail's search field, whose dashed outline is drawn in place rather
 * than faded and slid up (TracedOutline). Measures, over the entrance:
 *   1. how much of the perimeter is painted frame by frame, and how long the
 *      trace takes — the sweep's own dash window, not a CSS transition, since
 *      Framer Motion drives this on rAF and declares no transition anywhere;
 *   2. whether the field holds still while the line goes round it;
 *   3. the settled outline against the CSS border it replaces — 1px dashed
 *      rgba(207,202,183,0.3), square corners — including a pixel count of the
 *      dashes off a screenshot, next to a probe-injected div still wearing that
 *      exact border;
 *   4. that the field is still what you hit, focus and type into, with nothing
 *      of the overlay in the way.
 * Shoots frames through the trace and the settled state into /tmp.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9377;
/** The border the outline stands in for, and the box it is painted on. */
const RESTING = { width: '1px', style: 'dashed', color: 'rgba(207, 202, 183, 0.3)', radius: '0px' };
/** Screenshot magnification — 4 puts each CSS px on 4 image px, enough to count
 *  a 3px dash and a 2px gap without the antialiasing swallowing either. */
const SCALE = 4;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/search-outline-trace-profile',
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
    // Hand back protocol-level failures too, or an evaluate that never ran comes
    // out of here indistinguishable from one that returned nothing.
    pending.get(m.id)(m.error ? { protocolError: m.error } : m.result);
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
  if (r?.protocolError) return { error: r.protocolError.message };
  if (r?.exceptionDetails) {
    const d = r.exceptionDetails;
    return { error: d.exception?.description || d.text };
  }
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* The sweep's state, read off what is actually being painted: the dash window
   Framer Motion writes onto the mask stroke. It normalises the path with
   pathLength="1" and writes `stroke-dasharray: {drawn} 1` — one dash of the
   fraction uncovered so far, then a gap the length of the whole path — so the
   first number IS that fraction. Nothing here reads a CSS transition, because
   there is none to read: this is rAF-driven, and `style.transition` on any of
   these elements is empty. */
const READ = `(() => {
  const field = document.querySelector('.grid-search-field');
  const input = document.querySelector('.filter-sidebar .grid-search-input');
  const mask = field && field.querySelector('svg mask path');
  const line = field && field.querySelector('svg > path');
  if (!input) return { error: 'no sidebar search input' };
  const r = input.getBoundingClientRect();
  const nums = (s) => String(s || '').split(/[ ,]+/).map(parseFloat).filter(n => !isNaN(n));
  let drawn = null;
  let window = null;
  if (mask) {
    const dash = nums(getComputedStyle(mask).strokeDasharray);
    window = dash;
    drawn = dash.length ? Math.min(1, dash[0]) : null;
  }
  return {
    drawn,
    dashWindow: window,
    pathLengthAttr: mask ? mask.getAttribute('pathLength') : null,
    maskTransition: mask ? getComputedStyle(mask).transition : null,
    perimeterPx: line ? +line.getTotalLength().toFixed(2) : null,
    // Constant through the trace if the line is being drawn rather than faded.
    lineOpacity: line ? +(+getComputedStyle(line).opacity).toFixed(3) : null,
    lineStroke: line ? getComputedStyle(line).stroke : null,
    inputOpacity: +(+getComputedStyle(input).opacity).toFixed(3),
    rect: { left: +r.left.toFixed(2), top: +r.top.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) },
  };
})()`;

/* ── 1 + 2: the trace, sampled every frame from mount ───────────────────── */
await send('Page.navigate', { url: `${BASE}/?view=grid` });
const trace = await evaluate(`(async () => {
  const s = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 200; i++) {
    if (document.querySelector('.grid-search-field svg mask path')) break;
    await s(50);
  }
  const read = () => (${READ});
  const t0 = performance.now();
  const samples = [];
  let sampling = true;
  const tick = () => {
    if (!sampling) return;
    samples.push({ t: +(performance.now() - t0).toFixed(1), ...read() });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await s(8000);
  sampling = false;

  const drawnAt = samples.filter(x => x.drawn !== null);
  const started = drawnAt.find(x => x.drawn > 0.005);
  const closed = drawnAt.find(x => x.drawn > 0.999);
  const quarters = [0.25, 0.5, 0.75, 1].map(q => {
    const hit = drawnAt.find(x => x.drawn >= q);
    return { fraction: q, atMs: hit ? Math.round(hit.t) : null };
  });
  // Every distinct value the sweep passed through, thinned for reading.
  const curve = drawnAt
    .filter(x => x.drawn > 0.0001 && x.drawn < 0.9999)
    .filter((_, i) => i % 3 === 0)
    .map(x => ({ atMs: Math.round(x.t), drawn: +x.drawn.toFixed(3) }));

  // Does the box move while the line goes round it? Measured over the window
  // the sweep is actually running in.
  const during = samples.filter(x => x.drawn !== null && x.drawn > 0 && x.drawn <= 1
    && started && closed && x.t >= started.t - 100 && x.t <= closed.t + 100);
  const span = (k) => {
    const v = during.map(x => x.rect[k]);
    return { min: Math.min(...v), max: Math.max(...v), drift: +(Math.max(...v) - Math.min(...v)).toFixed(3) };
  };

  return {
    frames: samples.length,
    firstFrame: samples[0],
    traceStartMs: started ? Math.round(started.t) : null,
    traceClosedMs: closed ? Math.round(closed.t) : null,
    traceDurationMs: started && closed ? Math.round(closed.t - started.t) : null,
    distinctFractions: new Set(drawnAt.map(x => +x.drawn.toFixed(3))).size,
    quarters,
    curve,
    lineOpacityValues: [...new Set(samples.map(x => x.lineOpacity))],
    lineStrokeValues: [...new Set(samples.map(x => x.lineStroke))],
    inputOpacityFirstLast: [samples[0]?.inputOpacity, samples[samples.length - 1]?.inputOpacity],
    rectDuringTrace: { samples: during.length, left: span('left'), top: span('top'), width: span('width'), height: span('height') },
    settled: (${READ}),
  };
})()`);

/* ── 3: the settled outline, against the border it replaces ─────────────── */
const resting = await evaluate(`(() => {
  const field = document.querySelector('.grid-search-field');
  const input = document.querySelector('.filter-sidebar .grid-search-input');
  const line = field.querySelector('svg > path');
  const cs = getComputedStyle(line);
  const box = getComputedStyle(input);
  const r = input.getBoundingClientRect();

  // A stand-in still wearing the CSS border, parked under the field at the same
  // size, so the two can be counted off one screenshot.
  let ref = document.querySelector('#probe-border-reference');
  if (!ref) {
    ref = document.createElement('div');
    ref.id = 'probe-border-reference';
    document.body.appendChild(ref);
  }
  ref.setAttribute('style', [
    'position:fixed', 'z-index:99',
    'left:' + r.left + 'px', 'top:' + (r.bottom + 24) + 'px',
    'width:' + r.width + 'px', 'height:' + r.height + 'px',
    'box-sizing:border-box',
    'border:${RESTING.width} ${RESTING.style} ${RESTING.color}',
    'border-radius:${RESTING.radius}',
  ].join(';'));

  return {
    outline: {
      stroke: cs.stroke,
      strokeWidth: cs.strokeWidth,
      strokeDasharray: cs.strokeDasharray,
      strokeOpacity: cs.strokeOpacity,
      fieldColor: getComputedStyle(field).color,
    },
    // The input's own border is transparent and holds the 1px inset only.
    inputBorder: { width: box.borderTopWidth, style: box.borderTopStyle, color: box.borderTopColor, radius: box.borderTopLeftRadius },
    fieldRect: { left: r.left, top: r.top, width: r.width, height: r.height },
    referenceRect: { left: r.left, top: r.bottom + 24, width: r.width, height: r.height },
    // The field is wrapped now, and an inline child inside a block wrapper would
    // have carried descender space that pushed the rest of the rail down. The
    // first accordion should still sit one 18px rail gap under the field.
    railRhythm: (() => {
      const btn = document.querySelector('.filter-sidebar .facet-accordion-btn');
      const b = btn.getBoundingClientRect();
      return { fieldBottom: r.bottom, firstAccordionTop: b.top, gap: +(b.top - r.bottom).toFixed(2) };
    })(),
  };
})()`);

/* Count the dashes on both, straight off the pixels. */
const countDashes = async (rect, label) => {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, scale: SCALE },
  });
  fs.writeFileSync(`/tmp/search-outline-${label}.png`, Buffer.from(shot.data, 'base64'));
  const runs = await evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${shot.data}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const scan = (y) => {
      const d = ctx.getImageData(0, y, img.width, 1).data;
      const lum = [];
      for (let x = 0; x < img.width; x++) lum.push((d[x*4] + d[x*4+1] + d[x*4+2]) / 3);
      const sorted = [...lum].sort((a, b) => a - b);
      const t = (sorted[Math.floor(sorted.length * 0.1)] + sorted[Math.floor(sorted.length * 0.9)]) / 2;
      const runs = []; let on = lum[0] > t, len = 0;
      for (const v of lum) { const o = v > t; if (o === on) len++; else { runs.push([on, len]); on = o; len = 1; } }
      runs.push([on, len]);
      return runs;
    };
    // The top edge, one image row into the border.
    const runs = scan(1);
    const ink = runs.filter(([o]) => o).map(([, n]) => n);
    const gap = runs.filter(([o]) => !o).map(([, n]) => n);
    const mode = (a) => { const m = new Map(); a.forEach(n => m.set(n, (m.get(n) || 0) + 1)); return [...m].sort((x, y) => y[1] - x[1])[0]; };
    return {
      imageWidth: img.width,
      dashes: ink.length,
      dashPxMode: mode(ink),
      gapPxMode: mode(gap),
      dashCssPx: +(mode(ink)[0] / ${SCALE}).toFixed(2),
      gapCssPx: +(mode(gap)[0] / ${SCALE}).toFixed(2),
    };
  })()`);
  return runs;
};
const dashesTraced = await countDashes(resting.fieldRect, 'settled');
const dashesCss = await countDashes(resting.referenceRect, 'css-reference');
// Both together, so the two hairlines can be looked at side by side.
{
  const r = resting.fieldRect;
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r.left - 10, y: r.top - 10, width: r.width + 20, height: r.height * 2 + 44 + 20, scale: 3 },
  });
  fs.writeFileSync('/tmp/search-outline-vs-css-border.png', Buffer.from(shot.data, 'base64'));
}
await evaluate(`document.querySelector('#probe-border-reference')?.remove()`);

/* ── 4: still a field ───────────────────────────────────────────────────── */
const interaction = await evaluate(`(async () => {
  const s = (m) => new Promise(r => setTimeout(r, m));
  const input = document.querySelector('.filter-sidebar .grid-search-input');
  const field = document.querySelector('.grid-search-field');
  const r = input.getBoundingClientRect();
  const at = (x, y) => { const el = document.elementFromPoint(x, y); return el ? el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') : null; };
  const hits = {
    centre: at(r.left + r.width / 2, r.top + r.height / 2),
    onOutlineTop: at(r.left + r.width / 2, r.top + 0.5),
    nearLeftEdge: at(r.left + 2, r.top + r.height / 2),
  };
  const restColor = getComputedStyle(field).color;
  const tilesBefore = document.querySelectorAll('.grid-tile').length;
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  input.focus();
  const focused = document.activeElement === input;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'confession');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await s(400);
  const line = field.querySelector('svg > path');
  return {
    hits,
    focused,
    value: input.value,
    // The query is what the grid filters on, so the tile count moving is the
    // keystrokes arriving in React rather than only in the DOM node.
    tilesBefore,
    tilesAfterTyping: document.querySelectorAll('.grid-tile').length,
    outlineColourRest: restColor,
    outlineColourFocused: getComputedStyle(field).color,
    outlineStrokeFocused: getComputedStyle(line).stroke,
    focusWithin: field.matches(':focus-within'),
  };
})()`);

/* ── 4a: the phone filter row, left on its CSS border ───────────────────── */
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?view=grid&probe=phone` });
const phone = await evaluate(`(async () => {
  const s = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 200; i++) { if (document.querySelector('.grid-search-input')) break; await s(50); }
  await s(3000);
  const input = document.querySelector('.grid-search-input');
  const cs = getComputedStyle(input);
  return {
    border: [cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor].join(' '),
    tracedOutlinesOnPage: document.querySelectorAll('.grid-search-field').length,
  };
})()`);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* ── 4b: nothing to draw for a visitor who would rather it didn't ───────── */
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
});
// A fresh document, not a fragment: navigating to a URL that differs only by
// hash is a same-document navigation, and the page would still be sitting there
// with its outline already drawn from the run before.
await send('Page.navigate', { url: `${BASE}/?view=grid&probe=reduced` });
const reduced = await evaluate(`(async () => {
  const s = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 300; i++) {
    if (document.querySelector('.grid-search-field svg mask path')) break;
    await s(20);
  }
  const drawn = () => {
    const p = document.querySelector('.grid-search-field svg mask path');
    if (!p) return null;
    const a = parseFloat(getComputedStyle(p).strokeDasharray);
    return isNaN(a) ? null : Math.min(1, a);
  };
  const seen = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) { seen.push(drawn()); await new Promise(requestAnimationFrame); }
  return {
    reduceMotionMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    firstSample: seen[0],
    distinctValues: [...new Set(seen)],
  };
})()`);
await send('Emulation.setEmulatedMedia', { features: [] });

/* ── 5: frames through the trace ────────────────────────────────────────── */
const shots = [];
{
  // Waited on rather than timed: one fresh arrival per frame, held until the
  // sweep has actually reached the fraction being shot, since a capture costs
  // enough that a run of them off one clock drifts out of the trace entirely.
  const targets = [0.15, 0.4, 0.65, 0.9];
  const r = resting.fieldRect;
  const clip = { x: r.left - 6, y: r.top - 6, width: r.width + 12, height: r.height + 12, scale: 3 };
  // A capture asked for while the page is still coming up answers with a
  // protocol error rather than an image; the frame we want is a few ms away, so
  // ask again instead of dropping it.
  const capture = async () => {
    for (let i = 0; i < 5; i++) {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip });
      if (shot?.data) return shot.data;
      await sleep(60);
    }
    return null;
  };
  for (const [i, want] of targets.entries()) {
    await send('Page.navigate', { url: `${BASE}/?view=grid&probe=shot${i}` });
    // The execution context is torn down by the navigation, so the first
    // evaluate after it can come back empty — ask until the page answers.
    for (let k = 0; k < 60; k++) {
      const ready = await evaluate(`!!document.querySelector('.grid-search-field svg mask path')`);
      if (ready === true) break;
      await sleep(50);
    }
    const reached = await evaluate(`(async () => {
      const s = (m) => new Promise(r => setTimeout(r, m));
      const drawn = () => {
        const p = document.querySelector('.grid-search-field svg mask path');
        if (!p) return null;
        const a = parseFloat(getComputedStyle(p).strokeDasharray);
        return isNaN(a) ? null : Math.min(1, a);
      };
      const t0 = performance.now();
      while (performance.now() - t0 < 20000) {
        const d = drawn();
        if (d !== null && d >= ${want}) return { atMs: Math.round(performance.now() - t0), drawn: +d.toFixed(3) };
        await new Promise(requestAnimationFrame);
      }
      return { timedOut: true, drawn: drawn() };
    })()`);
    const data = await capture();
    const after = await evaluate(READ);
    const path = `/tmp/search-outline-trace-${i + 1}-drawn${Math.round(want * 100)}.png`;
    if (data) fs.writeFileSync(path, Buffer.from(data, 'base64'));
    shots.push({
      path,
      target: want,
      reached,
      drawnAfterCapture: after?.drawn,
      rect: after?.rect,
    });
  }
  await sleep(2500);
  const settled = await capture();
  if (settled) fs.writeFileSync('/tmp/search-outline-trace-5-settled.png', Buffer.from(settled, 'base64'));
  const end = await evaluate(READ);
  shots.push({ path: '/tmp/search-outline-trace-5-settled.png', target: 'settled', drawnAfterCapture: end?.drawn, rect: end?.rect });
}

console.log(JSON.stringify({ trace, resting, dashesTraced, dashesCss, interaction, phone, reduced, shots }, null, 1));

ws.close();
chrome.kill();
