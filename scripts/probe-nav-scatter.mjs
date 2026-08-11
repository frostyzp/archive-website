/**
 * INDEX / EXPLORE view tabs — the per-letter hover scatter, measured.
 *
 * Deep-links into the archive (`/?view=grid`) and, for each tab, reports every
 * glyph's computed transform at rest, at the peak of a hover, and after the
 * pointer leaves; hovers twice to show a letter takes the same direction both
 * times; and checks the tab's box, its neighbours' boxes (the slash and the
 * other tab), the accessible name, and whether the glyph spans reach the
 * accessibility tree at all.
 *
 * Then it sweeps the pointer across both tabs in quick succession — the way a
 * cursor actually crosses nav chrome — and checks nothing is left scattered
 * behind it. Finally it clicks each tab to confirm the view still switches and
 * the selected styling lands on the right one.
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
const PORT = 9358;
const TAG = process.env.TAG || 'nav';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/nav-scatter-profile',
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
/* Other agents are editing this app while the probe runs, so Vite can reload
   the page out from under a call. Re-inject the helpers and try once more
   rather than reporting a hole in the data. */
const evaluateOnce = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { __failed: r.exceptionDetails.text };
  if (!r?.result) return { __failed: 'no execution context' };
  return { value: r.result.value };
};
const evaluate = async (expression) => {
  let r = await evaluateOnce(expression);
  if (r.__failed) {
    await sleep(1500);
    await evaluateOnce(HELPERS);
    r = await evaluateOnce(expression);
  }
  if (r.__failed) throw new Error(`evaluate failed: ${r.__failed}`);
  return r.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Accessibility.enable');
if (process.env.REDUCED) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
}
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
// The landing sequence is a timer the archive doesn't need; the deep link the
// cta itself uses opens straight onto the grid.
await send('Page.navigate', { url: `${BASE}/?view=grid` });

const HELPERS = `
  window.__tab = (name) => [...document.querySelectorAll('button[aria-label]')]
    .find((b) => b.getAttribute('aria-label') === name);
  window.__glyphs = (name) => {
    const b = window.__tab(name);
    if (!b) return [];
    const wrap = b.querySelector('span');
    return wrap ? [...wrap.querySelectorAll('span')] : [];
  };
  window.__decompose = (el) => {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return { x: 0, y: 0, rot: 0 };
    const n = t.match(/matrix\\(([^)]+)\\)/);
    if (!n) return { x: 0, y: 0, rot: 0 };
    const [a, b2, , , e, f] = n[1].split(',').map(Number);
    return {
      x: +e.toFixed(3),
      y: +f.toFixed(3),
      rot: +((Math.atan2(b2, a) * 180) / Math.PI).toFixed(3),
    };
  };
  window.__sample = (name) => window.__glyphs(name).map((el, i) => {
    const d = window.__decompose(el);
    return { i, ch: el.textContent, x: d.x, y: d.y, rot: d.rot };
  });
  window.__rects = () => {
    const out = {};
    for (const name of ['INDEX', 'EXPLORE']) {
      const b = window.__tab(name);
      if (!b) continue;
      const r = b.getBoundingClientRect();
      out[name] = { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    }
    // The non-interactive slash between the pair — the nearest neighbour a
    // reflow would shove.
    const slash = [...document.querySelectorAll('span[aria-hidden="true"]')]
      .find((s) => s.textContent === '/' && s.getBoundingClientRect().width);
    if (slash) {
      const r = slash.getBoundingClientRect();
      out.slash = { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    }
    return out;
  };
  true;
`;

// Survives the reloads above, so a sample never lands on a page without them.
await send('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS });

const ready = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  ${HELPERS}
  for (let i = 0; i < 150; i++) {
    if (window.__tab('INDEX') && window.__tab('EXPLORE')) {
      // The bar itself enters on a y-slide; measuring through that reads as a
      // layout shift that has nothing to do with the hover.
      await sleep(2500);
      return { ok: true, waitedMs: i * 100 };
    }
    await sleep(100);
  }
  return { ok: false };
})()`);
console.log('arrival:', JSON.stringify(ready));
if (!ready?.ok) {
  ws.close();
  chrome.kill();
  process.exit(1);
}

const point = async (name) => {
  const p = await evaluate(`(() => {
    ${name ? `const r = window.__tab(${JSON.stringify(name)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };` : 'return { x: 700, y: 600 };'}
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: p.x,
    y: p.y,
    buttons: 0,
    pointerType: 'mouse',
  });
  return p;
};

