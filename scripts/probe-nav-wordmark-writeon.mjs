/**
 * The nav wordmark writing itself on, and only on the way in from the intro.
 *
 * Two claims, and they pull in opposite directions, which is why both are here:
 * arriving from the story the mark is the vector art being drawn stroke by
 * stroke, and arriving any other way it is the flat PNG that was always there,
 * having fetched none of the 1.6MB of path data.
 *
 * The write-on is measured by counting revealed strokes per frame rather than by
 * timing an element: each of the 31 masks cuts its stroke in at the moment the
 * pen touches down, so the count IS the progress. What the run should show is a
 * count climbing from 0 to 31 — if it jumps straight to 31 the art is being
 * placed rather than written, which is the failure worth catching.
 *
 * Also checked: the vector occupies the same box the PNG would, since the whole
 * swap rests on the two lockups sharing an aspect.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const WANTED = Number(process.env.PORT || 9600 + (process.pid % 97));
const PROFILE = `/tmp/nav-wordmark-${process.pid}`;

let PORT = null;
for (let i = 0; i < 12 && PORT == null; i++) {
  try {
    await fetch(`http://127.0.0.1:${WANTED + i}/json/version`);
  } catch {
    PORT = WANTED + i;
  }
}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,900',
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
const fetched = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params?.exceptionDetails?.text || 'exception');
  }
  if (m.method === 'Network.requestWillBeSent') fetched.push(m.params.request.url);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    const timer = setTimeout(() => {
      if (pending.has(n)) {
        pending.delete(n);
        resolve({ __timeout: method });
      }
    }, 20000);
    pending.set(n, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { __error: r.exceptionDetails.text };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.startScreencast', { format: 'jpeg', quality: 10, everyNthFrame: 60 });

/* Installed on the document, not started once the archive is up: the write-on
   begins with the nav's own fade and would be part-run by the time anything
   that had to notice the nav first got going. */
const RECORDER = `
  (() => {
    window.__wm = { frames: [], t0: performance.now() };
    const mark = () => {
      const btn = document.querySelector('button[aria-label^="What We Tell AI"]');
      if (btn) {
        const svg = btn.querySelector('svg');
        const img = btn.querySelector('img');
        const box = (svg || img)?.getBoundingClientRect();
        window.__wm.frames.push({
          t: performance.now() - window.__wm.t0,
          kind: svg ? 'svg' : img ? 'img' : 'none',
          // A stroke's mask path is cut in at opacity 1 the instant the pen
          // lands on it, so this counts pens down, not paths present.
          inked: svg
            ? [...svg.querySelectorAll('mask path')].filter(
                (p) => Number(p.style.opacity || getComputedStyle(p).opacity) > 0.5
              ).length
            : 0,
          masks: svg ? svg.querySelectorAll('mask').length : 0,
          w: box ? Math.round(box.width) : 0,
          h: box ? Math.round(box.height) : 0,
        });
      }
      requestAnimationFrame(mark);
    };
    requestAnimationFrame(mark);
  })()
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });

const KEYS = { ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 } };
async function pressKey(name) {
  const k = KEYS[name];
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: k.key,
      code: k.code,
      windowsVirtualKeyCode: k.vk,
      nativeVirtualKeyCode: k.vk,
    });
  }
}
async function swipe({ x = 60, y = 700, dy = -140, steps = 5 } = {}) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: Math.round(y + (dy * i) / steps), id: 1 }],
    });
    await sleep(14);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const BEAT = `(() => {
  const nav = document.querySelector('nav[aria-label="Beats"]');
  const dots = nav ? [...nav.querySelectorAll('button')] : [];
  return dots.findIndex((b) => b.getAttribute('aria-current') === 'step');
})()`;
const AT_INDEX = `document.querySelectorAll('.grid-tile').length > 0`;

async function walkTheStory() {
  for (let i = 0; i < 8; i++) {
    const b = await evaluate(BEAT);
    if (b >= 4) break;
    await pressKey('ArrowDown');
    await sleep(1500);
  }
  await sleep(2800);
  for (let i = 0; i < 5; i++) {
    await swipe();
    await sleep(1400);
    const out = await evaluate(
      `(${AT_INDEX}) || !document.querySelector('nav[aria-label="Beats"]')`
    );
    if (out) break;
  }
}

let passes = 0;
let failures = 0;
const ok = (claim, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${claim}${detail ? ` — ${detail}` : ''}`);
  cond ? passes++ : failures++;
};

console.log(`\n═══ NAV WORDMARK WRITE-ON · ${BASE} ═══\n`);

/* ── the way in that should write ──────────────────────────────────────── */
console.log('  onboarding → INDEX');
await send('Page.navigate', { url: `${BASE}/` });
await sleep(1200);
await walkTheStory();
await sleep(2600);

