/**
 * ENTER THE ARCHIVE — the closing cta's per-letter hover scatter, measured.
 *
 * Walks the beats telling to its last beat, waits out the button's entrance,
 * then reports for each glyph of the label: its computed transform at rest,
 * the peak translation / rotation reached while the pointer sits on the
 * button, and where it lands after the pointer leaves. Hovers twice to show a
 * given letter takes the same direction both times (the directions are derived
 * from the letter's index, not drawn at random per render).
 *
 * Also reports the button's bounding box at rest vs hovered (must be
 * identical — transforms only), the label's rendered text and width, the
 * button's accessible name, and whether the letter spans are hidden from
 * assistive tech. Writes /tmp screenshots of rest / hover / settled.
 *
 * Transforms are sampled frame by frame from getComputedStyle: motion animates
 * on requestAnimationFrame and writes the matrix itself, so there is no CSS
 * transition to read a duration off.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PATHNAME = process.env.PATHNAME || '/onboarding-beats';
const PORT = 9357;
const TAG = process.env.TAG || 'after';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/cta-scatter-profile',
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
  if (r?.exceptionDetails) return { error: r.exceptionDetails.text };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Accessibility.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
// REDUCED=1 runs the whole thing under prefers-reduced-motion, where hovering
// should leave every letter exactly where it sits.
if (process.env.REDUCED) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
}
await send('Page.navigate', { url: BASE + PATHNAME });

/* Shared page-side helpers: find the ENTER button and decompose the matrix
   each letter is currently carrying. */
const HELPERS = `
  window.__cta = () => [...document.querySelectorAll('.onboarding-cta')]
    .find((c) => /enter the archive/i.test(c.textContent || ''));
  window.__letters = () => {
    const b = window.__cta();
    if (!b) return [];
    const wrap = b.querySelector('span');
    // The glyph spans are the wrapper's element children; before the split
    // there are none and this reports the label as one piece.
    return [...wrap.querySelectorAll('span')].filter((s) => !s.querySelector('span'));
  };
  window.__decompose = (el) => {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return { x: 0, y: 0, rot: 0, raw: 'none' };
    const n = t.match(/matrix\\(([^)]+)\\)/);
    if (!n) return { x: 0, y: 0, rot: 0, raw: t };
    const [a, b2, , d, e, f] = n[1].split(',').map(Number);
    return {
      x: +e.toFixed(3),
      y: +f.toFixed(3),
      rot: +((Math.atan2(b2, a) * 180) / Math.PI).toFixed(3),
      scaleY: +d.toFixed(3),
      raw: t,
    };
  };
  window.__sample = () => window.__letters().map((el, i) => {
    const d = window.__decompose(el);
    return { i, ch: el.textContent, x: d.x, y: d.y, rot: d.rot };
  });
  true;
`;

