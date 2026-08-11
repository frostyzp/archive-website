/**
 * WHEN the DATE / LOCATION block actually arrives on EXPLORE, and whether that
 * arrival is an ENTRANCE-only hold or something every note change now pays for.
 *
 * These are Motion animations driven on rAF, so there is no declared transition
 * to read back off the element — this samples opacity frame by frame instead.
 * Two wrinkles the naive read gets wrong:
 *
 *  1. The hold lives on an ANCESTOR of the value spans (the block fades in as
 *     one piece), so a per-span opacity is 1 while the block is still invisible.
 *     Every reading here is the EFFECTIVE opacity: the product of the opacity of
 *     the element and every ancestor above it, i.e. what the eye gets.
 *  2. The recorder is installed at document-start, so t0 is the frame the block
 *     first exists rather than whenever a post-load evaluate happened to land.
 *
 * Phases: desktop entrance, a note-to-note change once settled, reduced motion,
 * the 390x844 phone, and the INDEX lightbox (which wears the same block's style
 * but reveals it on its own timing — it should not move).
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9352;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/meta-entrance-profile',
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
  if (r?.exceptionDetails) return { error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
  return r?.result?.value;
};
const shoot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const path = `/tmp/meta-entrance-${name}.png`;
  if (s?.data) fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  return path;
};

await send('Page.enable');
await send('Runtime.enable');

/* ── The in-page recorder ────────────────────────────────────────────────
   Installed before any app script runs. Samples every rAF: effective opacity
   of each tracked element, plus the frame it first appeared in the DOM. */
const RECORDER = `
window.__meta = { frames: [], mount: {}, started: performance.now() };
(() => {
  const M = window.__meta;
  // Effective opacity: the element's own, times every ancestor's. A parent at 0
  // hides a child at 1, which is exactly the case this probe exists for.
  const eff = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const v = parseFloat(getComputedStyle(n).opacity);
      if (!Number.isNaN(v)) o *= v;
      if (getComputedStyle(n).visibility === 'hidden') return 0;
    }
    return o;
  };
  const labelled = (txt) =>
    [...document.querySelectorAll('span')].find((s) => (s.textContent || '').trim() === txt);
  const targets = () => {
    const dateLabel = labelled('DATE');
    const locLabel = labelled('LOCATION');
    // The whole block: row container -> the frame that holds both rows.
    const block = dateLabel ? dateLabel.closest('div')?.parentElement : null;
    const card = document.querySelector('[data-card][data-active], [data-vcard][data-active]');
    const scroller = document.querySelector('.transcript-reveal');
    const showBtn = document.querySelector('button[aria-label^="Show "]');
    return {
      // Values are the label's sibling in each row.
      dateValue: dateLabel?.nextElementSibling || null,
      locationValue: locLabel?.nextElementSibling || null,
      metaBlock: block,
      noteImage: card?.querySelector('img') || null,
      // The dissolve appends its canvas at the transcript beat; with no WebGL
      // the words stagger themselves in at the same beat.
      transcriptCanvas: scroller?.querySelector('canvas') || null,
      transcriptWord: scroller?.querySelector('[data-word]') || null,
      // The category wheel's column is the grandparent of any neighbour button.
      categoryWheel: showBtn?.parentElement?.parentElement || null,
      // Phone stand-in for the wheel.
      categoryStepper:
        document.querySelector('button[aria-label="Next category"]')?.parentElement || null,
    };
  };
  const tick = () => {
    requestAnimationFrame(tick);
    const t = performance.now();
    const els = targets();
    const row = { t };
    for (const [k, el] of Object.entries(els)) {
      if (!el) continue;
      if (M.mount[k] == null) M.mount[k] = t;
      row[k] = Math.round(eff(el) * 1000) / 1000;
    }
    /* Each value types in per character, so the ROW's arrival is the first
       character starting and the last one finishing — not the value element,
       whose own opacity never moves. *Max tracks the leading edge (read its
       start), *Min the trailing edge (read its finish). */
    for (const [name, el] of [['dateRow', els.dateValue], ['locationRow', els.locationValue]]) {
      const chars = el ? [...el.querySelectorAll('span')] : [];
      if (!chars.length) continue;
      const vals = chars.map(eff);
      row[name + 'Max'] = Math.round(Math.max(...vals) * 1000) / 1000;
      row[name + 'Min'] = Math.round(Math.min(...vals) * 1000) / 1000;
      if (M.mount[name + 'Max'] == null) M.mount[name + 'Max'] = t;
      if (M.mount[name + 'Min'] == null) M.mount[name + 'Min'] = t;
    }
    M.frames.push(row);
    // Note id of the centred card, so a value swap can be dated to the change.
    const card = document.querySelector('[data-card][data-active], [data-vcard][data-active]');
    const key = card?.getAttribute('data-note-key') || null;
    const dv = els.dateValue ? (els.dateValue.textContent || '').trim() : null;
    if (dv && M.lastDate !== dv) {
      M.lastDate = dv;
      M.dateChanges = M.dateChanges || [];
      M.dateChanges.push({ t, value: dv });
    }
  };
  requestAnimationFrame(tick);
  window.__metaReset = () => {
    M.frames = [];
    M.mount = {};
    M.started = performance.now();
    M.mark = performance.now();
    return true;
  };
})();
`;

