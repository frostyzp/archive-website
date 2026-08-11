/**
 * The About drawer's mailing-list card: reports its corner radius, border, and
 * outer box against the column it sits in (so a border added "inside" can be shown
 * not to have grown the slab), plus the radius of the SUBSCRIBE button nested in
 * it. Shoots the card.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9343;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/subscribe-card-profile',
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

await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if ([...document.querySelectorAll('button, a')].some(b => /^about$/i.test((b.textContent||'').trim()))) break;
    await sleep(200);
  }
  await sleep(1800);
  [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim())).click();
  await sleep(1600);
  document.querySelector('.about-subscribe')?.scrollIntoView({ block: 'center' });
  await sleep(900);
  return true;
})()`);

const m = await evaluate(`(() => {
  const card = document.querySelector('.about-subscribe');
  if (!card) return { error: 'card not found' };
  const cs = getComputedStyle(card);
  const cb = card.getBoundingClientRect();
  const col = card.parentElement;
  const colCs = getComputedStyle(col);
  const colBox = col.clientWidth - parseFloat(colCs.paddingLeft) - parseFloat(colCs.paddingRight);
  const btn = card.querySelector('button[type="submit"]');
  return {
    radius: cs.borderRadius,
    border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
    boxSizing: cs.boxSizing,
    // offsetWidth includes the border; compare against the space the column offers
    // and the margins the card sets, to show the border came out of the inside.
    cardOuterWidth: card.offsetWidth,
    marginInline: cs.marginLeft + ' / ' + cs.marginRight,
    columnContentWidth: Math.round(colBox),
    fitsColumn: card.offsetWidth + 6 <= Math.round(colBox) + 1,
    submitRadius: btn ? getComputedStyle(btn).borderRadius : null,
    rect: { x: Math.round(cb.left), y: Math.round(cb.top), w: Math.round(cb.width), h: Math.round(cb.height) },
  };
})()`);

console.log(JSON.stringify(m, null, 1));

if (m?.rect) {
  const r = m.rect;
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r.x - 14, y: r.y - 14, width: r.w + 28, height: r.h + 28, scale: 2 },
  });
  if (s?.data) fs.writeFileSync('/tmp/subscribe-card.png', Buffer.from(s.data, 'base64'));
}

ws.close();
chrome.kill();
