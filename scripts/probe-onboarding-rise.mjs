/**
 * The path each onboarding photograph takes on its way into the pile, measured
 * off the live DOM. Motion animates on rAF rather than through CSS transitions,
 * so there is no declared duration or offset to read back — this samples the
 * print's bounding rect every frame from the moment a beat is stepped until it
 * has stopped moving, and reports:
 *
 *   · where the travel starts, relative to the bottom edge of the window
 *   · how much of the move is vertical against how much is horizontal
 *   · when the paper crosses into frame, and how much of the climb is still to
 *     come once it is opaque enough to see — a print that is clipped for its
 *     whole flight would appear at its landing place rather than rise into it
 *   · the arrival's duration — both the tween's and, more usefully on a
 *     long-tailed ease-out, when the climb is 90/96/99% behind it
 *   · the beat on one clock: when the print starts, when it is down, when the
 *     first word of the line begins and when the cascade finishes, so the
 *     photograph-then-words order can be read off rather than assumed
 *   · whether the caption strip written into the booth's margin holds its offset
 *     against its own print for the whole flight
 *   · the tilt it unwinds on the way
 *
 * Run at a desktop and a phone width, since the pile is scaled to fit and the
 * offstage distance is measured against the window's height.
 *
 * Also walks the ancestors of a print looking for anything that clips it before
 * the page shell does, and re-runs under prefers-reduced-motion, where a print
 * should simply be in place and only its opacity should change.
 *
 * Frames of the flight itself are the companion probe's job
 * (probe-onboarding-rise-frames.mjs): a `Page.captureScreenshot` round trip is
 * ~300ms against a 620ms front-loaded throw, so a shot fired on a delay lands in
 * the settling tail every time. Only the settled pile is shot here.
 *
 * Keyboard steps are dispatched on `window` ONLY: the page's handler is bound
 * there, and a second dispatch on `document` bubbles up to it and silently
 * advances two beats at once.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9347;
const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'phone', width: 390, height: 844 },
];
const PHOTO_NAMES = ['booth', 'note 1 (AC_171)', 'note 2 (AC_148)', 'note 3 (AC_185)'];
/** The opening words of the line each print's own beat writes underneath it. */
const COPY_PREFIX = ['We invited strangers', 'AI is entering', 'And even', 'Every note is'];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/onboarding-rise-profile',
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
  if (r?.exceptionDetails) {
    return {
      error: [r.exceptionDetails.text, r.exceptionDetails.exception?.description]
        .filter(Boolean)
        .join(' — ')
        .split('\n')[0],
    };
  }
  if (r?.result && !('value' in r.result)) return { error: `unserialisable: ${r.result.type}` };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

/* Shared page-side helpers: finding the prints, and one frame's worth of
   geometry for one of them. The <img> is measured rather than its wrapper —
   the wrapper is a fixed box the scans are centred in, so it is not the paper
   you can see. */
const HELPERS = `
  const PRINTS = () => [...document.querySelectorAll('img')]
    .filter((im) => /intro-booth-park|confession_notes_2/.test(im.src))
    .filter((im) => im.closest('[style*="will-change"]'));
  const snap = (im) => {
    const r = im.getBoundingClientRect();
    const wrap = im.closest('[style*="will-change"]');
    const cs = getComputedStyle(wrap);
    const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
    const vh = window.innerHeight;
    const visibleH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return {
      top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      h: r.height, w: r.width,
      cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2,
      visibleFrac: r.height ? visibleH / r.height : 0,
      rot: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      opacity: parseFloat(cs.opacity),
    };
  };
  const stepKey = (key) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  /* The caption strip written into the booth's margin. It is a child of the
     print, so its offset from the paper should never change during the flight —
     that is what is being checked, not where it is. */
  const CAPTION = () =>
    [...document.querySelectorAll('span, div')].find(
      (el) => el.children.length === 0 && /San Francisco, April 2026/i.test(el.textContent || '')
    ) || null;
  /* The words of the beat's line. RevealWords fades each one in its own span. */
  const WORDS = (prefix) => {
    const host = [...document.querySelectorAll('[aria-label]')].find((el) =>
      (el.getAttribute('aria-label') || '').trim().startsWith(prefix)
    );
    if (!host) return [];
    return [...host.querySelectorAll('span[aria-hidden="true"]')].filter((s) =>
      (s.textContent || '').trim()
    );
  };
`;

