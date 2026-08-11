/**
 * Does the "SAN FRANCISCO, APRIL 2026" line on the Dolores Park booth photograph
 * belong to the site's metadata family, and does it cost either telling
 * anything?
 *
 * Covers both: the beat-stepped pile at /onboarding-beats, held on the beat
 * where the booth is the only photograph down, and the scrolled telling at
 * /onboarding, scrolled to the same photograph. Measures, at 1440 and 390 wide:
 *   1. the caption's computed font / size / tracking / colour / text, alongside
 *      the archive's DATE / LOCATION rows and the About drawer's credits card —
 *      the metadata it is meant to resemble;
 *   2. the caption's box against the photograph's, reported in the photograph's
 *      OWN units with every rotation and scale in the chain above it divided
 *      back out, and compared with the paper's corners as measured off the file
 *      (0,62 / 902,0 / 974,950 / 66,1022 of a 977x1024 png) — a visual bounding
 *      box of a rotated line says nothing useful about whether the line is on
 *      the paper. The photograph's rect is read twice, once as it ships and once
 *      with the strip and the room kept for it taken away, so a reflow would
 *      show as a difference;
 *   3. what follows the print down the page, and whether the strip reaches it;
 *   4. screenshots of the photograph at scale 3, to /tmp.
 *
 * Motion animates on rAF rather than through CSS transitions, so both entrances
 * are waited out by sampling the photograph's rect until it stops moving rather
 * than by reading a declared duration.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9377;
const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/booth-caption-profile',
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

const key = async (name, vk) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: name,
      code: name,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      autoRepeat: false,
    });
  }
};
const arrowDown = () => key('ArrowDown', 40);

const BOOTH = `document.querySelector('img[src="/intro-booth-park.png"]')`;

/* Page.navigate resolves as the navigation STARTS, so anything evaluated on its
   heels runs in the outgoing document and comes back empty when that context is
   torn down. Wait here rather than in the page. */
const goto = async (url) => {
  await send('Page.navigate', { url });
  await sleep(2500);
};

/* The loader and the wordmark write-on own the first few seconds; only step once
   the hero's question is up, or the swipe is thrown away. */
const READY = `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 200; i++) {
    if (${BOOTH}) break;
    await sleep(100);
  }
  await sleep(3000);
  return !!${BOOTH};
})()`;

/* Dealt and stopped: six consecutive frames of an unchanged rect at full card
   opacity. */
const SETTLE = `(async () => {
  const img = ${BOOTH};
  if (!img) return { error: 'booth image never mounted' };
  const card = img.closest('div').parentElement;
  let last = null, still = 0;
  for (let i = 0; i < 600; i++) {
    const r = img.getBoundingClientRect();
    const o = parseFloat(getComputedStyle(card).opacity);
    const sig = [r.x, r.y, r.width, r.height, o].map(n => Math.round(n * 100)).join(',');
    still = (sig === last && o > 0.99) ? still + 1 : 0;
    last = sig;
    if (still >= 6) return { settledAfterFrames: i, opacity: o };
    await new Promise(r => requestAnimationFrame(r));
  }
  return { error: 'booth never settled' };
})()`;

/* One measurement for both tellings. The pile turns its prints on a scaled
   stage and the scrolled telling hangs the same photograph square in a column,
   so nothing here reads a known transform: the chain from the <img> up is
   multiplied out, and the flattening below neutralises every rotation in it
   rather than the one it expects to find. */