// Jump straight to the closing beat with the progress rail rather than
// stepping: the rail's dashes are real buttons and land on a beat directly.
const arrive = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 120; i++) {
    if (document.querySelector('[aria-label^="Beat "]')) break;
    await sleep(150);
  }
  const dashes = [...document.querySelectorAll('[aria-label^="Beat "]')];
  if (!dashes.length) return { ok: false, why: 'no progress rail' };
  dashes[dashes.length - 1].click();
  ${HELPERS}
  for (let i = 0; i < 200; i++) {
    const b = window.__cta();
    if (b && parseFloat(getComputedStyle(b).opacity) > 0.98) {
      await sleep(250);
      return { ok: true, beats: dashes.length, waitedMs: i * 100 };
    }
    await sleep(100);
  }
  return { ok: false, why: 'cta never settled' };
})()`);
console.log('arrival:', JSON.stringify(arrive));
if (!arrive?.ok) {
  ws.close();
  chrome.kill();
  process.exit(1);
}

const STATIC = `(() => {
  const b = window.__cta();
  const wrap = b.querySelector('span');
  const letters = window.__letters();
  const bb = b.getBoundingClientRect();
  const wb = wrap.getBoundingClientRect();
  const cs = getComputedStyle(wrap);
  return {
    button: {
      box: { x: +bb.x.toFixed(2), y: +bb.y.toFixed(2), w: +bb.width.toFixed(2), h: +bb.height.toFixed(2) },
      ariaLabel: b.getAttribute('aria-label'),
      text: b.textContent,
      outlineStyle: getComputedStyle(b).outlineStyle,
    },
    label: {
      text: wrap.textContent,
      width: +wb.width.toFixed(2),
      height: +wb.height.toFixed(2),
      top: +wb.top.toFixed(2),
      ariaHidden: wrap.getAttribute('aria-hidden'),
      backgroundImage: cs.backgroundImage,
      backgroundSize: cs.backgroundSize,
      backgroundRepeat: cs.backgroundRepeat,
      backgroundPosition: cs.backgroundPosition,
    },
    letters: {
      count: letters.length,
      chars: letters.map((l) => l.textContent),
      ariaHidden: letters.map((l) => l.getAttribute('aria-hidden')),
      // Any per-letter background would mean the dotted rule got fragmented.
      ownBackgrounds: letters.filter((l) => getComputedStyle(l).backgroundImage !== 'none').length,
      lefts: letters.map((l) => +l.getBoundingClientRect().left.toFixed(2)),
    },
  };
})()`;

const hover = async (on) => {
  const box = await evaluate(`(() => {
    const b = window.__cta();
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: on ? box.cx : 5,
    y: on ? box.cy : 5,
    buttons: 0,
    pointerType: 'mouse',
  });
};

/** Sample every letter's transform once a frame for `ms`, keep the frame with
 *  the largest mean displacement, and report where things end up. */
const track = (ms) => evaluate(`(async () => {
  const frames = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ${ms}) {
    frames.push(window.__sample());
    await new Promise(r => requestAnimationFrame(r));
  }
  const mag = (f) => f.reduce((s, l) => s + Math.hypot(l.x, l.y), 0) / Math.max(1, f.length);
  let peak = frames[0], peakMag = -1;
  for (const f of frames) { const m = mag(f); if (m > peakMag) { peakMag = m; peak = f; } }
  return { frames: frames.length, peak, peakMeanPx: +peakMag.toFixed(3), last: frames[frames.length - 1] };
})()`);

const shot = async (name, pad = 14) => {
  const clip = await evaluate(`(() => {
    const r = window.__cta().getBoundingClientRect();
    return { x: Math.max(0, r.x - ${pad}), y: Math.max(0, r.y - ${pad}), width: r.width + ${pad} * 2, height: r.height + ${pad} * 2 };
  })()`);
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...clip, scale: 3 },
    captureBeyondViewport: false,
  });
  const path = `/tmp/cta-scatter-${TAG}-${name}.png`;
  if (s?.data) fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  return path;
};

const statics = await evaluate(STATIC);
const rest = await track(120);
const restShot = await shot('rest');

await hover(true);
const hover1 = await track(700);
const hoverShot = await shot('hover');
const hoverBox = await evaluate(
  `(() => { const r = window.__cta().getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; })()`
);
const hoverLabelWidth = await evaluate(
  `(() => +window.__cta().querySelector('span').getBoundingClientRect().width.toFixed(2))()`
);

await hover(false);
const settle = await track(800);
const settledShot = await shot('settled');

await hover(true);
const hover2 = await track(700);
await hover(false);
await track(700);

/* Keyboard focus: tab until the cta owns focus, then read what the focus ring
   computes to and whether the box moved to make room for it. */
const focus = await (async () => {
  for (let i = 0; i < 40; i++) {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
    }
    const hit = await evaluate(`(() => document.activeElement === window.__cta())()`);
    if (hit) break;
    await sleep(20);
  }
  return evaluate(`(() => {
    const b = window.__cta();
    const focused = document.activeElement === b;
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return {
      focused,
      matchesFocusVisible: focused && b.matches(':focus-visible'),
      outline: cs.outline,
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      box: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
      lettersStill: window.__sample().every((l) => !l.x && !l.y && !l.rot),
    };
  })()`);
})();
const focusShot = await shot('focus');
await evaluate(`(() => { document.activeElement.blur(); return true; })()`);

