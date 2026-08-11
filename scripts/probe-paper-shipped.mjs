/**
 * Sanity check on the shipped paper stock: opens the About drawer with no dial
 * flag, reads back what every paper layer in it is actually rendering, and then
 * measures the sheet — the new settings against the old ones on the same patch,
 * how far `level` below neutral pulls the surface down, and what the grain
 * measures as `strength` rises.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9367;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/paper-shipped-profile-${process.pid}`,
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
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { error: r.exceptionDetails.text || JSON.stringify(r.exceptionDetails) };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${BASE}/?view=grid` });
// The navigation replaces the execution context, so anything evaluated before it
// commits runs — and waits, and fails — inside the blank page it left behind.
await sleep(2500);

/* Opens the drawer and bares a strip of panel that is nothing but stock, so the
   numbers below describe paper rather than copy sitting on it. */
const opened = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) {
    if ([...document.querySelectorAll('button, a')].some(b => /^about$/i.test((b.textContent||'').trim()))) break;
    await sleep(200);
  }
  await sleep(1600);
  [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim())).click();
  await sleep(1800);
  const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
  if (!panel) return { error: 'no panel' };
  const layer = [...panel.children].find(el => getComputedStyle(el).filter.includes('roughpaper'));

  // Every layer wearing the stock, with the filter behind it, so all six can be
  // compared against one another rather than trusted.
  const num = (s) => (s == null ? null : +s);
  const layers = [...document.querySelectorAll('*')].flatMap((el) => {
    const f = getComputedStyle(el).filter;
    if (!f.includes('roughpaper')) return [];
    const fid = (f.match(/url\\("?#([^")]+)"?\\)/) || [])[1];
    const def = document.getElementById(fid);
    const turb = def?.querySelector('feTurbulence');
    const light = def?.querySelector('feDiffuseLighting');
    const lamp = def?.querySelector('feDistantLight');
    const cs = getComputedStyle(el);
    return [{
      id: fid,
      strength: +(+cs.opacity).toFixed(3),
      blendMode: cs.mixBlendMode,
      level: num((f.match(/brightness\\(([^)]+)\\)/) || [])[1]),
      contrast: num((f.match(/contrast\\(([^)]+)\\)/) || [])[1]),
      baseFrequency: turb?.getAttribute('baseFrequency'),
      numOctaves: num(turb?.getAttribute('numOctaves')),
      seed: num(turb?.getAttribute('seed')),
      surfaceScale: num(light?.getAttribute('surfaceScale')),
      lightingColor: light?.getAttribute('lighting-color') || light?.getAttribute('lightingColor'),
      azimuth: num(lamp?.getAttribute('azimuth')),
      elevation: num(lamp?.getAttribute('elevation')),
      isPanel: el === layer,
    }];
  });

  for (const el of panel.children) {
    const tag = el.tagName.toLowerCase();
    if (el === layer || tag === 'style' || tag === 'svg') continue;
    el.style.visibility = 'hidden';
  }
  const b = panel.getBoundingClientRect();
  return {
    layers,
    patch: { x: Math.round(b.left) + 40, y: Math.round(b.bottom) - 200, width: 220, height: 180, scale: 1 },
  };
})()`);

if (!opened?.patch) {
  console.error('could not open drawer', JSON.stringify(opened));
  ws.close();
  chrome.kill();
  process.exit(1);
}

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
      range: +(max - min).toFixed(1),
    };
  })()`);

const measure = async () => {
  await sleep(340);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: opened.patch });
  return stats(s?.data);
};

const setSheet = (attrs, css) =>
  evaluate(`(() => {
    const def = document.getElementById('roughpaper');
    const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
    const layer = [...panel.children].find(el => getComputedStyle(el).filter.includes('roughpaper'));
    const a = ${JSON.stringify(attrs)};
    const t = def.querySelector('feTurbulence');
    const l = def.querySelector('feDiffuseLighting');
    const d = def.querySelector('feDistantLight');
    if (a.baseFrequency != null) t.setAttribute('baseFrequency', a.baseFrequency);
    if (a.numOctaves != null) t.setAttribute('numOctaves', a.numOctaves);
    if (a.surfaceScale != null) l.setAttribute('surfaceScale', a.surfaceScale);
    if (a.azimuth != null) d.setAttribute('azimuth', a.azimuth);
    if (a.elevation != null) d.setAttribute('elevation', a.elevation);
    Object.assign(layer.style, ${JSON.stringify(css)});
    return true;
  })()`);

const panelLayer = opened.layers.find((l) => l.isPanel);
const SHIPPED = {
  baseFrequency: panelLayer.baseFrequency,
  numOctaves: panelLayer.numOctaves,
  surfaceScale: panelLayer.surfaceScale,
  azimuth: panelLayer.azimuth,
  elevation: panelLayer.elevation,
  level: panelLayer.level,
  contrast: panelLayer.contrast,
  strength: panelLayer.strength,
};
const restore = () =>
  setSheet(SHIPPED, {
    filter: `url(#roughpaper) brightness(${SHIPPED.level}) contrast(${SHIPPED.contrast})`,
    opacity: SHIPPED.strength,
  });

const out = { layers: opened.layers, shipped: SHIPPED };

out.new = await measure();
await setSheet({}, { opacity: 0 });
out.flat = await measure();
await restore();

// The old sheet, reproduced on the same patch so the two are comparable.
await setSheet(
  { baseFrequency: 0.04, numOctaves: 5, surfaceScale: 8, azimuth: 45, elevation: 60 },
  { filter: 'url(#roughpaper) brightness(0.5) contrast(2.4)', opacity: 0.12 }
);
out.old = await measure();
await restore();

// New sheet at old level, to separate "finer/flatter" from "parked lower".
await setSheet({}, { filter: `url(#roughpaper) brightness(0.5) contrast(${SHIPPED.contrast})` });
out.newAtNeutralLevel = await measure();
await restore();

out.strengthSweep = {};
for (const v of [0.09, 0.12, 0.2, 0.3, 0.4]) {
  await setSheet({}, { opacity: v });
  out.strengthSweep[v] = await measure();
}
await restore();
out.restored = await measure();

console.log(JSON.stringify(out, null, 1));

ws.close();
chrome.kill();
