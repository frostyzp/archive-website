/**
 * BodyKicker's three verbs, measured as a cluster: each verb's INK box inside the
 * scatter block (not its line box — the line box carries half-leading and a
 * rotated one exaggerates every vertical gap), the pairwise separation between
 * those ink boxes as rotated quads, whether any verb crosses the block's edges,
 * and the closest any ascii mark comes to a verb.
 *
 * Ink boxes come from canvas TextMetrics with the element's own font and
 * tracking; the quads are rebuilt from the computed matrix and transform-origin,
 * so the numbers describe what is actually on screen rather than the untilted
 * layout. Framer Motion animates on rAF, so everything is sampled after the beat
 * has settled rather than read off a transition.
 *
 * Walks to the BODY beat at each width and writes a magnified screenshot of the
 * block to /tmp. ROUTE=onboarding measures the scrolled telling instead, which
 * shares the component but sets its type more than half again as large — the
 * widest the verbs ever are against the same 620px block.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const ROUTE = process.env.ROUTE || ''; // '' = the beat-stepped telling; 'onboarding' = the scrolled one
const TAG = process.env.TAG || 'before';
const PORT = 9377;
const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 1024, h: 820 },
  { w: 390, h: 844 },
  { w: 320, h: 720 }, // the narrowest the piece claims to hold, and where a mark hanging past the block would pull a scrollbar
];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/kicker-scatter-profile',
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
  const VERBS = ['communicate', 'work', 'think'];
  const leaf = (t) => [...document.querySelectorAll('div')].find(
    (d) => d.children.length === 0 && (d.textContent || '').trim() === t
  );
  const words = VERBS.map(leaf);
  if (words.some((w) => !w)) return { error: 'verbs not on screen' };
  const block = words[0].parentElement;
  const br = block.getBoundingClientRect();

  /* local point -> viewport, honouring transform-origin. The element's
     untransformed top-left is recovered by mapping its own corners and
     subtracting the result's minimum from the rect the browser reports. */
  const mapper = (el) => {
    const cs = getComputedStyle(el);
    const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
    const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat);
    const w = el.offsetWidth, h = el.offsetHeight;
    const f = (q) => {
      const p = m.transformPoint(new DOMPoint(q[0] - ox, q[1] - oy));
      return [p.x + ox, p.y + oy];
    };
    const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(f);
    const r = el.getBoundingClientRect();
    const dx = r.left - Math.min(...corners.map((c) => c[0]));
    const dy = r.top - Math.min(...corners.map((c) => c[1]));
    return (q) => { const p = f(q); return [p[0] + dx, p[1] + dy]; };
  };

  /* Ink box in local coords: canvas metrics for width and cap/descender reach,
     font metrics for where the baseline sits inside the line box. */
  const inkLocal = (el) => {
    const cs = getComputedStyle(el);
    const c = document.createElement('canvas').getContext('2d');
    c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    if ('letterSpacing' in c) c.letterSpacing = cs.letterSpacing;
    const m = c.measureText((el.textContent || '').trim());
    const base = (el.offsetHeight - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2
      + m.fontBoundingBoxAscent;
    return {
      x0: -m.actualBoundingBoxLeft, x1: m.actualBoundingBoxRight,
      y0: base - m.actualBoundingBoxAscent, y1: base + m.actualBoundingBoxDescent,
    };
  };

  const quadOf = (el, local) => {
    const f = mapper(el);
    return [[local.x0, local.y0], [local.x1, local.y0], [local.x1, local.y1], [local.x0, local.y1]].map(f);
  };
  const aabb = (q) => ({
    left: Math.min(...q.map((p) => p[0])), right: Math.max(...q.map((p) => p[0])),
    top: Math.min(...q.map((p) => p[1])), bottom: Math.max(...q.map((p) => p[1])),
  });

  // Separation between two convex quads: SAT for overlap, segment pairs for the gap.
  const axes = (q) => q.map((p, i) => {
    const n = q[(i + 1) % q.length];
    const [ex, ey] = [n[0] - p[0], n[1] - p[1]];
    const l = Math.hypot(ex, ey) || 1;
    return [-ey / l, ex / l];
  });
  const proj = (q, a) => { const v = q.map((p) => p[0] * a[0] + p[1] * a[1]); return [Math.min(...v), Math.max(...v)]; };
  const overlap = (A, B) => [...axes(A), ...axes(B)].every((a) => {
    const [a0, a1] = proj(A, a), [b0, b1] = proj(B, a);
    return a1 >= b0 && b1 >= a0;
  });
  const segDist = (p, q, r, s) => {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const near = (a, b, c) => {
      const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      if (!l2) return d(a, c);
      let t = ((c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1])) / l2;
      t = Math.max(0, Math.min(1, t));
      return d([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], c);
    };
    return Math.min(near(p, q, r), near(p, q, s), near(r, s, p), near(r, s, q));
  };
  const gap = (A, B) => {
    if (overlap(A, B)) return 0;
    let best = Infinity;
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
      best = Math.min(best, segDist(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length]));
    }
    return best;
  };

  const r1 = (n) => Math.round(n * 10) / 10;
  const rel = (b) => ({
    left: r1(b.left - br.left), right: r1(b.right - br.left),
    top: r1(b.top - br.top), bottom: r1(b.bottom - br.top),
    leftPct: r1(((b.left - br.left) / br.width) * 100),
    rightPct: r1(((b.right - br.left) / br.width) * 100),
  });

  const wordQuads = words.map((el) => quadOf(el, inkLocal(el)));
  const wordOut = words.map((el, i) => {
    const b = aabb(wordQuads[i]);
    return {
      text: VERBS[i], fontPx: r1(parseFloat(getComputedStyle(el).fontSize)),
      inkWidth: r1(b.right - b.left), box: rel(b),
      centreXPct: r1((((b.left + b.right) / 2 - br.left) / br.width) * 100),
    };
  });

  const pairs = [];
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    pairs.push({
      pair: VERBS[i] + '↔' + VERBS[j],
      gapPx: r1(gap(wordQuads[i], wordQuads[j])),
      overlaps: overlap(wordQuads[i], wordQuads[j]),
      centreDistPx: r1(Math.hypot(
        (aabb(wordQuads[i]).left + aabb(wordQuads[i]).right) / 2 - (aabb(wordQuads[j]).left + aabb(wordQuads[j]).right) / 2,
        (aabb(wordQuads[i]).top + aabb(wordQuads[i]).bottom) / 2 - (aabb(wordQuads[j]).top + aabb(wordQuads[j]).bottom) / 2
      )),
    });
  }

  /* A mark's box is nearly all air: the motifs are fixed-width, so every line is
     padded with spaces, and line-height 1.5 puts a quarter of an em above and
     below each row. Both are stripped here — one quad per line, trimmed to the
     glyphs that are actually lit — or every mark reads as touching its neighbour. */
  const markQuads = (el) => {
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const lh = parseFloat(cs.lineHeight);
    const lines = [...el.children].map((d) => d.textContent || '');
    const cols = Math.max(1, ...lines.map((l) => l.length));
    const charW = el.offsetWidth / cols;
    const f = mapper(el);
    const out = [];
    lines.forEach((line, i) => {
      const first = line.search(/\\S/);
      if (first < 0) return;
      let last = line.length - 1;
      while (last > first && !line[last].trim()) last--;
      const x0 = first * charW, x1 = (last + 1) * charW;
      const y0 = i * lh + (lh - fs) / 2, y1 = (i + 1) * lh - (lh - fs) / 2;
      out.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(f));
    });
    return out;
  };

  const marks = [...block.querySelectorAll(':scope > [aria-hidden="true"]')].map((el) => {
    const qs = markQuads(el);
    const b = aabb(qs.flat());
    const worst = wordOut
      .map((w, i) => ({ word: w.text, gapPx: r1(Math.min(...qs.map((q) => gap(q, wordQuads[i])))) }))
      .sort((a, b2) => a.gapPx - b2.gapPx)[0];
    return {
      glyphs: (el.textContent || '').trim().slice(0, 12),
      box: rel(b), closestWord: worst,
      pastBlockPx: r1(Math.max(br.left - b.left, b.right - br.right)),
      pastViewportPx: r1(Math.max(-b.left, b.right - window.innerWidth)),
    };
  });

  // Debris crowding debris reads as a smudge rather than as two marks.
  const markPairs = [];
  const allMarkQuads = marks.map((_, i) =>
    markQuads([...block.querySelectorAll(':scope > [aria-hidden="true"]')][i])
  );
  for (let i = 0; i < allMarkQuads.length; i++) for (let j = i + 1; j < allMarkQuads.length; j++) {
    let best = Infinity;
    for (const a of allMarkQuads[i]) for (const b2 of allMarkQuads[j]) best = Math.min(best, gap(a, b2));
    if (best < 8) markPairs.push({ pair: i + '↔' + j, gapPx: r1(best), a: marks[i].glyphs, b: marks[j].glyphs });
  }

  const inkBoxes = wordOut.map((w) => w.box);
  return {
    viewport: window.innerWidth,
    /* Screenshot clips are in PAGE coordinates while a rect is in viewport ones,
       so the scroll offset travels with the block — on the scrolled telling the
       difference is a screenful and the clip lands on the hero instead. */
    block: {
      left: r1(br.left), top: r1(br.top), width: r1(br.width), height: r1(br.height),
      pageLeft: r1(br.left + window.scrollX), pageTop: r1(br.top + window.scrollY),
    },
    words: wordOut,
    pairs,
    span: {
      wordsLeftPct: r1(Math.min(...inkBoxes.map((b) => b.leftPct))),
      wordsRightPct: r1(Math.max(...inkBoxes.map((b) => b.rightPct))),
      clusterWidthPx: r1(Math.max(...inkBoxes.map((b) => b.right)) - Math.min(...inkBoxes.map((b) => b.left))),
      overflowsLeftPx: r1(Math.max(0, -Math.min(...inkBoxes.map((b) => b.left)))),
      overflowsRightPx: r1(Math.max(0, Math.max(...inkBoxes.map((b) => b.right)) - br.width)),
      pageHasHScroll: document.documentElement.scrollWidth > window.innerWidth,
    },
    marks,
    markPairs,
  };
})()`;

const out = {};
for (const { w, h } of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: ROUTE ? `${BASE}/${ROUTE}` : BASE });
  /* The scrolled telling has the kicker in the document from the start and takes
     an intersection as its cue, so it is scrolled to rather than walked to. */
  const reach = ROUTE
    ? `(async () => {
        const sleep = (m) => new Promise(r => setTimeout(r, m));
        const leaf = () => [...document.querySelectorAll('div')].find(
          (d) => d.children.length === 0 && (d.textContent || '').trim() === 'communicate'
        );
        for (let i = 0; i < 40; i++) { const el = leaf(); if (el) { el.scrollIntoView({ block: 'center' }); break; } await sleep(300); }
        await sleep(4200);
        return !!leaf();
      })()`
    : null;
  /* Forward keys are ignored while the opening loader holds, and how long it
     holds is not this component's business — so the walk to the BODY beat is
     driven by what is on screen rather than by a fixed wait. Once the beat's
     copy is up the keys stop, and the verbs are given asciiIdle (2400ms after
     the beat lands) to arrive and every mark to type on. */
  await evaluate(reach || `(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    const verbUp = () => [...document.querySelectorAll('div')].some(
      (d) => d.children.length === 0 && (d.textContent || '').trim() === 'communicate'
    );
    for (let i = 0; i < 40 && !verbUp(); i++) {
      if (!/changing how we/.test(document.body.innerText)) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      }
      await sleep(700);
    }
    await sleep(3400);
    return verbUp();
  })()`);
  const m = await evaluate(MEASURE);
  out[w] = m;
  if (m?.error) {
    console.log(`── ${w}px: ${m.error}`);
    continue;
  }
  const pad = 46;
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, m.block.pageLeft - pad),
      y: Math.max(0, m.block.pageTop - pad * 1.4),
      width: Math.min(w, m.block.width + pad * 2),
      height: m.block.height + pad * 2.6,
      scale: 2,
    },
  });
  const path = `/tmp/kicker-scatter-${TAG}${ROUTE ? `-${ROUTE}` : ''}-${w}.png`;
  if (shot?.data) fs.writeFileSync(path, Buffer.from(shot.data, 'base64'));
  m.screenshot = path;

  console.log(`── viewport ${w}px · block ${m.block.width}×${m.block.height} at (${m.block.left}, ${m.block.top})`);
  for (const word of m.words) {
    console.log(
      `   ${word.text.padEnd(12)} ${String(word.fontPx).padStart(5)}px  ink ${String(word.inkWidth).padStart(6)}px  ` +
        `x ${String(word.box.leftPct).padStart(6)}%→${String(word.box.rightPct).padStart(6)}%  ` +
        `y ${String(word.box.top).padStart(6)}→${String(word.box.bottom).padStart(6)}  centre ${word.centreXPct}%`
    );
  }
  for (const p of m.pairs) {
    console.log(`   gap ${p.pair.padEnd(24)} ${String(p.gapPx).padStart(7)}px${p.overlaps ? '  ← OVERLAP' : ''}   centres ${p.centreDistPx}px`);
  }
  console.log(
    `   cluster ${m.span.clusterWidthPx}px wide, x ${m.span.wordsLeftPct}%→${m.span.wordsRightPct}%` +
      `  overflow L${m.span.overflowsLeftPx}/R${m.span.overflowsRightPx}` +
      `  page h-scroll: ${m.span.pageHasHScroll}`
  );
  const touching = m.marks.filter((k) => k.closestWord.gapPx < 6);
  console.log(`   marks: ${m.marks.length}, closest-to-type: ` +
    m.marks.map((k) => k.closestWord.gapPx).sort((a, b) => a - b).slice(0, 4).join('/') + 'px');
  for (const k of touching) {
    console.log(`     ON THE TYPE  "${k.glyphs}" ${k.closestWord.gapPx}px from "${k.closestWord.word}" at x ${k.box.leftPct}%→${k.box.rightPct}%`);
  }
  for (const p of m.markPairs) console.log(`     marks crowding: "${p.a}" / "${p.b}" ${p.gapPx}px apart`);
  const past = m.marks.filter((k) => k.pastBlockPx > 2);
  for (const k of past) {
    console.log(`     past the block edge by ${k.pastBlockPx}px: "${k.glyphs}"` +
      (k.pastViewportPx > 0 ? `  ← AND ${k.pastViewportPx}px OFF THE VIEWPORT` : ''));
  }
  console.log(`   ${path}`);
}

fs.writeFileSync(`/tmp/kicker-scatter-${TAG}.json`, JSON.stringify(out, null, 2));
console.log(`\njson: /tmp/kicker-scatter-${TAG}.json`);

ws.close();
chrome.kill();
