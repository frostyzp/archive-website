/**
 * Which entrance the INDEX flies, by route.
 *
 * The wall now has two readings — the nearest-edge fly-in it has always had,
 * and the rise out of one point low in the middle that the onboarding's closing
 * beat hands over to. The whole point of the change is that the second one is
 * reserved: it is the story's own sentence finishing, and every other way into
 * the grid has to look exactly as it did before. That is not something a
 * screenshot can settle, so this measures it.
 *
 * Per route, per tile: where it was on the frame it started moving, how wide it
 * was there against how wide it ends up, and how far it travelled. A rise tile
 * launches from below the bottom edge, pulled in toward the middle of the
 * screen, at better than twice its own size. An edge tile launches fully
 * outside exactly one edge at its own size. The two are not confusable, which
 * is what makes this a gate test rather than a taste test.
 *
 * Routes covered: the onboarding walked end to end, SKIP INTRO, the /?view=grid
 * deep link, explore → INDEX, and reduced motion. Widths are also reported at a
 * phone width and a wide desktop, since the origin is viewport-relative and the
 * column count is not.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const WANTED = Number(process.env.PORT || 9500 + (process.pid % 97));
const PROFILE = `/tmp/grid-entrance-gate-${process.pid}`;

let PORT = null;
for (let i = 0; i < 12 && PORT == null; i++) {
  try {
    await fetch(`http://127.0.0.1:${WANTED + i}/json/version`);
  } catch {
    PORT = WANTED + i;
  }
}
if (PORT == null) throw new Error(`no free debugging port near ${WANTED}`);

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
const consoleErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params?.exceptionDetails?.text || 'exception');
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description).join(' '));
  }
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
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
/* Headless backgrounds a page it is not showing anyone, and a backgrounded page
   stops servicing requestAnimationFrame — which stops Motion, and stops the
   entrance dead at `parked` with every tile still at its resting transform. The
   symptom looks exactly like a broken entrance, so: a live screencast, which is
   the cheapest thing that keeps the compositor producing frames, and focus
   emulation so nothing else can take the page's visibility away mid-run. */
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.startScreencast', { format: 'jpeg', quality: 10, everyNthFrame: 60 });

/* The recorder is installed on the document rather than started by hand once
   the grid is up. The launch frame is the one measurement that matters here and
   it lands three frames after GridView mounts; anything that has to notice the
   mount first has already missed it. */
