/**
 * The "Paper Stock" DialKit panel: proves it is gated behind ?dial=1, that every
 * dial opens on the value the About drawer ships (so the panel changes nothing
 * until it is dragged), and that dragging one really drives the render — each
 * slider is moved with real pointer events and the resulting sheet is measured
 * off a screenshot, panel surface and folder tabs alike.
 *
 * The dial row is laid out across the top of the viewport and sits over the
 * drawer, so every patch measured here is taken from the strip of panel below
 * it, and the clearance is asserted rather than assumed.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9363;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/paper-dials-profile-${process.pid}`,
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
    if (m.error) console.error('protocol error', JSON.stringify(m.error));
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

/* Opens the archive, opens the About drawer, bares the panel so a patch of it
   reads only stock, and hands back the patches to measure plus everything worth
   asserting about the filter that is actually in the document. */
const OPEN = `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const aboutBtn = () => [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim()));
  for (let i = 0; i < 150; i++) {
    if (aboutBtn()) break;
    await sleep(200);
  }
  await sleep(1800);
  if (!aboutBtn()) return { error: 'no ABOUT control', url: location.href, buttons: document.querySelectorAll('button').length };
  aboutBtn().click();
  await sleep(2600);
  const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
  if (!panel) return { error: 'panel not found' };
  const layer = [...panel.children].find(el => getComputedStyle(el).filter.includes('roughpaper'));
  const tabs = [...document.querySelectorAll('.about-drawer-tab')];
  window.__paperLayer = layer;
  window.__tabLayers = tabs.map(t => [...t.children].find(el => getComputedStyle(el).filter.includes('roughpaper')));
  for (const el of panel.children) {
    const tag = el.tagName.toLowerCase();
    if (el === layer || tag === 'style' || tag === 'svg') continue;
    // The folder-tab strip stays: it is half of what is being measured.
    if (el.getAttribute && el.getAttribute('role') === 'tablist') continue;
    el.style.visibility = 'hidden';
  }
  // The dial row runs the full width of the window with every project panel open
  // in it, which leaves the drawer no clear ground to photograph. Only this one
  // is under test, so the rest are pulled for the duration.
  for (const root of document.querySelectorAll('.dialkit-folder-root')) {
    if (root.querySelector('.dialkit-folder-title-root')?.textContent.trim() !== 'Paper Stock') {
      root.style.display = 'none';
    }
  }
  // Tab labels out of the way as well, so a patch of tab is all stock and none
  // of the ink rotated through the middle of it.
  for (const t of tabs) {
    const s = t.querySelector('span:not([aria-hidden])');
    if (s) s.style.visibility = 'hidden';
  }
  await sleep(400);
  const b = panel.getBoundingClientRect();
  // Low in the panel: DialRoot is anchored top-right, over the drawer's own
  // corner, so the bottom of the sheet is what stays photographable either way.
  const patch = { x: Math.round(b.left) + 40, y: Math.round(b.bottom) - 200, width: 220, height: 180, scale: 1 };
  // Well inside the live tab: its clip-path notches the top and bottom corners,
  // so the patch keeps clear of both ends.
  const live = tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0];
  const t = live?.getBoundingClientRect();
  const tabPatch = t ? {
    x: Math.round(t.left) + 14,
    y: Math.round(t.top) + 30,
    width: Math.max(8, Math.round(t.width) - 28),
    height: Math.max(8, Math.round(t.height) - 60), scale: 1,
  } : null;
  // Geometry, not hit-testing: DialRoot lays a transparent full-window wrapper
  // over the page, so elementFromPoint answers "dialkit" everywhere and says
  // nothing about what is actually painted where.
  const shown = [...document.querySelectorAll('.dialkit-folder-root')].filter(p => p.style.display !== 'none');
  const dialRect = shown.length ? shown[0].getBoundingClientRect() : null;
  const clear = (p) => !dialRect || !p ? true : (
    dialRect.left > p.x + p.width || dialRect.right < p.x ||
    dialRect.top > p.y + p.height || dialRect.bottom < p.y
  );
  const f = document.getElementById('roughpaper');
  const turb = f?.querySelector('feTurbulence');
  const light = f?.querySelector('feDiffuseLighting');
  const lamp = f?.querySelector('feDistantLight');
  const cs = getComputedStyle(layer);
  return {
    patch, tabPatch,
    drawerRect: { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) },
    liveTab: live ? {
      label: live.getAttribute('aria-label'),
      rect: { x: +t.left.toFixed(1), y: +t.top.toFixed(1), w: +t.width.toFixed(1), h: +t.height.toFixed(1) },
      opacity: getComputedStyle(live).opacity,
      transform: getComputedStyle(live).transform,
      background: getComputedStyle(live).backgroundColor,
    } : null,
    // Nothing painted by DialKit may sit over either patch, or "identical with
    // the panel open" would be measuring the panel.
    clearance: {
      dialPanelRect: dialRect ? { x: Math.round(dialRect.left), y: Math.round(dialRect.top), w: Math.round(dialRect.width), h: Math.round(dialRect.height) } : null,
      patchClear: clear(patch),
      tabPatchClear: clear(tabPatch),
    },
    filter: {
      baseFrequency: turb?.getAttribute('baseFrequency'),
      numOctaves: turb?.getAttribute('numOctaves'),
      seed: turb?.getAttribute('seed'),
      surfaceScale: light?.getAttribute('surfaceScale') || light?.getAttribute('surface-scale'),
      lightingColor: light?.getAttribute('lighting-color') || light?.getAttribute('lightingColor'),
      azimuth: lamp?.getAttribute('azimuth'),
      elevation: lamp?.getAttribute('elevation'),
    },
    layerCss: { opacity: cs.opacity, blend: cs.mixBlendMode, filter: cs.filter },
    tabSeeds: [...document.querySelectorAll('filter[id^="roughpaper-about-tab"] feTurbulence')].map(t => t.getAttribute('seed')),
    tabFrequencies: [...document.querySelectorAll('filter[id^="roughpaper-about-tab"] feTurbulence')].map(t => t.getAttribute('baseFrequency')),
    paperStockPresent: [...document.querySelectorAll('.dialkit-folder-title-root')].some(t => t.textContent.trim() === 'Paper Stock'),
    dialkitNodes: document.querySelectorAll('[class^="dialkit"]').length,
  };
})()`;

