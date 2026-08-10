/**
 * Desktop EXPLORE: what happens to the left category dial when the About drawer
 * opens. Reports each category's own opacity and the opacity it actually renders
 * at once every ancestor is multiplied in, before and after the drawer opens.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:5190';
const PORT = 9336;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-dial-profile',
  '--window-size=1440,900',
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
  if (s?.data) fs.writeFileSync(`/tmp/about-${name}.png`, Buffer.from(s.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
const VIEW = process.argv[2] || 'explore';
await send('Page.navigate', { url: `${BASE}/?view=${VIEW}` });

const MEASURE = `(() => {
  // EXPLORE's left dial, or the grid's filter rail — whichever this view has.
  const cats = [...document.querySelectorAll('button[aria-label^="Show "]')].length
    ? [...document.querySelectorAll('button[aria-label^="Show "]')]
    : [...document.querySelectorAll('button, a')].filter(b => /^\\[?\\s*[A-Z][A-Z ]{2,}\\s*\\]?$/.test((b.textContent || '').trim()) && b.getBoundingClientRect().left < 460 && b.getBoundingClientRect().top > 120);
  // Everything an ancestor does to a node's visibility, multiplied out.
  const chain = (el) => {
    let op = 1;
    const filters = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      op *= Number(cs.opacity);
      if (cs.filter && cs.filter !== 'none') filters.push(cs.filter);
      if (cs.visibility === 'hidden') op = 0;
    }
    return { effectiveOpacity: +op.toFixed(3), filters };
  };
  return {
    count: cats.length,
    labels: cats.slice(0, 3).map(c => (c.textContent || '').trim().slice(0, 18)),
    perCategory: cats.slice(0, 3).map(c => ({
      ownOpacity: +getComputedStyle(c).opacity,
      ...chain(c),
      onScreen: c.getBoundingClientRect().width > 0,
    })),
  };
})()`;

await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if (document.querySelectorAll('button[aria-label^="Show "]').length) break;
    await sleep(200);
  }
  await sleep(2200);
  return true;
})()`);

const before = await evaluate(MEASURE);
await shoot('before');

const clicked = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent || '').trim()));
  if (!btn) return 'no ABOUT control found';
  btn.click();
  return 'clicked';
})()`);
await sleep(1400);
const after = await evaluate(MEASURE);
await shoot('after');

console.log(JSON.stringify({ clicked, before, after }, null, 1));
ws.close();
chrome.kill();