const track = (name, ms) => evaluate(`(async () => {
  const frames = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ${ms}) {
    frames.push(window.__sample(${JSON.stringify(name)}));
    await new Promise(r => requestAnimationFrame(r));
  }
  const mag = (f) => f.reduce((s, l) => s + Math.hypot(l.x, l.y), 0) / Math.max(1, f.length);
  let peak = frames[0], peakMag = -1;
  for (const f of frames) { const m = mag(f); if (m > peakMag) { peakMag = m; peak = f; } }
  return { peak, peakMeanPx: +peakMag.toFixed(3), last: frames[frames.length - 1] };
})()`);

const shot = async (name, pad = 10) => {
  const clip = await evaluate(`(() => {
    const r = window.__tab('INDEX').getBoundingClientRect();
    const e = window.__tab('EXPLORE').getBoundingClientRect();
    const x = Math.min(r.x, e.x) - ${pad};
    const y = Math.min(r.y, e.y) - ${pad};
    return { x: Math.max(0, x), y: Math.max(0, y), width: Math.max(r.right, e.right) - x + ${pad}, height: Math.max(r.bottom, e.bottom) - y + ${pad} };
  })()`);
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...clip, scale: 3 },
    captureBeyondViewport: false,
  });
  const path = `/tmp/${TAG}-${name}.png`;
  if (s?.data) fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  return path;
};

const axFor = async (label) => {
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const q = await send('DOM.querySelectorAll', {
    nodeId: doc.root.nodeId,
    selector: `button[aria-label="${label}"]`,
  });
  for (const nodeId of q?.nodeIds || []) {
    const ax = await send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const n = ax?.nodes?.[0];
    if (n) {
      return {
        name: n.name?.value,
        role: n.role?.value,
        ignored: n.ignored,
        childCount: (n.childIds || []).length,
      };
    }
  }
  return null;
};

const fmt = (f) =>
  (f || [])
    .map(
      (l) =>
        `      ${JSON.stringify(l.ch).padEnd(4)} x ${String(l.x).padStart(7)}  y ${String(l.y).padStart(7)}  rot ${String(l.rot).padStart(7)}°  |Δ| ${Math.hypot(l.x, l.y).toFixed(2)}`
    )
    .join('\n');
const dirs = (f) => (f || []).map((l) => Math.round((Math.atan2(l.y, l.x) * 180) / Math.PI));

const results = {};
const shots = {};
shots.rest = await shot('rest');

/** Hover a tab, watch every glyph, let go, hover again. */
async function measure(name) {
  const restRects = await evaluate('window.__rects()');
  const rest = await track(name, 120);
  await point(name);
  const h1 = await track(name, 620);
  const hoverRects = await evaluate('window.__rects()');
  shots[`hover-${name}`] = await shot(`hover-${name.toLowerCase()}`);
  await point(null);
  const settle = await track(name, 800);
  await point(name);
  const h2 = await track(name, 620);
  await point(null);
  await track(name, 700);

  const d1 = dirs(h1.peak);
  const d2 = dirs(h2.peak);
  const peak = h1.peak || [];
  results[name] = {
    glyphs: peak.length,
    moved: peak.filter((l) => Math.hypot(l.x, l.y) > 0.2).length,
    distinctDirections: new Set(d1).size,
    directionsDeg1: d1,
    directionsDeg2: d2,
    directionsStable: d1.length > 0 && d1.every((a, i) => Math.abs(a - (d2[i] ?? 999)) <= 3),
    translationPx: {
      min: +Math.min(...peak.map((l) => Math.hypot(l.x, l.y))).toFixed(2),
      max: +Math.max(...peak.map((l) => Math.hypot(l.x, l.y))).toFixed(2),
    },
    rotationDegMax: +Math.max(...peak.map((l) => Math.abs(l.rot))).toFixed(2),
    restAllZero: (rest.last || []).every((l) => !l.x && !l.y && !l.rot),
    returnedToRest: (settle.last || []).every(
      (l) => Math.hypot(l.x, l.y) < 0.05 && Math.abs(l.rot) < 0.05
    ),
    boxes: { rest: restRects, hover: hoverRects },
    boxesUnchanged: JSON.stringify(restRects) === JSON.stringify(hoverRects),
    ax: await axFor(name),
  };
  console.log(`\n── ${name} hover peak (mean |Δ| ${h1.peakMeanPx}px)`);
  console.log(fmt(h1.peak));
  console.log(`── ${name} after the pointer leaves`);
  console.log(fmt(settle.last));
}