const MEASURE = `(() => {
  const img = ${BOOTH};
  if (!img) return { error: 'no booth' };
  const wrap = img.parentElement;
  const margin = wrap.querySelector(':scope > div');
  const cap = margin && margin.querySelector('span');
  if (!cap) return { error: 'no caption' };
  const cs = getComputedStyle(cap);
  const ms = getComputedStyle(margin);
  const box = (el) => { const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2),
             right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2) }; };

  const range = document.createRange();
  range.selectNodeContents(cap);
  const lines = range.getClientRects().length;

  const imgVisual = box(img);
  const capVisual = box(cap);
  const marginVisual = box(margin);

  /* Any ancestor that could crop the line before it is painted. */
  const clippers = [];
  for (let n = wrap; n && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
      const r = n.getBoundingClientRect();
      clippers.push({ overflow: s.overflowX + '/' + s.overflowY,
                      rect: [+r.left.toFixed(1), +r.top.toFixed(1), +r.right.toFixed(1), +r.bottom.toFixed(1)],
                      containsCaption: r.left <= capVisual.x + 0.5 && r.right >= capVisual.right - 0.5 &&
                                       r.top <= capVisual.y + 0.5 && r.bottom >= capVisual.bottom - 0.5 });
    }
  }

  /* Everything the print is seen through, multiplied out: the scale is what the
     declared type size is actually read at, and the rotation is the angle the
     strip rides at on screen. */
  let acc = new DOMMatrix();
  for (let n = img; n && n !== document.body; n = n.parentElement) {
    const t = getComputedStyle(n).transform;
    if (t && t !== 'none') acc = new DOMMatrix(t).multiply(acc);
  }
  const total = Math.hypot(acc.a, acc.b);
  const chainRotDeg = +(Math.atan2(acc.b, acc.a) * 180 / Math.PI).toFixed(2);
  const mm = new DOMMatrix(ms.transform);
  const marginRotDeg = +(Math.atan2(mm.b, mm.a) * 180 / Math.PI).toFixed(2);

  const frame = { w: img.offsetWidth, h: img.offsetHeight };

  /* The paper's corners in the photograph's own units, off the file's alpha. */
  const QUAD = { tl: [0, 62], tr: [902, 0], br: [974, 950], bl: [66, 1022] };
  const FILE = { w: 977, h: 1024 };
  const sx = frame.w / FILE.w, sy = frame.h / FILE.h;
  const paperBL = [+(QUAD.bl[0] * sx).toFixed(1), +(QUAD.bl[1] * sy).toFixed(1)];
  const paperBR = [+(QUAD.br[0] * sx).toFixed(1), +(QUAD.br[1] * sy).toFixed(1)];
  const paperEdgeDeg = +(Math.atan2(paperBR[1] - paperBL[1], paperBR[0] - paperBL[0]) * 180 / Math.PI).toFixed(2);
  const paperEdgeLen = +Math.hypot(paperBR[0] - paperBL[0], paperBR[1] - paperBL[1]).toFixed(1);

  /* The text run and the room around it, with every rotation in the chain taken
     out — the strip is turned, so an axis-aligned bounding box overstates both.
     Scales are left in and divided back out, so the numbers are the
     photograph's own. */
  const flat = (() => {
    const undo = [];
    for (let n = margin; n && n !== document.body; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      if (t && t !== 'none') {
        const q = new DOMMatrix(t);
        undo.push([n, n.style.transform]);
        n.style.transform = 'scale(' + Math.hypot(q.a, q.b) + ')';
      }
    }
    void margin.offsetHeight;
    const mr = margin.getBoundingClientRect();
    const r2 = document.createRange();
    r2.selectNodeContents(cap);
    const tr = r2.getBoundingClientRect();
    const out = {
      textW: +(tr.width / total).toFixed(1),
      textH: +(tr.height / total).toFixed(1),
      roomLeft: +((tr.left - mr.left) / total).toFixed(1),
      roomRight: +((mr.right - tr.right) / total).toFixed(1),
      roomAbove: +((tr.top - mr.top) / total).toFixed(1),
      roomBelow: +((mr.bottom - tr.bottom) / total).toFixed(1),
      marginW: +(mr.width / total).toFixed(1),
      marginH: +(mr.height / total).toFixed(1),
    };
    for (const [n, t] of undo) n.style.transform = t;
    void margin.offsetHeight;
    return out;
  })();

  /* What follows the print down the page, and whether the strip reaches it. */
  const after = (() => {
    let n = wrap;
    while (n && !n.nextElementSibling) n = n.parentElement;
    const next = n && n.nextElementSibling;
    if (!next) return null;
    const r = next.getBoundingClientRect();
    return { tag: next.tagName, text: (next.textContent || '').trim().slice(0, 34),
             top: +r.top.toFixed(1), gapBelowMargin: +(r.top - marginVisual.bottom).toFixed(1) };
  })();

  return {
    caption: {
      text: cap.textContent,
      rendered: cs.textTransform === 'uppercase' ? cap.textContent.toUpperCase() : cap.textContent,
      fontFamily: cs.fontFamily,
      fontSizeDeclared: cs.fontSize,
      fontSizeOnScreen: +(parseFloat(cs.fontSize) * total).toFixed(2),
      letterSpacingDeclared: cs.letterSpacing,
      letterSpacingOnScreen: +(parseFloat(cs.letterSpacing) * total).toFixed(2),
      textTransform: cs.textTransform,
      color: cs.color,
      whiteSpace: cs.whiteSpace,
      ariaHiddenOnMargin: margin.getAttribute('aria-hidden'),
      lines,
    },
    geometry: {
      frame,
      chainScale: +total.toFixed(4),
      chainRotDeg,
      marginRotDeg,
      marginRotOnScreen: +(chainRotDeg + marginRotDeg).toFixed(2),
      paper: { bottomLeft: paperBL, bottomRight: paperBR, edgeDeg: paperEdgeDeg, edgeLen: paperEdgeLen },
      marginBox: { left: +margin.offsetLeft.toFixed(1), top: +margin.offsetTop.toFixed(1),
                   w: +margin.offsetWidth.toFixed(1), h: +margin.offsetHeight.toFixed(1) },
      /* How far the strip's top-left corner and its angle miss the paper's own
         bottom-left corner and bottom edge by. */
      seam: { dx: +(margin.offsetLeft - paperBL[0]).toFixed(1),
              dyTucked: +(paperBL[1] - margin.offsetTop).toFixed(1),
              dDeg: +(marginRotDeg - paperEdgeDeg).toFixed(2),
              dWidth: +(margin.offsetWidth - paperEdgeLen).toFixed(1) },
      line: flat,
      background: ms.backgroundColor,
    },
    visual: { photo: imgVisual, margin: marginVisual, caption: capVisual, clippers, after },
    reflow: (() => {
      /* Take the caption away — the strip, and the room the scrolled telling
         keeps clear underneath it — and read the photograph again. */
      const before = box(img);
      margin.remove();
      if (wrap.parentElement) wrap.parentElement.style.paddingBottom = '0px';
      void wrap.offsetHeight;
      const after2 = box(img);
      return {
        withCaption: before,
        withoutCaption: after2,
        deltaPx: { x: +(after2.x - before.x).toFixed(3), y: +(after2.y - before.y).toFixed(3),
                   w: +(after2.w - before.w).toFixed(3), h: +(after2.h - before.h).toFixed(3) },
      };
    })(),
  };
})()`;

