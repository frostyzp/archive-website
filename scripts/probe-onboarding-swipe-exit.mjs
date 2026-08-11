/**
 * The onboarding's closing beat after the label removal: the landing page's
 * scroll arrow alone inside the ENTER control, and the four ways out of the
 * piece — touch swipe, trackpad wheel, click, keyboard.
 *
 * Establishes, with numbers:
 *   · no text label and no dashed rule remain inside the cta
 *   · the cta still has an accessible name, its AX node exposes no glyph
 *     children, and the arrow is hidden from assistive tech
 *   · swipe / wheel / click / Tab→Enter / Tab→Space each reach the index, once
 *   · the pile's exit starts on the frame the gesture is recognised (no lead-in),
 *     staggers, and the archive arrives while the notes are still in the air
 *   · a gesture inside the 1250ms grace window is dropped and not banked
 *   · the closing arrow is the same treatment as the landing (beat 0) arrow
 *   · the archive nav tabs' letter scatter still runs (shared letterScatter.jsx)
 *   · reduced motion goes straight through
 *   · the cta's box and hit area at 1440 and 390
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
// Derived from this process, not fixed: several of these probes run at once and a
// shared port silently attaches to somebody else's browser — which reads as the
// page having broken rather than as the wrong page having been measured.
const WANTED = Number(process.env.PORT || 9400 + (process.pid % 97));
const PROFILE = `/tmp/onboarding-swipe-exit-profile-${process.pid}`;

let PORT = null;
for (let i = 0; i < 12 && PORT == null; i++) {
  try {
    await fetch(`http://127.0.0.1:${WANTED + i}/json/version`);
  } catch {
    PORT = WANTED + i; // nothing listening — the port is ours
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
console.log(`(devtools on ${PORT}, profile ${PROFILE})`);

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
// Every call is time-boxed: a wedged renderer used to hang the whole run inside
// an await that no timeout could reach.
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
await send('DOM.enable');
await send('Accessibility.enable');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

const DOWN = '\\u2193';
// The arrow's own span, not any wrapper that merely contains it.
const CUE = `[...document.querySelectorAll('span')].filter((s) => (s.textContent || '').trim() === '${DOWN}' && s.children.length === 0)`;
const CTA = `[...document.querySelectorAll('.onboarding-cta')].find((c) => /enter the archive/i.test(c.getAttribute('aria-label') || ''))`;

/* ── page-side probes ──────────────────────────────────────────────────── */

const RECORDER = `(() => {
  window.__phases = [];
  const read = () => document.querySelector('.grid-tile')
    ? 'index'
    : (document.querySelector('.onboarding-cta') ? 'onboarding' : 'blank');
  const push = () => {
    const p = read();
    const last = window.__phases[window.__phases.length - 1];
    if (!last || last.phase !== p) window.__phases.push({ phase: p, t: Math.round(performance.now()) });
  };
  push();
  clearInterval(window.__recTimer);
  window.__recTimer = setInterval(push, 40);
  return true;
})()`;

const STATE = `(() => {
  const nav = document.querySelector('nav[aria-label="Beats"]');
  const dots = nav ? [...nav.querySelectorAll('button')] : [];
  const cta = ${CTA};
  const cues = ${CUE};
  return {
    view: document.querySelector('.grid-tile') ? 'index' : (cta ? 'onboarding' : 'blank'),
    tiles: document.querySelectorAll('.grid-tile').length,
    filterRail: !!document.querySelector('[aria-label="Filter notes"]'),
    beat: dots.findIndex((b) => b.getAttribute('aria-current') === 'step'),
    arrows: cues.length,
    arrowInCta: cues.some((s) => !!s.closest('.onboarding-cta')),
    phases: window.__phases || [],
  };
})()`;

const LABEL_AUDIT = `(() => {
  const cta = ${CTA};
  if (!cta) return null;
  const text = (cta.textContent || '').replace(/${DOWN}/g, '').trim();
  const glyphSpans = [...cta.querySelectorAll('span')].filter(
    (s) => (s.textContent || '').length === 1 && /[A-Za-z]/.test(s.textContent)
  );
  const ruled = [...cta.querySelectorAll('*'), cta].filter((e) => {
    const cs = getComputedStyle(e);
    return /gradient|repeating/.test(cs.backgroundImage) ||
      ['dotted', 'dashed'].includes(cs.borderBottomStyle) ||
      cs.textDecorationLine !== 'none';
  }).map((e) => ({ tag: e.tagName, bg: getComputedStyle(e).backgroundImage.slice(0, 44) }));
  const arrow = ${CUE}.find((s) => s.closest('.onboarding-cta'));
  const hiddenAncestor = (() => {
    let n = arrow;
    while (n && n !== cta) { if (n.getAttribute('aria-hidden') === 'true') return n.tagName; n = n.parentElement; }
    return null;
  })();
  return {
    visibleText: text,
    hasText: text.length > 0,
    glyphSpans: glyphSpans.length,
    ruledElements: ruled,
    ariaLabel: cta.getAttribute('aria-label'),
    arrowAriaHiddenOn: hiddenAncestor,
  };
})()`;