/** Waits out the loader and the hero, so the first step actually registers. */
const READY = `(async () => {
  ${HELPERS}
  const deadline = performance.now() + 25000;
  while (performance.now() < deadline) {
    if (PRINTS().length >= 4) break;
    await new Promise((r) => requestAnimationFrame(r));
  }
  if (PRINTS().length < 4) return { error: 'prints never mounted: ' + PRINTS().length };
  await new Promise((r) => setTimeout(r, 7500));
  return { prints: PRINTS().length, vw: innerWidth, vh: innerHeight };
})()`;

/** Everything between a print and the page that could clip it. */
const CLIPPERS = `(() => {
  ${HELPERS}
  const im = PRINTS()[3];
  if (!im) return { error: 'no prints' };
  const out = [];
  for (let el = im.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.overflow === 'visible' && cs.clipPath === 'none') continue;
    const r = el.getBoundingClientRect();
    out.push({
      tag: el.tagName.toLowerCase(),
      overflow: cs.overflow,
      clipPath: cs.clipPath,
      rect: [Math.round(r.top), Math.round(r.bottom)],
      isPageShell: Math.round(r.top) <= 0 && Math.round(r.bottom) >= window.innerHeight,
    });
  }
  return { clippers: out, vh: window.innerHeight };
})()`;

/**
 * Steps one beat forward and follows print `k` frame by frame.
 * `k` is its index in the deal: 0 is the booth, which arrives on beat 1.
 */
