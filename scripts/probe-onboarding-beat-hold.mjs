/**
 * The head and the tail of every onboarding beat, sampled off the live DOM.
 *
 * probe-onboarding-timing.mjs measures a cascade from its own first word, which
 * says nothing about the wait in FRONT of it. This one starts its clock at the
 * moment the beat is asked for (the keystroke that steps to it, or the page load
 * for the hero) and reports:
 *
 *   PASS A  per beat — when the copy block mounts, when its first word starts to
 *           fade, when the last word finishes, and when everything hung off those
 *           words arrives (the kicker's verbs and marks, ENTER THE ARCHIVE, the
 *           hero's scroll cue).
 *   PASS B  the same beats walked as fast as the piece allows — wheel events fired
 *           continuously, so SWIPE.graceMs is what paces it — recording how long
 *           each beat is actually on screen against how long its cascade needs.
 *           This is the cut-off check: dwell has to outlast the cascade.
 *
 * Motion animates on rAF, not through CSS transitions, so there is nothing to
 * read back off `style.transition` — every number here comes from watching
 * computed opacity frame by frame.
 *
 * REDUCE=1 runs pass A under prefers-reduced-motion, where the point is the
 * opposite one: the words are up on the frame the beat mounts, since a hold in
 * front of an animation that isn't going to play is just a stalled screen.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9347;

/** Beat name → a distinctive prefix of its copy → what it schedules after it. */
const BEATS = [
  ['hero', 'What do you have', ['scrollCue']],
  ['intro', 'We asked strangers', []],
  ['body', 'AI is entering', ['communicate', 'work', 'think', 'marks']],
  ['fragment', 'And even', []],
  ['closing', 'Every note is', ['enter']],
];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/onboarding-beat-hold-profile',
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

/* Shared in-page helpers: how a copy block and each downstream thing is found,
   and the opacity threshold that counts as "started to arrive". */
const HELPERS = `
  const RAF = () => new Promise((r) => requestAnimationFrame(r));
  const ON = 0.02;
  const host = (prefix) =>
    [...document.querySelectorAll('[aria-label]')].find((el) =>
      (el.getAttribute('aria-label') || '').trim().startsWith(prefix)
    ) || null;
  const words = (h) =>
    [...h.querySelectorAll('span[aria-hidden="true"]')].filter((s) => (s.textContent || '').trim());
  const verb = (root, t) =>
    [...root.querySelectorAll('div')].find(
      (d) => !d.children.length && (d.textContent || '').trim() === t
    ) || null;
  /* Everything here is scheduled AFTER a beat's words, so each is looked up
     inside that beat's own block wherever possible — a document-wide scan per
     frame is expensive enough on this page (the ascii field alone is thousands
     of nodes) to starve the sampler and smear the timings it is measuring. */
  const EXTRA = {
    scrollCue: () => {
      const s = [...document.querySelectorAll('span')].find((e) => (e.textContent || '').trim() === '\\u2193');
      return s ? s.parentElement : null;
    },
    communicate: (root) => verb(root, 'communicate'),
    work: (root) => verb(root, 'work'),
    think: (root) => verb(root, 'think'),
    // The kicker's ascii marks: absolutely-placed pre-formatted blocks whose
    // glyphs type on one span at a time.
    marks: (root) => {
      const block = [...root.querySelectorAll('div')].find((d) => {
        const cs = getComputedStyle(d);
        return cs.whiteSpace === 'pre' && cs.position === 'absolute' && d.querySelector('span');
      });
      if (!block) return null;
      return [...block.querySelectorAll('span')].find((s) => (s.textContent || '').trim()) || null;
    },
    enter: (root) =>
      [...root.querySelectorAll('.onboarding-cta')].find((c) =>
        /enter the archive/i.test(c.textContent || '')
      ) || null,
  };
  const lit = (el) => el && parseFloat(getComputedStyle(el).opacity) > ON;
`;

/**
 * One beat, clocked from the keystroke that asks for it. Steps first (except on
 * the hero, which the page load already put up), then watches until every word
 * has finished and every downstream thing has begun.
 */
const measure = (prefix, extras, timeoutMs, step) => `(async () => {
  ${HELPERS}
  const prefix = ${JSON.stringify(prefix)};
  const extras = ${JSON.stringify(extras)};
  const t0 = performance.now();
  ${step ? `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));` : ''}
  const deadline = t0 + ${timeoutMs};

  let h = null;
  let mount = null;
  while (!h && performance.now() < deadline) {
    h = host(prefix);
    if (h) mount = performance.now();
    else await RAF();
  }
  if (!h) return { error: 'copy block never appeared: ' + prefix };

  const spans = words(h);
  if (!spans.length) return { error: 'no word spans: ' + prefix };

  const root = h.parentElement;
  const started = new Map();
  const done = new Map();
  const at = {};
  const found = {};
  while (performance.now() < deadline) {
    const t = performance.now();
    for (const s of spans) {
      const o = parseFloat(getComputedStyle(s).opacity);
      if (!started.has(s) && o > ON) started.set(s, t);
      if (started.has(s) && !done.has(s) && o > 0.995) done.set(s, t);
    }
    // Nothing downstream can arrive before the copy does, so the search for it
    // only opens once the first word is up — and holds onto what it finds.
    for (const name of extras) {
      if (at[name] != null || !started.size) continue;
      if (!found[name]) found[name] = EXTRA[name](root);
      if (lit(found[name])) at[name] = t;
    }
    if (done.size === spans.length && extras.every((n) => at[n] != null)) break;
    await RAF();
  }
  if (!started.size) return { error: 'words never animated: ' + prefix };

  const s = (n) => (n == null ? null : Math.round(n - t0) / 1000);
  const starts = [...started.values()].sort((a, b) => a - b);
  const ends = [...done.values()].sort((a, b) => a - b);
  const after = {};
  for (const name of extras) after[name] = s(at[name]);
  return {
    words: spans.length,
    measured: done.size,
    mountS: s(mount),
    firstWordS: s(starts[0]),
    lastWordStartS: s(starts[starts.length - 1]),
    cascadeEndS: ends.length === spans.length ? s(ends[ends.length - 1]) : null,
    after,
  };
})()`;

