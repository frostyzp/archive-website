/**
 * What sits ON TOP of the DATE / LOCATION metadata block on INDEX (grid →
 * lightbox) and EXPLORE. Reports the block's rect, the rect + z-index of every
 * black wash / vignette layer that overlaps it, and the pixel actually painted
 * at the DATE label — so "is it being darkened by something above it" is
 * answered by measurement rather than by reading z-indexes.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9337;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/meta-stack-profile',
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
const shoot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s?.data) fs.writeFileSync(`/tmp/meta-${name}.png`, Buffer.from(s.data, 'base64'));
  return `/tmp/meta-${name}.png`;
};

await send('Page.enable');
await send('Runtime.enable');

/* Finds the metadata block (the row container holding the DATE label) and every
   overlay whose box covers it. "Overlay" = positioned, pointer-events:none, with
   a black gradient or a translucent black fill — i.e. the washes / vignettes. */
const MEASURE = `(() => {
  const label = [...document.querySelectorAll('span')].find(
    (s) => (s.textContent || '').trim() === 'DATE'
  );
  if (!label) return { error: 'no DATE label on screen' };
  const block = label.closest('div').parentElement;
  const r = block.getBoundingClientRect();
  const lr = label.getBoundingClientRect();

  const overlaps = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  const washes = [...document.querySelectorAll('div')]
    .filter((d) => {
      const cs = getComputedStyle(d);
      if (cs.position === 'static') return false;
      const bg = cs.backgroundImage + ' ' + cs.backgroundColor;
      // Only layers that actually paint black (skip rgba(0,0,0,0) placeholders).
      if (!/rgba?\\(0, 0, 0(, 0\\.[1-9]|\\)|, [1-9])/.test(bg)) return false;
      return overlaps(d.getBoundingClientRect(), r);
    })
    .map((d) => {
      const cs = getComputedStyle(d);
      const b = d.getBoundingClientRect();
      return {
        zIndex: cs.zIndex,
        position: cs.position,
        rect: [Math.round(b.top), Math.round(b.left), Math.round(b.width), Math.round(b.height)],
        background: (cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor).slice(0, 90),
      };
    });

  // The stacking-context chain above the label: which ancestor z-index the whole
  // block is trapped inside (a child can never escape this).
  const contexts = [];
  for (let n = label.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.zIndex !== 'auto' && cs.position !== 'static') {
      contexts.push({ zIndex: cs.zIndex, position: cs.position, cls: n.className?.slice?.(0, 20) || '' });
    }
  }

  /* Paint order, by the browser's own hit-testing rather than by reading
     z-indexes: the washes are pointer-events:none, so make them hittable for one
     frame and ask what elementsFromPoint returns at the DATE label. That array is
     front-to-back, so if a wash comes back before the label, it is painted on top
     of it. Restored immediately after. */
  const marked = [...document.querySelectorAll('div')].filter((d) => {
    const cs = getComputedStyle(d);
    return cs.position !== 'static' && /rgba\\(0, 0, 0, 0\\.(8|4|9|6)/.test(cs.backgroundImage);
  });
  const prior = marked.map((d) => d.style.pointerEvents);
  marked.forEach((d) => { d.style.pointerEvents = 'auto'; d.dataset.probeWash = '1'; });
  const cx = lr.left + lr.width / 2;
  const cy = lr.top + lr.height / 2;
  const stack = document.elementsFromPoint(cx, cy).map((el) => {
    if (el.dataset?.probeWash) return 'WASH z' + getComputedStyle(el).zIndex;
    if (el === label) return 'DATE LABEL';
    const cs = getComputedStyle(el);
    return el.tagName.toLowerCase() + (cs.zIndex !== 'auto' ? ' z' + cs.zIndex : '');
  });
  marked.forEach((d, i) => { d.style.pointerEvents = prior[i]; delete d.dataset.probeWash; });

  return {
    labelColor: getComputedStyle(label).color,
    paintOrderAtLabel: stack,
    washAboveLabel:
      stack.findIndex((s) => s.startsWith('WASH')) !== -1 &&
      stack.findIndex((s) => s.startsWith('WASH')) < stack.indexOf('DATE LABEL'),
    blockRect: [Math.round(r.top), Math.round(r.left), Math.round(r.width), Math.round(r.height)],
    labelRect: [Math.round(lr.top), Math.round(lr.left), Math.round(lr.width), Math.round(lr.height)],
    washesOverBlock: washes,
    stackingChain: contexts,
    samplePoint: [Math.round(lr.left + 2), Math.round(lr.top + lr.height / 2)],
  };
})()`;

const report = {};

/* ── EXPLORE ─────────────────────────────────────────────────────────── */
await send('Page.navigate', { url: `${BASE}/?view=explore` });
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if ([...document.querySelectorAll('span')].some(s => (s.textContent||'').trim() === 'DATE')) break;
    await sleep(200);
  }
  await sleep(2600);
  return true;
})()`);
report.explore = await evaluate(MEASURE);
report.explore.screenshot = await shoot('explore');

/* ── INDEX (grid → click a tile to open the lightbox) ────────────────── */
await send('Page.navigate', { url: `${BASE}/?view=grid` });
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if (document.querySelectorAll('img[alt^="Confession"]').length) break;
    await sleep(200);
  }
  await sleep(2600);
  const tile = document.querySelector('.grid-tile');
  tile.click();
  await sleep(1600);
  return true;
})()`);
report.index = await evaluate(MEASURE);
report.index.screenshot = await shoot('index');

console.log(JSON.stringify(report, null, 1));
ws.close();
chrome.kill();
