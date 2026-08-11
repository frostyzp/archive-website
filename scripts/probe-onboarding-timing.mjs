/**
 * How long each onboarding beat's copy actually takes to fade in, sampled off the
 * live DOM. Motion animates on rAF rather than through CSS transitions, so there
 * is no declared duration to read back — this watches every word span's opacity
 * frame by frame and records when each one starts and finishes, then reports the
 * cascade: per-word fade, gap between words, and end to end.
 *
 * Timings are relative to the FIRST word starting, so they don't include the
 * render latency between a swipe and the beat mounting.
 *
 * Reduced motion is deliberately not emulated — that path zeroes every duration.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9341;

/** Beat name → a distinctive prefix of its copy, to find the right container. */
const BEATS = [
  ['hero (opening question)', 'What do you have'],
  ['intro', 'We asked strangers'],
  ['body', 'AI is entering'],
  ['fragment', 'And even'],
  ['closing', 'Every note is'],
];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/onboarding-timing-profile',
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
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r?.exceptionDetails) return { error: r.exceptionDetails.text };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

/** Watches the words of the block whose aria-label starts with `prefix`. */
const track = (prefix, timeoutMs) => `(async () => {
  const prefix = ${JSON.stringify(prefix)};
  const findWords = () => {
    const host = [...document.querySelectorAll('[aria-label]')].find((el) =>
      (el.getAttribute('aria-label') || '').trim().startsWith(prefix)
    );
    if (!host) return null;
    const spans = [...host.querySelectorAll('span[aria-hidden="true"]')]
      .filter((s) => (s.textContent || '').trim());
    return spans.length ? spans : null;
  };

  const deadline = performance.now() + ${timeoutMs};
  let spans = null;
  while (!spans && performance.now() < deadline) {
    spans = findWords();
    if (!spans) await new Promise((r) => requestAnimationFrame(r));
  }
  if (!spans) return { error: 'copy block never appeared: ' + prefix };

  const started = new Map();
  const done = new Map();
  while (performance.now() < deadline) {
    const t = performance.now();
    for (const s of spans) {
      const o = parseFloat(getComputedStyle(s).opacity);
      if (!started.has(s) && o > 0.02) started.set(s, t);
      if (started.has(s) && !done.has(s) && o > 0.995) done.set(s, t);
    }
    if (done.size === spans.length) break;
    await new Promise((r) => requestAnimationFrame(r));
  }
  if (!started.size) return { error: 'words never animated: ' + prefix };

  const t0 = Math.min(...started.values());
  const starts = spans.filter((s) => started.has(s)).map((s) => started.get(s) - t0).sort((a, b) => a - b);
  const ends = spans.filter((s) => done.has(s)).map((s) => done.get(s) - t0).sort((a, b) => a - b);
  // Median gap between consecutive word starts, in case a frame is dropped.
  const gaps = starts.slice(1).map((v, i) => v - starts[i]).filter((g) => g > 1).sort((a, b) => a - b);
  const s = (n) => Math.round(n) / 1000;
  return {
    words: spans.length,
    measured: done.size,
    staggerS: gaps.length ? s(gaps[Math.floor(gaps.length / 2)]) : null,
    perWordFadeS: ends.length ? s(ends[0] - starts[0]) : null,
    lastWordStartsS: s(starts[starts.length - 1]),
    totalS: ends.length === spans.length ? s(ends[ends.length - 1]) : null,
  };
})()`;

await send('Page.navigate', { url: BASE });

const results = [];
for (let i = 0; i < BEATS.length; i++) {
  const [name, prefix] = BEATS[i];
  if (i > 0) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  }
  // Beat 0 waits out the loader and the wordmark write-on before its question.
  results.push({ name, ...(await evaluate(track(prefix, i === 0 ? 20000 : 9000))) });
  await sleep(300);
}

for (const r of results) {
  if (r.error) {
    console.log(`${r.name.padEnd(24)} ${r.error}`);
    continue;
  }
  console.log(
    `${r.name.padEnd(24)} ${String(r.words).padStart(2)} words  ` +
      `stagger ${String(r.staggerS).padEnd(6)}s  fade ${String(r.perWordFadeS).padEnd(5)}s  ` +
      `last word starts ${String(r.lastWordStartsS).padEnd(5)}s  →  all in by ${r.totalS}s`
  );
}

ws.close();
chrome.kill();