const RECORDER = `
  (() => {
    window.__rec = { t0: null, vw: 0, vh: 0, frames: [], ids: null };
    const loop = () => {
      const tiles = [...document.querySelectorAll('.grid-tile')];
      if (tiles.length) {
        if (window.__rec.t0 == null) {
          window.__rec.t0 = performance.now();
          window.__rec.vw = innerWidth;
          window.__rec.vh = innerHeight;
        }
        const t = performance.now() - window.__rec.t0;
        if (t < 4200) {
          /* Only the head of the wall: the entrance flies what is on screen at
             mount, which is always the first rows in document order, and reading
             all 165 rects per frame costs more layout than the flight does. */
          const head = tiles.slice(0, 30);
          window.__rec.frames.push([
            Math.round(t),
            head.length,
            head.map((el) => {
              const r = el.getBoundingClientRect();
              return [
                Math.round(r.left + r.width / 2),
                Math.round(r.top + r.height / 2),
                Math.round(r.width),
              ];
            }),
          ]);
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })();
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });

/* ── input ─────────────────────────────────────────────────────────────── */

const KEYS = { ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 } };
async function pressKey(name) {
  const k = KEYS[name];
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.vk,
    nativeVirtualKeyCode: k.vk,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.vk,
    nativeVirtualKeyCode: k.vk,
  });
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
async function waitFor(expr, label, timeoutMs = 40000) {
  const t0 = Date.now();
  for (;;) {
    if (await evaluate(`!!(${expr})`)) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}
/* The nav words are set a letter at a time (see letterScatter), so they are
   matched on their text with every scrap of whitespace taken out rather than on
   a tidy label. */
const clickText = (needle) => `(() => {
  const flat = (e) => (e.textContent || '').replace(/\\s+/g, '').toLowerCase();
  const el = [...document.querySelectorAll('button, a')].find((b) => flat(b) === '${needle}');
  if (!el) return false;
  el.click();
  return true;
})()`;

/* ── analysis ──────────────────────────────────────────────────────────── */

/**
 * Per tile: the pose on the frame it first moved, the pose it ended at, and the
 * distance covered. Frames are dropped if the tile count changed under them (a
 * note whose scan 404s is pulled out of the wall mid-entrance), so a route is
 * measured against one stable wall or not at all.
 */
function readLaunch(rec) {
  if (!rec || !rec.frames?.length) return null;
  const n = rec.frames[rec.frames.length - 1][1];
  const frames = rec.frames.filter((f) => f[1] === n);
  if (frames.length < 4) return null;
  const last = frames[frames.length - 1][2];
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const home = last[i];
    /* The launch pose is the frame the tile is furthest from the cell it ends
       up in, not the first frame it is seen to move on: the recorder starts
       while the wall is still being measured, so the opening frames of every
       route are the tiles sitting at rest, and a tile "first moves" when it is
       written to its launch rather than when it leaves it. */
    let at = -1;
    let far = 2;
    for (let f = 0; f < frames.length; f++) {
      const p = frames[f][2][i];
      const d = Math.hypot(p[0] - home[0], p[1] - home[1]);
      if (d > far) {
        far = d;
        at = f;
      }
    }
    if (at < 0) continue; // never left its cell — below the fold, out of the study
    const launch = frames[at][2][i];
    let travelX = 0;
    let travelY = 0;
    let widest = 0;
    for (let f = at; f < frames.length; f++) {
      travelX += Math.abs(frames[f][2][i][0] - frames[f - 1 < at ? at : f - 1][2][i][0]);
      travelY += Math.abs(frames[f][2][i][1] - frames[f - 1 < at ? at : f - 1][2][i][1]);
      if (frames[f][2][i][2] > widest) widest = frames[f][2][i][2];
    }
    tiles.push({
      i,
      launch: { x: launch[0], y: launch[1], w: launch[2] },
      widest,
      home: { x: home[0], y: home[1], w: home[2] },
      travel: { x: Math.round(travelX), y: Math.round(travelY) },
    });
  }
  return { vw: rec.vw, vh: rec.vh, count: n, tiles };
}

/**
 * Which reading the numbers describe, decided on which edge each tile parks
 * outside of. Both entrances start their tiles wholly off the screen, so being
 * off it says nothing; WHICH way off it says everything. The rise comes from one
 * point below the bottom, so every tile parks under the bottom edge and none
 * anywhere else. The edge fly-in sends each tile to its own nearest edge, which
 * on a first screenful is necessarily several different ones — the top row's
 * nearest edge is the top.
 *
 * Size used to be the discriminator, since the rise launched at better than
 * twice a tile. It no longer changes size at all, and a tile tilted 24° reports
 * a bounding box 1.32× its own width whatever its scale, so growth is now only
 * reported — the 1.5 threshold sits above that rotation and below any real
 * scaling, so it still catches a scale coming back by accident.
 */
function classify(r) {
  if (!r || !r.tiles.length) return { mode: 'none' };
  const outside = (t) => {
    const half = t.launch.w / 2;
    const sides = [];
    if (t.launch.y - half > r.vh) sides.push('bottom');
    if (t.launch.y + half < 0) sides.push('top');
    if (t.launch.x + half < 0) sides.push('left');
    if (t.launch.x - half > r.vw) sides.push('right');
    return sides;
  };
  const grew = r.tiles.filter((t) => t.widest > t.home.w * 1.5).length;
  const below = r.tiles.filter((t) => outside(t).includes('bottom')).length;
  const inward = r.tiles.filter(
    (t) => Math.abs(t.launch.x - r.vw / 2) < Math.abs(t.home.x - r.vw / 2) + 2
  ).length;
  const offEdge = r.tiles.filter((t) => outside(t).length > 0).length;
  const sides = new Set(r.tiles.flatMap(outside));
  const n = r.tiles.length;
  const mode =
    below === n && sides.size === 1
      ? 'rise'
      : offEdge === n && sides.size > 1
        ? 'edge'
        : 'mixed';
  return { mode, grew, below, inward, offEdge, sides: [...sides].sort(), n };
}

const mean = (a, f) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0);

function report(label, r) {
  if (!r) {
    console.log(`  ${label.padEnd(26)} nothing flew`);
    return { mode: 'none' };
  }
  const c = classify(r);
  const w = mean(r.tiles, (t) => t.widest / t.home.w);
  console.log(
    `  ${label.padEnd(26)} ${String(c.mode).padEnd(6)} · ${String(r.tiles.length).padStart(
      2
    )} tiles flew of ${r.count} · widest ${Math.round(
      mean(r.tiles, (t) => t.widest)
    )}px vs ${Math.round(mean(r.tiles, (t) => t.home.w))}px home (${w.toFixed(2)}×)`
  );
  console.log(
    `  ${' '.repeat(26)} launched below ${(
      mean(r.tiles, (t) => t.launch.y) / r.vh
    ).toFixed(2)}vh · mean |dx| ${Math.round(
      mean(r.tiles, (t) => t.travel.x)
    )}px · |dy| ${Math.round(mean(r.tiles, (t) => t.travel.y))}px · pulled inward ${c.inward}/${
      c.n
    } · off an edge ${c.offEdge}/${c.n}`
  );
  return c;
}

let passes = 0;
let failures = 0;
function ok(claim, cond, detail = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${claim}${detail ? ` — ${detail}` : ''}`);
  if (cond) passes += 1;
  else failures += 1;
}

