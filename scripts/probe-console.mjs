/**
 * Whatever the page says on its way up: console entries and uncaught
 * exceptions, for a URL that is rendering nothing.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_ = process.env.URL || 'http://localhost:5191/?view=grid';
const PORT = 9300 + (process.pid % 89);
const PROFILE = `/tmp/probe-console-${process.pid}`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=${PROFILE}`,
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
const said = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    said.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    said.push(`EXCEPTION: ${d.exception?.description || d.text}`);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.navigate', { url: URL_ });
await sleep(9000);

const len = (
  await send('Runtime.evaluate', {
    expression: '(document.body.textContent||"").trim().length',
    returnByValue: true,
  })
)?.result?.value;

console.log(`\n═══ ${URL_} ═══`);
console.log(`  body text length: ${len}`);
said.slice(0, 25).forEach((s) => console.log(`  ${s}`));
if (!said.length) console.log('  (nothing logged)');
console.log('');

chrome.kill();
ws.close();
process.exit(0);