const track = (k, ms, wordPrefix = null) => `(async () => {
  ${HELPERS}
  const prints = PRINTS();
  const im = prints[${k}];
  if (!im) return { error: 'print ${k} missing' };
  const vh = window.innerHeight;
  const wait = snap(im);
  const frames = [];
  /* The caption strip is a child of the print; its offset from the paper is
     sampled every frame, and any drift means it is being animated on its own.
     Measured as a FRACTION of the print, not in px: the card scales from 0.92 up
     to its resting scale as it lands, so a caption riding along perfectly still
     changes its px offset by more than 100px on the booth. Only the print that
     carries the caption is asked about it. */
  const cap = ${k} === 0 ? CAPTION() : null;
  const capOffsets = [];
  // When each word of the beat's line first shows and finishes.
  const wordPrefix = ${JSON.stringify(wordPrefix)};
  const wordStart = new Map();
  const wordDone = new Map();
  const t0 = performance.now();
  stepKey('ArrowDown');
  while (performance.now() - t0 < ${ms}) {
    const t = performance.now() - t0;
    frames.push({ t, ...snap(im) });
    if (cap) {
      const cr = cap.getBoundingClientRect();
      const pr = im.getBoundingClientRect();
      const wrap = im.closest('[style*="will-change"]');
      const m = new DOMMatrixReadOnly(getComputedStyle(wrap).transform || '');
      const th = Math.atan2(m.b, m.a);
      const s = Math.hypot(m.a, m.b) || 1;
      // Centre-to-centre, turned back out of the card's rotation and divided by
      // the print's untransformed height: what is left is the caption's place ON
      // the paper, which cannot change unless it is being moved separately.
      const dx = (cr.left + cr.right) / 2 - (pr.left + pr.right) / 2;
      const dy = (cr.top + cr.bottom) / 2 - (pr.top + pr.bottom) / 2;
      const h = im.offsetHeight || 1;
      capOffsets.push([
        (dx * Math.cos(th) + dy * Math.sin(th)) / s / h,
        (-dx * Math.sin(th) + dy * Math.cos(th)) / s / h,
      ]);
    }
    if (wordPrefix) {
      for (const s of WORDS(wordPrefix)) {
        const o = parseFloat(getComputedStyle(s).opacity);
        if (!wordStart.has(s) && o > 0.02) wordStart.set(s, t);
        if (wordStart.has(s) && !wordDone.has(s) && o > 0.995) wordDone.set(s, t);
      }
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  const last = frames[frames.length - 1];
  const moved = (f) => Math.hypot(f.cx - last.cx, f.cy - last.cy);
  const first = frames.findIndex((f) => moved(f) > 1.5);
  const climb = Math.abs(wait.cy - last.cy);
  const at = (test) => {
    const f = frames.find((v) => v.t >= (first < 0 ? 0 : frames[first].t) && test(v));
    if (!f) return null;
    return {
      ms: Math.round(f.t - (first < 0 ? 0 : frames[first].t)),
      topVsBottom: Math.round(f.top - vh),
      leftToClimbPct: climb ? Math.round((Math.abs(f.cy - last.cy) / climb) * 100) : 0,
      visiblePct: Math.round(f.visibleFrac * 100),
    };
  };
  const out = {
    vh,
    frames: frames.length,
    startTop: Math.round(wait.top),
    belowBottomPx: Math.round(wait.top - vh),
    paperH: Math.round(wait.h),
    dy: Math.round(wait.cy - last.cy),
    dx: Math.round(last.cx - wait.cx),
    landCx: Math.round(last.cx),
    landCy: Math.round(last.cy),
    rotStart: +wait.rot.toFixed(1),
    rotEnd: +last.rot.toFixed(1),
    waitOpacity: Math.round(wait.opacity * 100),
    endOpacity: Math.round(last.opacity * 100),
    // The first 20 frames of the flight, so a pop can be told from a rise.
    trace: frames
      .slice(Math.max(0, first), Math.max(0, first) + 20)
      .map((f) => [Math.round(f.t), Math.round(f.top), Math.round(f.visibleFrac * 100), Math.round(f.opacity * 100)]),
  };
  // How far the caption drifted against its own print, as a % of the print.
  const capDrift = capOffsets.length
    ? Math.max(
        ...capOffsets.map(([dt, dl]) =>
          Math.max(Math.abs(dt - capOffsets[0][0]), Math.abs(dl - capOffsets[0][1]))
        )
      ) * 100
    : null;
  out.captionDriftPct = capDrift == null ? null : +capDrift.toFixed(2);
  out.captionSamples = capOffsets.length;
  out.captionRidesCard =
    cap == null ? null : cap.closest('[style*="will-change"]') === im.closest('[style*="will-change"]');
  if (wordPrefix) {
    const starts = [...wordStart.values()].sort((a, b) => a - b);
    const ends = [...wordDone.values()].sort((a, b) => a - b);
    out.copy = {
      words: wordStart.size,
      firstWordMs: starts.length ? Math.round(starts[0]) : null,
      lastWordStartsMs: starts.length ? Math.round(starts[starts.length - 1]) : null,
      cascadeDoneMs: ends.length === wordStart.size && ends.length ? Math.round(ends[ends.length - 1]) : null,
    };
  }
  if (first < 0) return { ...out, stillMs: 0, note: 'no travel' };
  let settle = frames.length - 1;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (moved(frames[i]) > 0.5) { settle = i + 1; break; }
  }
  /* ms from the start of the move to covering this much of the climb. The
     duration alone says little on an ease-out this long-tailed: what the eye
     reads as the arrival is over well before the tween is. */
  const toPct = (p) => {
    const f = frames.find((v) => v.t >= frames[first].t && Math.abs(v.cy - last.cy) <= climb * (1 - p));
    return f ? Math.round(f.t - frames[first].t) : null;
  };
  return {
    ...out,
    latencyMs: Math.round(frames[first].t),
    durationMs: Math.round(frames[settle].t - frames[first].t),
    to90: toPct(0.9),
    to96: toPct(0.96),
    to99: toPct(0.99),
    crossesEdge: at((f) => f.top < vh - 1),
    halfSeen: at((f) => f.opacity >= 0.5),
    fullySeen: at((f) => f.opacity >= 0.99),
  };
})()`;