await send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });

/* Pulls the recorder's log back and reduces it to start/finish per target. */
const REPORT = (originKey) => `(() => {
  const M = window.__meta;
  const frames = M.frames;
  if (!frames.length) return { error: 'recorder never ran' };
  const keys = [...new Set(frames.flatMap((f) => Object.keys(f)))].filter((k) => k !== 't');
  const origin = ${JSON.stringify(originKey)};
  const t0 =
    origin === 'mark'
      ? M.mark
      : Math.min(...Object.entries(M.mount)
          .filter(([k]) => k === 'metaBlock' || k === 'noteImage')
          .map(([, v]) => v));
  const out = {};
  for (const k of keys) {
    let start = null;
    let end = null;
    let peak = 0;
    for (const f of frames) {
      const v = f[k];
      if (v == null) continue;
      if (v > peak) peak = v;
      if (start == null && v > 0.02) start = f.t;
      if (start != null && end == null && v > 0.98) end = f.t;
    }
    out[k] = {
      mountS: M.mount[k] == null ? null : Math.round(M.mount[k] - t0) / 1000,
      startS: start == null ? null : Math.round(start - t0) / 1000,
      doneS: end == null ? null : Math.round(end - t0) / 1000,
      peak,
    };
  }
  // Layout guard: the entrance hold is carried by an extra wrapper inside the
  // slot, so the block's resting box has to be identical to before it existed.
  const label = [...document.querySelectorAll('span')].find(
    (s) => (s.textContent || '').trim() === 'DATE'
  );
  const b = label ? label.closest('div').parentElement.getBoundingClientRect() : null;
  return {
    frames: frames.length,
    spanS: Math.round(frames[frames.length - 1].t - frames[0].t) / 1000,
    blockRect: b ? [Math.round(b.top), Math.round(b.left), Math.round(b.width), Math.round(b.height)] : null,
    dateChanges: (M.dateChanges || []).map((c) => ({
      atS: Math.round(c.t - t0) / 1000,
      value: c.value,
    })),
    targets: out,
  };
})()`;

/* The note-to-note case, which the whole design of the hold turns on. Dated from
   the frame the DATE text actually changes (not from the keypress, which is one
   scroll away from it): how long the incoming value takes to finish typing, and
   whether the block's own opacity ever dips — a dip would mean the entrance hold
   had been re-served on a scroll. */
const SWAP_REPORT = `(() => {
  const M = window.__meta;
  const change = (M.dateChanges || []).slice(-1)[0];
  if (!change) return { error: 'the value never changed' };
  const frames = M.frames.filter((f) => f.dateRowMin != null);
  const after = frames.filter((f) => f.t >= change.t);
  const s = (t) => Math.round(t - change.t) / 1000;
  const settled = after.find((f) => f.dateRowMin > 0.98 && f.locationRowMin > 0.98);
  return {
    newValue: change.value,
    // Does the persistent frame stay lit right through the swap?
    blockOpacityMin: Math.min(...after.map((f) => f.metaBlock ?? 1)),
    firstCharUpS: s((after.find((f) => f.dateRowMax > 0.02) || {}).t ?? NaN),
    allCharsInS: settled ? s(settled.t) : null,
    trace: after
      .filter((_, i) => i % 3 === 0)
      .slice(0, 22)
      .map((f) => [s(f.t), f.metaBlock, f.dateRowMin, f.dateRowMax]),
  };
})()`;

/* Blocks until `ms` after the block first appeared, so a screenshot can be
   placed at a known point inside (or just past) the hold window. */
const sinceMount = (ms) => `(async () => {
  const M = window.__meta;
  const sleep = (m) => new Promise((r) => setTimeout(r, m));
  for (let i = 0; i < 200; i++) {
    if (M.mount.metaBlock != null) break;
    await sleep(30);
  }
  const left = ${ms} - (performance.now() - M.mount.metaBlock);
  if (left > 0) await sleep(left);
  return Math.round(performance.now() - M.mount.metaBlock);
})()`;

/* Waits for the block to exist, then holds for `settleMs` of sampling. */
const settle = (settleMs) => `(async () => {
  const sleep = (m) => new Promise((r) => setTimeout(r, m));
  for (let i = 0; i < 150; i++) {
    if (window.__meta?.mount?.metaBlock != null) break;
    await sleep(100);
  }
  await sleep(${settleMs});
  return window.__meta?.mount?.metaBlock != null;
})()`;

const report = {};
// ONLY=reduced,phone,index narrows the run while iterating; the desktop entrance
// and the note change always run (the change needs the view the entrance left).
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (name) => !ONLY.length || ONLY.includes(name);