const pick = (name, sel) => `(() => {
  const el = ${sel};
  if (!el) return { name: ${JSON.stringify(name)}, error: 'not found' };
  const cs = getComputedStyle(el);
  return { name: ${JSON.stringify(name)}, text: (el.textContent || '').trim().slice(0, 40),
           fontFamily: cs.fontFamily, fontSize: cs.fontSize, letterSpacing: cs.letterSpacing,
           textTransform: cs.textTransform, color: cs.color };
})()`;

const out = { base: BASE, widths: {} };

/* How many photographs are down. Other agents are editing this project while the
   probe runs, so a stray HMR reload can put the pile back at the hero — and a
   key event now and then lands twice. Neither is worth a rerun; both are worth
   checking for. */
const DEALT = `(() => {
  const img = ${BOOTH};
  if (!img) return -1;
  const stage = img.parentElement.parentElement.parentElement;
  return [...stage.children].filter(c => parseFloat(getComputedStyle(c).opacity) > 0.5).length;
})()`;

for (const { w, h } of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  let ready = false;
  let dealt = -1;
  for (let attempt = 0; attempt < 3 && dealt !== 1; attempt++) {
    await goto(`${BASE}/onboarding-beats`);
    ready = await evaluate(READY);
    await arrowDown();
    await sleep(1400);
    for (let fix = 0; fix < 5; fix++) {
      dealt = await evaluate(DEALT);
      if (dealt === 1) break;
      if (dealt < 1) break;
      await key('ArrowUp', 38);
      await sleep(1200);
    }
  }
  const settle = await evaluate(SETTLE);

  const shots = [];
  const clip = await evaluate(`(() => {
    const img = ${BOOTH};
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: Math.max(0, Math.round(r.x) - 8), y: Math.max(0, Math.round(r.y) - 8),
             width: Math.round(r.width) + 16, height: Math.round(r.height) + 46 };
  })()`);
  if (clip) {
    const whole = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 3 } });
    if (whole?.data) {
      fs.writeFileSync(`/tmp/booth-caption-${w}.png`, Buffer.from(whole.data, 'base64'));
      shots.push(`/tmp/booth-caption-${w}.png`);
    }
    const band = { x: clip.x, y: clip.y + Math.round(clip.height * 0.68), width: clip.width, height: Math.round(clip.height * 0.32) };
    const b = await send('Page.captureScreenshot', { format: 'png', clip: { ...band, scale: 3 } });
    if (b?.data) {
      fs.writeFileSync(`/tmp/booth-caption-band-${w}.png`, Buffer.from(b.data, 'base64'));
      shots.push(`/tmp/booth-caption-band-${w}.png`);
    }
  }

  // Last: it dismantles the DOM to prove the photograph doesn't move.
  const measured = await evaluate(MEASURE);
  out.widths[w] = { viewport: `${w}x${h}`, ready, settle, ...measured, screenshots: shots };
}

