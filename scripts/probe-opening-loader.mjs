/**
 * Does the site still open behind a loader, and how long until the hero reads?
 *
 * Arms a recorder before the document loads, then samples every frame for the
 * loader's presence and for the first painted hero type. The number that matters
 * is when the wordmark and question become legible: hiding a loader is only a
 * win if it isn't replaced by an equally long blank screen, which is exactly
 * what the hero title's one-second wait would have done if left alone.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9380 + (process.pid % 40);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/opening-loader-${process.pid}`,
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

/* Armed before load, so the first frames aren't already gone by the time the
   recorder starts. The loader is a fixed full-bleed layer at z 200 over the page
   gradient; the hero is the wordmark drawing plus the opening question. */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__open = { t0: performance.now(), pts: [] };
    const tick = () => {
      const t = performance.now() - window.__open.t0;
      const layers = [...document.querySelectorAll('div')].filter((d) => {
        const cs = getComputedStyle(d);
        return cs.position === 'fixed' && Number(cs.zIndex) >= 190 &&
          d.getBoundingClientRect().width >= innerWidth - 2 &&
          d.getBoundingClientRect().height >= innerHeight - 2 &&
          Number(cs.opacity) > 0.02;
      });
      // Hero legibility: any painted glyph or drawn wordmark stroke on screen.
      const heroInk = [...document.querySelectorAll('main *, svg path')].some((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 4) return false;
        if (r.top > innerHeight || r.bottom < 0) return false;
        let o = 1;
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          o *= Number(getComputedStyle(n).opacity);
        }
        return o > 0.12 && (el.textContent || '').trim().length > 0;
      });
      window.__open.pts.push({ t, veils: layers.length, heroInk });
      if (t < 6000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  `,
});

await send('Page.navigate', { url: `${BASE}/` });
await sleep(8000);
const pts = (await evaluate('window.__open && window.__open.pts')) || [];

console.log(`\n═══ THE OPENING · ${BASE} ═══\n`);
if (!pts.length) {
  console.log('  recorder never ran\n');
} else {
  const veiled = pts.filter((p) => p.veils > 0);
  const firstInk = pts.find((p) => p.heroInk);
  console.log(`  frames sampled              ${pts.length} over ${Math.round(pts.at(-1).t)}ms`);
  console.log(`  full-bleed veil frames      ${veiled.length}`);
  if (veiled.length) {
    console.log(`    first at                  ${Math.round(veiled[0].t)}ms`);
    console.log(`    last at                   ${Math.round(veiled.at(-1).t)}ms`);
  }
  console.log(`  hero type first legible     ${firstInk ? `${Math.round(firstInk.t)}ms` : 'never in window'}`);
  console.log('');
  console.log(`  ${veiled.length === 0 ? '✓ nothing covers the opening' : '✗ a full-bleed layer is still up'}`);
  console.log(
    `  ${firstInk && firstInk.t < 700 ? '✓' : '✗'} the screen isn't blank while it waits` +
      `${firstInk ? ` (${Math.round(firstInk.t)}ms)` : ''}`
  );
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) {
  writeFileSync('scripts/opening-no-loader.png', Buffer.from(shot.data, 'base64'));
  console.log('\n  crop → scripts/opening-no-loader.png');
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