/* ── 1. DESKTOP ENTRANCE ─────────────────────────────────────────────── */
await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
await send('Page.navigate', { url: `${BASE}/?view=explore` });
// Placed frames: the note alone (nothing else has started yet), mid-hold (the
// transcript's field is condensing, the block is still absent), just past the
// block's fade, and fully settled.
report.imageAloneAtMs = await evaluate(sinceMount(330));
report.shotImageAlone = await shoot('desktop-image-alone');
report.holdAtMs = await evaluate(sinceMount(520));
report.shotDuringHold = await shoot('desktop-hold');
report.inAtMs = await evaluate(sinceMount(1120));
report.shotJustIn = await shoot('desktop-just-in');
await evaluate(`new Promise((r) => setTimeout(r, 2600))`);
report.shotSettled = await shoot('desktop-settled');
report.desktopEntrance = await evaluate(REPORT('stack'));

/* ── 2. NOTE-TO-NOTE CHANGE (after the entrance has settled) ──────────── */
await evaluate('window.__metaReset()');
const arrow = async () => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39,
  });
};
await arrow();
await evaluate(`new Promise((r) => setTimeout(r, 1800))`);
report.noteChange = await evaluate(REPORT('mark'));
report.noteChangeSwap = await evaluate(SWAP_REPORT);
report.shotAfterChange = await shoot('desktop-after-note-change');
// And a second change, to be sure the first wasn't a one-off.
await evaluate('window.__metaReset()');
await arrow();
await evaluate(`new Promise((r) => setTimeout(r, 1400))`);
report.secondNoteChangeSwap = await evaluate(SWAP_REPORT);

/* ── 3. REDUCED MOTION ───────────────────────────────────────────────── */
if (want('reduced')) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await send('Page.navigate', { url: `${BASE}/?view=explore&rm=1` });
  await evaluate(settle(2200));
  report.reducedMotion = await evaluate(REPORT('stack'));
  report.shotReducedMotion = await shoot('desktop-reduced-motion');
  await send('Emulation.setEmulatedMedia', { features: [] });
}

/* ── 4. PHONE 390x844 ────────────────────────────────────────────────── */
if (want('phone')) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: `${BASE}/?view=explore&t=${Date.now()}` });
  report.phoneHoldAtMs = await evaluate(sinceMount(520));
  report.shotPhoneHold = await shoot('phone-hold');
  await evaluate(`new Promise((r) => setTimeout(r, 3000))`);
  report.phone = await evaluate(REPORT('stack'));
  report.shotPhoneSettled = await shoot('phone-settled');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.clearDeviceMetricsOverride');
}

/* ── 4b. PHONE, INDEX TAP → the note overlay ──────────────────────────────
   The phone's index surface is not the Lightbox but NoteOpenView again (a
   vertical stack, entered on a shared-element morph), so it wears the same
   persistent block and the same hold. Dated from the block's mount, which is the
   tap. */
if (want('phone-overlay')) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: `${BASE}/?view=grid&t=${Date.now()}` });
  await evaluate(`(async () => {
    const sleep = (m) => new Promise((r) => setTimeout(r, m));
    for (let i = 0; i < 150; i++) {
      if (document.querySelectorAll('img[alt^="Confession"]').length) break;
      await sleep(100);
    }
    await sleep(2400);
    window.__metaReset();
    document.querySelector('.grid-tile')?.click();
    return true;
  })()`);
  report.phoneOverlayHoldAtMs = await evaluate(sinceMount(520));
  report.shotPhoneOverlayHold = await shoot('phone-overlay-hold');
  await evaluate(`new Promise((r) => setTimeout(r, 2400))`);
  report.phoneIndexOverlay = await evaluate(REPORT('stack'));
  report.shotPhoneOverlay = await shoot('phone-overlay-settled');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.clearDeviceMetricsOverride');
}

/* ── 4c. THE DIAL PAGE ────────────────────────────────────────────────────
   META_TIMING is shared with the dial page, whose metadata is the per-note
   version (metaRow, 400ms) rather than EXPLORE's persistent block — so pulling
   the transcript earlier narrows the gap between the two there. Measured rather
   than assumed. */
if (want('dial')) {
  await send('Page.navigate', { url: `${BASE}/?view=theme&t=${Date.now()}` });
  await evaluate(settle(3000));
  report.dialPage = await evaluate(REPORT('stack'));
  report.shotDialPage = await shoot('dial-page');
}

/* ── 5. INDEX LIGHTBOX (same block style, its own timing) ─────────────── */
if (want('index')) {
  await send('Page.navigate', { url: `${BASE}/?view=grid&t=${Date.now()}` });
  await evaluate(`(async () => {
    const sleep = (m) => new Promise((r) => setTimeout(r, m));
    for (let i = 0; i < 150; i++) {
      if (document.querySelectorAll('img[alt^="Confession"]').length) break;
      await sleep(100);
    }
    await sleep(2400);
    window.__metaReset();
    document.querySelector('.grid-tile')?.click();
    await sleep(2000);
    return true;
  })()`);
  report.indexLightbox = await evaluate(REPORT('mark'));
  report.shotLightbox = await shoot('index-lightbox');
}

console.log(JSON.stringify(report, null, 1));
ws.close();
chrome.kill();
