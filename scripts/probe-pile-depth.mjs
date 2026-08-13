/**
 * What the pile's depth shading actually measures out at.
 *
 * The cards are darkened with a `brightness()` inside the same filter that
 * carries their drop shadow, so the only honest way to read the ramp is off the
 * computed style of each card once it has settled — the constants say what was
 * asked for, not what a card three deep is wearing after the deal has run.
 *
 * Steps the story to the beat where the pile is at its deepest, reads every
 * card's filter and stacking order, and puts a still next to it.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const OUT = process.env.OUT || '/tmp/pile-depth.png';
const PORT = 9600 + (process.pid % 89);
const PROFILE = `/tmp/pile-depth-${process.pid}`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,900',
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
/* Headless throttles a page nobody is watching, and a throttled page stops
   servicing requestAnimationFrame — which stops Motion mid-deal and would have
   the pile measured halfway through its own shading. */
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

await send('Page.navigate', { url: BASE });
await sleep(3200);

// Step to the last beat, where every card in the pile is down.
for (let i = 0; i < 4; i++) {
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })), 1`);
  await sleep(1400);
}
await sleep(900);

const cards = await evaluate(`
  (() => {
    const imgs = [...document.querySelectorAll('img[src*="confession_notes_2"], img[alt="Handwritten confession"]')];
    return imgs.map((img) => {
      // The filter is on the card, which is the positioned ancestor of the scan.
      let el = img;
      let filter = 'none';
      for (let i = 0; i < 4 && el; i++) {
        const f = getComputedStyle(el).filter;
        if (f && f !== 'none') { filter = f; break; }
        el = el.parentElement;
      }
      const r = img.getBoundingClientRect();
      const m = /brightness\\(([\\d.]+)\\)/.exec(filter);
      return {
        src: img.getAttribute('src').split('/').pop(),
        brightness: m ? Number(m[1]) : null,
        z: Number(getComputedStyle(el).zIndex) || 0,
        top: Math.round(r.top),
        w: Math.round(r.width),
        visible: r.width > 0 && r.height > 0,
      };
    }).filter((c) => c.visible);
  })()
`);

console.log(`\n═══ PILE DEPTH · ${BASE} ═══`);
if (!cards || !cards.length) {
  console.log('  no cards on screen — the deal may not have run');
} else {
  cards
    .sort((a, b) => b.z - a.z)
    .forEach((c, i) => {
      console.log(
        `  ${i === 0 ? 'front' : `${i} back`.padEnd(6)} ${c.src.padEnd(14)} brightness ${
          c.brightness == null ? '—' : c.brightness.toFixed(2)
        }   z ${String(c.z).padStart(2)}   ${c.w}px wide`
      );
    });
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) {
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`\n  ${OUT}\n`);
}

chrome.kill();
ws.close();
process.exit(0);
