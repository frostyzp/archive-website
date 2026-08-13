/**
 * How many themes does the dial actually carry?
 *
 * Reads the explore view's category counter, which renders as "01 / NN", so the
 * intro copy can state a number that matches what the dial will show.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9580 + (process.pid % 40);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/theme-count-${process.pid}`,
  '--window-size=1440,900',
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
await send('Page.navigate', { url: `${BASE}/?view=explore` });
await sleep(6000);

const out = await evaluate(`
  (() => {
    const text = document.body.innerText || '';
    const counter = text.match(/\\b0?\\d+\\s*\\/\\s*0?(\\d+)\\b/);
    // Every theme on the wheel renders through formatCategoryLabel as "[ NAME ]".
    const labels = [...new Set(
      [...document.querySelectorAll('span, div')]
        .map((el) => (el.children.length ? '' : (el.textContent || '').trim()))
        .filter((t) => /^\\[\\s*[A-Z][A-Z \\-]*\\s*\\]$/.test(t))
    )];
    return { counter: counter ? counter[0] : null, total: counter ? Number(counter[1]) : null, labels };
  })()
`);

console.log(`\n═══ THEMES ON THE DIAL · ${BASE} ═══\n`);
console.log(`  counter reads      ${out.counter ?? 'not found'}`);
console.log(`  themes             ${out.total ?? '?'}`);
console.log(`  labels on screen   ${out.labels.length ? out.labels.join('  ') : 'none matched'}`);
console.log('');

chrome.kill();
ws.close();
process.exit(0);