const BOX = `(() => {
  const cta = ${CTA};
  if (!cta) return null;
  const r = cta.getBoundingClientRect();
  const cs = getComputedStyle(cta);
  const arrow = ${CUE}.find((s) => s.closest('.onboarding-cta'));
  const ar = arrow ? arrow.getBoundingClientRect() : null;
  return {
    vw: innerWidth, vh: innerHeight,
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    x: +r.x.toFixed(1), y: +r.y.toFixed(1),
    centreOffsetPx: +(r.x + r.width / 2 - innerWidth / 2).toFixed(2),
    bottomGapPx: +(innerHeight - r.bottom).toFixed(1),
    onScreen: r.top >= 0 && r.bottom <= innerHeight,
    padding: cs.padding, minWidth: cs.minWidth, minHeight: cs.minHeight,
    fontSize: cs.fontSize, letterSpacing: cs.letterSpacing,
    arrow: ar ? {
      w: +ar.width.toFixed(1), h: +ar.height.toFixed(1),
      fontSize: getComputedStyle(arrow).fontSize,
      letterSpacing: getComputedStyle(arrow).letterSpacing,
      offsetInButtonPx: +(ar.x + ar.width / 2 - (r.x + r.width / 2)).toFixed(2),
      offsetInViewportPx: +(ar.x + ar.width / 2 - innerWidth / 2).toFixed(2),
    } : null,
  };
})()`;

const ARROWS = `(() => ${CUE}.map((span) => {
  const cs = getComputedStyle(span);
  const wrap = span.closest('div');
  const wcs = wrap ? getComputedStyle(wrap) : null;
  const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
  const fid = (cs.filter.match(/#([^)"']+)/) || [])[1] || null;
  const f = fid ? document.getElementById(fid) : null;
  const turb = f ? f.querySelector('feTurbulence') : null;
  const disp = f ? f.querySelector('feDisplacementMap') : null;
  const r = span.getBoundingClientRect();
  return {
    where: span.closest('.onboarding-cta') ? 'closing-cta' : 'landing-hero',
    glyph: span.textContent,
    fontSizePx: parseFloat(cs.fontSize),
    color: cs.color,
    fontFamily: cs.fontFamily.split(',')[0].replace(/['"]/g, ''),
    filterIdPrefix: fid ? fid.replace(/-[^-]*$/, '') : null,
    turbBaseFrequency: turb ? turb.getAttribute('baseFrequency') : null,
    turbOctaves: turb ? turb.getAttribute('numOctaves') : null,
    dispScale: disp ? disp.getAttribute('scale') : null,
    wrapperOpacity: wcs ? +(+wcs.opacity).toFixed(3) : null,
    transform: cs.transform,
    translateY: +m.f.toFixed(2),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  };
}))()`;

const ARROW_UP = `(() => {
  const c = ${CUE}.find((s) => s.closest('.onboarding-cta'));
  if (!c) return false;
  const w = c.closest('div');
  return w ? +getComputedStyle(w).opacity > 0.5 : false;
})()`;

const LANDING_ARROW_UP = `(() => {
  const c = ${CUE}.find((s) => !s.closest('.onboarding-cta'));
  if (!c) return false;
  const w = c.closest('div');
  return w ? +getComputedStyle(w).opacity > 0.5 : false;
})()`;

/** rAF sampler over the four prints, plus the moment the gesture was recognised. */
const EXIT_SAMPLER = (markEvent) => `(() => {
  const imgs = [...document.querySelectorAll('img')].filter((i) => /confession/i.test(i.alt || ''));
  window.__ex = { t0: null, tIndex: null, n: imgs.length, samples: [] };
  const mark = () => { if (window.__ex.t0 == null) window.__ex.t0 = performance.now(); };
  window.addEventListener('${markEvent}', mark, true);
  const eff = (el) => { let o = 1, n = el;
    while (n && n !== document.documentElement) { o *= +getComputedStyle(n).opacity; n = n.parentElement; }
    return o; };
  const loop = () => {
    const t = performance.now();
    if (window.__ex.tIndex == null && document.querySelector('.grid-tile')) window.__ex.tIndex = t;
    window.__ex.samples.push({
      t,
      p: imgs.map((i) => { const r = i.getBoundingClientRect();
        return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2),
          h: +r.height.toFixed(2), o: +eff(i).toFixed(4) }; }),
    });
    if (window.__ex.samples.length < 480 && (window.__ex.t0 == null || t - window.__ex.t0 < 3000)) {
      requestAnimationFrame(loop);
    }
  };
  requestAnimationFrame(loop);
  return imgs.length;
})()`;