/* ── THE SCROLLED TELLING ────────────────────────────────────────────────
   The same photograph, hung square in a column with the intro line under it,
   instead of turned on the pile's stage. Scrolled to and left to finish its
   slide, then measured by the same code. */
out.scrolled = {};
for (const { w, h } of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await goto(`${BASE}/onboarding`);
  const ready = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    for (let i = 0; i < 200; i++) { if (${BOOTH}) break; await sleep(100); }
    if (!${BOOTH}) return false;
    await sleep(2600);
    ${BOOTH}.scrollIntoView({ block: 'center' });
    await sleep(2400);
    return true;
  })()`);
  const settle = await evaluate(SETTLE);

  const shots = [];
  /* Page.captureScreenshot clips in PAGE coordinates, and this telling is a long
     scroller — a viewport rect here photographs whatever is that far down the
     document instead, which is black. */
  const clip = await evaluate(`(() => {
    const img = ${BOOTH};
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const sx = window.scrollX, sy = window.scrollY;
    const pad = Math.round(r.height * 0.16);
    return { x: Math.max(0, Math.round(r.x + sx) - 8), y: Math.max(0, Math.round(r.y + sy) - 8),
             width: Math.round(r.width) + 16, height: Math.round(r.height) + 8 + pad };
  })()`);
  if (clip) {
    const whole = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 3 } });
    if (whole?.data) {
      fs.writeFileSync(`/tmp/booth-scrolled-${w}.png`, Buffer.from(whole.data, 'base64'));
      shots.push(`/tmp/booth-scrolled-${w}.png`);
    }
    const band = { x: clip.x, y: clip.y + Math.round(clip.height * 0.72), width: clip.width, height: Math.round(clip.height * 0.28) };
    const b = await send('Page.captureScreenshot', { format: 'png', clip: { ...band, scale: 3 } });
    if (b?.data) {
      fs.writeFileSync(`/tmp/booth-scrolled-band-${w}.png`, Buffer.from(b.data, 'base64'));
      shots.push(`/tmp/booth-scrolled-band-${w}.png`);
    }
  }

  const measured = await evaluate(MEASURE);
  out.scrolled[w] = { viewport: `${w}x${h}`, ready, settle, ...measured, screenshots: shots };
}

/* ── The metadata it is meant to look related to ─────────────────────── */
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await goto(`${BASE}/?view=explore`);
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 120; i++) {
    if ([...document.querySelectorAll('span')].some(s => (s.textContent||'').trim() === 'LOCATION')) break;
    await sleep(200);
  }
  await sleep(2400);
  return true;
})()`);
const locLabel = `[...document.querySelectorAll('span')].find(s => (s.textContent||'').trim() === 'LOCATION')`;
out.reference = [
  await evaluate(pick('archive LOCATION label', locLabel)),
  await evaluate(pick('archive LOCATION value', `${locLabel}?.parentElement.lastElementChild`)),
];

await goto(`${BASE}/?view=grid`);
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if ([...document.querySelectorAll('button, a')].some(b => /^about$/i.test((b.textContent||'').trim()))) break;
    await sleep(200);
  }
  await sleep(1800);
  [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim())).click();
  await sleep(1800);
  document.querySelector('.about-credits-card')?.scrollIntoView({ block: 'center' });
  await sleep(700);
  return true;
})()`);
out.reference.push(
  await evaluate(
    pick(
      'About drawer credits value',
      `(() => { const c = document.querySelector('.about-credits-card');
        const v = c?.firstElementChild?.lastElementChild;
        return v?.querySelector('a, span') || v; })()`
    )
  ),
  await evaluate(
    pick(
      'About drawer photo figcaption',
      `[...document.querySelectorAll('figcaption')].find(f => (f.textContent||'').trim().startsWith('Fig.'))`
    )
  )
);

console.log(JSON.stringify(out, null, 1));

ws.close();
chrome.kill();