const stats = async (b64) =>
  evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${b64}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2];
      sum += l; sum2 += l * l; n++;
    }
    const mean = sum / n;
    return { mean: +mean.toFixed(2), stdDev: +Math.sqrt(Math.max(0, sum2/n - mean*mean)).toFixed(2) };
  })()`);

const shoot = async (clip) => (await send('Page.captureScreenshot', { format: 'png', clip }))?.data;
const measure = async (clip) => (clip ? stats(await shoot(clip)) : null);

/* The dial row is a single wide surface pinned across the top of the window, and
   the drawer's folder tabs live up there too — there is no patch of tab it does
   not cover. So the UI is hidden for the length of a reading and put straight
   back: nothing is unmounted, no panel is unregistered, every dial keeps the
   value it is on. What changes is only whether the panel is painted over the
   thing being photographed. */
const dialUI = (display) =>
  evaluate(`(() => {
    const root = document.querySelector('.dialkit-root');
    if (root) root.style.display = '${display}';
    return !!root;
  })()`);
const saveBare = async (file, clip) => {
  await dialUI('none');
  await sleep(360);
  await save(file, clip);
  await dialUI('');
  await sleep(240);
};
const measureBare = async (...clips) => {
  await dialUI('none');
  await sleep(360);
  const out = [];
  for (const c of clips) out.push(await measure(c));
  await dialUI('');
  await sleep(240);
  return out;
};
const save = async (file, clip) => {
  const d = await shoot(clip);
  if (d) fs.writeFileSync(file, Buffer.from(d, 'base64'));
};

/* Every panel in this project is titled, and several share dial names ("Seed",
   "Base Frequency"), so both reading and dragging are scoped to the Paper Stock
   panel's own root folder. Labels can carry a shortcut pill, hence startsWith. */
const SCOPE = `(() => {
  const root = [...document.querySelectorAll('.dialkit-folder-root')]
    .find(p => p.querySelector('.dialkit-folder-title-root')?.textContent.trim() === 'Paper Stock');
  return root || null;
})()`;
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

const readDials = () =>
  evaluate(`(() => {
    const root = ${SCOPE};
    if (!root) return null;
    const norm = (s) => (s||'').toLowerCase().replace(/[^a-z]/g, '');
    const out = {};
    for (const w of root.querySelectorAll('.dialkit-slider-wrapper')) {
      out[norm(w.querySelector('.dialkit-slider-label')?.textContent)] = w.querySelector('.dialkit-slider-value')?.textContent.trim();
    }
    for (const r of root.querySelectorAll('.dialkit-select-row')) {
      out[norm(r.querySelector('.dialkit-select-label')?.textContent)] = r.querySelector('.dialkit-select-value')?.textContent.trim();
    }
    for (const c of root.querySelectorAll('.dialkit-color-control')) {
      out[norm(c.querySelector('.dialkit-color-label')?.textContent)] = c.querySelector('.dialkit-color-hex')?.textContent.trim();
    }
    return out;
  })()`);

const dialValue = async (name) => {
  const all = await readDials();
  const key = Object.keys(all || {}).find((k) => k.startsWith(norm(name)));
  return key ? all[key] : null;
};

/** Drags one of Paper Stock's sliders to a fraction of its track, as a user would. */
async function dragDial(name, fraction) {
  const box = await evaluate(`(() => {
    const root = ${SCOPE};
    if (!root) return null;
    const norm = (s) => (s||'').toLowerCase().replace(/[^a-z]/g, '');
    const w = [...root.querySelectorAll('.dialkit-slider-wrapper')]
      .find(w => norm(w.querySelector('.dialkit-slider-label')?.textContent).startsWith('${norm(name)}'));
    if (!w) return null;
    w.scrollIntoView({ block: 'center' });
    const b = w.getBoundingClientRect();
    return { x: b.left, y: b.top + b.height / 2, w: b.width, label: w.querySelector('.dialkit-slider-label')?.textContent.trim() };
  })()`);
  if (!box) return { error: `no slider "${name}"` };
  const mouse = (type, x, cc = 0) =>
    send('Input.dispatchMouseEvent', {
      type, x, y: box.y, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: cc, pointerType: 'mouse',
    });
  const from = box.x + 4;
  const to = box.x + Math.max(6, box.w * fraction);
  await mouse('mousePressed', from, 1);
  await mouse('mouseMoved', from + 8);
  await mouse('mouseMoved', (from + to) / 2);
  await mouse('mouseMoved', to);
  await mouse('mouseReleased', to, 1);
  await sleep(420);
  return { label: box.label };
}

async function fresh(url) {
  await send('Page.navigate', { url });
  await sleep(700);
  return evaluate(OPEN);
}

const report = {};

/* ── 1. The gate ─────────────────────────────────────────────────────────── */
const plain = await fresh(`${BASE}/?view=grid`);
if (!plain?.patch) {
  console.log('open failed', JSON.stringify(plain));
  process.exit(1);
}
report.gate = {
  withoutFlag: { paperStockPresent: plain.paperStockPresent, dialkitNodes: plain.dialkitNodes },
};
report.shipped = {
  filter: plain.filter,
  layerCss: plain.layerCss,
  tabSeeds: plain.tabSeeds,
  liveTab: plain.liveTab,
  patch: plain.patch,
  tabPatch: plain.tabPatch,
};
report.gate.withoutFlag.clearance = plain.clearance;
const plainPanel = await measure(plain.patch);
const plainTab = await measure(plain.tabPatch);
await save('/tmp/paper-dials-tab-closed.png', { ...plain.tabPatch, scale: 4 });

/* The one value the dials spell differently from the source (`white` → `#ffffff`):
   put the keyword back by hand and confirm it is the same sheet either way. */
