/**
 * Where does the mobile grid actually start, and what is the empty band under
 * the filter bar made of?
 *
 * The grid's top padding is derived from the bar's measured height, so the gap
 * is the sum of several things that are easy to conflate: the bar's own bottom
 * padding, the constant added on top of it, and whatever the first row puts
 * above the tile image (its number, and the lattice line over that). This walks
 * that band top to bottom so a trim can be aimed at the right term.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9410 + (process.pid % 40);
const W = Number(process.env.W || 390);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/grid-gap-${process.pid}`,
  `--window-size=${W},844`,
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
  width: W, height: 844, deviceScaleFactor: 1, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`document.querySelectorAll('.grid-tile').length > 2`)) break;
  await sleep(500);
}
await sleep(3000);

const READ = `
  (() => {
    const out = {};
    const scroller = document.querySelector('.grid-stack')?.closest('[style*="scrollbar-gutter"]')
      || [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).scrollbarGutter === 'stable');
    if (scroller) {
      const cs = getComputedStyle(scroller);
      out.scrollPadTop = parseFloat(cs.paddingTop);
      out.scrollTop = Math.round(scroller.scrollTop);
    }

    /* The docked bar is the absolutely-placed box carrying the search field. */
    const input = document.querySelector('input[type="search"]');
    if (input) {
      const ir = input.getBoundingClientRect();
      out.searchBottom = Math.round(ir.bottom);
      let bar = input;
      while (bar && getComputedStyle(bar).position !== 'absolute') bar = bar.parentElement;
      if (bar) {
        const br = bar.getBoundingClientRect();
        const cs = getComputedStyle(bar);
        out.barTop = Math.round(br.top);
        out.barBottom = Math.round(br.bottom);
        out.barHeight = Math.round(br.height);
        out.barPadTop = parseFloat(cs.paddingTop);
        out.barPadBottom = parseFloat(cs.paddingBottom);
        /* The lowest edge of anything the bar actually draws — the scrim keeps
           going past this, but this is where the chrome reads as ending. */
        const kids = [...bar.querySelectorAll('*')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        out.barInkBottom = Math.round(Math.max(...kids.map((r) => r.bottom)));
      }
    }

    const stack = document.querySelector('.grid-stack');
    if (stack) out.stackTop = Math.round(stack.getBoundingClientRect().top);

    const svg = document.querySelector('.grid-stack svg');
    if (svg) out.latticeTop = Math.round(svg.getBoundingClientRect().top);

    const tile = document.querySelector('.grid-tile');
    if (tile) {
      const r = tile.getBoundingClientRect();
      out.tileTop = Math.round(r.top);
      const img = tile.querySelector('img');
      if (img) out.imgTop = Math.round(img.getBoundingClientRect().top);
      /* The tile's own number sits above its image inside the tile box. */
      const num = [...tile.querySelectorAll('span, div')]
        .map((el) => ({ t: (el.textContent || '').trim(), r: el.getBoundingClientRect() }))
        .find((x) => /^\\d{1,4}$/.test(x.t) && x.r.height > 0);
      if (num) out.numTop = Math.round(num.r.top);
    }
    return out;
  })()
`;

const m = await evaluate(READ);
console.log(`\n═══ MOBILE GRID TOP · ${W}px · ${BASE} ═══\n`);
console.log(`  scroll offset ................ ${m.scrollTop}px (want 0)`);
console.log(`  bar box ...................... ${m.barTop} → ${m.barBottom}  (h ${m.barHeight}, pad ${m.barPadTop}/${m.barPadBottom})`);
console.log(`  last ink the bar draws ....... y ${m.barInkBottom}`);
console.log(`  search field bottom .......... y ${m.searchBottom}`);
console.log(`  scroller padding-top ......... ${m.scrollPadTop}px`);
console.log(`  grid-stack top ............... y ${m.stackTop}`);
console.log(`  lattice svg top .............. y ${m.latticeTop}`);
console.log(`  first tile box top ........... y ${m.tileTop}`);
console.log(`  first tile number top ........ y ${m.numTop}`);
console.log(`  first tile image top ......... y ${m.imgTop}`);
console.log('');
console.log(`  ▸ dead band, bar ink → tile number:  ${m.numTop - m.barInkBottom}px`);
console.log(`  ▸ dead band, bar ink → tile image:   ${m.imgTop - m.barInkBottom}px`);
console.log('');

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 0, y: 0, width: W, height: 460, scale: 2 },
});
if (shot?.data) {
  writeFileSync('scripts/mobile-grid-gap.png', Buffer.from(shot.data, 'base64'));
  console.log('  crop → scripts/mobile-grid-gap.png\n');
}

chrome.kill();
ws.close();
process.exit(0);
