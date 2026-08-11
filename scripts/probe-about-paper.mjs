/**
 * The About drawer's paper texture: confirms the layer exists, resolves the
 * roughpaper filter, covers the panel and nothing more, stays under the copy and
 * out of the pointer's way. Shoots the open panel twice — texture on, then with
 * the layer hidden — so the grain can be compared against the flat fill.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9347;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-paper-profile',
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

await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if ([...document.querySelectorAll('button, a')].some(b => /^about$/i.test((b.textContent||'').trim()))) break;
    await sleep(200);
  }
  await sleep(1800);
  [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim())).click();
  await sleep(1800);
  return true;
})()`);

const m = await evaluate(`(() => {
  const filterEl = document.getElementById('roughpaper');
  const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
  if (!panel) return { error: 'panel not found' };
  const layer = [...panel.children].find(el => getComputedStyle(el).filter.includes('roughpaper'));
  if (!layer) return { error: 'texture layer not found', filterDefined: !!filterEl };
  const cs = getComputedStyle(layer);
  const pb = panel.getBoundingClientRect();
  const lb = layer.getBoundingClientRect();
  // Paint order inside the panel: copy column and folder tabs must outrank it.
  const order = [...panel.children].map(el => {
    const s = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 24), position: s.position, z: s.zIndex };
  });
  // Hit-test over a run of copy and over bare panel: the layer must catch neither.
  const heading = panel.querySelector('h2, h3, p');
  const hb = heading?.getBoundingClientRect();
  const hitCopy = hb ? document.elementFromPoint(hb.left + 4, hb.top + hb.height / 2) : null;
  const hitBare = document.elementFromPoint(pb.left + pb.width / 2, pb.bottom - 8);
  const copyFilter = heading ? getComputedStyle(heading).filter : null;
  return {
    filterDefined: !!filterEl,
    filterUnits: filterEl ? {
      x: filterEl.getAttribute('x'), y: filterEl.getAttribute('y'),
      width: filterEl.getAttribute('width'), height: filterEl.getAttribute('height'),
      turbulence: filterEl.querySelector('feTurbulence')?.getAttribute('baseFrequency'),
      octaves: filterEl.querySelector('feTurbulence')?.getAttribute('numOctaves'),
      surfaceScale: filterEl.querySelector('feDiffuseLighting')?.getAttribute('surface-scale')
        || filterEl.querySelector('feDiffuseLighting')?.getAttribute('surfaceScale'),
      lightingColor: filterEl.querySelector('feDiffuseLighting')?.getAttribute('lighting-color'),
      light: filterEl.querySelector('feDistantLight')?.getAttribute('azimuth') + '/' + filterEl.querySelector('feDistantLight')?.getAttribute('elevation'),
    } : null,
    layer: {
      filter: cs.filter, opacity: cs.opacity, blend: cs.mixBlendMode,
      z: cs.zIndex, pointerEvents: cs.pointerEvents,
    },
    coversPanel: Math.round(lb.width) === Math.round(pb.width) && Math.round(lb.height) === Math.round(pb.height)
      && Math.round(lb.left) === Math.round(pb.left) && Math.round(lb.top) === Math.round(pb.top),
    panelRect: { x: Math.round(pb.left), y: Math.round(pb.top), w: Math.round(pb.width), h: Math.round(pb.height) },
    childOrder: order,
    copyIsUnfiltered: copyFilter === 'none',
    hitOverCopy: hitCopy ? hitCopy.tagName.toLowerCase() + '.' + (hitCopy.className||'').toString().slice(0,20) : null,
    hitOverBarePanel: hitBare ? hitBare.tagName.toLowerCase() + '.' + (hitBare.className||'').toString().slice(0,20) : null,
    layerIsHitTarget: hitCopy === layer || hitBare === layer,
  };
})()`);

console.log(JSON.stringify(m, null, 1));

const shoot = async (file, r) => {
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 2 },
  });
  if (s?.data) fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
};

if (m?.panelRect) {
  await shoot('/tmp/about-paper-on.png', m.panelRect);
  // Same frame with the stock pulled, for a side-by-side read of the grain.
  await evaluate(`(() => {
    const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]');
    const layer = [...panel.children].find(el => getComputedStyle(el).filter.includes('roughpaper'));
    layer.style.display = 'none';
    return true;
  })()`);
  await sleep(400);
  await shoot('/tmp/about-paper-off.png', m.panelRect);
}

ws.close();
chrome.kill();
