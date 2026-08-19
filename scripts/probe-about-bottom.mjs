/**
 * Phone ABOUT sheet, scrolled to the end of each tab: how much air is left under
 * the last thing on the page, and does anything sit past the sheet's edge?
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9540 + (process.pid % 40);
const W = 390;
const H = 844;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/abt-${process.pid}`,
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 50; i++) {
  if (await evaluate(`document.querySelectorAll('.grid-tile').length > 8`)) break;
  await sleep(400);
}
await sleep(2200);

// Menu → ABOUT.
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /menu/i.test(x.getAttribute('aria-label') || '')
    );
    if (b) b.click();
  })()
`);
await sleep(700);
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('button, a')].find((x) =>
      /^about$/i.test((x.textContent || '').trim())
    );
    if (b) b.click();
  })()
`);
await sleep(1400);

const READ = `
  (() => {
    const body = document.getElementById('about-panel-body');
    if (!body) return { missing: true };
    const br = body.getBoundingClientRect();
    /* The last thing with ink in the column. */
    const inked = [...body.querySelectorAll('*')].filter((el) => {
      const t = (el.textContent || '').trim();
      const r = el.getBoundingClientRect();
      return t && el.childElementCount === 0 && r.height > 0 && r.width > 0;
    });
    const lastBottom = inked.length
      ? Math.max(...inked.map((el) => el.getBoundingClientRect().bottom))
      : null;
    return {
      atEnd: Math.abs(body.scrollTop + body.clientHeight - body.scrollHeight) < 2,
      scrollTop: Math.round(body.scrollTop),
      scrollHeight: Math.round(body.scrollHeight),
      clientHeight: Math.round(body.clientHeight),
      bodyBottom: Math.round(br.bottom),
      lastInkBottom: lastBottom == null ? null : Math.round(lastBottom),
      airUnderLastInk: lastBottom == null ? null : Math.round(br.bottom - lastBottom),
      viewportBottomGap: Math.round(innerHeight - br.bottom),
      padBottom: getComputedStyle(body).paddingBottom,
    };
  })()
`;

console.log(`\n═══ PHONE ABOUT · FOOT OF EACH TAB · ${W}×${H} · ${BASE} ═══`);
for (const tab of ['About', 'Process', 'The Why']) {
  const ok = await evaluate(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        (x.getAttribute('role') === 'tab' || /about-tab/.test(x.id || '')) &&
        new RegExp('^${tab}$', 'i').test((x.textContent || '').trim())
      );
      if (b) { b.click(); return true; }
      return false;
    })()
  `);
  if (!ok) {
    console.log(`\n  ${tab}: no such tab`);
    continue;
  }
  await sleep(900);
  await evaluate(`
    (() => {
      const b = document.getElementById('about-panel-body');
      if (b) b.scrollTop = b.scrollHeight;
    })()
  `);
  await sleep(700);
  const m = await evaluate(READ);
  console.log(`\n  ── ${tab} ──`);
  console.log(`     column ........... ${m.clientHeight}px tall, content ${m.scrollHeight}px, at end: ${m.atEnd}`);
  console.log(`     padding-bottom ... ${m.padBottom}`);
  console.log(`     last ink ......... y ${m.lastInkBottom}   column ends y ${m.bodyBottom}`);
  console.log(`     air under it ..... ${m.airUnderLastInk}px  (+ ${m.viewportBottomGap}px below the sheet)`);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s?.data) writeFileSync(`scripts/about-foot-${tab.toLowerCase()}.png`, Buffer.from(s.data, 'base64'));
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
