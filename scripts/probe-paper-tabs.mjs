/**
 * The paper stock on the About drawer's folder tabs. For each tab: measures a
 * label-free patch with the stock on and off (mean value must hold, spread must
 * rise), checks the label still paints over the texture, and confirms the four
 * tabs aren't all showing the same crop of the noise field. Shoots the strip.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9351;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/paper-tabs-profile',
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

const info = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if ([...document.querySelectorAll('button, a')].some(b => /^about$/i.test((b.textContent||'').trim()))) break;
    await sleep(200);
  }
  await sleep(1800);
  [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim())).click();
  await sleep(2400);
  const tabs = [...document.querySelectorAll('.about-drawer-tab')];
  window.__tabs = tabs;
  window.__layers = tabs.map(t => [...t.children].find(el => getComputedStyle(el).filter.includes('roughpaper')));
  const strip = tabs[0]?.parentElement?.getBoundingClientRect();
  return {
    tabCount: tabs.length,
    layersFound: window.__layers.filter(Boolean).length,
    filterIds: window.__layers.filter(Boolean).map(l => getComputedStyle(l).filter.match(/#([a-z0-9-]+)/i)[1]),
    seeds: [...document.querySelectorAll('filter[id^="roughpaper-about-tab"] feTurbulence')].map(t => t.getAttribute('seed')),
    // A label painted under the stock would be the whole point missed.
    labelZ: tabs.map(t => {
      const s = t.querySelector('span:not([aria-hidden])');
      const b = s.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { position: getComputedStyle(s).position, hitIsLayer: hit === window.__layers[[...tabs].indexOf(t)] };
    }),
    // The clip-path notches each tab's corners, so a patch must stay well inside
    // the tab and above the rotated label — otherwise it reads the page behind.
    tabRects: tabs.map(t => {
      const b = t.getBoundingClientRect();
      const s = t.querySelector('span:not([aria-hidden])').getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
               label: t.getAttribute('aria-label'), active: t.getAttribute('aria-selected') === 'true',
               patch: { x: Math.round(s.left), y: Math.round(b.top) + 8,
                        width: Math.max(6, Math.round(s.width)),
                        height: Math.max(6, Math.round(s.top - b.top) - 12), scale: 1 } };
    }),
    strip: strip ? { x: Math.round(strip.left) - 6, y: Math.round(strip.top), w: Math.round(strip.width) + 24, h: Math.round(strip.height) } : null,
  };
})()`);

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
    const px = [];
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2];
      sum += l; sum2 += l * l; n++; px.push(+l.toFixed(1));
    }
    const mean = sum / n;
    return { mean: +mean.toFixed(2), stdDev: +Math.sqrt(Math.max(0, sum2/n - mean*mean)).toFixed(2), sample: px.slice(0, 24) };
  })()`);

const patchOf = (r) => r.patch;
const shotOf = async (clip) => (await send('Page.captureScreenshot', { format: 'png', clip }))?.data;
const setLayers = (display) =>
  evaluate(`(() => { window.__layers.forEach(l => { if (l) l.style.display = '${display}'; }); return true; })()`);

const out = { tabCount: info.tabCount, layersFound: info.layersFound, filterIds: info.filterIds, seeds: info.seeds, labelZ: info.labelZ, tabs: {} };

for (const r of info.tabRects || []) {
  if (r.h < 20) continue;
  await setLayers('none');
  await sleep(280);
  const off = await stats(await shotOf(patchOf(r)));
  await setLayers('');
  await sleep(280);
  const on = await stats(await shotOf(patchOf(r)));
  out.tabs[`${r.label}${r.active ? ' (open)' : ''}`] = {
    flatMean: off.mean, texturedMean: on.mean, meanShift: +(on.mean - off.mean).toFixed(2),
    flatSpread: off.stdDev, texturedSpread: on.stdDev,
    firstPixels: on.sample.slice(0, 8),
  };
}

// If two tabs came out pixel-identical, the seeds aren't doing their job.
const rows = Object.values(out.tabs).map((t) => t.firstPixels.join(','));
out.allTabsShowSameCrop = rows.length > 1 && new Set(rows).size === 1;

console.log(JSON.stringify(out, null, 1));

if (info.strip) {
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: info.strip.x, y: info.strip.y, width: info.strip.w, height: info.strip.h, scale: 3 },
  });
  if (s?.data) fs.writeFileSync('/tmp/paper-tabs.png', Buffer.from(s.data, 'base64'));
}

ws.close();
chrome.kill();
