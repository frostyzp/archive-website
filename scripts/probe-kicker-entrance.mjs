/**
 * Checks that BodyKicker's verbs still ARRIVE the way they did after their resting
 * places moved: samples each verb's opacity, rotation and vertical travel every
 * 100ms through the entrance, so the stagger between the three and the untilt each
 * one settles out of can be read off as a sequence.
 *
 * Framer Motion animates on rAF rather than with a CSS transition, so the rotation
 * is recovered from the computed matrix on each sample instead of from any
 * transition property. `left` is printed alongside it: the placement is not part of
 * the transform, and should hold still while the transform runs.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9379;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/kicker-entrance-profile',
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE });

const samples = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const NAMES = ['communicate', 'work', 'think'];
  const leaf = (t) => [...document.querySelectorAll('div')].find(
    (d) => d.children.length === 0 && (d.textContent || '').trim() === t
  );
  // Walk to the BODY beat; forward keys are ignored while the loader holds.
  for (let i = 0; i < 40 && !leaf('communicate'); i++) {
    if (!/changing how we/.test(document.body.innerText)) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
    await sleep(700);
  }
  const t0 = performance.now();
  const out = [];
  for (let i = 0; i < 26; i++) {
    out.push({
      ms: Math.round(performance.now() - t0),
      verbs: NAMES.map((n) => {
        const el = leaf(n);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
        return {
          o: Math.round(parseFloat(cs.opacity) * 100) / 100,
          deg: Math.round(Math.atan2(m.b, m.a) * (180 / Math.PI) * 10) / 10,
          y: Math.round(m.f * 10) / 10,
          left: cs.left,
        };
      }),
    });
    await sleep(100);
  }
  return out;
})()`);

console.log('ms      communicate            work                   think');
for (const s of samples) {
  const cell = (v) => (v ? `o${String(v.o).padEnd(4)} ${String(v.deg).padStart(6)}° y${String(v.y).padStart(5)}` : '—');
  console.log(String(s.ms).padStart(5), s.verbs.map(cell).map((c) => c.padEnd(22)).join(' '));
}
console.log('\nleft (placement, should not move):', samples.at(-1).verbs.map((v) => v && v.left).join('  '));

ws.close();
chrome.kill();
