/**
 * Shoots the right edge of the page a few hundred ms into EXPLORE → INDEX — the
 * moment the peeking ABOUT tab used to be off the screen.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9357;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-tab-shot-profile',
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
  const byText = (re) => [...document.querySelectorAll('button, a')]
    .find(b => re.test((b.textContent||'').trim()));
  await sleep(9000);
  byText(/^explore$/i)?.click();
  await sleep(4000);
  byText(/^index$/i)?.click();
  return true;
})()`);

const shots = [];
for (const at of [250, 700, 1600]) {
  await sleep(at - (shots.at(-1)?.at ?? 0));
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 1240, y: 0, width: 200, height: 420, scale: 2 },
  });
  const file = `/tmp/about-tab-crossing-${at}ms.png`;
  if (s?.data) fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  shots.push({ at, file });
}

console.log(JSON.stringify(shots, null, 1));

ws.close();
chrome.kill();
