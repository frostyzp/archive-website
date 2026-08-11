/**
 * Range-finding sweep for the paper-stock dials: opens the About drawer, bares
 * the panel, and walks baseFrequency / surfaceScale / contrast one at a time,
 * reading mean + spread off a real screenshot each step. The point is to set the
 * dial bounds where the render still answers, rather than at the spec limits.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9361;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/paper-sweep-profile',
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
  for (const el of panel.children) {
    const tag = el.tagName.toLowerCase();
    if (el === layer || tag === 'style' || tag === 'svg') continue;
    el.style.visibility = 'hidden';
  }
  const b = panel.getBoundingClientRect();
  return { x: Math.round(b.left) + 40, y: Math.round(b.top) + 200, w: 220, h: 220 };
})()`);

console.log('patch', JSON.stringify(opened));

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

const shot = async () => {
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: opened.x, y: opened.y, width: opened.w, height: opened.h, scale: 1 },
  });
  return s?.data;
};

const setAttr = (sel, attr, v) =>
  evaluate(
    `(() => { document.querySelector('#roughpaper ${sel}').setAttribute('${attr}', '${v}'); return true; })()`
  );
const setLayer = (css) =>
  evaluate(`(() => {
    const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
    const layer = [...panel.children].find(el => getComputedStyle(el).filter.includes('roughpaper'));
    Object.assign(layer.style, ${JSON.stringify(css)});
    return true;
  })()`);

const measure = async (label, out) => {
  await sleep(320);
  out[label] = await stats(await shot());
};

const freq = {};
for (const v of [0.008, 0.01, 0.02, 0.03, 0.04, 0.06, 0.08, 0.12, 0.16, 0.2, 0.3, 0.5]) {
  await setAttr('feTurbulence', 'baseFrequency', v);
  await measure(`baseFrequency ${v}`, freq);
}
await setAttr('feTurbulence', 'baseFrequency', 0.04);

const scale = {};
for (const v of [0, 1, 2, 4, 8, 12, 16, 20, 30]) {
  await setAttr('feDiffuseLighting', 'surfaceScale', v);
  await measure(`surfaceScale ${v}`, scale);
}
await setAttr('feDiffuseLighting', 'surfaceScale', 8);

const oct = {};
for (const v of [1, 2, 3, 4, 5, 6, 8]) {
  await setAttr('feTurbulence', 'numOctaves', v);
  await measure(`numOctaves ${v}`, oct);
}
await setAttr('feTurbulence', 'numOctaves', 5);

const elev = {};
for (const v of [0, 10, 25, 45, 60, 75, 90]) {
  await setAttr('feDistantLight', 'elevation', v);
  await measure(`elevation ${v}`, elev);
}
await setAttr('feDistantLight', 'elevation', 60);

const contrast = {};
for (const v of [0.5, 1, 1.6, 2.4, 3.5, 5, 8]) {
  await setLayer({ filter: `url(#roughpaper) brightness(0.5) contrast(${v})` });
  await measure(`contrast ${v}`, contrast);
}

console.log(JSON.stringify({ freq, scale, oct, elev, contrast }, null, 1));

ws.close();
chrome.kill();