/* ── routes ────────────────────────────────────────────────────────────── */

async function openAt(url, { width = 1440, height = 900, reduce = false } = {}) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }],
  });
  await send('Page.navigate', { url: `${BASE}${url}` });
  await sleep(600);
}

const readRec = () => evaluate('window.__rec');

const BEAT = `(() => {
  const nav = document.querySelector('nav[aria-label="Beats"]');
  const dots = nav ? [...nav.querySelectorAll('button')] : [];
  return dots.findIndex((b) => b.getAttribute('aria-current') === 'step');
})()`;
const AT_INDEX = `document.querySelectorAll('.grid-tile').length > 0`;
const SKIP_LINK = `(() => {
  const a = document.querySelector('a.onboarding-cta');
  if (!a) return false;
  a.click();
  return true;
})()`;

/**
 * Forward to the closing beat and then out of the piece.
 *
 * Stepped by reading the dots rather than by counting presses: the first
 * forward gesture of a session is spent on the loading gate, and a fixed count
 * either stops a beat short or leans on that gate never changing. The exit is
 * retried past the 1250ms grace, since the way out is only offered once the
 * closing arrow has faded up at enterDelayS.
 */
async function walkTheStory() {
  for (let i = 0; i < 8; i++) {
    const b = await evaluate(BEAT);
    process.stderr.write(`    · beat ${JSON.stringify(b)}\n`);
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
    process.stderr.write(`    · swipe ${i} → left ${JSON.stringify(out)}\n`);
    if (out) break;
  }
}

/* A route can be run on its own — ROUTES=explore, say. Six full walks through
   the story in one browser is enough page churn that the renderer has been seen
   to fall over on the fourth, and a run that cannot be narrowed is a run that
   cannot be trusted when it does. */
const WANT = new Set(
  (process.env.ROUTES || 'story,skip,deep,explore,phone,wide,reduced').split(',')
);
const want = (k) => WANT.has(k);

console.log(`\n═══ WHICH ENTRANCE, BY ROUTE · ${BASE} ═══\n`);
const seen = {};

