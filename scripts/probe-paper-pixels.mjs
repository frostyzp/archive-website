/**
 * Measures the About drawer's paper texture in pixels. Opens the drawer, hides
 * the copy column so the panel is bare, then shoots the same patch with the
 * stock on and off and reports mean brightness / spread / range for each — the
 * only way to tell a texture that is painting from one that only looks like it.
 *
 * Sweeps candidate opacity + blend combinations so the settings can be picked
 * off numbers instead of guesses.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9348;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/paper-pixels-profile',
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
await send('Page.navigate', { url: `${BASE}/?view=grid` });

const opened = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if ([...document.querySelectorAll('button, a')].some(b => /^about$/i.test((b.textContent||'').trim()))) break;
    await sleep(200);
  }
  await sleep(1800);
  [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim())).click();
  await sleep(1800);
  const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
  const layer = [...panel.children].find(el => getComputedStyle(el).filter.includes('roughpaper'));
  // Bare the panel: copy column and folder tabs out of the way.
  for (const el of panel.children) {
    if (el === layer || el.tagName.toLowerCase() === 'style' || el.tagName.toLowerCase() === 'svg') continue;
    el.dataset.paperProbeHidden = '1';
    el.style.visibility = 'hidden';
  }
  window.__paperLayer = layer;
  const b = panel.getBoundingClientRect();
  return { x: Math.round(b.left) + 40, y: Math.round(b.top) + 200, w: 220, h: 220, panelBg: getComputedStyle(panel).backgroundColor };
})()`);

console.log('patch', JSON.stringify(opened));

// Feeds a PNG back into the page and reads its pixels through a canvas — the only
// way to get real numbers out of a CDP screenshot without a decoder in Node.
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
    let sum = 0, sum2 = 0, min = 255, max = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2];
      sum += l; sum2 += l * l; if (l < min) min = l; if (l > max) max = l; n++;
    }
    const mean = sum / n;
    return {
      mean: +mean.toFixed(2),
      stdDev: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2),
      min: +min.toFixed(1), max: +max.toFixed(1),
      range: +(max - min).toFixed(1),
    };
  })()`);

const shot = async () => {
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: opened.x, y: opened.y, width: opened.w, height: opened.h, scale: 1 },
  });
  return s?.data;
};

const setLayer = (css) =>
  evaluate(`(() => { Object.assign(window.__paperLayer.style, ${JSON.stringify(css)}); return true; })()`);

const rows = [];

await setLayer({ display: 'none' });
await sleep(350);
rows.push(['flat panel (no texture)', await stats(await shot())]);
await setLayer({ display: '' });

const setFilter = (surfaceScale, elevation) =>
  evaluate(`(() => {
    document.querySelector('#roughpaper feDiffuseLighting').setAttribute('surfaceScale', '${surfaceScale}');
    document.querySelector('#roughpaper feDistantLight').setAttribute('elevation', '${elevation}');
    return true;
  })()`);

// A raking light (low elevation) and a taller surface deepen the troughs, which
// is the only way to get contrast out of a lit sheet that starts near-white.
// Paired with a CSS chain that pulls the whole thing back toward mid-grey, so a
// mid-neutral blend can add shadow AND highlight without shifting the panel.
const CASES = [
  // brightness(0.5) parks the lit sheet on mid-grey, where `overlay` is neutral —
  // that is what lets the grain in without dragging the panel's value with it.
  // contrast() then sets how far the fibre swings either side of that.
  ['scale 2 · c3 · overlay 0.5', { surfaceScale: 2, elevation: 60, blend: 'overlay', opacity: 0.5, chain: ' brightness(0.5) contrast(3)' }],
  ['scale 2 · c6 · overlay 0.5', { surfaceScale: 2, elevation: 60, blend: 'overlay', opacity: 0.5, chain: ' brightness(0.5) contrast(6)' }],
  ['scale 2 · c10 · overlay 0.5', { surfaceScale: 2, elevation: 60, blend: 'overlay', opacity: 0.5, chain: ' brightness(0.5) contrast(10)' }],
  ['scale 4 · c2.4 · overlay 0.35', { surfaceScale: 4, elevation: 60, blend: 'overlay', opacity: 0.35, chain: ' brightness(0.5) contrast(2.4)' }],
  ['scale 8 · c2.4 · overlay 0.12', { surfaceScale: 8, elevation: 60, blend: 'overlay', opacity: 0.12, chain: ' brightness(0.5) contrast(2.4)' }],
  ['scale 8 · c2.4 · overlay 0.2', { surfaceScale: 8, elevation: 60, blend: 'overlay', opacity: 0.2, chain: ' brightness(0.5) contrast(2.4)' }],
  ['scale 8 · c2.4 · overlay 0.3', { surfaceScale: 8, elevation: 60, blend: 'overlay', opacity: 0.3, chain: ' brightness(0.5) contrast(2.4)' }],
  ['scale 8 · c2.4 · overlay 0.4', { surfaceScale: 8, elevation: 60, blend: 'overlay', opacity: 0.4, chain: ' brightness(0.5) contrast(2.4)' }],
  ['scale 8 · c2.4 · soft-light 0.7', { surfaceScale: 8, elevation: 60, blend: 'soft-light', opacity: 0.7, chain: ' brightness(0.5) contrast(2.4)' }],
  ['scale 8 · c1 · overlay 0.5', { surfaceScale: 8, elevation: 60, blend: 'overlay', opacity: 0.5, chain: ' brightness(0.5)' }],
];

for (const [label, c] of CASES) {
  await setFilter(c.surfaceScale, c.elevation);
  await setLayer({
    mixBlendMode: c.blend,
    opacity: String(c.opacity),
    filter: `url(#roughpaper)${c.chain}`,
  });
  await sleep(400);
  rows.push([label, await stats(await shot())]);
}

console.log(JSON.stringify(Object.fromEntries(rows), null, 1));

ws.close();
chrome.kill();
