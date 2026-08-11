/**
 * The onboarding's two ways out — the sticky SKIP INTRO and the closing ENTER THE
 * ARCHIVE — compared side by side: computed font size, tracking, and the rendered
 * width of each label. Walks to the closing beat so both exist at once.
 *
 * Also reports the ENTER button's total width against the viewport at phone
 * widths, since the label is held on one line (`white-space: nowrap`) and can only
 * overflow rather than wrap.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9342;
const WIDTHS = [1440, 430, 390, 320];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/onboarding-cta-profile',
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

const MEASURE = `(() => {
  const read = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const span = el.querySelector('span') || el;
    const sb = span.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    return {
      text: (span.textContent || '').trim(),
      fontSizePx: parseFloat(cs.fontSize),
      letterSpacing: cs.letterSpacing,
      labelWidth: Math.round(sb.width),
      buttonWidth: Math.round(eb.width),
      overflowsViewport: eb.left < 0 || eb.right > window.innerWidth,
    };
  };
  const ctas = [...document.querySelectorAll('.onboarding-cta')];
  const skip = ctas.find((c) => /skip/i.test(c.textContent || ''));
  const enter = ctas.find((c) => /enter the archive/i.test(c.textContent || ''));
  return { viewport: window.innerWidth, skip: read(skip), enter: read(enter) };
})()`;

for (const width of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  // Walk to the closing beat, where ENTER exists (SKIP is still in the DOM,
  // faded out, so both can be measured together).
  await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    await sleep(7000);
    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await sleep(900);
    }
    await sleep(2600);
    return true;
  })()`);
  const m = await evaluate(MEASURE);
  const line = (name, r) =>
    r
      ? `   ${name.padEnd(6)} "${r.text}" ${String(r.fontSizePx).padStart(5)}px  tracking ${r.letterSpacing.padEnd(7)} label ${String(r.labelWidth).padStart(4)}px  button ${String(r.buttonWidth).padStart(4)}px${r.overflowsViewport ? '  ← OVERFLOWS VIEWPORT' : ''}`
      : `   ${name.padEnd(6)} not present`;
  console.log(`── viewport ${m.viewport}px`);
  console.log(line('skip', m.skip));
  console.log(line('enter', m.enter));
  if (m.enter && m.skip) {
    console.log(`   sizes match: ${m.enter.fontSizePx === m.skip.fontSizePx}`);
  }
  if (width === 1440 && m.enter) {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (s?.data) fs.writeFileSync('/tmp/onboarding-closing.png', Buffer.from(s.data, 'base64'));
  }
}

ws.close();
chrome.kill();