await evaluate(
  `(() => { document.querySelector('#roughpaper feDiffuseLighting').setAttribute('lighting-color', 'white'); return true; })()`
);
await sleep(400);
report.lightingColorSpelling = { hex: plainPanel, keyword: await measure(plain.patch) };

/* ── 2. Under the flag: same render, every dial on its shipped value ─────── */
const dialed = await fresh(`${BASE}/?view=grid&dial=1`);
report.gate.withFlag = { paperStockPresent: dialed.paperStockPresent, clearance: dialed.clearance };
report.dialsAsOpened = await readDials();
report.withPanel = {
  filter: dialed.filter, layerCss: dialed.layerCss, tabSeeds: dialed.tabSeeds,
  liveTab: dialed.liveTab, patch: dialed.patch, tabPatch: dialed.tabPatch,
};
// The panel surface has ground the dial row leaves clear, so it can be compared
// with the panel genuinely painted on screen. The tabs cannot, so they are read
// with the UI hidden for the length of the shot.
const dialedPanelPainted = await measure(dialed.patch);
const [dialedPanel, dialedTab] = await measureBare(dialed.patch, dialed.tabPatch);
await saveBare('/tmp/paper-dials-tab-open.png', { ...dialed.tabPatch, scale: 4 });
report.identical = {
  patch: dialed.patch,
  tabPatch: dialed.tabPatch,
  panelSurface: { closed: plainPanel, open: dialedPanel, openWithPanelPainted: dialedPanelPainted },
  folderTab: { closed: plainTab, open: dialedTab },
  match:
    plainPanel.mean === dialedPanel.mean &&
    plainPanel.stdDev === dialedPanel.stdDev &&
    plainPanel.mean === dialedPanelPainted.mean &&
    plainPanel.stdDev === dialedPanelPainted.stdDev &&
    plainTab?.mean === dialedTab?.mean &&
    plainTab?.stdDev === dialedTab?.stdDev,
};