/**
 * The whole sequence walked at the fastest rate the piece will accept: a wheel
 * notch every 120ms from the first frame, so SWIPE.graceMs is the only thing
 * pacing it. Records each beat's life and its cascade inside that life.
 */
const raceThrough = (timeoutMs) => `(async () => {
  ${HELPERS}
  const names = ${JSON.stringify(BEATS.map(([n]) => n))};
  const prefixes = ${JSON.stringify(BEATS.map(([, p]) => p))};
  const t0 = performance.now();
  const deadline = t0 + ${timeoutMs};
  const seen = prefixes.map(() => ({ mount: null, unmount: null, first: null, end: null, words: 0, done: 0 }));
  let lastWheel = 0;

  while (performance.now() < deadline) {
    const t = performance.now();
    if (t - lastWheel > 120) {
      lastWheel = t;
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true }));
    }
    prefixes.forEach((p, i) => {
      const rec = seen[i];
      const h = host(p);
      if (!h) {
        if (rec.mount != null && rec.unmount == null) rec.unmount = t;
        return;
      }
      if (rec.mount == null) rec.mount = t;
      const spans = words(h);
      rec.words = spans.length;
      let done = 0;
      for (const sp of spans) {
        const o = parseFloat(getComputedStyle(sp).opacity);
        if (o > ON && rec.first == null) rec.first = t;
        if (o > 0.995) done += 1;
      }
      if (done > rec.done) {
        rec.done = done;
        if (done === spans.length && rec.end == null) rec.end = t;
      }
    });
    // Nothing steps past the closing beat, so stop once its cascade has landed.
    if (seen[seen.length - 1].end != null) break;
    await RAF();
  }

  return names.map((name, i) => {
    const r = seen[i];
    const rel = (v) => (v == null ? null : Math.round(v - (r.mount ?? t0)) / 1000);
    return {
      name,
      words: r.words,
      holdS: rel(r.first),
      cascadeEndS: rel(r.end),
      dwellS: rel(r.unmount),
      exited: r.unmount != null,
    };
  });
})()`;

/* ── PASS A ─────────────────────────────────────────────────────────────── */
const REDUCE = !!process.env.REDUCE;
if (REDUCE) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
}
await send('Page.navigate', { url: BASE });

const f = (v, w = 5) => String(v == null ? '—' : v.toFixed ? v.toFixed(2) : v).padStart(w);
console.log(
  `\n── PASS A · one beat at a time, clocked from the step that asks for it${REDUCE ? '  (reduced motion)' : ''}`
);
console.log(
  `   ${'beat'.padEnd(9)} ${'words'.padStart(5)} ${'mount'.padStart(6)} ${'1st word'.padStart(9)} ` +
    `${'last starts'.padStart(11)} ${'cascade in'.padStart(11)}   after the words`
);
for (let i = 0; i < BEATS.length; i++) {
  const [name, prefix, extras] = BEATS[i];
  // The hero waits out the loader and the wordmark writing itself before its
  // question, so it is given far longer to report.
  const budget = i === 0 ? 22000 : 12000;
  const r = { name, ...(await evaluate(measure(prefix, extras, budget, i > 0))) };
  if (r.error) {
    console.log(`   ${name.padEnd(9)} ${r.error}`);
  } else {
    const tail = Object.entries(r.after || {})
      .map(([k, v]) => `${k} ${v == null ? '—' : v.toFixed(2)}s`)
      .join('  ');
    console.log(
      `   ${name.padEnd(9)} ${f(r.words, 5)} ${f(r.mountS, 6)}s ${f(r.firstWordS, 8)}s ` +
        `${f(r.lastWordStartS, 10)}s ${f(r.cascadeEndS, 10)}s   ${tail}`
    );
  }
  await sleep(400);
}

/* ── PASS B ─────────────────────────────────────────────────────────────── */
if (REDUCE) {
  ws.close();
  chrome.kill();
  process.exit(0);
}
await send('Page.navigate', { url: BASE });
await sleep(500);
const passB = await evaluate(raceThrough(30000));

console.log('\n── PASS B · swiped as fast as the piece allows (grace-limited)');
if (passB?.error) {
  console.log(`   ${passB.error}`);
} else {
  console.log(
    `   ${'beat'.padEnd(9)} ${'hold'.padStart(6)} ${'cascade in'.padStart(11)} ${'on screen'.padStart(10)}   headroom`
  );
  for (const r of passB) {
    const head = r.dwellS != null && r.cascadeEndS != null ? r.dwellS - r.cascadeEndS : null;
    const verdict = !r.exited
      ? 'held (last beat)'
      : head == null
        ? 'cascade never finished  ← CUT OFF'
        : `${head >= 0 ? '+' : ''}${head.toFixed(2)}s${head < 0 ? '  ← CUT OFF' : ''}`;
    console.log(
      `   ${r.name.padEnd(9)} ${f(r.holdS, 6)}s ${f(r.cascadeEndS, 10)}s ${f(r.dwellS, 9)}s   ${verdict}`
    );
  }
}

ws.close();
chrome.kill();