if (want('story')) {
  console.log('  onboarding → INDEX, walked end to end');
  await openAt('/');
  await walkTheStory();
  await waitFor(AT_INDEX, 'the index');
  await sleep(3200);
  seen.story = report('closing beat', readLaunch(await readRec()));
  /* Everything else that hangs off the entrance's clock, read once the rise has
     landed: the lattice, the hover arming, the count in the header, the chrome
     and the rail the retimed delays carry, and the scrolling the flight took
     away. A rise that flies but leaves the grid inert is not the entrance
     working. */
  seen.after = await evaluate(`(() => {
    const grid = document.querySelector('.confession-grid');
    const scroller = grid?.closest('[style*="overflow"]') || grid?.parentElement?.parentElement;
    return {
      live: !!document.querySelector('.confession-grid.is-live'),
      lattice: [...document.querySelectorAll('.grid-lattice-line')].filter(
        (el) => +getComputedStyle(el).opacity > 0.05
      ).length,
      scrollY: scroller ? getComputedStyle(scroller).overflowY : 'gone',
      search: !!document.querySelector('input'),
      count: (document.body.innerText.match(/\\b\\d+\\s+(notes?|confessions?)\\b/i) || [null])[0],
    };
  })()`);
  console.log(
    `  ${' '.repeat(26)} after it lands · grid live ${seen.after.live} · lattice ${
      seen.after.lattice
    } strokes · scroll ${seen.after.scrollY} · rail ${seen.after.search ? 'up' : 'missing'} · ${
      seen.after.count || 'no count read'
    }`
  );
}

if (want('skip')) {
  console.log('\n  SKIP INTRO → INDEX');
  await openAt('/');
  await sleep(1400);
  await evaluate(SKIP_LINK);
  await waitFor(AT_INDEX, 'the index');
  await sleep(3200);
  seen.skip = report('skip intro', readLaunch(await readRec()));
}

if (want('deep')) {
  console.log('\n  /?view=grid deep link');
  await openAt('/?view=grid');
  await waitFor(AT_INDEX, 'the index');
  await sleep(3200);
  seen.deep = report('deep link', readLaunch(await readRec()));
}

if (want('explore')) {
  console.log('\n  explore → INDEX (after arriving by the story)');
  await openAt('/');
  await walkTheStory();
  await waitFor(AT_INDEX, 'the index');
  await sleep(3400);
  process.stderr.write(`    · explore ${JSON.stringify(await evaluate(clickText('explore')))}\n`);
  await sleep(2600);
  // The recorder only ever times from the first grid it sees, so it is
  // restarted for the return trip — the index it measures has to be the one
  // being replayed, not the one that was flown out of.
  await evaluate('window.__rec = null');
  await evaluate(RECORDER);
  process.stderr.write(`    · index ${JSON.stringify(await evaluate(clickText('index')))}\n`);
  await waitFor(AT_INDEX, 'the index again');
  await sleep(3200);
  seen.explore = report('explore → index', readLaunch(await readRec()));
}

if (want('phone')) {
  console.log('\n  the rise at 390×844 · 2 columns');
  await openAt('/', { width: 390, height: 844 });
  await walkTheStory();
  await waitFor(AT_INDEX, 'the index');
  await sleep(3200);
  seen.phone = report('390×844', readLaunch(await readRec()));
}

if (want('wide')) {
  console.log('\n  the rise at 2100×1200 · 5 columns');
  await openAt('/', { width: 2100, height: 1200 });
  await walkTheStory();
  await waitFor(AT_INDEX, 'the index');
  await sleep(3200);
  seen.wide = report('2100×1200', readLaunch(await readRec()));
}