await save('/tmp/paper-dials-panel-open.png', { x: 0, y: 0, width: 1440, height: 900, scale: 2 });
await saveBare('/tmp/paper-dials-drawer-shipped.png', { ...dialed.drawerRect, scale: 2 });
const paperPanelRect = await evaluate(`(() => {
  const root = ${SCOPE};
  const b = root.getBoundingClientRect();
  return { x: Math.round(b.left) - 8, y: Math.round(b.top) - 8, width: Math.round(b.width) + 16, height: Math.round(b.height) + 16, scale: 2 };
})()`);
await save('/tmp/paper-dials-panel.png', paperPanelRect);

/* ── 3. Each dial, dragged, from a fresh shipped baseline ────────────────── */
report.drives = {};
for (const [name, fraction] of [
  ['strength', 0.45],
  ['baseFrequency', 0.06],
  ['surfaceScale', 0.9],
]) {
  const run = await fresh(`${BASE}/?view=grid&dial=1`);
  const [beforePanel, beforeTab] = await measureBare(run.patch, run.tabPatch);
  const before = { panel: beforePanel, tab: beforeTab };
  const dragged = await dragDial(name, fraction);
  await sleep(450);
  const [afterPanel, afterTab] = await measureBare(run.patch, run.tabPatch);
  const after = { panel: afterPanel, tab: afterTab };
  const now = await evaluate(`(() => {
    const f = document.getElementById('roughpaper');
    return {
      panelFilter: {
        baseFrequency: f.querySelector('feTurbulence').getAttribute('baseFrequency'),
        surfaceScale: f.querySelector('feDiffuseLighting').getAttribute('surfaceScale'),
        opacity: getComputedStyle(window.__paperLayer).opacity,
      },
      tabFilters: [...document.querySelectorAll('filter[id^="roughpaper-about-tab"] feTurbulence')]
        .map(t => t.getAttribute('baseFrequency') + ' / seed ' + t.getAttribute('seed')),
      tabSurfaceScales: [...document.querySelectorAll('filter[id^="roughpaper-about-tab"] feDiffuseLighting')]
        .map(l => l.getAttribute('surfaceScale')),
      tabOpacity: window.__tabLayers.filter(Boolean).map(l => getComputedStyle(l).opacity),
    };
  })()`);
  report.drives[name] = {
    draggedSlider: dragged?.error ?? dragged?.label,
    dialNow: await dialValue(name),
    domNow: now,
    panelSurface: {
      before: before.panel, after: after.panel,
      meanShift: +(after.panel.mean - before.panel.mean).toFixed(2),
      stdDevShift: +(after.panel.stdDev - before.panel.stdDev).toFixed(2),
    },
    folderTab: {
      before: before.tab, after: after.tab,
      meanShift: +(after.tab.mean - before.tab.mean).toFixed(2),
      stdDevShift: +(after.tab.stdDev - before.tab.stdDev).toFixed(2),
    },
  };
  if (name === 'strength') await saveBare('/tmp/paper-dials-drawer-strong.png', { ...run.drawerRect, scale: 2 });
}