const EXIT_RESULT = `(() => {
  const ex = window.__ex;
  if (!ex || ex.t0 == null) return { error: 'no gesture recorded', t0: ex && ex.t0 };
  const before = ex.samples.filter((s) => s.t <= ex.t0);
  const base = (before[before.length - 1] || ex.samples[0]).p;
  const after = ex.samples.filter((s) => s.t >= ex.t0);
  const firstMove = base.map((b, i) => {
    for (const s of after) {
      const p = s.p[i];
      if (!p) continue;
      const moved = Math.abs(p.x - b.x) > 0.25 || Math.abs(p.y - b.y) > 0.25;
      const faded = b.o - p.o > 0.01;
      if (moved || faded) return { i, dtMs: +(s.t - ex.t0).toFixed(1), kind: moved ? 'travel' : 'fade' };
    }
    return { i, dtMs: null, kind: 'never' };
  });
  const offScreen = base.map((b, i) => {
    for (const s of after) {
      const p = s.p[i];
      if (!p) continue;
      if (p.o < 0.02 || p.x > innerWidth || p.x < -600 || p.y > innerHeight || p.y < -600) {
        return { i, dtMs: +(s.t - ex.t0).toFixed(1) };
      }
    }
    return { i, dtMs: null };
  });
  /* Which way each print actually went, and whether any part of the trip the
     reader can see went downward. Read off the rects rather than off the authored
     numbers, so a sign error anywhere between DEAL_SLOTS and the transform shows
     up here. "Seen" is while the print still has opacity: past that it can travel
     wherever it likes. */
  const vertical = base.map((b, i) => {
    let last = b, minY = b.y, maxYSeen = b.y, downFrames = 0, worstDown = 0, prev = b;
    let off = null, detached = 0;
    for (const s of after) {
      const p = s.p[i];
      if (!p) continue;
      /* The beat unmounts behind the exit, and a detached node measures 0×0 at
         the origin — which reads as a print that flew to the top left corner.
         The trip is counted up to the last frame the node was still in the
         document. */
      if (p.w === 0 && p.h === 0) { detached++; continue; }
      last = p;
      if (p.y < minY) minY = p.y;
      if (p.o > 0.02) {
        if (p.y > maxYSeen) maxYSeen = p.y;
        const step = p.y - prev.y;
        if (step > 0.25) { downFrames++; if (step > worstDown) worstDown = +step.toFixed(2); }
      }
      if (off == null && (p.y + p.h < 0 || p.x + p.w < 0 || p.x > innerWidth || p.y > innerHeight)) {
        off = p.y + p.h < 0 ? 'top' : p.x + p.w < 0 ? 'left' : p.x > innerWidth ? 'right' : 'bottom';
      }
      prev = p;
    }
    const netDy = +(last.y - b.y).toFixed(1);
    const netDx = +(last.x - b.x).toFixed(1);
    return {
      i, y0: +b.y.toFixed(1), yEnd: +last.y.toFixed(1), netDy, netDx,
      // Degrees off straight up, signed: negative is leftward, positive rightward.
      angleFromUp: netDy === 0 && netDx === 0 ? null
        : +(Math.atan2(netDx, -netDy) * 180 / Math.PI).toFixed(1),
      risePx: +(b.y - minY).toFixed(1),
      seenDescentPx: +(maxYSeen - b.y).toFixed(1),
      downFramesSeen: downFrames,
      worstDownStepPx: worstDown,
      leftBy: off,
      detachedFrames: detached,
    };
  });
  return {
    photos: ex.n,
    frames: ex.samples.length,
    firstMove,
    offScreen,
    vertical,
    indexAtMs: ex.tIndex == null ? null : +(ex.tIndex - ex.t0).toFixed(1),
    lastSampleMs: +(ex.samples[ex.samples.length - 1].t - ex.t0).toFixed(1),
    // The sampler's own resolution, so a "first movement" number can be read
    // against the frame it was caught on rather than treated as exact.
    frameMs: +((ex.samples[ex.samples.length - 1].t - ex.samples[0].t) / (ex.samples.length - 1)).toFixed(2),
    firstFrameAfterGestureMs: (() => {
      const f = ex.samples.find((s) => s.t > ex.t0);
      return f ? +(f.t - ex.t0).toFixed(1) : null;
    })(),
  };
})()`;

const NAV_TABS = `(() => {
  const tabs = [...document.querySelectorAll('button[aria-label]')].filter((b) =>
    /^(index|explore)$/i.test(b.getAttribute('aria-label') || '')
  );
  return tabs.map((b) => {
    const r = b.getBoundingClientRect();
    return { label: b.getAttribute('aria-label'), cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
      glyphs: [...b.querySelectorAll('span')].filter((s) => (s.textContent || '').length === 1).length };
  });
})()`;

const NAV_LETTERS = (label) => `(() => {
  const b = [...document.querySelectorAll('button[aria-label]')].find((x) =>
    (x.getAttribute('aria-label') || '').toLowerCase() === '${label}'.toLowerCase()
  );
  if (!b) return null;
  return [...b.querySelectorAll('span')]
    .filter((s) => (s.textContent || '').length === 1 && /[A-Za-z]/.test(s.textContent))
    .map((s) => { const t = getComputedStyle(s).transform;
      const m = new DOMMatrixReadOnly(t === 'none' ? '' : t);
      return { ch: s.textContent, x: +m.e.toFixed(2), y: +m.f.toFixed(2) }; });
})()`;

/* ── input ─────────────────────────────────────────────────────────────── */

const KEYS = {
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
};

async function pressKey(name) {
  const k = KEYS[name];
  await send('Input.dispatchKeyEvent', {
    type: k.text ? 'keyDown' : 'rawKeyDown',
    key: k.key, code: k.code,
    windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk,
    ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}),
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: k.key, code: k.code,
    windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk,
  });
}

/** One finger drag. Negative dy = up the screen = forward in this telling. */
async function swipe({ x = 60, y = 700, dy = -140, steps = 5 } = {}) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: Math.round(y + (dy * i) / steps), id: 1 }],
    });
    await sleep(14);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function wheel({ x = 60, y = 300, deltaY = 60, bursts = 1 } = {}) {
  for (let i = 0; i < bursts; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, pointerType: 'mouse' });
    await sleep(14);
  }
}

const moveMouse = (x, y) =>
  send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });

