/**
 * The About sheet's section heading after it was taken out of the pinned header:
 * where it sits relative to the tab row at rest, and whether it scrolls away with
 * the copy while the tabs stay put.
 *
 * Runs 390x844 and 320x568, plus a desktop 1440x900 pass to confirm the heading
 * is where it always was there.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9400 + (process.pid % 500);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/about-heading-profile-${process.pid}`,
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
  if (r?.exceptionDetails) {
    const d = r.exceptionDetails;
    return { error: d.exception?.description || d.text, line: d.lineNumber };
  }
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

const shoot = async (file) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s?.data) fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  return file;
};

const OPEN_ABOUT = `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  await sleep(3600);
  const burger = document.querySelector('button[aria-label="Open menu"]');
  if (burger) { burger.click(); await sleep(700); }
  const btn = [...document.querySelectorAll('button, a')]
    .find(b => /^about$/i.test((b.textContent||'').trim()));
  if (!btn) return { error: 'no about control' };
  btn.click();
  await sleep(900);
  return true;
})()`;

const REPORT = `(() => {
  const R = (n) => Math.round(n * 100) / 100;
  const body = document.getElementById('about-panel-body');
  if (!body) return { error: 'no panel body' };
  const tablist = document.querySelector('[role="tablist"][aria-label="About sections"]');
  const heading = body.querySelector('h2');
  const firstCopy = [...body.querySelectorAll('p')].find(p => (p.textContent||'').trim().length > 40);
  const bb = body.getBoundingClientRect();
  const tb = tablist ? tablist.getBoundingClientRect() : null;
  const hb = heading ? heading.getBoundingClientRect() : null;
  const cb = firstCopy ? firstCopy.getBoundingClientRect() : null;
  return {
    headingInsideColumn: heading ? body.contains(heading) : null,
    headingInsideHeader: heading && tablist ? tablist.parentElement.contains(heading) : null,
    closeButtons: document.querySelectorAll('.about-close').length,
    tabsBottom: tb ? R(tb.bottom) : null,
    colTop: R(bb.top),
    colPadTop: getComputedStyle(body).paddingTop,
    headingTop: hb ? R(hb.top) : null,
    headingBottom: hb ? R(hb.bottom) : null,
    gapTabsToHeading: tb && hb ? R(hb.top - tb.bottom) : null,
    gapHeadingToCopy: hb && cb ? R(cb.top - hb.bottom) : null,
    scrollable: body.scrollHeight > body.clientHeight,
  };
})()`;

const SCROLL_AND_REPORT = `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const R = (n) => Math.round(n * 100) / 100;
  const body = document.getElementById('about-panel-body');
  const tablist = document.querySelector('[role="tablist"][aria-label="About sections"]');
  const heading = body.querySelector('h2');
  const before = { heading: heading.getBoundingClientRect().top, tabs: tablist.getBoundingClientRect().top };
  body.scrollTop = 240;
  await sleep(250);
  const after = { heading: heading.getBoundingClientRect().top, tabs: tablist.getBoundingClientRect().top };
  return {
    scrolledBy: body.scrollTop,
    headingMovedUpBy: R(before.heading - after.heading),
    tabsMovedBy: R(before.tabs - after.tabs),
    headingNowAboveTabs: after.heading < tablist.getBoundingClientRect().bottom,
    pageScrollY: window.scrollY,
  };
})()`;

const out = {};

for (const [tag, w, h] of [['390', 390, 844], ['320', 320, 568]]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: true,
  });
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  await sleep(1200);
  const opened = await evaluate(OPEN_ABOUT);
  if (opened?.error) { out[tag] = { openFailed: opened.error }; continue; }
  out[tag] = { rest: await evaluate(REPORT) };
  await shoot(`/tmp/heading-${tag}-rest.png`);
  out[tag].scrolled = await evaluate(SCROLL_AND_REPORT);
  await shoot(`/tmp/heading-${tag}-scrolled.png`);
}

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: `${BASE}/?view=grid` });
await sleep(1200);
const openedDesk = await evaluate(OPEN_ABOUT);
out.desktop = openedDesk?.error ? { openFailed: openedDesk.error } : await evaluate(REPORT);
await shoot('/tmp/heading-1440-rest.png');

console.log(JSON.stringify(out, null, 2));

ws.close();
chrome.kill();
process.exit(0);
