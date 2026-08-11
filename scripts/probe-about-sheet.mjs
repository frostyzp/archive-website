/**
 * The About panel as a phone bottom sheet: where it rests, how much archive is
 * left showing above it, whether the tab row's paper crop and the mailing-list
 * card's outward bleed survive the new surface, and whether the column still
 * scrolls inside the sheet rather than the sheet growing past the viewport.
 *
 * Runs 390x844, 320x568 (small phone) and 844x390 (short landscape), plus a
 * desktop 1440x900 pass that asserts the peek drawer is untouched. Captures a
 * mid-flight frame of the rise.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9400 + (process.pid % 500);
const TAG = process.env.TAG || 'sheet';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/about-sheet-profile-${process.pid}`,
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
  if (r?.exceptionDetails) {
    const d = r.exceptionDetails;
    return { error: d.exception?.description || d.text, line: d.lineNumber };
  }
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

const shoot = async (file, clip) => {
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
  });
  if (s?.data) fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  return file;
};

// Phone hides ABOUT behind the burger; desktop has it in the bar (and on the
// drawer's own folder tab). Returns without waiting out the open animation so
// the caller can time a mid-flight frame itself.
const CLICK_ABOUT = `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  await sleep(3600);
  const burger = document.querySelector('button[aria-label="Open menu"]');
  if (burger) { burger.click(); await sleep(700); }
  const btn = [...document.querySelectorAll('button, a')]
    .find(b => /^about$/i.test((b.textContent||'').trim()));
  if (!btn) return { error: 'no about control' };
  btn.click();
  return true;
})()`;

const R = (n) => Math.round(n * 100) / 100;

const REPORT = `(() => {
  const R = (n) => Math.round(n * 100) / 100;
  const panel = document.querySelector('[aria-label="About What We Tell AI"]');
  if (!panel) return { error: 'no panel' };
  const ps = getComputedStyle(panel);
  const pb = panel.getBoundingClientRect();
  const H = window.innerHeight, W = window.innerWidth;

  const body = document.getElementById('about-panel-body');
  const bcs = body ? getComputedStyle(body) : null;
  const bb = body ? body.getBoundingClientRect() : null;

  const tablist = document.querySelector('[role="tablist"][aria-label="About sections"]');
  const tabs = tablist ? [...tablist.querySelectorAll('[role="tab"]')] : [];
  const active = tabs.find(t => t.getAttribute('aria-selected') === 'true');
  const tlb = tablist ? tablist.getBoundingClientRect() : null;
  // The paper layer is the child actually wearing the roughpaper filter — not
  // the <svg> holding its defs, which is also an aria-hidden absolute child but
  // has no box.
  const paperOn = (host) => {
    if (!host) return null;
    const layer = [...host.children].find(c => getComputedStyle(c).filter.includes('roughpaper'));
    if (!layer) return { present: false };
    const ls = getComputedStyle(layer);
    const lb = layer.getBoundingClientRect();
    return {
      present: true,
      opacity: ls.opacity,
      filter: ls.filter.slice(0, 60),
      blend: ls.mixBlendMode,
      radius: ls.borderRadius,
      box: { w: R(lb.width), h: R(lb.height) },
      painted: lb.width > 0 && lb.height > 0 && Number(ls.opacity) > 0,
    };
  };

  const card = document.querySelector('.about-subscribe');
  let bleed = null;
  if (card && body) {
    const keep = card.style.transform;
    card.style.transform = 'none';
    const flat = card.getBoundingClientRect();
    card.style.transform = keep;
    const tilted = card.getBoundingClientRect();
    const clipL = bb.left, clipR = bb.left + body.clientWidth;
    const para = [...body.querySelectorAll('p')].find(p => (p.textContent||'').trim().length > 60);
    const pr = para ? para.getBoundingClientRect() : null;
    bleed = {
      cardW: card.offsetWidth,
      radius: getComputedStyle(card).borderRadius,
      border: getComputedStyle(card).borderTopStyle,
      pastTextL: pr ? R(pr.left - flat.left) : null,
      pastTextR: pr ? R(flat.right - pr.right) : null,
      slackL: R(tilted.left - clipL),
      slackR: R(clipR - tilted.right),
      clipsL: tilted.left < clipL - 0.01,
      clipsR: tilted.right > clipR + 0.01,
      hOverflow: body.scrollWidth > body.clientWidth,
      insidePanel: tilted.left > pb.left - 0.01 && tilted.right < pb.right + 0.01,
    };
  }

  const backdrop = [...document.querySelectorAll('div,button')].find(el => {
    const s = getComputedStyle(el);
    return s.position === 'fixed' && s.zIndex === '1000'
      && el.getBoundingClientRect().height === H;
  });

  return {
    viewport: W + 'x' + H,
    sheet: {
      pos: ps.position,
      top: R(pb.top), bottom: R(pb.bottom), left: R(pb.left), right: R(pb.right),
      w: R(pb.width), h: R(pb.height),
      bandAbove: R(pb.top),
      bandPctOfViewport: R((pb.top / H) * 100),
      reachesFoot: Math.abs(pb.bottom - H) < 0.6,
      fullWidth: Math.abs(pb.width - W) < 0.6,
      overflowsViewport: pb.height > H + 0.6 || pb.bottom > H + 0.6,
      radius: ps.borderRadius,
      bg: ps.backgroundColor,
      shadow: ps.boxShadow,
      overflow: ps.overflow,
      zIndex: ps.zIndex,
      transform: ps.transform,
    },
    panelPaper: paperOn(panel),
    a11y: {
      role: panel.getAttribute('role'),
      ariaModal: panel.getAttribute('aria-modal'),
      ariaLabel: panel.getAttribute('aria-label'),
      tabCount: tabs.length,
      tabsControl: tabs.map(t => t.getAttribute('aria-controls')).join(','),
      activeTabId: active ? active.id : null,
      panelLabelledBy: body ? body.getAttribute('aria-labelledby') : null,
      panelRole: body ? body.getAttribute('role') : null,
      labelMatchesActive: !!active && !!body && body.getAttribute('aria-labelledby') === active.id,
      closeBtn: !!document.querySelector('button[aria-label="Close about"]'),
    },
    tabRow: tlb ? {
      top: R(tlb.top), h: R(tlb.height),
      gapFromSheetTop: R(tlb.top - pb.top),
      insideSheet: tlb.top > pb.top - 0.01,
      activeLabel: active ? active.textContent.trim() : null,
      activeRadius: active ? getComputedStyle(active).borderRadius : null,
      activeBg: active ? getComputedStyle(active).backgroundColor : null,
      ruleColor: getComputedStyle(tablist).borderBottomColor,
      paper: paperOn(active),
    } : null,
    column: body ? {
      top: R(bb.top), h: R(bb.height),
      padding: bcs.padding,
      marginInline: bcs.marginLeft + ' / ' + bcs.marginRight,
      overscroll: bcs.overscrollBehavior,
      scrollsVertically: body.scrollHeight > body.clientHeight,
      scrollH: body.scrollHeight, clientH: body.clientHeight,
      footPad: bcs.paddingBottom,
      bottomVsSheet: R(pb.bottom - bb.bottom),
    } : null,
    bleed,
    backdrop: backdrop ? {
      bg: getComputedStyle(backdrop).backgroundColor,
      touchAction: getComputedStyle(backdrop).touchAction,
      coversViewport: R(backdrop.getBoundingClientRect().height) === R(H),
      cursor: getComputedStyle(backdrop).cursor,
    } : null,
    pageScrollY: R(window.scrollY),
  };
})()`;

// Does a flick that runs past the end of the column move the page behind it?
const SCROLL_CONTAINMENT = `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const body = document.getElementById('about-panel-body');
  const before = window.scrollY;
  body.scrollTop = body.scrollHeight;
  await sleep(120);
  const atEnd = body.scrollTop;
  // Another push once the column has nowhere left to go.
  body.dispatchEvent(new WheelEvent('wheel', { deltaY: 900, bubbles: true, cancelable: true }));
  await sleep(200);
  return {
    columnScrolled: atEnd > 0,
    columnAtEnd: Math.abs(body.scrollTop + body.clientHeight - body.scrollHeight) < 2,
    pageScrollBefore: before,
    pageScrollAfter: window.scrollY,
    pageMoved: Math.abs(window.scrollY - before) > 0.5,
    bodyOverflow: getComputedStyle(document.body).overflow,
  };
})()`;

const run = async (label, metrics, opts = {}) => {
  await send('Emulation.setDeviceMetricsOverride', metrics);
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: opts.reduceMotion ? 'reduce' : 'no-preference' }],
  });
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  const vp = await evaluate(`window.innerWidth + 'x' + window.innerHeight`);
  const want = `${metrics.width}x${metrics.height}`;
  if (vp !== want) {
    console.log(`${label}: WRONG VIEWPORT ${vp} (wanted ${want})`);
    return null;
  }

  const clicked = await evaluate(CLICK_ABOUT);
  if (clicked?.error) {
    console.log(label, 'could not open', JSON.stringify(clicked));
    return null;
  }

  // Mid-flight: caught while the sheet is still climbing.
  if (opts.midFlight) {
    await sleep(170);
    const mid = await evaluate(`(() => {
      const p = document.querySelector('[aria-label="About What We Tell AI"]');
      if (!p) return null;
      const b = p.getBoundingClientRect();
      return { top: Math.round(b.top), transform: getComputedStyle(p).transform,
               restTop: Math.round(b.top - (new DOMMatrix(getComputedStyle(p).transform)).m42) };
    })()`);
    await shoot(`/tmp/${TAG}-${opts.midFlight}-midflight.png`);
    console.log(`  mid-flight @170ms: ${JSON.stringify(mid)}  -> /tmp/${TAG}-${opts.midFlight}-midflight.png`);
  }

  await sleep(1400);
  const m = await evaluate(REPORT);
  console.log(`\n===== ${label}${opts.reduceMotion ? ' (reduced motion)' : ''} =====`);
  console.log(JSON.stringify(m, null, 1));
  return m;
};

// ── Phones ──────────────────────────────────────────────────────────────
const phone = await run('PHONE 390x844', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, { midFlight: 'phone' });
if (phone && !phone.error) {
  await shoot(`/tmp/${TAG}-390-rest.png`);
  // Tab row + sheet edge, close up.
  await shoot(`/tmp/${TAG}-390-edge.png`, { x: 0, y: Math.max(0, phone.sheet.top - 34), width: 390, height: 130 });
  console.log('containment:', JSON.stringify(await evaluate(SCROLL_CONTAINMENT)));
  // Card bleed lives further down the column.
  await evaluate(`(async () => {
    const c = document.querySelector('.about-subscribe');
    if (c) { c.scrollIntoView({ block: 'center' }); }
    await new Promise(r => setTimeout(r, 700));
  })()`);
  const cardM = await evaluate(REPORT);
  console.log('card bleed @390:', JSON.stringify(cardM.bleed ?? cardM.column));
  const cb = await evaluate(`(() => { const c = document.querySelector('.about-subscribe').getBoundingClientRect();
    return { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height) }; })()`);
  await shoot(`/tmp/${TAG}-390-card.png`, { x: 0, y: Math.max(0, cb.y - 18), width: 390, height: cb.h + 36 });

  // Paper on the tab, proven in pixels rather than in computed styles: the same
  // crop with the layer shown and hidden, and the grain read off as luminance
  // spread. Same technique as probe-paper-pixels.
  const tabBox = await evaluate(`(() => {
    const t = document.querySelector('[role="tab"][aria-selected="true"]');
    const b = t.getBoundingClientRect();
    window.__tab = t;
    window.__tabPaper = [...t.children].find(c => getComputedStyle(c).filter.includes('roughpaper'));
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
  })()`);
  const stats = async (b64) =>
    evaluate(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${b64}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, sum2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
        sum += l; sum2 += l*l; n++;
      }
      const mean = sum / n;
      return { mean: +mean.toFixed(2), stdDev: +Math.sqrt(Math.max(0, sum2/n - mean*mean)).toFixed(3) };
    })()`);
  // Inside the tab, clear of its label and its 1px outline.
  const crop = { x: tabBox.x + 2, y: tabBox.y + 2, width: tabBox.w - 4, height: 8 };
  const grab = async () => (await send('Page.captureScreenshot', { format: 'png', clip: { ...crop, scale: 1 } }))?.data;
  const withPaper = await stats(await grab());
  await evaluate(`(() => { window.__tabPaper.style.display = 'none'; return true; })()`);
  await sleep(300);
  const without = await stats(await grab());
  await evaluate(`(() => { window.__tabPaper.style.display = ''; return true; })()`);
  await sleep(300);
  console.log('tab paper pixels — with:', JSON.stringify(withPaper), ' without:', JSON.stringify(without));
  await shoot(`/tmp/${TAG}-390-tab-paper.png`, { x: tabBox.x - 6, y: tabBox.y - 6, width: tabBox.w + 12, height: tabBox.h + 12 });
  // Exit: does it go back down, and does ESC still work?
  const esc = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(120);
    const p = document.querySelector('[aria-label="About What We Tell AI"]');
    const mid = p ? { transform: getComputedStyle(p).transform, top: Math.round(p.getBoundingClientRect().top) } : null;
    await sleep(700);
    return { midExit: mid, gone: !document.querySelector('[aria-label="About What We Tell AI"]') };
  })()`);
  console.log('ESC close:', JSON.stringify(esc));
}

// ── How deep should the band be? ────────────────────────────────────────
// The archive's own compact chrome is what shows in it, so the candidates are
// measured against where that chrome ends rather than picked off a scale.
if (process.env.BAND_SWEEP) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  const marks = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    await sleep(4200);
    const R = (n) => Math.round(n * 100) / 100;
    const mark = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: R(b.top), bottom: R(b.bottom) };
    };
    const chip = [...document.querySelectorAll('button, div')]
      .find(e => /^CATEGORY/.test((e.textContent || '').trim()) && e.getBoundingClientRect().height < 60);
    const search = document.querySelector('.grid-search-input') || document.querySelector('input');
    const count = [...document.querySelectorAll('*')]
      .find(e => /^\\d+ CONFESSIONS$/.test((e.textContent || '').trim()));
    const burger = document.querySelector('button[aria-label="Open menu"]');
    return {
      burger: mark(burger),
      search: mark(search),
      chip: mark(chip),
      count: mark(count),
    };
  })()`);
  console.log('\n===== archive landmarks @390x844 (sheet closed) =====');
  console.log(JSON.stringify(marks));

  await evaluate(CLICK_ABOUT);
  await sleep(1600);
  for (const band of (process.env.BAND_SWEEP).split(',').map(Number)) {
    await evaluate(`(() => {
      const p = document.querySelector('[aria-label="About What We Tell AI"]');
      p.style.top = '${band}px';
      return true;
    })()`);
    await sleep(220);
    await shoot(`/tmp/${TAG}-band-${band}.png`);
    console.log(`  band ${band} -> /tmp/${TAG}-band-${band}.png`);
  }
}

const small = await run('SMALL PHONE 320x568', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
if (small && !small.error) await shoot(`/tmp/${TAG}-320-rest.png`);

// Landscape has to stay under the 760px compact breakpoint to be a sheet at all
// — 844 wide is the desktop drawer. 667x375 is a phone on its side; 740x320 is
// the shortest thing that still gets the sheet.
const land = await run('SHORT LANDSCAPE 667x375', { width: 667, height: 375, deviceScaleFactor: 1, mobile: true });
if (land && !land.error) await shoot(`/tmp/${TAG}-667x375-rest.png`);

const tiny = await run('VERY SHORT LANDSCAPE 740x320', { width: 740, height: 320, deviceScaleFactor: 1, mobile: true });
if (tiny && !tiny.error) await shoot(`/tmp/${TAG}-740x320-rest.png`);

// Reduced motion: appears without travel, dismisses promptly.
const rm = await run('PHONE 390x844', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, { reduceMotion: true });
if (rm && !rm.error) {
  console.log('reduced-motion transform (want none/identity):', rm.sheet.transform);
  await shoot(`/tmp/${TAG}-390-reduced.png`);
  // It still has to go away, and go away quickly.
  const rmOut = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    for (let i = 0; i < 60; i++) {
      if (!document.querySelector('[aria-label="About What We Tell AI"]')) {
        return { dismissedMs: Math.round(performance.now() - t0) };
      }
      await sleep(25);
    }
    return { dismissedMs: null, stuck: true };
  })()`);
  console.log('reduced-motion dismiss:', JSON.stringify(rmOut));
}
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

// Backdrop tap closes.
const tap = await run('PHONE 390x844 backdrop tap', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
if (tap && !tap.error) {
  // The ✕ first, then reopened for the backdrop.
  const viaX = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    document.querySelector('button[aria-label="Close about"]').click();
    await sleep(800);
    const gone = !document.querySelector('[aria-label="About What We Tell AI"]');
    document.querySelector('button[aria-label="Open menu"]').click();
    await sleep(700);
    [...document.querySelectorAll('button, a')]
      .find(b => /^about$/i.test((b.textContent||'').trim())).click();
    await sleep(1400);
    return { gone, reopened: !!document.querySelector('[aria-label="About What We Tell AI"]') };
  })()`);
  console.log('close button:', JSON.stringify(viaX));

  const closed = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    const H = window.innerHeight;
    const bd = [...document.querySelectorAll('div,button')].find(el => {
      const s = getComputedStyle(el);
      return s.position === 'fixed' && s.zIndex === '1000' && el.getBoundingClientRect().height === H;
    });
    if (!bd) return { error: 'no backdrop' };
    // A tap in the empty band above the sheet.
    const hit = document.elementFromPoint(window.innerWidth / 2, 30);
    const hitsBackdrop = hit === bd;
    bd.click();
    await sleep(900);
    return { hitsBackdrop, hitTag: hit ? hit.tagName + '.' + (hit.className||'') : null,
             gone: !document.querySelector('[aria-label="About What We Tell AI"]') };
  })()`);
  console.log('backdrop tap:', JSON.stringify(closed));
}

// ── Desktop must be untouched ───────────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?view=grid` });
const desk = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const R = (n) => Math.round(n * 100) / 100;
  const P = () => document.querySelector('[aria-label="About What We Tell AI"]');
  await sleep(4200);
  const peek = P();
  if (!peek) return { error: 'no drawer' };
  const rest = peek.getBoundingClientRect();
  const shutSliver = R(window.innerWidth - rest.left);
  // Hover lean on the shut drawer.
  peek.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  peek.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  await sleep(1000);
  const leaned = R(window.innerWidth - P().getBoundingClientRect().left);
  peek.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
  peek.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
  await sleep(900);
  const settled = R(window.innerWidth - P().getBoundingClientRect().left);
  // Open it.
  const btn = [...document.querySelectorAll('button, a')]
    .find(b => /^about$/i.test((b.textContent||'').trim()));
  btn.click();
  await sleep(1200);
  const open = P().getBoundingClientRect();
  const cs = getComputedStyle(P());
  const folderTabs = document.querySelectorAll('.about-drawer-tab').length;
  return {
    shutSliver, leaned, leanDelta: R(leaned - shutSliver), settled,
    openLeft: R(open.left), openW: R(open.width),
    openWvsVw: R((open.width / window.innerWidth) * 100) + 'vw',
    top: R(open.top), bottom: R(open.bottom), viewportH: window.innerHeight,
    radius: cs.borderRadius, inset: cs.top + '/' + cs.right + '/' + cs.bottom,
    shadow: cs.boxShadow, folderTabs,
    topTabRow: !!document.querySelector('[role="tablist"][aria-label="About sections"] [role="tab"].about-top-tab'),
    closeBtn: !!document.querySelector('button[aria-label="Close about"]'),
  };
})()`);
console.log('\n===== DESKTOP 1440x900 (must be unchanged) =====');
console.log(JSON.stringify(desk, null, 1));
await shoot(`/tmp/${TAG}-desktop-open.png`);

console.log(`\nshots in /tmp/${TAG}-*.png`);
ws.close();
chrome.kill();
