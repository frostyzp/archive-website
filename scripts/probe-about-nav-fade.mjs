/**
 * Does the archive's INDEX / EXPLORE pair finish clearing off before the About
 * drawer arrives?
 *
 * The claim is an ordering, not a duration, so it is read as one: per frame,
 * the tabs' own opacity against how much of the drawer has crossed the right
 * edge of the screen. The two numbers that matter are the moment the tabs reach
 * nothing and how far in the drawer had got by then.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9400 + (process.pid % 89);
const PROFILE = `/tmp/about-nav-${process.pid}`;

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
// Headless stops servicing rAF on a page nobody is watching, which stops Motion
// mid-slide and would have the ordering read off a frozen frame.
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

/* The archive fetches its notes from a published sheet before it renders
   anything, so this waits for the bar itself rather than for a duration. */
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 40; i++) {
  const ready = await evaluate(
    `!!document.body && /EXPLORE/.test(document.body.textContent || '')`
  );
  if (ready) break;
  await sleep(500);
}
await sleep(600);

const trace = await evaluate(`
  new Promise((resolve) => {
    /* The smallest box that still holds both words: the bar wraps the pair in
       several layers, and any of the outer ones would be reporting the whole
       header's opacity rather than the tabs' own. */
    const tabs = [...document.querySelectorAll('div')]
      .filter((d) => {
        const s = d.textContent || '';
        if (!/INDEX/.test(s) || !/EXPLORE/.test(s)) return false;
        const r = d.getBoundingClientRect();
        return r.width > 40 && r.width < 400 && r.height > 0 && r.height < 120;
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      })[0];
    const about = [...document.querySelectorAll('button, a')].find((b) =>
      /^\\s*ABOUT\\s*$/i.test(b.textContent || '')
    );
    if (!tabs || !about) {
      resolve({
        error: !tabs ? 'no tabs' : 'no about control',
        sample: [...document.querySelectorAll('button, a, div')]
          .map((el) => (el.textContent || '').trim())
          .filter((s) => s && s.length < 40)
          .slice(0, 40),
      });
      return;
    }

    const vw = window.innerWidth;
    const panel = () =>
      [...document.querySelectorAll('aside, [class*="about-panel"], [class*="about-drawer"]')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 200 && r.height > 200)
        .sort((a, b) => a.left - b.left)[0] || null;

    /* The FIRST open is not worth timing. Mounting the panel — its sections, its
       paper-texture filters — stalls the main thread for a third of a second, and
       a starved rAF makes every animation on screen report whatever it likes:
       measured cold, a 140ms fade takes 420ms of wall clock because it is only
       given three frames to run in. So the panel is opened, closed and opened
       again, and the second one is the one recorded, with everything warm. */
    const shut = () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) ||
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const warmup = async () => {
      about.click();
      await new Promise((r) => setTimeout(r, 1600));
      shut();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 1600));
    };

    const pts = [];
    let t0 = performance.now();
    let raf;
    const step = () => {
      const t = performance.now() - t0;
      const r = panel();
      pts.push({
        t,
        // Motion writes opacity onto the element, so this is what is painted.
        tabs: Number(getComputedStyle(tabs).opacity),
        // How much of the drawer is inside the viewport, as a share of its width.
        onScreen: r ? Math.max(0, Math.min(1, (vw - r.left) / r.width)) : 0,
      });
      if (t < 1400) raf = requestAnimationFrame(step);
      else { cancelAnimationFrame(raf); resolve({ pts }); }
    };
    warmup().then(() => {
      t0 = performance.now();
      requestAnimationFrame(step);
      about.click();
    });
  })
`);

console.log(`\n═══ NAV TABS vs ABOUT DRAWER · ${BASE} ═══`);
if (!trace || trace.error) {
  console.log(`  could not read the bar: ${trace?.error || 'no trace'}`);
  if (trace?.sample) console.log(`  what is on the page: ${trace.sample.join(' | ')}\n`);
} else {
  const pts = trace.pts;
  const gone = pts.find((p) => p.tabs <= 0.02);
  const showing = pts.find((p) => p.onScreen > 0.02);
  const half = pts.find((p) => p.onScreen >= 0.5);
  const landed = pts.find((p) => p.onScreen >= 0.98);
  const at = (p) => (p ? `${Math.round(p.t)}ms` : 'never');

  console.log(`  tabs gone (opacity ≤ 0.02)          ${at(gone)}`);
  console.log(`  drawer first on screen              ${at(showing)}`);
  console.log(`  drawer half in                      ${at(half)}`);
  console.log(`  drawer landed                       ${at(landed)}`);
  if (gone) {
    const p = pts.find((q) => q.t >= gone.t);
    console.log(
      `\n  at the frame the tabs vanish the drawer is ${(p.onScreen * 100).toFixed(0)}% in`
    );
  }
  const ordered = gone && half && gone.t < half.t;
  console.log(
    `\n  ${ordered ? '✓' : '✗'} the tabs clear ${
      ordered ? 'before' : 'AFTER'
    } the drawer is half way in`
  );
  fs.writeFileSync('/tmp/about-nav-fade.json', JSON.stringify(pts, null, 1));
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
