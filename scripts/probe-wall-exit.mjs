/**
 * Does the confession field empty the way it filled?
 *
 * A sheet-like exit and a scattered one both end with an invisible wall, so the
 * end state proves nothing. What separates them is the middle: partway through a
 * scattered exit the words are at MANY different opacities, while a group fade
 * has every word at the same one, whatever that one is. So this samples a few
 * hundred words per frame and counts how many distinct opacities are on screen.
 *
 * The entrance is measured the same way and printed beside it, since the ask was
 * for the two to match.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9800 + (process.pid % 89);
const PROFILE = `/tmp/wall-exit-${process.pid}`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1280,860',
  '--force-device-scale-factor=1',
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
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params?.exceptionDetails?.text || 'exception');
  }
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
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.startScreencast', { format: 'jpeg', quality: 10, everyNthFrame: 60 });

/* A sample of word spans, fixed once so every frame reports the same words, and
   spread across the whole field rather than taken from the top — the exit is
   shuffled over the wall, and a sample from one corner could miss it. */
/* The window has to outlast the loader. The field mounts with every word at
   zero and does not begin writing until the hero's own gate opens, which is
   several seconds after the wall element first exists — a short window armed at
   mount expires before the reveal starts and reports a wall that never moved. */
const RECORDER = (windowMs) => `
  (() => {
    const wall = document.querySelector('div[aria-hidden="true"][style*="translateX(-50%)"]');
    if (!wall) return 'no wall';
    const all = [...wall.querySelectorAll('span')].filter((s) => s.textContent.trim());
    if (all.length < 50) return 'too few words: ' + all.length;
    const step = Math.max(1, Math.floor(all.length / 300));
    const sample = all.filter((_, i) => i % step === 0);
    /* Each recorder stamps itself, and an older loop retires as soon as a newer
       one takes over. Without this the entrance's long-running loop kept
       pushing frames into the exit's fresh record on its own start time, and
       the two interleaved timelines made the exit read as lasting a negative
       number of milliseconds. */
    const runId = (window.__wallRun = (window.__wallRun || 0) + 1);
    window.__wall = { pts: [], n: sample.length, id: runId };
    const t0 = performance.now();
    const step2 = () => {
      if (!window.__wall || window.__wall.id !== runId) return;
      const t = performance.now() - t0;
      const o = sample.map((s) => Number(getComputedStyle(s).opacity));
      window.__wall.pts.push({
        t,
        mean: o.reduce((a, b) => a + b, 0) / o.length,
        // Rounded to a twentieth: enough to tell "all the same" from "all over
        // the place" without counting float noise as variety.
        levels: new Set(o.map((v) => Math.round(v * 20))).size,
      });
      if (t < ${windowMs}) requestAnimationFrame(step2);
    };
    requestAnimationFrame(step2);
    return 'armed(' + sample.length + ')';
  })()
`;

const report = (label, pts) => {
  const busy = pts.filter((p) => p.mean > 0.02 && p.mean < 0.98);
  const peak = Math.max(...pts.map((p) => p.levels));
  const mid = busy.length ? busy[Math.floor(busy.length / 2)] : null;
  console.log(`  ${label}`);
  console.log(`    distinct opacities on screen: up to ${peak}`);
  if (mid) {
    console.log(
      `    halfway through: mean opacity ${mid.mean.toFixed(2)}, ${mid.levels} different levels`
    );
  }
  console.log(
    `    time spent partly-faded: ${
      busy.length ? Math.round(busy[busy.length - 1].t - busy[0].t) : 0
    }ms`
  );
  return peak;
};

console.log(`\n═══ CONFESSION WALL, IN AND OUT · ${BASE} ═══\n`);

/* Armed before the document exists, and then retried until the wall does.
   Waiting for the beats nav and arming after it was too late by seconds — the
   field had already finished writing itself, so the entrance measured as two
   opacity levels and no partly-faded time at all, which is exactly what a
   sheet-like fade would have looked like. */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (() => {
      const arm = () => {
        const r = (${RECORDER(14000)});
        if (typeof r === 'string' && r.startsWith('armed')) return;
        setTimeout(arm, 60);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arm);
      } else arm();
    })()
  `,
});

await send('Page.navigate', { url: `${BASE}/` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`!!document.querySelector('nav[aria-label="Beats"]')`)) break;
  await sleep(500);
}
// Long enough for the loader, the hero gate, and the full 2.4s scatter after it.
await sleep(9000);
const inPts = (await evaluate('window.__wall && window.__wall.pts')) || [];
const inPeak = report('coming in', inPts);

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

await evaluate(RECORDER(3200));
await pressDown();
await sleep(3200);
const outPts = (await evaluate('window.__wall && window.__wall.pts')) || [];
console.log('');
const outPeak = report('going out (beat 1 → 2)', outPts);

console.log('');
console.log(
  `  ${outPeak > 6 ? '✓' : '✗'} the field empties word by word, not as one sheet` +
    ` (${outPeak} levels at once; a group fade would show 1–2)`
);
console.log(
  `  ${outPeak >= inPeak * 0.4 ? '✓' : '✗'} the exit is as scattered as the entrance` +
    ` (${outPeak} out vs ${inPeak} in)`
);
if (errors.length) console.log(`  page errors: ${errors.slice(0, 3).join(' | ')}`);
console.log('');

chrome.kill();
ws.close();
process.exit(0);