let rm = null;
let rmSettled = null;
if (want('reduced')) {
  console.log('\n  reduced motion, out of the story');
  await openAt('/', { reduce: true });
  await sleep(1400);
  await evaluate(SKIP_LINK);
  await waitFor(AT_INDEX, 'the index');
  await sleep(1800);
  rm = readLaunch(await readRec());
  rmSettled = await evaluate(`(() => {
    const t = [...document.querySelectorAll('.grid-tile')].slice(0, 12);
    const off = t.filter((el) => {
      const tr = getComputedStyle(el).transform;
      const m = new DOMMatrixReadOnly(tr === 'none' ? '' : tr);
      return Math.abs(m.e) > 0.5 || Math.abs(m.f) > 0.5 || Math.abs(m.a - 1) > 0.01;
    }).length;
    return {
      sampled: t.length,
      transformed: off,
      live: !!document.querySelector('.confession-grid.is-live'),
      lit: t.filter((el) => +getComputedStyle(el).opacity > 0.99).length,
    };
  })()`);
  console.log(
    `  ${'reduced motion'.padEnd(26)} ${rm ? `${rm.tiles.length} tiles moved` : 'nothing flew'} · ${
      rmSettled.transformed
    }/${rmSettled.sampled} still hold a transform · ${rmSettled.lit}/${
      rmSettled.sampled
    } fully lit · grid live ${rmSettled.live}`
  );
}

/* ── the claims ────────────────────────────────────────────────────────── */

console.log('\n═══ THE GATE ═══');
if (seen.story) {
  ok('the closing beat flies the rise', seen.story.mode === 'rise', `read as ${seen.story.mode}`);
  ok(
    'every rise tile launches off the bottom of the screen',
    seen.story.below === seen.story.n,
    `${seen.story.below}/${seen.story.n}`
  );
  ok(
    'every rise tile launches pulled in toward the middle',
    seen.story.inward === seen.story.n,
    `${seen.story.inward}/${seen.story.n}`
  );
  ok(
    'the rise uses the bottom edge and no other',
    seen.story.sides.length === 1 && seen.story.sides[0] === 'bottom',
    seen.story.sides.join(' + ') || 'none'
  );
  ok(
    'no rise tile changes size on the way in',
    seen.story.grew === 0,
    `${seen.story.grew} grew`
  );
  ok(
    'the rise hands back a live, scrolling, drawn grid',
    seen.after.live && seen.after.lattice > 0 && seen.after.scrollY !== 'hidden',
    `live ${seen.after.live} · ${seen.after.lattice} lattice strokes · overflow-y ${seen.after.scrollY}`
  );
}
if (seen.skip) ok('skip intro flies the rise too', seen.skip.mode === 'rise', `read as ${seen.skip.mode}`);
if (seen.deep) {
  ok('the deep link keeps the edge fly-in', seen.deep.mode === 'edge', `read as ${seen.deep.mode}`);
  ok(
    'every edge tile still parks off an edge, and off more than one between them',
    seen.deep.offEdge === seen.deep.n && seen.deep.sides.length > 1,
    `${seen.deep.offEdge}/${seen.deep.n} off ${seen.deep.sides.join(' + ')}`
  );
  ok('no edge tile changes size on the way in', seen.deep.grew === 0, `${seen.deep.grew} grew`);
}
if (seen.explore)
  ok(
    'explore → index keeps the edge fly-in',
    seen.explore.mode === 'edge',
    `read as ${seen.explore.mode}`
  );
if (seen.phone) ok('the rise reads the same at 2 columns', seen.phone.mode === 'rise', `read as ${seen.phone.mode}`);
if (seen.wide) ok('the rise reads the same at 5 columns', seen.wide.mode === 'rise', `read as ${seen.wide.mode}`);
if (rmSettled)
  ok(
    'reduced motion lands settled, nothing in the air',
    !rm?.tiles.length &&
      rmSettled.transformed === 0 &&
      rmSettled.lit === rmSettled.sampled &&
      rmSettled.live,
    `${rm?.tiles.length ?? 0} tiles in the air`
  );
ok(
  'no console errors on the routes run',
  consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | ') || 'clean'
);

console.log(`\n  ${passes} passed · ${failures} failed\n`);

chrome.kill();
ws.close();
process.exit(failures ? 1 : 0);