/**
 * The closing beat's cue arrow, once the four prints are down: which way its
 * loop carries it, how far, and what it has to spare above it. Read off the
 * span's own transform as well as its box, since the box alone cannot say
 * whether the arrow rides up from its resting place or down from it.
 */
const CUE = `(async () => {
  const arrows = [...document.querySelectorAll('span')].filter(
    (s) => (s.textContent || '').trim() === '\\u2193'
  );
  const el = arrows.find((s) => s.closest('.onboarding-cta')) || null;
  if (!el) return { error: 'no cue arrow inside the CTA (' + arrows.length + ' arrows in the page)' };
  const btn = el.closest('.onboarding-cta');
  // The beat's line: the block the words are revealed into, above the control.
  const copy = document.querySelector('h2[aria-label]');
  const ys = [];
  const tops = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 3600) {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform || '');
    ys.push(m.f);
    tops.push(el.getBoundingClientRect().top);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const br = btn.getBoundingClientRect();
  const cr = copy ? copy.getBoundingClientRect() : null;
  return {
    frames: ys.length,
    minY: +Math.min(...ys).toFixed(1),
    maxY: +Math.max(...ys).toFixed(1),
    highestTop: Math.round(Math.min(...tops)),
    lowestTop: Math.round(Math.max(...tops)),
    viewportTopClearancePx: Math.round(Math.min(...tops)),
    // At its highest, how much air is left under the line above it and inside
    // the control's own box.
    copyGapPx: cr ? Math.round(Math.min(...tops) - cr.bottom) : null,
    insideButtonPx: Math.round(Math.min(...tops) - br.top),
    buttonTop: Math.round(br.top),
    buttonBottom: Math.round(br.bottom),
  };
})()`;

const num = (v, w = 5) => String(v).padStart(w);
const stage = (s) =>
  s ? `${s.ms}ms in (top ${s.topVsBottom > 0 ? '+' : ''}${s.topVsBottom}px vs the edge, ${s.leftToClimbPct}% of the climb left, ${s.visiblePct}% of the paper in frame)` : 'never';