async function click(x, y) {
  await moveMouse(x, y);
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function waitFor(expr, label, timeoutMs = 40000) {
  const t0 = Date.now();
  for (;;) {
    if (await evaluate(`!!(${expr})`)) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

async function axTree(jsExpr) {
  // requestNode only resolves against a document the agent has already walked.
  await send('DOM.getDocument', { depth: 1 });
  const r = await send('Runtime.evaluate', { expression: jsExpr, returnByValue: false });
  const objectId = r?.result?.objectId;
  if (!objectId) return null;
  const n = await send('DOM.requestNode', { objectId });
  if (!n?.nodeId) return null;
  const ax = await send('Accessibility.getPartialAXTree', { nodeId: n.nodeId, fetchRelatives: false });
  return ax?.nodes || null;
}

/* ── driver ────────────────────────────────────────────────────────────── */

async function open(width, height = 900) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  await sleep(500);
  await evaluate(RECORDER);
  await waitFor(LANDING_ARROW_UP, `landing arrow (beat 0) at ${width}px`);
  if (!(await evaluate('Array.isArray(window.__phases)'))) await evaluate(RECORDER);
}

/** Four forward steps, 1.6s apart — clear of the 1250ms grace each time. */
async function walkToClosing() {
  for (let i = 0; i < 4; i++) {
    await pressKey('ArrowDown');
    await sleep(1600);
  }
}

async function shot(path, scale = 3) {
  const vp = await evaluate('({ w: innerWidth, h: innerHeight })');
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: vp.w, height: vp.h, scale },
    captureBeyondViewport: false,
  });
  if (!r?.data) return null;
  fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
  return path;
}

const phaseLine = (ph) =>
  ph.map((p) => `${p.phase}@${p.t}ms`).join(' → ') +
  `   (index mounts: ${ph.filter((p) => p.phase === 'index').length})`;

const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const shots = [];

/* ── 1 · THE LABEL IS GONE, THE NAME IS NOT ────────────────────────────── */

console.log('\n═══ 1 · NO LABEL, NO RULE, STILL NAMED ═══');
await open(1440);
await walkToClosing();
await waitFor(ARROW_UP, 'closing arrow');
const audit = await evaluate(LABEL_AUDIT);
console.log(`   visible text inside the cta: ${JSON.stringify(audit.visibleText)}`);
console.log(`   per-glyph spans: ${audit.glyphSpans} · dashed/underlined elements: ${audit.ruledElements.length}`);
console.log(`   aria-label: "${audit.ariaLabel}" · arrow aria-hidden on <${audit.arrowAriaHiddenOn}>`);
ok('no text label renders inside the cta', !audit.hasText && audit.glyphSpans === 0, `textContent minus the arrow is ${JSON.stringify(audit.visibleText)}`);
ok('no dashed rule remains', audit.ruledElements.length === 0, JSON.stringify(audit.ruledElements));
ok('the arrow is hidden from assistive tech', audit.arrowAriaHiddenOn !== null, `aria-hidden="true" on the cue's <${audit.arrowAriaHiddenOn}>`);

const ax = await axTree(CTA);
const axCta = ax ? ax[0] : null;
const axName = axCta?.name?.value ?? null;
const axChildren = axCta?.childIds?.length ?? null;
console.log(`   AX node: role "${axCta?.role?.value}" name "${axName}" · child AX nodes ${axChildren}`);
ok(
  'the AX node keeps a meaningful name and exposes no glyph children',
  axCta?.role?.value === 'button' && axName === 'ENTER THE ARCHIVE' && (axChildren ?? 0) === 0,
  `role=${axCta?.role?.value} name=${JSON.stringify(axName)} children=${axChildren}`
);

/* ── 2 · THE BOX ───────────────────────────────────────────────────────── */

console.log('\n═══ 2 · THE BOX AND HIT AREA ═══');
const boxes = {};
boxes[1440] = await evaluate(BOX);
console.log(`   1440×900  button ${boxes[1440].w}×${boxes[1440].h}  padding ${boxes[1440].padding}  min ${boxes[1440].minWidth}/${boxes[1440].minHeight}`);
console.log(`             arrow ${boxes[1440].arrow.w}×${boxes[1440].arrow.h} @ ${boxes[1440].arrow.fontSize}, tracking ${boxes[1440].arrow.letterSpacing}`);
console.log(`             arrow off the button's centre by ${boxes[1440].arrow.offsetInButtonPx}px · off the viewport's by ${boxes[1440].arrow.offsetInViewportPx}px`);
console.log(`             button centred to ${boxes[1440].centreOffsetPx}px · ${boxes[1440].bottomGapPx}px of screen below it`);

/* ── 3 · THE EXIT: SWIPE → PRINTS LEAVING → INDEX ──────────────────────── */

