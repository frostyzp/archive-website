/**
 * Is anything left of the ascii marks on the kicker beat?
 *
 * Walks the beats until the one carrying "communicate" is up, waits past the
 * point where the marks would have typed on and started looping, then reads the
 * kicker block's own text. If the marks are off, that text is the three verbs
 * and nothing else.
 *
 * Also samples it twice a second apart: a running motif rewrites its glyphs, so
 * text that changes between reads means something is still animating even if it
 * looks quiet in a single frame.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9700 + (process.pid % 40);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/kicker-marks-${process.pid}`,
  '--window-size=1440,900',
  '--force-device-scale-factor=2',
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
await send('Page.navigate', { url: `${BASE}/` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`!!document.querySelector('nav[aria-label="Beats"]')`)) break;
  await sleep(500);
}
await sleep(1500);

const pressDown = async () => {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'ArrowDown',
      code: 'ArrowDown',
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 40,
    });
  }
};

const KICKER = `
  (() => {
    const el = [...document.querySelectorAll('main div')].find((d) =>
      /communicate/.test(d.textContent || '') && d.style.maxWidth === '620px');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      text: (el.textContent || '').trim(),
      // Marks are the aria-hidden absolutely-placed blocks; the verbs are not.
      markNodes: el.querySelectorAll('[aria-hidden="true"]').length,
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
  })()
`;

let found = null;
for (let i = 0; i < 8 && !found; i++) {
  await pressDown();
  await sleep(1600);
  found = await evaluate(KICKER);
}

console.log(`\n═══ KICKER MARKS · ${BASE} ═══\n`);
if (!found) {
  console.log('  never reached the beat carrying "communicate"\n');
} else {
  /* Past asciiType (1750ms) and asciiIdle (2400ms), plus the beat's own hold. */
  await sleep(4000);
  const a = await evaluate(KICKER);
  await sleep(1000);
  const b = await evaluate(KICKER);

  console.log(`  kicker text        "${a.text}"`);
  console.log(`  aria-hidden marks  ${a.markNodes}`);
  console.log(`  text 1s later      "${b.text}"`);

  const onlyVerbs = /^communicate\s*work\s*think$/i.test(a.text.replace(/\s+/g, ' ').trim());
  const still = a.text === b.text;
  console.log(`\n  ${onlyVerbs ? '✓' : '✗'} nothing but the three verbs`);
  console.log(`  ${still ? '✓' : '✗'} nothing rewriting itself between frames`);

  const clip = {
    x: Math.max(0, a.box.x - 30),
    y: Math.max(0, a.box.y - 70),
    width: a.box.w + 60,
    height: a.box.h + 100,
    scale: 2,
  };
  const shot = await send('Page.captureScreenshot', { format: 'png', clip });
  if (shot?.data) {
    writeFileSync('scripts/kicker-marks.png', Buffer.from(shot.data, 'base64'));
    console.log('\n  crop → scripts/kicker-marks.png');
  }
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