for (const vp of VIEWPORTS) {
  for (const reduced of [false, true]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
    });
    await send('Page.navigate', { url: BASE });
    let ready = await evaluate(READY);
    if (ready?.error) {
      await send('Page.navigate', { url: BASE });
      ready = await evaluate(READY);
    }
    console.log(
      `\n══ ${vp.label} ${vp.width}×${vp.height}${reduced ? '  ·  prefers-reduced-motion: reduce' : ''}` +
        `  (${ready?.prints ?? ready?.error} prints, vh ${ready?.vh})`
    );

    if (!reduced) {
      const c = await evaluate(CLIPPERS);
      for (const cl of c.clippers || []) {
        console.log(
          `   clips: <${cl.tag}> overflow:${cl.overflow} top..bottom ${cl.rect[0]}..${cl.rect[1]}` +
            (cl.isPageShell ? '  ← the page shell, i.e. the window itself' : '  ← CLIPS INSIDE THE PAGE')
        );
      }
    }

    const runs = [];
    for (let k = 0; k < 4; k++) {
      // Each print's own beat carries its own line; the beat is watched whole so
      // the deal and the copy can be laid on one clock.
      runs.push({
        name: PHOTO_NAMES[k],
        ...(await evaluate(track(k, 4200, COPY_PREFIX[k]))),
      });
      await sleep(500);
    }

    for (const r of runs) {
      if (r.error) {
        console.log(`   ${r.name.padEnd(16)} ${r.error}`);
        continue;
      }
      if (reduced) {
        console.log(
          `   ${r.name.padEnd(16)} travel ↑${num(r.dy)}px ↔${num(r.dx)}px  ` +
            `tilt ${num(r.rotStart, 6)}° → ${r.rotEnd}°  opacity ${r.waitOpacity}% → ${r.endOpacity}%  ` +
            `${r.note === 'no travel' ? 'IN PLACE' : 'MOVED'}`
        );
        continue;
      }
      const ratio = r.dx === 0 ? '∞' : (Math.abs(r.dy) / Math.abs(r.dx)).toFixed(1);
      console.log(
        `   ${r.name.padEnd(16)} waits ${num(r.belowBottomPx)}px past the bottom edge (paper ${r.paperH}px tall)  ` +
          `travel ↑${num(r.dy)}px ↔${num(r.dx)}px = ${ratio}:1  ` +
          `tilt ${num(r.rotStart, 6)}° → ${r.rotEnd}°  ${num(r.durationMs)}ms  land (${r.landCx}, ${r.landCy})`
      );
      console.log(`   ${''.padEnd(16)} crosses the edge  ${stage(r.crossesEdge)}`);
      console.log(`   ${''.padEnd(16)} half visible      ${stage(r.halfSeen)}`);
      console.log(`   ${''.padEnd(16)} fully opaque      ${stage(r.fullySeen)}`);
      console.log(
        `   ${''.padEnd(16)} climb 90% by ${r.to90}ms · 96% by ${r.to96}ms · 99% by ${r.to99}ms · ` +
          `still by ${r.durationMs}ms` +
          (r.captionDriftPct == null
            ? ''
            : `\n   ${''.padEnd(16)} caption: ${r.captionRidesCard ? 'same animated card as its print' : 'ON A CARD OF ITS OWN'}, ` +
              `drifts ${r.captionDriftPct}% of the print's height over ${r.captionSamples} frames of flight`)
      );
      if (r.copy) {
        console.log(
          `   ${''.padEnd(16)} copy: first word ${r.copy.firstWordMs}ms · last word starts ` +
            `${r.copy.lastWordStartsMs}ms · cascade done ${r.copy.cascadeDoneMs}ms  ` +
            `(${r.copy.words} words) → print ${r.to99 != null && r.copy.firstWordMs != null && r.to99 < r.copy.firstWordMs ? 'DOWN BEFORE' : 'STILL MOVING AT'} the first word`
        );
      }
      console.log(
        `   ${''.padEnd(16)} ms/top/inframe%/opacity%: ` +
          r.trace
            .filter((_, i) => i % 2 === 0)
            .map(([t, top, v, o]) => `${t}:${top}/${v}/${o}`)
            .join('  ')
      );
    }

    if (reduced) continue;

    const cue = await evaluate(CUE);
    if (cue?.error) {
      console.log(`   cue: ${cue.error}`);
    } else {
      console.log(
        `   cue arrow: rides ${cue.minY}px → ${cue.maxY}px on its loop ` +
          `(${cue.minY < 0 && cue.maxY <= 0.5 ? 'UP from rest, never below it' : 'DOWN from rest'}) ` +
          `over ${cue.frames} frames`
      );
      console.log(
        `   ${''.padEnd(10)} at its highest: ${cue.viewportTopClearancePx}px below the top of the window, ` +
          `${cue.copyGapPx}px under the beat's last line, ${cue.insideButtonPx}px inside the control's own box ` +
          `(control ${cue.buttonTop}..${cue.buttonBottom})`
      );
    }

    const settled = await send('Page.captureScreenshot', {
      format: 'png',
      // scale lives inside clip; a top-level one is ignored and returns 1×.
      clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 2 },
    });
    const settledPath = `/tmp/onboarding-pile-${vp.label}-settled.png`;
    if (settled?.data) fs.writeFileSync(settledPath, Buffer.from(settled.data, 'base64'));
    console.log(`   settled pile  ${settledPath}`);
  }
}

ws.close();
chrome.kill();
