/**
 * Phone EXPLORE, three complaints at once:
 *   - does the metadata block ever land on the note image?
 *   - is the note counter on screen?
 *   - after changing category, does the stack actually arrive at a note?
 *
 * Reports the boxes at each step rather than a pass/fail, since the failure is
 * a few pixels of overlap rather than a missing element.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9410 + (process.pid % 40);
const W = Number(process.env.W || 390);
const H = Number(process.env.H || 844);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/expm-${process.pid}`,
  `--window-size=${W},${H}`,
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

const READ = `
  (() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right),
        h: Math.round(r.height), w: Math.round(r.width),
      };
    };
    /* The metadata block: the DATE label's outermost positioned wrapper. */
    const dateLabel = [...document.querySelectorAll('span, div')].find(
      (el) => (el.textContent || '').trim() === 'DATE' && el.childElementCount === 0
    );
    let meta = dateLabel;
    while (meta && getComputedStyle(meta).position !== 'absolute' && meta.parentElement) {
      meta = meta.parentElement;
      if (meta === document.body) { meta = null; break; }
    }
    /* The active note image: the biggest visible img in the middle band. */
    const img = [...document.querySelectorAll('img')]
      .filter((i) => {
        const r = i.getBoundingClientRect();
        return r.height > 120 && r.top < innerHeight && r.bottom > 0;
      })
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    /* During a change there are two counts stacked on each other, so take the
       brightest — the question is whether ANY count is legible, not whether the
       outgoing one has left. */
    const counters = [...document.querySelectorAll('div')].filter(
      (d) => d.childElementCount === 0 && /^\\d{2}\\/\\d{2}$/.test((d.textContent || '').trim())
    );
    const stepLabel = (() => {
      const prev = document.querySelector('[aria-label="Previous category"]');
      const row = prev ? prev.parentElement : null;
      return row ? (row.textContent || '').trim() : null;
    })();
    const vis = (el) => {
      let o = 1, n = el;
      while (n && n !== document.body) {
        o *= parseFloat(getComputedStyle(n).opacity || '1');
        n = n.parentElement;
      }
      return Math.round(o * 100) / 100;
    };

    const m = box(meta), im = box(img);
    let overlap = null;
    if (m && im) overlap = Math.max(0, Math.min(m.bottom, im.bottom) - Math.max(m.top, im.top));

    const lit = counters
      .map((c) => ({ text: (c.textContent || '').trim(), v: vis(c) }))
      .sort((a, b) => b.v - a.v)[0];

    return {
      meta: m, metaText: meta ? (meta.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 48) : null,
      image: im,
      imageSrc: img ? (img.getAttribute('src') || '').split('/').pop() : null,
      overlap,
      counter: lit ? lit.text : null,
      counterVis: lit ? lit.v : null,
      category: stepLabel,
      scrollTop: (() => {
        const el = document.querySelector('[data-vcard]')?.parentElement;
        return el ? Math.round(el.scrollTop) : null;
      })(),
    };
  })()
`;

const show = (tag, m) => {
  console.log(`\n  ── ${tag} ──`);
  console.log(`     category ......... ${m.category ?? '—'}`);
  console.log(`     counter .......... ${m.counter ?? '—'}   opacity ${m.counterVis ?? '—'}`);
  console.log(`     metadata block ... ${m.meta ? `y ${m.meta.top}–${m.meta.bottom}` : '—'}`);
  console.log(`     note image ....... ${m.image ? `y ${m.image.top}–${m.image.bottom}` : '—'}  ${m.imageSrc ?? ''}`);
  console.log(`     metadata over image  ${m.overlap == null ? '—' : `${m.overlap}px`}`);
  console.log(`     stack scrollTop .. ${m.scrollTop}`);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${BASE}/?view=explore` });
for (let i = 0; i < 50; i++) {
  if (await evaluate(`/anywhere to continue/i.test(document.body.textContent || '')`)) break;
  await sleep(400);
}
await sleep(1800);
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /anywhere to continue/i.test(x.textContent || '')
    );
    if (b) b.click();
  })()
`);
await sleep(2600);

console.log(`\n═══ PHONE EXPLORE STATE · ${W}×${H} · ${BASE} ═══`);
show('settled on first note', await evaluate(READ));

// Metadata is placed from a measured anchor, so the interesting moments are
// right after something moves.
for (let n = 1; n <= 3; n++) {
  await evaluate(`
    (() => {
      const el = document.querySelector('[data-vcard]')?.parentElement;
      if (el) el.scrollBy({ top: el.clientHeight * 0.9, behavior: 'smooth' });
    })()
  `);
  await sleep(250);
  show(`mid-swipe ${n} (250ms after)`, await evaluate(READ));
  await sleep(1500);
  show(`settled after swipe ${n}`, await evaluate(READ));
}

for (let n = 1; n <= 2; n++) {
  await evaluate(`
    (() => {
      const b = document.querySelector('[aria-label="Next category"]');
      if (b) b.click();
    })()
  `);
  await sleep(300);
  show(`category step ${n} (300ms after)`, await evaluate(READ));
  await sleep(2000);
  show(`category step ${n} settled`, await evaluate(READ));
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s?.data) writeFileSync(`scripts/explore-cat-${n}.png`, Buffer.from(s.data, 'base64'));
}

console.log('');
chrome.kill();
ws.close();
process.exit(0);
