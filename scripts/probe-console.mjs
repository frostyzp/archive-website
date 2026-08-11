/** Loads the page and prints whatever the console and Vite complain about. */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9600 + (process.pid % 83);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/console-profile-${process.pid}`,
  '--window-size=1440,900',
  'about:blank',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page = null;
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
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push(`[throw] ${d.text} ${d.exception?.description || ''}`);
  }
  if (m.method === 'Log.entryAdded') logs.push(`[log:${m.params.entry.level}] ${m.params.entry.text}`);
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: BASE });
await sleep(6000);
const r = await send('Runtime.evaluate', {
  expression: `({ imgs: document.querySelectorAll('img').length, root: (document.getElementById('root')||{}).childElementCount, body: document.body.innerText.slice(0, 300) })`,
  returnByValue: true,
});
console.log(JSON.stringify(r?.result?.value, null, 2));
console.log(logs.length ? logs.join('\n') : '(no console output)');
chrome.kill();
process.exit(0);