/* ── 4. Seed: one dial moves every crop, the offsets between them survive ── */
const seedRun = await fresh(`${BASE}/?view=grid&dial=1`);
await dragDial('seed', 0.3);
await sleep(400);
const seedsAfter = await evaluate(
  `[...document.querySelectorAll('filter[id^="roughpaper-about-tab"] feTurbulence')].map(t => t.getAttribute('seed'))`
);
const panelSeedAfter = await evaluate(
  `document.querySelector('#roughpaper feTurbulence').getAttribute('seed')`
);
const gaps = (a) => a.slice(1).map((v, i) => +v - +a[i]);
report.seed = {
  dialNow: await dialValue('seed'),
  panel: { before: seedRun.filter.seed, after: panelSeedAfter },
  tabs: { before: seedRun.tabSeeds, after: seedsAfter },
  offsetsPreserved: JSON.stringify(gaps(seedRun.tabSeeds)) === JSON.stringify(gaps(seedsAfter)),
  allDistinct: new Set(seedsAfter).size === seedsAfter.length,
  movedWithPanel: seedsAfter.every((s, i) => +s - +seedRun.tabSeeds[i] === +panelSeedAfter - +seedRun.filter.seed),
};

/* ── 5. A coarse, heavy sheet — the same dials taken somewhere obvious ───── */
await dragDial('strength', 0.6);
await dragDial('baseFrequency', 0.02);
await dragDial('surfaceScale', 1);
await dragDial('contrast', 0.9);
await sleep(500);
report.coarseSetting = await readDials();
const [coarsePanel, coarseTab] = await measureBare(seedRun.patch, seedRun.tabPatch);
report.coarseMeasured = { panel: coarsePanel, tab: coarseTab };
await saveBare('/tmp/paper-dials-drawer-coarse.png', { ...seedRun.drawerRect, scale: 2 });

/* ── 6. The drawer as it actually looks, copy and all: the panel over it, then
       the same sheet dialled up. ─────────────────────────────────────────── */
await send('Page.navigate', { url: `${BASE}/?view=grid&dial=1` });
await sleep(700);
const live = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const aboutBtn = () => [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim()));
  for (let i = 0; i < 150; i++) { if (aboutBtn()) break; await sleep(200); }
  await sleep(1800);
  aboutBtn().click();
  await sleep(2600);
  const p = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]').getBoundingClientRect();
  return { x: Math.round(p.left) - 60, y: 0, width: Math.round(p.width) + 60, height: Math.round(p.height) };
})()`);
await save('/tmp/paper-dials-over-drawer.png', { x: 0, y: 0, width: 1440, height: 900, scale: 2 });
await saveBare('/tmp/paper-dials-copy-shipped.png', { ...live, scale: 2 });
await dragDial('strength', 0.5);
await dragDial('contrast', 0.75);
await sleep(400);
report.readableContrastSetting = await readDials();
await saveBare('/tmp/paper-dials-copy-heavy.png', { ...live, scale: 2 });

/* ── 7. The phone's top tab keeps its own crop too. It only exists at the
       compact breakpoint, where the drawer is opened out of the nav sheet
       rather than off a peeking tab. ───────────────────────────────────────── */
await send('Emulation.setDeviceMetricsOverride', {
  width: 420, height: 900, deviceScaleFactor: 1, mobile: true,
});
await send('Page.navigate', { url: `${BASE}/?view=grid&dial=1` });
await sleep(700);
report.compactTopTab = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if (document.querySelector('button[aria-label="Open menu"]')) break;
    await sleep(200);
  }
  await sleep(1600);
  document.querySelector('button[aria-label="Open menu"]')?.click();
  await sleep(700);
  [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim()))?.click();
  await sleep(2200);
  const turb = (sel) => document.querySelector(sel + ' feTurbulence');
  return {
    panelSeed: turb('#roughpaper')?.getAttribute('seed') ?? null,
    topTabSeed: turb('filter#roughpaper-about-top-tab')?.getAttribute('seed') ?? null,
    topTabFrequency: turb('filter#roughpaper-about-top-tab')?.getAttribute('baseFrequency') ?? null,
  };
})()`);
await send('Emulation.clearDeviceMetricsOverride');

console.log(JSON.stringify(report, null, 1));

ws.close();
chrome.kill();
