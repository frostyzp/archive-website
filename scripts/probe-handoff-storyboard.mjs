/**
 * The onboarding → INDEX hand-off, timestamped.
 *
 * Every landmark is measured from the swipe that starts it, because several of
 * the constants behind this sequence are derived from OTHER constants — the nav
 * chrome's delay is restated by hand from the rise's own numbers, and the filter
 * sidebar hangs off the EDGE entrance's constant rather than the rise's. Reading
 * the source gives you what was intended; only a run gives you what happens.
 *
 * Landmarks, all in ms after the gesture:
 *   the pile clearing, the page swapping, the first tile moving and the last one
 *   landing, the nav chrome fading up, the wordmark's pen going down and lifting,
 *   the filter sidebar arriving, and the About tab peeking in.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9900 + (process.pid % 89);
const PROFILE = `/tmp/handoff-${process.pid}`;

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
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.startScreencast', { format: 'jpeg', quality: 10, everyNthFrame: 60 });

const pressDown = async () => {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'ArrowDown',
      code: 'ArrowDown',
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 40,
    });
  }
};
const swipe = async ({ x = 60, y = 700, dy = -140, steps = 5 } = {}) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: Math.round(y + (dy * i) / steps), id: 1 }],
    });
    await sleep(14);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

await send('Page.navigate', { url: `${BASE}/` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`!!document.querySelector('nav[aria-label="Beats"]')`)) break;
  await sleep(500);
}
await sleep(1500);

// To the closing beat. Read off the dots rather than counted, since the first
// gesture of a session is spent on the loading gate.
const BEAT = `(() => {
  const nav = document.querySelector('nav[aria-label="Beats"]');
  const dots = nav ? [...nav.querySelectorAll('button')] : [];
  return dots.findIndex((b) => b.getAttribute('aria-current') === 'step');
})()`;
for (let i = 0; i < 8; i++) {
  const b = await evaluate(BEAT);
  if (b >= 4) break;
  await pressDown();
  await sleep(1500);
}
await sleep(2800);

/* Armed before the gesture, and it watches for everything at once — the pile,
   the tiles, the chrome, the wordmark, the sidebar, the About tab — recording
   the first frame each one is true on. One clock for all of them, started on the
   gesture, so the numbers are directly comparable. */
await evaluate(`
  (() => {
    window.__hand = { t0: performance.now(), marks: {}, tiles: null };
    const mark = (k, v) => {
      if (window.__hand.marks[k] == null) window.__hand.marks[k] = v ?? (performance.now() - window.__hand.t0);
    };
    const q = (s) => document.querySelector(s);
    const vis = (el) => el && Number(getComputedStyle(el).opacity) > 0.5;

    const loop = () => {
      const t = performance.now() - window.__hand.t0;
      const pile = [...document.querySelectorAll('main img[alt="Handwritten confession"]')];
      if (pile.length && pile.every((i) => {
        const box = i.getBoundingClientRect();
        return box.bottom < 0 || box.top > innerHeight || Number(getComputedStyle(i.parentElement).opacity) < 0.02;
      })) mark('pileGone', t);

      const tiles = [...document.querySelectorAll('.grid-tile')];
      if (tiles.length) {
        mark('archiveMounted', t);
        // A tile is "moving" while its own transform still differs from where it
        // ends up; the wall is down once nothing is moving any more.
        const ys = tiles.map((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);
        if (window.__hand.tiles) {
          const moved = ys.some((y, i) => Math.abs(y - window.__hand.tiles[i]) > 0.5);
          if (moved) { mark('firstTileMoves', t); window.__hand.lastMove = t; }
        }
        window.__hand.tiles = ys;
      }

      const bar = q('button[aria-label^="What We Tell AI"]');
      if (bar && vis(bar.parentElement) && vis(bar)) mark('navChrome', t);
      const svg = bar && bar.querySelector('svg');
      if (svg) {
        const inked = [...svg.querySelectorAll('mask path')]
          .filter((p) => Number(p.style.opacity || getComputedStyle(p).opacity) > 0.5).length;
        const masks = svg.querySelectorAll('mask').length;
        if (inked > 0) mark('penDown', t);
        if (masks && inked >= masks) mark('penUp', t);
      }

      const side = [...document.querySelectorAll('input')].find((i) =>
        /search/i.test(i.getAttribute('placeholder') || ''));
      if (vis(side)) mark('sidebar', t);

      const about = [...document.querySelectorAll('button, a, aside')].find((el) =>
        /^\\s*ABOUT\\s*$/i.test(el.textContent || ''));
      if (about) {
        const r = about.getBoundingClientRect();
        if (r.width > 0 && r.right <= innerWidth + 2 && vis(about)) mark('aboutPeek', t);
      }

      if (t < 6000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })()
`);

await swipe();
await sleep(6500);
const out = await evaluate('({ marks: window.__hand.marks, lastMove: window.__hand.lastMove })');

const M = out?.marks || {};
const row = (label, v) =>
  `  ${String(v == null ? '—' : Math.round(v)).padStart(5)}ms  ${label}`;

console.log(`\n═══ ONBOARDING → INDEX, MEASURED · ${BASE} ═══`);
console.log('  (all times from the swipe)\n');
console.log(row('the pile is off the screen', M.pileGone));
console.log(row('the archive is mounted — first tiles in the DOM', M.archiveMounted));
console.log(row('the wall starts rising', M.firstTileMoves));
console.log(row('the wall is down', out?.lastMove));
console.log(row('nav chrome fades up', M.navChrome));
console.log(row('the wordmark pen touches down', M.penDown));
console.log(row('the wordmark is written', M.penUp));
console.log(row('the filter sidebar arrives', M.sidebar));
console.log(row('the About tab peeks in', M.aboutPeek));
console.log('');

chrome.kill();
ws.close();
process.exit(0);