console.log('\n═══ 3 · SWIPE UP · EXIT TIMING AND THE HAND-OFF ═══');
const n = await evaluate(EXIT_SAMPLER('touchend'));
console.log(`   sampling ${n} prints`);
await swipe();
await sleep(3400);
let ex = await evaluate(EXIT_RESULT);
let s = await evaluate(STATE);
console.log(`   frames sampled ${ex.frames} · sampler resolution ${ex.frameMs}ms · first frame after the gesture at ${ex.firstFrameAfterGestureMs}ms`);
for (const f of ex.firstMove) {
  console.log(`   print ${f.i} (${f.i === 0 ? 'booth' : 'note ' + f.i}) first ${f.kind} at ${f.dtMs}ms after the gesture · off screen at ${ex.offScreen[f.i].dtMs}ms`);
}
console.log(`   index mounted ${ex.indexAtMs}ms after the gesture`);
const firstAny = Math.min(...ex.firstMove.map((f) => f.dtMs ?? Infinity));
const travels = ex.firstMove.filter((f) => f.i > 0).map((f) => f.dtMs);
// There is no authored wait in front of the exit — queueS[0] is 0 — so what is
// left is one React commit and one animation frame in a dev build.
ok(
  'the exit begins on the gesture — no authored lead-in',
  firstAny <= 100,
  `first print moves ${firstAny}ms after the gesture: one commit + one frame, against an authored delay of 0ms`
);
ok(
  'the notes leave staggered, not together',
  travels.every((t) => t != null) && travels[1] - travels[0] > 40 && travels[2] - travels[1] > 20,
  `note departures at ${travels.join('ms, ')}ms → intervals ${(travels[1] - travels[0]).toFixed(0)}ms and ${(travels[2] - travels[1]).toFixed(0)}ms (authored 100ms / 80ms)`
);
console.log('\n   ── which way each print went (rects, not authored numbers) ──');
for (const v of ex.vertical) {
  const name = v.i === 0 ? 'booth ' : `note ${v.i}`;
  console.log(
    `   ${name}  y ${v.y0} → ${v.yEnd}  net Δy ${v.netDy > 0 ? '+' : ''}${v.netDy}px  net Δx ${v.netDx > 0 ? '+' : ''}${v.netDx}px  ` +
      `${v.angleFromUp == null ? 'held still' : `${Math.abs(v.angleFromUp)}° ${v.angleFromUp < 0 ? 'left' : 'right'} of straight up`}  ` +
      `rise ${v.risePx}px · descent while visible ${v.seenDescentPx}px · left by ${v.leftBy ?? 'fading'}`
  );
}
console.log(
  '   (measured to the last frame each print was still in the document — ' +
    `${ex.vertical.map((v) => v.detachedFrames).join('/')} frames past that were dropped)`
);
const swipeVert = ex.vertical;
/* The other four ways out are the same call, so they should draw the same fan;
   the tolerance is there for where in a flight the last sample happened to land,
   not for a different route. */
const sameFan = (v, tag) =>
  ok(
    `${tag}: the notes go up, on the same fan as the swipe`,
    v.filter((k) => k.i > 0).every((k) => k.netDy < 0) &&
      v.every((k, i) => Math.abs(k.netDy - swipeVert[i].netDy) < 40),
    `net Δy ${v.filter((k) => k.i > 0).map((k) => k.netDy).join('px, ')}px against the swipe's ${swipeVert.filter((k) => k.i > 0).map((k) => k.netDy).join('px, ')}px`
  );
const notesV = ex.vertical.filter((v) => v.i > 0);
ok(
  'no note travels downward',
  notesV.every((v) => v.netDy < 0),
  `net Δy per note: ${notesV.map((v) => `note ${v.i} ${v.netDy}px`).join(' · ')} — all negative is all upward`
);
ok(
  'nothing dips downward on the way, either',
  notesV.every((v) => v.seenDescentPx <= 1 && v.downFramesSeen === 0),
  `while visible, the worst downward step any note takes is ${Math.max(...notesV.map((v) => v.worstDownStepPx))}px, over ${notesV.reduce((a, v) => a + v.downFramesSeen, 0)} frames`
);
ok(
  'the fan is tilted up, not collapsed onto one path',
  new Set(notesV.map((v) => Math.round(v.angleFromUp / 5))).size === notesV.length &&
    Math.max(...notesV.map((v) => v.angleFromUp)) - Math.min(...notesV.map((v) => v.angleFromUp)) > 40,
  `departure angles ${notesV.map((v) => `${v.angleFromUp}°`).join(', ')} off vertical — a ${(Math.max(...notesV.map((v) => v.angleFromUp)) - Math.min(...notesV.map((v) => v.angleFromUp))).toFixed(0)}° spread`
);
ok(
  'the notes leave through the top edge',
  notesV.every((v) => v.leftBy === 'top'),
  `exits: ${notesV.map((v) => `note ${v.i} ${v.leftBy}`).join(' · ')}`
);
ok(
  'the archive arrives while the prints are still in the air',
  ex.indexAtMs != null && ex.indexAtMs > Math.max(...ex.offScreen.map((o) => o.dtMs ?? 0)) - 200 && ex.indexAtMs < 1200,
  `last print off screen at ${Math.max(...ex.offScreen.map((o) => o.dtMs ?? 0))}ms · index at ${ex.indexAtMs}ms · flights formally end at ~1100ms`
);
ok(
  'the swipe reaches the index',
  s.view === 'index' && s.tiles > 0 && s.filterRail,
  `tiles ${s.tiles} · filter rail ${s.filterRail}`
);
ok('the archive mounts exactly once', s.phases.filter((p) => p.phase === 'index').length === 1, phaseLine(s.phases));

/* ── 3b · THE FAN, AS A PICTURE ─────────────────────────────────────────
   Stills through the exit. Captured in a burst rather than at one chosen
   instant: a capture costs more than a frame, so the moment is bracketed and
   the frame that caught the fan is picked afterwards. Scale 2 — the point is
   the shape of the departure, and scale 3 is slow enough here to widen the
   bracket past the exit itself. */

