/**
 * Phone INDEX: does the search + filter row ever reach the wordmark / menu row
 * above it? Checks at rest and part-scrolled, across the narrow widths where the
 * two filter buttons are most likely to grow.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9450 + (process.pid % 40);

const READ = `
  (() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    };
    const wordmark = [...document.querySelectorAll('img')].find((i) => {
      const r = i.getBoundingClientRect();
      return r.top < 140 && r.width > 60 && r.height < 60;
    });
    const burger = [...document.querySelectorAll('button')].find((b) =>
      /menu/i.test(b.getAttribute('aria-label') || '')
    );
    const search = document.querySelector('.grid-search-input') ||
      document.querySelector('input[type="search"], input');
    const cat = [...document.querySelectorAll('button')].find((b) =>
      /^category/i.test((b.textContent || '').trim())
    );
    const loc = [...document.querySelectorAll('button')].find((b) =>
      /^location/i.test((b.textContent || '').trim())
    );

    const navBottom = Math.max(
      wordmark ? wordmark.getBoundingClientRect().bottom : -Infinity,
      burger ? burger.getBoundingClientRect().bottom : -Infinity
    );
    const rowTop = Math.min(
      search ? search.getBoundingClientRect().top : Infinity,
      cat ? cat.getBoundingClientRect().top : Infinity,
      loc ? loc.getBoundingClientRect().top : Infinity
    );

    return {
      wordmark: box(wordmark), burger: box(burger),
      search: box(search), category: box(cat), location: box(loc),
      navBottom: Math.round(navBottom),
      rowTop: Math.round(rowTop),
      gap: Math.round(rowTop - navBottom),
      scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
      /* Filters on their own line, or squeezed beside the search field? */
      rowWraps: !!(search && cat) &&
        Math.abs(search.getBoundingClientRect().top - cat.getBoundingClientRect().top) > 8,
    };
  })()
`;

const run = async (w, h) => {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    `--user-data-dir=/tmp/idxbar-${process.pid}-${w}`,
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
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`document.querySelectorAll('.grid-tile').length > 8`)) break;
    await sleep(400);
  }
  await sleep(2200);

  console.log(`\n  ── ${w}×${h} ──`);
  for (const [tag, y] of [['at rest', 0], ['scrolled 400', 400], ['scrolled 1400', 1400]]) {
    if (y) {
      await evaluate(`
        (() => {
          const sc = [...document.querySelectorAll('*')].find((el) => {
            const s = getComputedStyle(el);
            return /auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 200;
          });
          (sc || window).scrollTo ? (sc || window).scrollTo(0, ${y}) : window.scrollTo(0, ${y});
        })()
      `);
      await sleep(700);
    }
    const m = await evaluate(READ);
    const flag = m.gap < 0 ? '  ← OVERLAP' : '';
    console.log(
      `     ${tag.padEnd(14)} nav ends y ${String(m.navBottom).padStart(3)} · filter row starts y ${String(m.rowTop).padStart(3)} · gap ${String(m.gap).padStart(4)}px${flag}`
    );
    if (m.gap < 0) {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      if (s?.data) writeFileSync(`scripts/index-bar-overlap-${w}.png`, Buffer.from(s.data, 'base64'));
    }
  }
  const last = await evaluate(READ);
  console.log(`     filters on their own line: ${last.rowWraps ? 'yes' : 'no (beside the search field)'}`);

  chrome.kill();
  ws.close();
  await sleep(400);
};

console.log(`\n═══ PHONE INDEX · NAV vs FILTER ROW · ${BASE} ═══`);
for (const [w, h] of [[390, 844], [375, 667], [360, 740], [320, 568]]) await run(w, h);
console.log('');
process.exit(0);