/* Accessible name straight from the AX tree, plus whether the glyph spans
   surface as nodes at all. */
const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
const btnNode = await evaluate(`(() => { window.__ctaEl = window.__cta(); return true; })()`);
const axName = await (async () => {
  const q = await send('DOM.querySelectorAll', {
    nodeId: doc.root.nodeId,
    selector: '.onboarding-cta',
  });
  for (const nodeId of q?.nodeIds || []) {
    const ax = await send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const node = ax?.nodes?.[0];
    const name = node?.name?.value || '';
    if (/enter the archive/i.test(name) || /enter/i.test(name)) {
      return {
        name,
        role: node?.role?.value,
        ignored: node?.ignored,
        childCount: (node?.childIds || []).length,
      };
    }
  }
  return { name: null };
})();

const fmt = (f) =>
  f
    .map(
      (l) =>
        `      ${JSON.stringify(l.ch).padEnd(5)} x ${String(l.x).padStart(7)}  y ${String(l.y).padStart(7)}  rot ${String(l.rot).padStart(7)}°  |Δ| ${Math.hypot(l.x, l.y).toFixed(2)}`
    )
    .join('\n');

console.log('\n── static');
console.log(JSON.stringify(statics, null, 2));

console.log('\n── rest transforms');
console.log(fmt(rest.last));

console.log(`\n── hover #1 peak (mean |Δ| ${hover1.peakMeanPx}px over ${hover1.frames} frames)`);
console.log(fmt(hover1.peak));

console.log('\n── after pointer leaves');
console.log(fmt(settle.last));

console.log(`\n── hover #2 peak (mean |Δ| ${hover2.peakMeanPx}px)`);
console.log(fmt(hover2.peak));

const dirs = (f) => f.map((l) => Math.round((Math.atan2(l.y, l.x) * 180) / Math.PI));
const d1 = dirs(hover1.peak || []);
const d2 = dirs(hover2.peak || []);
const stable = d1.length && d1.every((a, i) => Math.abs(a - (d2[i] ?? 999)) <= 3);
const moved = (hover1.peak || []).filter((l) => Math.hypot(l.x, l.y) > 0.4).length;
const returned = (settle.last || []).every((l) => Math.hypot(l.x, l.y) < 0.05 && Math.abs(l.rot) < 0.05);
const peakPx = Math.max(0, ...(hover1.peak || []).map((l) => Math.hypot(l.x, l.y)));
const minPx = Math.min(Infinity, ...(hover1.peak || []).map((l) => Math.hypot(l.x, l.y)));
const peakRot = Math.max(0, ...(hover1.peak || []).map((l) => Math.abs(l.rot)));

console.log('\n── summary');
console.log(
  JSON.stringify(
    {
      letters: statics?.letters?.count,
      lettersMoved: moved,
      distinctDirections: new Set(d1).size,
      directionsDeg1: d1,
      directionsDeg2: d2,
      directionsStableAcrossHovers: stable,
      translationPx: { min: +minPx.toFixed(2), max: +peakPx.toFixed(2) },
      rotationDegMax: +peakRot.toFixed(2),
      returnedToRest: returned,
      restBox: statics?.button?.box,
      hoverBox: hoverBox,
      boxUnchanged:
        statics?.button?.box?.w === hoverBox?.w &&
        statics?.button?.box?.h === hoverBox?.h &&
        statics?.button?.box?.x === hoverBox?.x &&
        statics?.button?.box?.y === hoverBox?.y,
      labelWidthRest: statics?.label?.width,
      labelWidthHover: hoverLabelWidth,
      labelText: statics?.label?.text,
      accessible: axName,
      reducedMotionEmulated: Boolean(process.env.REDUCED),
      keyboardFocus: focus,
      shots: [restShot, hoverShot, settledShot, focusShot],
    },
    null,
    2
  )
);

ws.close();
chrome.kill();
