/**
 * The closing cta's measured box and hit area, at 1440 and 390 wide. Run before
 * and after the label removal (TAG=before / TAG=after) to compare.
 *
 * Throwaway; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9380;
const TAG = process.env.TAG || 'run';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/cta-box-profile',
  '--window-size=1440,900',
  '--force-device-scale-factor=1',
  'about:blank',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) return p;
    } catch {}
    await sleep(100);
  }
  throw new Error('no target');
}
const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { __error: r.exceptionDetails.text };
  return r?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');

const BOX = `(() => {
  const cta = [...document.querySelectorAll('.onboarding-cta')].find((c) =>
    /enter the archive/i.test(c.getAttribute('aria-label') || '')
  );
  if (!cta) return null;
  const r = cta.getBoundingClientRect();
  const cs = getComputedStyle(cta);
  const arrow = [...cta.querySelectorAll('span')].find((s) => (s.textContent||'').trim() === '\\u2193' && s.children.length === 0);
  const text = (cta.textContent || '').replace(/\\u2193/g, '').trim();
  const dashed = [...cta.querySelectorAll('*')].filter((e) => /repeating-linear|dotted|dashed/.test(getComputedStyle(e).backgroundImage + getComputedStyle(e).borderBottomStyle)).length;
  const slot = cta.closest('div').parentElement;
  const sr = slot ? slot.getBoundingClientRect() : null;
  return {
    vw: innerWidth, vh: innerHeight,
    box: { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1) },
    centreOffsetPx: +(r.x + r.width / 2 - innerWidth / 2).toFixed(2),
    bottomGapPx: +(innerHeight - r.bottom).toFixed(1),
    visibleText: text,
    hasText: text.length > 0,
    dashedRules: dashed,
    fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, padding: cs.padding, whiteSpace: cs.whiteSpace,
    arrow: arrow ? (() => { const ar = arrow.getBoundingClientRect(); return {
      w: +ar.width.toFixed(1), h: +ar.height.toFixed(1),
      centreOffsetPx: +(ar.x + ar.width / 2 - innerWidth / 2).toFixed(2),
      offsetInButtonPx: +(ar.x + ar.width / 2 - (r.x + r.width / 2)).toFixed(2),
      fontSize: getComputedStyle(arrow).fontSize, letterSpacing: getComputedStyle(arrow).letterSpacing,
    }; })() : null,
    slotBottomGapPx: sr ? +(innerHeight - sr.bottom).toFixed(1) : null,
    label: (() => {
      const l = [...cta.querySelectorAll('span')].find((s) => /[A-Za-z]/.test(s.textContent || ''));
      if (!l) return null;
      const lr = l.getBoundingClientRect();
      const lcs = getComputedStyle(l);
      return { w: +lr.width.toFixed(1), h: +lr.height.toFixed(1), bg: lcs.backgroundImage.slice(0, 60), text: (l.textContent||'').trim() };
    })(),
  };
})()`;

const key = async (k, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};

for (const [w, h] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  await sleep(8500);
  for (let i = 0; i < 4; i++) { await key('ArrowDown', 40); await sleep(1600); }
  await sleep(3200);
  const b = await evaluate(BOX);
  console.log(`[${TAG}] ${w}×${h}`);
  console.log(JSON.stringify(b, null, 1));
}

ws.close();
chrome.kill();