/* The tabs are real controls: click each and read back which view the app
   thinks it is on. The grid's search field only exists in the index view, and
   the current tab is the one at full opacity. */
const viewState = () => evaluate(`(() => ({
  gridSearchField: Boolean(document.querySelector('.grid-search-field')),
  opacity: {
    INDEX: getComputedStyle(window.__tab('INDEX')).opacity,
    EXPLORE: getComputedStyle(window.__tab('EXPLORE')).opacity,
  },
  labels: {
    INDEX: window.__tab('INDEX').textContent,
    EXPLORE: window.__tab('EXPLORE').textContent,
  },
}))()`);

const click = async (name) => {
  const p = await point(name);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: p.x,
      y: p.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'mouse',
    });
  }
  await point(null);
  await sleep(1200);
  return viewState();
};

/* One tab is always the current view, and the current view does not scatter —
   so each is measured while it is the OTHER one, the one you can travel to.
   The archive opens on the index, so EXPLORE goes first. */
const switching = { onLoad: await viewState() };
await measure('EXPLORE');

/* The tab you are already on, hovered: nothing should come loose. */
await point('INDEX');
const activeHeld = await track('INDEX', 620);
shots['hover-active-index'] = await shot('hover-active-index');
await point(null);
await track('INDEX', 300);

/* A cursor crossing the pair at speed — onto the live tab, then back off it —
   which is how a nav bar actually gets hovered. */
await point('EXPLORE');
await sleep(150);
const midSweep = await evaluate(`window.__sample('EXPLORE')`);
await point('INDEX');
await sleep(700);
const afterSweep = {
  EXPLORE: await evaluate(`window.__sample('EXPLORE')`),
  INDEX: await evaluate(`window.__sample('INDEX')`),
};
await point(null);
await sleep(500);
const still = (s) => (s || []).every((l) => Math.hypot(l.x, l.y) < 0.05 && Math.abs(l.rot) < 0.05);
const sweepSummary = {
  exploreScatteredMidSweep: !still(midSweep),
  everythingReleasedAfterSweep: still(afterSweep.EXPLORE) && still(afterSweep.INDEX),
};

switching.afterClickExplore = await click('EXPLORE');
// The explore view is current now, so INDEX is the travelable tab.
await measure('INDEX');
switching.afterClickIndex = await click('INDEX');

/* Keyboard focus still lands on the tabs and still draws a ring. Tabbed with
   real key events rather than el.focus(), since :focus-visible only matches
   when the focus arrived from the keyboard. */
const focus = await (async () => {
  await evaluate(`(() => { document.body.focus(); return true; })()`);
  for (let i = 0; i < 60; i++) {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
    }
    const hit = await evaluate(
      `(() => ['INDEX','EXPLORE'].find((n) => document.activeElement === window.__tab(n)) || null)()`
    );
    if (hit) break;
  }
  return evaluate(`(() => {
    const name = ['INDEX','EXPLORE'].find((n) => document.activeElement === window.__tab(n));
    if (!name) return { reachedByTab: false };
    const b = window.__tab(name);
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    const out = {
      reachedByTab: true,
      tab: name,
      matchesFocusVisible: b.matches(':focus-visible'),
      outline: cs.outline,
      outlineStyle: cs.outlineStyle,
      box: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
      lettersStill: window.__sample(name).every((l) => !l.x && !l.y && !l.rot),
    };
    b.blur();
    return out;
  })()`);
})();

console.log('\n── summary');
console.log(
  JSON.stringify(
    {
      tabs: results,
      activeTabHoverHeldStill: (activeHeld.peak || []).every((l) => !l.x && !l.y && !l.rot),
      sweep: sweepSummary,
      switching,
      keyboardFocus: focus,
      reduced: Boolean(process.env.REDUCED),
      shots,
    },
    null,
    2
  )
);

ws.close();
chrome.kill();