const story = await evaluate(`(() => {
  const f = window.__wm.frames;
  // Everything from the archive's own nav onward; the intro has no such button.
  const withMark = f.filter((x) => x.kind !== 'none');
  const svg = withMark.filter((x) => x.kind === 'svg');
  const first = svg.find((x) => x.inked > 0);
  const full = svg.find((x) => x.inked >= x.masks && x.masks > 0);
  const counts = [...new Set(svg.map((x) => x.inked))].sort((a, b) => a - b);

  /* The pen's pace, read off the frames where the stroke count went up. Frames
     are ~16ms apart so a single gap is coarse, but the question is whether the
     end runs slower than the start, and comparing the first third of the line
     against the last third is well clear of that noise. */
  const landings = [];
  // From the pen's first touch, not from the SVG appearing: the mark is mounted
  // and empty for the whole nav entrance delay before the run starts, and
  // counting that wait as the opening gap makes any schedule look front-loaded.
  let seen = 0;
  for (const f of svg) {
    if (f.inked > seen) {
      landings.push({ n: f.inked, t: f.t });
      seen = f.inked;
    }
  }
  const gaps = landings.slice(1).map((l, i) => l.t - landings[i].t);
  const third = Math.floor(gaps.length / 3) || 1;
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const early = mean(gaps.slice(0, third));
  const late = mean(gaps.slice(-third));

  return {
    early: Math.round(early),
    late: Math.round(late),
    ratio: early > 0 ? +(late / early).toFixed(1) : null,
    lastGap: gaps.length ? Math.round(gaps[gaps.length - 1]) : null,
    kinds: [...new Set(withMark.map((x) => x.kind))],
    masks: svg.length ? Math.max(...svg.map((x) => x.masks)) : 0,
    steps: counts.length,
    peak: svg.length ? Math.max(...svg.map((x) => x.inked)) : 0,
    firstInkT: first ? first.t : null,
    fullT: full ? full.t : null,
    drawMs: first && full ? Math.round(full.t - first.t) : null,
    box: svg.length ? { w: svg[svg.length - 1].w, h: svg[svg.length - 1].h } : null,
  };
})()`);

ok('the mark is the vector, not the PNG', story.kinds?.includes('svg'), `saw ${story.kinds}`);
ok('all 31 strokes are present', story.masks === 31, `${story.masks} masks`);
ok('every stroke gets inked', story.peak === story.masks, `${story.peak}/${story.masks}`);
ok(
  'it is written, not placed',
  story.steps > 8,
  `${story.steps} distinct stroke counts seen across the run`
);
console.log(
  `    pen down at ${Math.round(story.firstInkT)}ms after load · last stroke at ${Math.round(
    story.fullT
  )}ms · the writing itself took ${story.drawMs}ms`
);
console.log(
  `    pace: first third of the line ${story.early}ms between strokes · last third ${story.late}ms` +
    ` · ${story.ratio}× slower into the finish (final gap ${story.lastGap}ms)`
);
ok('the hand slows into the end of the line', story.ratio >= 2, `${story.ratio}×`);
console.log(`    box ${story.box?.w}×${story.box?.h}px`);
ok('sits at the nav height', story.box?.h === 26, `${story.box?.h}px tall`);
ok(
  'occupies the same width the PNG would',
  Math.abs(story.box?.w - 26 * (2461 / 456)) <= 1,
  `${story.box?.w}px vs ${Math.round(26 * (2461 / 456))}px`
);

/* ── the ways in that should not ───────────────────────────────────────── */
console.log('\n  /?view=grid deep link');
fetched.length = 0;
await send('Page.navigate', { url: `${BASE}/?view=grid` });
await sleep(5000);
const deep = await evaluate(`(() => {
  const f = window.__wm.frames.filter((x) => x.kind !== 'none');
  return { kinds: [...new Set(f.map((x) => x.kind))], n: f.length };
})()`);
ok('the mark is the flat PNG', deep.kinds?.length === 1 && deep.kinds[0] === 'img', `${deep.kinds}`);
ok(
  'the 1.6MB of path data is never fetched',
  !fetched.some((u) => u.includes('wwtai_2.svg')),
  `${fetched.filter((u) => u.includes('wwtai')).length} wordmark requests`
);

console.log(`\n  ${failures === 0 ? '✓ all good' : `✗ ${failures} failed`} · ${passes} passed`);
if (errors.length) console.log(`  page errors: ${errors.slice(0, 4).join(' | ')}`);
console.log('');

chrome.kill();
ws.close();
process.exit(failures === 0 ? 0 : 1);
