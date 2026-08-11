/**
 * The paper texture at the two shapes the About drawer takes: the phone's
 * full-bleed takeover, and the closed desktop sliver (where the panel is wearing
 * `idle`, not `bg`). Confirms the layer tracks the panel's box in both and that
 * the fill's value survives the texture, then shoots each.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9349;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/paper-bp-profile',
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

const REPORT = `(() => {
  const panel = document.querySelector('[role="dialog"][aria-label="About What We Tell AI"]')
    || document.querySelector('aside[aria-label="About What We Tell AI"]');
  if (!panel) return { error: 'panel not found' };
  const layer = [...panel.children].find(el => getComputedStyle(el).filter.includes('roughpaper'));
  if (!layer) return { error: 'layer not found' };
  const pb = panel.getBoundingClientRect();
  const lb = layer.getBoundingClientRect();
  return {
    panelBg: getComputedStyle(panel).backgroundColor,
    panelRect: { x: Math.round(pb.left), y: Math.round(pb.top), w: Math.round(pb.width), h: Math.round(pb.height) },
    layerTracksPanel: ['left','top','width','height'].every(k => Math.abs(lb[k] - pb[k]) < 1),
    strength: getComputedStyle(layer).opacity,
  };
})()`;

const shoot = async (file, clip) => {
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
  if (s?.data) fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
};

// The phone hides ABOUT behind the burger, so open that first when it is there.
const openAbout = `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const about = () => [...document.querySelectorAll('button, a')]
    .find(b => /^about$/i.test((b.textContent||'').trim()));
  await sleep(3400);
  const burger = document.querySelector('button[aria-label="Open menu"]');
  if (burger) { burger.click(); await sleep(700); }
  const btn = about();
  if (!btn) return { error: 'no about control' };
  btn.click();
  await sleep(2000);
  return true;
})()`;

// 1. Phone: full-bleed takeover.
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
});
await send('Page.navigate', { url: `${BASE}/?view=grid` });
await evaluate(openAbout);
const phone = await evaluate(REPORT);
console.log('phone', JSON.stringify(phone));
if (phone?.panelRect) await shoot('/tmp/paper-phone.png', { x: 0, y: 0, width: 390, height: 844 });

// 2. Desktop, drawer shut: the sliver is wearing `idle`.
await send('Emulation.clearDeviceMetricsOverride');
await send('Page.navigate', { url: `${BASE}/?view=grid` });
// Long enough for the peek entrance (which is held back behind the page's own
// arrival) to have parked the sliver on the edge.
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  await sleep(9000);
  return true;
})()`);
const shut = await evaluate(REPORT);
console.log('desktop shut', JSON.stringify(shut));
await shoot('/tmp/paper-sliver.png', { x: 1200, y: 0, width: 240, height: 500 });

ws.close();
chrome.kill();