console.log('\n═══ 3b · MID-EXIT STILLS ═══');
await open(1440);
await walkToClosing();
await waitFor(ARROW_UP, 'closing arrow');
await sleep(300);
const preFan = await shot('/tmp/onboarding-exit-fan-000-before.png', 2);
const fanT0 = Date.now();
await swipe();
const fanShots = [];
for (let f = 0; f < 5; f++) {
  const at = Date.now() - fanT0;
  const p = `/tmp/onboarding-exit-fan-${String(f + 1).padStart(3, '0')}.png`;
  await shot(p, 2);
  fanShots.push({ p, at });
}
console.log(`   before: ${preFan}`);
for (const f of fanShots) console.log(`   ~${f.at}ms after the gesture: ${f.p}`);
shots.push(preFan, ...fanShots.map((f) => f.p));

/* ── 4 · WHEEL ─────────────────────────────────────────────────────────── */

console.log('\n═══ 4 · WHEEL FORWARD (trackpad) ═══');
await open(1440);
await walkToClosing();
await waitFor(ARROW_UP, 'closing arrow');
await evaluate(EXIT_SAMPLER('wheel'));
await wheel({ deltaY: 60, bursts: 6 }); // a flick plus its momentum tail
await sleep(3400);
ex = await evaluate(EXIT_RESULT);
s = await evaluate(STATE);
console.log(`   first print moves ${Math.min(...ex.firstMove.map((f) => f.dtMs ?? Infinity))}ms after the wheel · index at ${ex.indexAtMs}ms`);
sameFan(ex.vertical, 'wheel');
ok('wheel forward reaches the index', s.view === 'index' && s.tiles > 0, `tiles ${s.tiles}`);
ok('a six-event wheel burst navigates once', s.phases.filter((p) => p.phase === 'index').length === 1, phaseLine(s.phases));

/* ── 5 · GRACE WINDOW ──────────────────────────────────────────────────── */

console.log('\n═══ 5 · THE 1250ms GRACE WINDOW ═══');
await open(1440);
// The grace is armed by the gesture handlers, not by the keys: a key press is
// discrete and carries no momentum tail to swallow. So the step that starts the
// window has to be a swipe as well.
await swipe(); // → beat 1, and the grace starts here
await sleep(500);
await swipe(); // inside the window
await sleep(400);
let g1 = await evaluate(STATE);
ok('a swipe 500ms into a beat is ignored', g1.beat === 1, `still on beat ${g1.beat} (a skipped beat would read 2)`);
await sleep(1400);
let g2 = await evaluate(STATE);
ok('the ignored swipe is not banked and replayed', g2.beat === 1, `still on beat ${g2.beat} 2.4s later, with no further input`);
await swipe();
await sleep(500);
let g3 = await evaluate(STATE);
ok('the next swipe, past the grace, steps one beat', g3.beat === 2, `beat ${g2.beat} → ${g3.beat}`);

console.log('   — and on the closing beat —');
await open(1440);
for (let i = 0; i < 3; i++) { await pressKey('ArrowDown'); await sleep(1600); }
await pressKey('ArrowDown'); // closing beat, t = 0
await sleep(600);
await swipe();
await sleep(300);
let c1 = await evaluate(STATE);
ok('a swipe 600ms into the closing beat does not leave', c1.view === 'onboarding' && c1.beat === 4, `view ${c1.view} · beat ${c1.beat}`);
await sleep(700);
await swipe();
await sleep(300);
let c2 = await evaluate(STATE);
ok(
  'a swipe past the grace but before the arrow is offered does not leave either',
  c2.view === 'onboarding' && c2.beat === 4,
  `view ${c2.view} · beat ${c2.beat} — the exit opens with the arrow, at enterDelayS = 2.5s`
);
await waitFor(ARROW_UP, 'closing arrow');
await sleep(150);
await swipe();
await sleep(3000);
let c3 = await evaluate(STATE);
ok('once the arrow is up, the same swipe leaves', c3.view === 'index' && c3.tiles > 0, `tiles ${c3.tiles} · ${phaseLine(c3.phases)}`);

/* ── 6 · CLICK ─────────────────────────────────────────────────────────── */

console.log('\n═══ 6 · CLICK ON THE ARROW ═══');
await open(1440);
await walkToClosing();
await waitFor(ARROW_UP, 'closing arrow');
let b = await evaluate(BOX);
let arr = (await evaluate(ARROWS)).find((a) => a.where === 'closing-cta');
await evaluate(EXIT_SAMPLER('click'));
await click(arr.rect.x + Math.round(arr.rect.w / 2), arr.rect.y + Math.round(arr.rect.h / 2));
await sleep(3400);
ex = await evaluate(EXIT_RESULT);
s = await evaluate(STATE);
const clickFirst = Math.min(...ex.firstMove.map((f) => f.dtMs ?? Infinity));
const clickTravels = ex.firstMove.filter((f) => f.i > 0).map((f) => f.dtMs);
console.log(`   first print moves ${clickFirst}ms after the click · note departures ${clickTravels.join('ms, ')}ms · index at ${ex.indexAtMs}ms`);
ok('clicking the arrow reaches the index', s.view === 'index' && s.tiles > 0, `tiles ${s.tiles} · ${phaseLine(s.phases)}`);
ok(
  'the click animates identically to the swipe',
  clickFirst <= 100 && Math.abs(clickTravels[2] - travels[2]) < 60,
  `first print ${firstAny}ms (swipe) vs ${clickFirst}ms (click) · last note away ${travels[2]}ms vs ${clickTravels[2]}ms`
);
sameFan(ex.vertical, 'click');

/* ── 7 · KEYBOARD ──────────────────────────────────────────────────────── */

