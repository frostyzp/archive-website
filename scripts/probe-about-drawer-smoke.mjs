/**
 * The About drawer after EXPLORE → INDEX, now that the crossing no longer
 * remounts it: does the peeking tab still open the panel, does a section switch
 * hold, does ESC still shut it, and does it come back on 'about' rather than
 * wherever it was left. The state the remount used to wipe, checked by hand.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9355;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-smoke-profile',
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

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${BASE}/?view=grid` });

const out = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const byText = (re) => [...document.querySelectorAll('button, a')]
    .find(b => re.test((b.textContent||'').trim()));
  const drawer = () => document.querySelector('aside[aria-label="About What We Tell AI"]');
  const openState = () => {
    const d = drawer();
    const b = d.getBoundingClientRect();
    return {
      openWide: Math.round(b.left) < window.innerWidth - 200,
      ariaModal: d.getAttribute('aria-modal'),
      activeTab: [...d.querySelectorAll('.about-drawer-tab')]
        .find(t => t.getAttribute('aria-selected') === 'true')?.getAttribute('aria-label') ?? null,
      // A collapsed tab is 'height: 0' plus its own padding and border, so it
      // still measures ~30px tall — opacity is what says whether it is there.
      tabsVisible: [...d.querySelectorAll('.about-drawer-tab')]
        .filter(t => +getComputedStyle(t).opacity > 0.5).length,
      tabBoxes: [...d.querySelectorAll('.about-drawer-tab')].map(t => ({
        label: t.getAttribute('aria-label'),
        opacity: +(+getComputedStyle(t).opacity).toFixed(2),
        h: Math.round(t.getBoundingClientRect().height),
      })),
      heading: d.querySelector('#about-panel-body h2, #about-panel-body h3')?.textContent?.trim() ?? null,
    };
  };

  await sleep(9000);
  byText(/^explore$/i)?.click();
  await sleep(4000);
  byText(/^index$/i)?.click();
  await sleep(3000);

  const shutAfterCrossing = openState();

  // The peeking tab is the way in.
  document.querySelector('.about-drawer-tab').click();
  await sleep(1400);
  const opened = openState();

  // Switch section, then shut with ESC.
  [...drawer().querySelectorAll('.about-drawer-tab')]
    .find(t => t.getAttribute('aria-label') === 'THE WHY')?.click();
  await sleep(900);
  const switched = openState();

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(1400);
  const shut = openState();

  // And back in: a reopen should start on ABOUT, not where it was left.
  document.querySelector('.about-drawer-tab').click();
  await sleep(1400);
  const reopened = openState();

  return { shutAfterCrossing, opened, switched, shut, reopened };
})()`);

console.log(JSON.stringify(out, null, 1));

ws.close();
chrome.kill();
