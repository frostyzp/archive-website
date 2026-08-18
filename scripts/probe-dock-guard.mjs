/**
 * Two loose ends from docking the phone's EXPLORE chrome:
 *   1. while the first look is up the dock is only faded out, so is a stepper
 *      arrow still tappable through it?
 *   2. desktop shares the component — did the dock change reach it?
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9820 + (process.pid % 40);

const run = async (label, { w, h, mobile }) => {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    `--user-data-dir=/tmp/dock-${process.pid}-${w}`,
    `--window-size=${w},${h}`,
    '--force-device-scale-factor=1',
    'about:blank',
  ]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let page;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
    } catch {}
    if (!page) await sleep(100);
  }
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
    new Promise((res) => {
      const n = ++id;
      pending.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (e) =>
    (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))
      ?.result?.value;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: `${BASE}/?view=explore` });
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`/swipe through curated/i.test(document.body.textContent || '')`)) break;
    await sleep(400);
  }
  await sleep(2400);

  const res = await evaluate(`
    (() => {
      const prev = document.querySelector('[aria-label="Previous category"]');
      let hit = null, label = null;
      if (prev) {
        const r = prev.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        hit = el ? (el.getAttribute('aria-label') || el.tagName.toLowerCase()) : null;
        label = 'stepper arrow at y ' + Math.round(r.top);
      }
      /* Desktop's wheel: the category words down the left edge. */
      const wheel = [...document.querySelectorAll('div')].find(
        (d) => getComputedStyle(d).position === 'fixed' &&
          d.getBoundingClientRect().left < 60 &&
          d.getBoundingClientRect().height > 200
      );
      return {
        hasStepper: !!prev,
        where: label,
        topmostAtArrow: hit,
        wheel: wheel ? Math.round(wheel.getBoundingClientRect().height) : null,
        intro: /swipe through curated/i.test(document.body.textContent || ''),
      };
    })()
  `);

  console.log(`\n  ── ${label} (${w}×${h}) ──`);
  console.log(`     first look on screen ..... ${res.intro ? 'yes' : 'no'}`);
  console.log(`     phone dock present ....... ${res.hasStepper ? 'yes' : 'no'}`);
  if (res.hasStepper)
    console.log(`     what a tap on the arrow hits: ${res.topmostAtArrow}  (want the first-look surface, not the arrow)`);
  console.log(`     desktop wheel ............ ${res.wheel ? `${res.wheel}px tall` : 'not present'}`);

  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s?.data) writeFileSync(`scripts/dock-guard-${w}.png`, Buffer.from(s.data, 'base64'));

  chrome.kill();
  ws.close();
  await sleep(500);
};

console.log(`\n═══ DOCK GUARD · ${BASE} ═══`);
await run('phone, first look up', { w: 390, h: 667, mobile: true });
await run('desktop', { w: 1440, h: 900, mobile: false });
console.log('');
process.exit(0);