const FOCUS = `(() => { const a = document.activeElement;
  return a ? { cls: String(a.className || ''), label: a.getAttribute('aria-label') || '', tag: a.tagName } : null; })()`;

for (const key of ['Enter', 'Space']) {
  console.log(`\n═══ 7 · KEYBOARD · TAB then ${key.toUpperCase()} ═══`);
  await open(1440);
  await walkToClosing();
  await waitFor(ARROW_UP, 'closing arrow');
  let tabs = 0;
  let focus = null;
  for (; tabs < 20; tabs++) {
    await pressKey('Tab');
    await sleep(60);
    focus = await evaluate(FOCUS);
    if (focus?.cls?.includes('onboarding-cta') && /ENTER/.test(focus.label)) break;
  }
  ok(
    `the cta is reachable by Tab (${tabs + 1} presses) with its name intact`,
    !!focus?.cls?.includes('onboarding-cta') && focus.label === 'ENTER THE ARCHIVE',
    `focused <${focus?.tag}> · accessible name "${focus?.label}"`
  );
  await evaluate(EXIT_SAMPLER('keydown'));
  await pressKey(key);
  await sleep(3400);
  ex = await evaluate(EXIT_RESULT);
  s = await evaluate(STATE);
  const kFirst = Math.min(...ex.firstMove.map((f) => f.dtMs ?? Infinity));
  console.log(`   first print moves ${kFirst}ms after ${key} · index at ${ex.indexAtMs}ms`);
  ok(
    `${key} on the focused cta reaches the index, once, with the same exit`,
    s.view === 'index' && s.tiles > 0 && s.phases.filter((p) => p.phase === 'index').length === 1 && kFirst <= 100,
    `first print ${kFirst}ms after the key · tiles ${s.tiles} · ${phaseLine(s.phases)}`
  );
  sameFan(ex.vertical, key);
}

/* ── 8 · THE ARROW vs THE LANDING PAGE'S ───────────────────────────────── */

console.log('\n═══ 8 · THE ARROW · CLOSING BEAT vs LANDING (beat 0) ═══');
await open(1440);
await walkToClosing();
await waitFor(ARROW_UP, 'closing arrow');
const both = await evaluate(ARROWS);
for (const a of both) {
  console.log(
    `   ${a.where.padEnd(13)} "${a.glyph}" ${a.fontSizePx}px ${a.fontFamily} ${a.color}\n` +
      `                 filter ${a.filterIdPrefix}* · feTurbulence baseFrequency ${a.turbBaseFrequency} octaves ${a.turbOctaves} · feDisplacementMap scale ${a.dispScale}\n` +
      `                 box ${a.rect.w}×${a.rect.h} at (${a.rect.x},${a.rect.y}) · wrapper opacity ${a.wrapperOpacity}`
  );
}
const closing = both.find((a) => a.where === 'closing-cta');
const landing = both.find((a) => a.where === 'landing-hero');
ok(
  'the two arrows are the same glyph, size, family, colour and grain filter',
  !!closing && !!landing &&
    closing.glyph === landing.glyph && closing.fontSizePx === landing.fontSizePx &&
    closing.fontFamily === landing.fontFamily && closing.color === landing.color &&
    closing.filterIdPrefix === landing.filterIdPrefix &&
    closing.turbBaseFrequency === landing.turbBaseFrequency && closing.dispScale === landing.dispScale,
  'one export: ScrollCue in OnboardingReveal.jsx, rendered by both'
);
const samples = [];
for (let i = 0; i < 26; i++) {
  const a = await evaluate(ARROWS);
  samples.push({
    c: a.find((x) => x.where === 'closing-cta')?.translateY ?? null,
    l: a.find((x) => x.where === 'landing-hero')?.translateY ?? null,
  });
  await sleep(70);
}
const spanOf = (k) => {
  const v = samples.map((x) => x[k]).filter((x) => x != null);
  return { min: Math.min(...v), max: Math.max(...v), amp: +(Math.max(...v) - Math.min(...v)).toFixed(2) };
};
const cAmp = spanOf('c');
const lAmp = spanOf('l');
console.log(`   closing bounce translateY ${cAmp.min} → ${cAmp.max} (amplitude ${cAmp.amp}px)`);
console.log(`   landing bounce translateY ${lAmp.min} → ${lAmp.max} (amplitude ${lAmp.amp}px)`);
console.log(`   raw transforms: closing "${closing.transform}" · landing "${landing.transform}"`);
ok(
  'both arrows bounce on the same 0→9px keyframe',
  cAmp.amp > 4 && lAmp.amp > 4 && Math.abs(cAmp.amp - lAmp.amp) < 3.5,
  `amplitudes ${cAmp.amp}px vs ${lAmp.amp}px against the authored 9px travel`
);

/* ── 9 · THE NAV TABS' SCATTER (shared letterScatter.jsx) ──────────────── */

