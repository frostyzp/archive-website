/**
 * The phone's index note reader: does it fit between its own chrome, does the
 * ˅ chevron step to the next note in the index's order, and does nothing scroll?
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9520 + (process.pid % 40);
const W = Number(process.env.W || 390);
const H = Number(process.env.H || 844);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/rdr-${process.pid}`,
  `--window-size=${W},${H}`,
  '--force-device-scale-factor=2',
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

const READ = `
  (() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    const notInTile = (el) => el && !el.closest('.grid-tile');
    const img = [...document.querySelectorAll('img')]
      .filter((i) => notInTile(i) && i.getBoundingClientRect().height > 120)[0];
    const dateLabel = [...document.querySelectorAll('span, div')].find(
      (el) => (el.textContent || '').trim() === 'DATE' && el.childElementCount === 0
    );
    let meta = dateLabel;
    for (let i = 0; i < 4 && meta?.parentElement; i++) meta = meta.parentElement;
    const back = [...document.querySelectorAll('button, a')].find((b) =>
      /^back$/i.test((b.textContent || '').trim())
    );
    const up = document.querySelector('[aria-label="Previous note"]');
    const down = document.querySelector('[aria-label="Next note"]');
    const transcript = document.querySelector('.transcript-reveal');
    /* Anything inside the overlay that can scroll is what we just removed. */
    const scrollers = [...document.querySelectorAll('div')]
      .filter((d) => {
        const s = getComputedStyle(d);
        return /auto|scroll/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 8 &&
          !d.closest('.grid-view') && d.getBoundingClientRect().height > 200;
      }).length;

    return {
      image: box(img),
      imageSrc: img ? (img.getAttribute('src') || '').split('/').pop() : null,
      meta: box(meta),
      back: box(back),
      up: box(up),
      down: box(down),
      transcript: box(transcript),
      transcriptText: transcript ? (transcript.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : null,
      scrollers,
      notesMounted: [...document.querySelectorAll('img')].filter(
        (i) => notInTile(i) && i.getBoundingClientRect().height > 120
      ).length,
    };
  })()
`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 50; i++) {
  if (await evaluate(`document.querySelectorAll('.grid-tile').length > 8`)) break;
  await sleep(400);
}
await sleep(2400);

const tapped = await evaluate(`
  (() => {
    const t = document.querySelectorAll('.grid-tile')[3];
    const r = t.getBoundingClientRect();
    const img = t.querySelector('img');
    return { file: (img.getAttribute('src') || '').split('/').pop(),
             x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()
`);
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tapped.x, y: tapped.y, id: 1 }] });
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(2200);

const show = (tag, m) => {
  console.log(`\n  ── ${tag} ──`);
  console.log(`     BACK / ˄ row ..... y ${m.back?.top}–${m.back?.bottom}  ·  chevron y ${m.up?.top}–${m.up?.bottom}`);
  console.log(`     metadata ......... y ${m.meta?.top}–${m.meta?.bottom}`);
  console.log(`     note image ....... y ${m.image?.top}–${m.image?.bottom}   ${m.imageSrc}`);
  console.log(`     transcript ....... y ${m.transcript?.top}–${m.transcript?.bottom}  "${m.transcriptText ?? ''}"`);
  console.log(`     ˅ chevron ........ y ${m.down?.top}–${m.down?.bottom}`);
  console.log(`     notes mounted .... ${m.notesMounted}   scrollers inside overlay: ${m.scrollers}`);
  const clashTop = m.meta && m.up ? m.up.bottom - m.meta.top : null;
  const clashBot = m.transcript && m.down ? m.transcript.bottom - m.down.top : null;
  console.log(`     clear of top chrome: ${clashTop != null ? (clashTop <= 0 ? `yes (${-clashTop}px)` : `NO — overlaps ${clashTop}px`) : '—'}`);
  console.log(`     clear of ˅ chevron:  ${clashBot != null ? (clashBot <= 0 ? `yes (${-clashBot}px)` : `NO — overlaps ${clashBot}px`) : '—'}`);
};

console.log(`\n═══ PHONE INDEX READER · ${W}×${H} · ${BASE} ═══`);
console.log(`     tapped tile #3 → ${tapped.file}`);
show('opened', await evaluate(READ));
let s = await send('Page.captureScreenshot', { format: 'png' });
if (s?.data) writeFileSync('scripts/index-reader.png', Buffer.from(s.data, 'base64'));

await evaluate(`document.querySelector('[aria-label="Next note"]').click()`);
await sleep(1000);
show('after ˅ (next note)', await evaluate(READ));

await evaluate(`document.querySelector('[aria-label="Previous note"]').click()`);
await sleep(1000);
show('after ˄ (back to it)', await evaluate(READ));

console.log('');
chrome.kill();
ws.close();
process.exit(0);