console.log('\n═══ 9 · ARCHIVE NAV TABS STILL SCATTER ═══');
await evaluate(EXIT_SAMPLER('click'));
b = await evaluate(BOX);
arr = (await evaluate(ARROWS)).find((a) => a.where === 'closing-cta');
await click(arr.rect.x + Math.round(arr.rect.w / 2), arr.rect.y + Math.round(arr.rect.h / 2));
await sleep(5000);
const tabs = await evaluate(NAV_TABS);
console.log(`   tabs found: ${tabs.map((t) => `${t.label} (${t.glyphs} glyph spans)`).join(', ') || 'none'}`);
const inactive = tabs.find((t) => /explore/i.test(t.label)) || tabs[0];
if (inactive) {
  const rest = await evaluate(NAV_LETTERS(inactive.label));
  await moveMouse(inactive.cx, inactive.cy);
  await sleep(420);
  const hov = await evaluate(NAV_LETTERS(inactive.label));
  await moveMouse(5, 5);
  await sleep(700);
  const ret = await evaluate(NAV_LETTERS(inactive.label));
  const movedN = hov.filter((l, i) => Math.abs(l.x - rest[i].x) > 0.5 || Math.abs(l.y - rest[i].y) > 0.5).length;
  const dirs = new Set(hov.map((l) => `${Math.sign(l.x)}${Math.sign(l.y)}`));
  const backToZero = ret.every((l) => Math.abs(l.x) < 0.6 && Math.abs(l.y) < 0.6);
  console.log(`   ${inactive.label}: ${hov.length} glyphs · ${movedN} moved · ${dirs.size} distinct directions · sample ${hov.slice(0, 4).map((l) => `${l.ch}(${l.x},${l.y})`).join(' ')}`);
  ok(
    `the ${inactive.label} tab's letters still scatter and return to zero`,
    movedN >= hov.length - 1 && dirs.size >= 2 && backToZero,
    `returned to rest: ${backToZero}`
  );
} else {
  ok('the nav tabs were found in the index', false, 'no INDEX / EXPLORE button with an aria-label');
}

/* ── 10 · REDUCED MOTION ───────────────────────────────────────────────── */

console.log('\n═══ 10 · prefers-reduced-motion ═══');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE });
await sleep(2500);
await evaluate(RECORDER);
for (let i = 0; i < 4; i++) { await pressKey('ArrowDown'); await sleep(1500); }
let rm = await evaluate(STATE);
console.log(`   beat ${rm.beat} · arrows ${rm.arrows} · arrow inside the cta ${rm.arrowInCta}`);
const tRm0 = Date.now();
await swipe();
await waitFor(`document.querySelector('.grid-tile')`, 'index under reduced motion', 8000).catch(() => null);
const rmMs = Date.now() - tRm0;
rm = await evaluate(STATE);
ok(
  'reduced motion: the swipe reaches the index promptly, with no disperse to wait out',
  rm.view === 'index' && rm.tiles > 0,
  `index up ${rmMs}ms after the swipe · tiles ${rm.tiles}`
);
await send('Emulation.setEmulatedMedia', { features: [] });

/* ── 11 · SCREENSHOTS AND THE PHONE BOX ────────────────────────────────── */

console.log('\n═══ 11 · SCREENSHOTS (scale 3) AND THE PHONE BOX ═══');
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await open(w, h);
  const p1 = await shot(`/tmp/onboarding-landing-arrow-${w}.png`);
  if (p1) shots.push(p1);
  await walkToClosing();
  await waitFor(ARROW_UP, `closing arrow at ${w}px`);
  await sleep(900);
  const p2 = await shot(`/tmp/onboarding-closing-arrow-${w}.png`);
  if (p2) shots.push(p2);
  boxes[w] = await evaluate(BOX);
  const bb = boxes[w];
  console.log(
    `   ${w}×${h}  button ${bb.w}×${bb.h} at (${bb.x},${bb.y})  padding ${bb.padding}\n` +
      `             arrow ${bb.arrow.w}×${bb.arrow.h} · off the button's centre by ${bb.arrow.offsetInButtonPx}px\n` +
      `             centred to ${bb.centreOffsetPx}px · ${bb.bottomGapPx}px of screen below · fully on screen ${bb.onScreen}`
  );
  ok(
    `the hit area is comfortably tappable at ${w}px (≥44×44) and on screen`,
    bb.w >= 44 && bb.h >= 44 && bb.onScreen,
    `${bb.w}×${bb.h}px`
  );
  ok(
    `the arrow is optically centred at ${w}px`,
    Math.abs(bb.arrow.offsetInButtonPx) < 2 && Math.abs(bb.centreOffsetPx) < 2,
    `arrow ${bb.arrow.offsetInButtonPx}px off the button's centre, button ${bb.centreOffsetPx}px off the viewport's`
  );
}
shots.forEach((p) => console.log(`   ${p}`));

/* ── 12 · THE SCROLLED TELLING KEEPS ITS WORDS ─────────────────────────── */

console.log('\n═══ 12 · /onboarding (the scrolled telling) STILL SETS THE PHRASE ═══');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/onboarding` });
await sleep(4000);
await evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
await sleep(3000);
const scrolled = await evaluate(LABEL_AUDIT);
console.log(`   visible text: ${JSON.stringify(scrolled?.visibleText)} · glyph spans ${scrolled?.glyphSpans} · ruled elements ${scrolled?.ruledElements.length}`);
ok(
  'the scrolled telling still renders the lettered cta and its rule',
  !!scrolled && scrolled.hasText && scrolled.glyphSpans > 10 && scrolled.ruledElements.length > 0,
  `so the arrow-only shape is scoped to the beats telling, and letterScatter.jsx keeps this caller too`
);

/* ── summary ───────────────────────────────────────────────────────────── */

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? `\nFAILED: ${failed.map((f) => f.name).join(' · ')}` : '')
);

ws.close();
chrome.kill();
// Chrome is still flushing the profile as it dies, so give it a moment before
// taking the directory out from under it.
await sleep(400);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {}
