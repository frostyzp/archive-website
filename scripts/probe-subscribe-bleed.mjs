/**
 * The About drawer's mailing-list card, measured for a deliberate outward bleed:
 * how wide it is, where its untransformed box sits against the copy column's
 * inset, and whether the tilted card (and its dashed edge) still clears the
 * panel body's clip and the column's scrollbar on both sides.
 *
 * Reports desktop (1440x900) and phone (390x844). `MARGIN` / `MARGIN_PHONE`
 * override `margin-inline` in the page for a dry-run sweep before touching the
 * source; unset, it measures whatever is shipped.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
// Random port per run: a fixed one gets squatted by a leftover headless Chrome
// from an earlier probe, and connecting to that browser silently inherits its
// device-metrics override. Other agents run probes here too, so this picks a
// free port rather than killing anything.
const PORT = 9400 + (process.pid % 500);
const TAG = process.env.TAG || 'bleed';
const SWEEP = process.env.SWEEP ? process.env.SWEEP.split(',').map((s) => s.trim()) : null;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  // Fresh profile per run: Chrome is single-instance per user-data-dir, so a
  // reused one silently attaches to a leftover browser still carrying the last
  // run's device-metrics override.
  `--user-data-dir=/tmp/subscribe-bleed-profile-${process.pid}`,
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

// The phone hides ABOUT behind the burger, so open that first when it is there.
const OPEN_ABOUT = `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const about = () => [...document.querySelectorAll('button, a')]
    .find(b => /^about$/i.test((b.textContent||'').trim()));
  await sleep(3600);
  const burger = document.querySelector('button[aria-label="Open menu"]');
  if (burger) { burger.click(); await sleep(700); }
  const btn = about();
  if (!btn) return { error: 'no about control' };
  btn.click();
  await sleep(2200);
  const card = document.querySelector('.about-subscribe');
  if (card) { card.scrollIntoView({ block: 'center' }); await sleep(900); }
  return !!card;
})()`;

/* Dry-run the whole change in the page: the card bleeds out by `bleed`, and the
   scroll container's clip opens by `gutter` while its padding puts the copy back
   exactly where it was — so the text column does not move and only the clip
   grows. `null` restores whatever is shipped. */
const applyBleed = (bleed, gutter) => `(() => {
  const c = document.querySelector('.about-subscribe');
  const b = document.getElementById('about-panel-body');
  if (!c || !b) return false;
  ${bleed === null
    ? `c.style.marginLeft=''; c.style.marginRight='';
       b.style.marginLeft=''; b.style.marginRight='';
       b.style.paddingLeft=''; b.style.paddingRight='';`
    : `c.style.marginLeft = '${-bleed}px';
       c.style.marginRight = '${-bleed}px';
       b.style.marginLeft = '${-gutter}px';
       b.style.marginRight = '${-gutter}px';
       b.style.paddingLeft = '${gutter}px';
       b.style.paddingRight = '${gutter}px';`}
  return true;
})()`;

const REPORT = `(() => {
  const card = document.querySelector('.about-subscribe');
  const body = document.getElementById('about-panel-body');
  if (!card || !body) return { error: 'card or panel body missing' };
  const cs = getComputedStyle(card);
  const R = (n) => Math.round(n * 100) / 100;

  // Untransformed layout box: the tilt makes getBoundingClientRect the rotated
  // envelope, which is not the width the card is laid out at. Drop the rotation
  // for one read (no paint in between) and put it straight back.
  const keep = card.style.transform;
  card.style.transform = 'none';
  const flat = card.getBoundingClientRect();
  card.style.transform = keep;
  // Rotated envelope: leftmost/rightmost of any corner, which is what the
  // panel's clip actually has to contain.
  const tilted = card.getBoundingClientRect();

  const bcs = getComputedStyle(body);
  const bodyBox = body.getBoundingClientRect();
  // overflow clips to the padding box; a vertical scrollbar eats into it on the
  // right, so the region content can legally occupy is clientWidth wide.
  const sbW = body.offsetWidth - body.clientWidth;
  const clipL = bodyBox.left;
  const clipR = bodyBox.left + body.clientWidth;

  // Where the copy column's text actually starts/ends, as a visual reference for
  // the inset the card is bleeding past.
  const para = [...body.querySelectorAll('p')].find((p) => (p.textContent || '').trim().length > 60);
  const paraBox = para ? para.getBoundingClientRect() : null;

  const panel = document.querySelector('[aria-label="About What We Tell AI"]');
  const panelBox = panel ? panel.getBoundingClientRect() : null;

  const btn = card.querySelector('button[type="submit"]');

  return {
    // --- preserved treatment ---
    border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
    borderAllSides: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join('/')
      + ' ' + [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle].join('/'),
    radius: cs.borderRadius,
    background: cs.backgroundColor,
    padding: cs.padding,
    submitRadius: btn ? getComputedStyle(btn).borderRadius : null,
    submitWidth: btn ? btn.offsetWidth : null,
    transform: cs.transform,

    // --- width + placement ---
    marginInline: cs.marginLeft + ' / ' + cs.marginRight,
    cardWidth: card.offsetWidth,
    flatBox: { left: R(flat.left), right: R(flat.right), w: R(flat.width) },
    clipBox: { left: R(clipL), right: R(clipR), w: body.clientWidth },
    bleedPastClipLeft: R(clipL - flat.left),
    bleedPastClipRight: R(flat.right - clipR),
    textInset: paraBox ? { left: R(paraBox.left), right: R(paraBox.right), w: R(paraBox.width) } : null,
    bleedPastTextLeft: paraBox ? R(paraBox.left - flat.left) : null,
    bleedPastTextRight: paraBox ? R(flat.right - paraBox.right) : null,

    // --- overflow / clipping ---
    scrollbarW: sbW,
    scrollsVertically: body.scrollHeight > body.clientHeight,
    bodyOuterWidth: body.offsetWidth,
    bodyPaddingInline: bcs.paddingLeft + ' / ' + bcs.paddingRight,
    bodyMarginInline: bcs.marginLeft + ' / ' + bcs.marginRight,
    bodyPaddingBox: { left: R(bodyBox.left), right: R(bodyBox.right) },
    scrollWidth: body.scrollWidth,
    clientWidth: body.clientWidth,
    horizontalOverflow: body.scrollWidth > body.clientWidth,
    // Room between the card's tilted right edge and the scrollbar, which sits at
    // the padding box's right edge. (This headless Chrome draws overlay
    // scrollbars, so sbW is 0; a classic bar shrinks the content box and the
    // clip by the same amount, so the room either side is unchanged.)
    scrollbarClearance: R(bodyBox.left + body.offsetWidth - sbW - tilted.right),
    // The section heading rides the same tilt off the same edge; watched so the
    // widened clip is not quietly changing how it is cropped.
    headBox: (() => {
      const h = body.querySelector('h2');
      if (!h) return null;
      const hb = h.getBoundingClientRect();
      return { left: R(hb.left), right: R(hb.right), clippedLeft: hb.left < bodyBox.left - 0.01 };
    })(),
    tiltedBox: { left: R(tilted.left), right: R(tilted.right), w: R(tilted.width) },
    // Room the tilted envelope (border included) has left before the clip edge.
    slackLeft: R(tilted.left - clipL),
    slackRight: R(clipR - tilted.right),
    clipsLeft: tilted.left < clipL - 0.01,
    clipsRight: tilted.right > clipR + 0.01,
    panelBox: panelBox ? { left: R(panelBox.left), right: R(panelBox.right), w: R(panelBox.width) } : null,
    insidePanel: panelBox ? tilted.left > panelBox.left && tilted.right < panelBox.right : null,
    viewport: window.innerWidth + 'x' + window.innerHeight,
  };
})()`;

const shoot = async (file, clip) => {
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
  if (s?.data) fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  return file;
};

const brief = (m) => {
  if (m?.error) return m;
  return {
    cardWidth: m.cardWidth,
    textLeft: m.textInset?.left,
    bleed: `L ${m.bleedPastTextLeft} / R ${m.bleedPastTextRight}`,
    slack: `L ${m.slackLeft} / R ${m.slackRight}`,
    clipped: m.clipsLeft || m.clipsRight,
    hOverflow: m.horizontalOverflow,
    sbClear: m.scrollbarClearance,
    panelEdgeGap: m.panelBox ? Math.round((m.tiltedBox.left - m.panelBox.left) * 100) / 100 : null,
  };
};

const run = async (label, metrics) => {
  // Always overridden rather than cleared: the headless window's own viewport is
  // 1440x813, so "desktop" has to be stated to be the 1440x900 being reported.
  await send('Emulation.setDeviceMetricsOverride', metrics);
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  const vp = await evaluate(`window.innerWidth + 'x' + window.innerHeight`);
  const want = `${metrics.width}x${metrics.height}`;
  if (vp !== want) {
    console.log(`${label}: WRONG VIEWPORT ${vp} (wanted ${want}) — attached to the wrong browser?`);
    return;
  }
  const opened = await evaluate(OPEN_ABOUT);
  if (opened?.error || !opened) {
    console.log(label, 'could not open drawer', JSON.stringify(opened));
    return;
  }

  const shipped = await evaluate(REPORT);
  console.log(`\n===== ${label} — as shipped =====`);
  console.log(JSON.stringify(shipped, null, 1));

  if (SWEEP) {
    console.log(`\n----- ${label} — sweep (bleed:gutter) -----`);
    for (const pair of SWEEP) {
      const [bleed, gutter] = pair.split(':').map(Number);
      await evaluate(applyBleed(bleed, Number.isFinite(gutter) ? gutter : bleed + 6));
      await sleep(140);
      const m = await evaluate(REPORT);
      console.log(pair.padStart(7) + '  ' + JSON.stringify(brief(m)));
    }
    await evaluate(applyBleed(null));
    await sleep(160);
  }

  // The widened clip belongs to the column, not to the card, so the other two
  // sections have to be checked for overflow as well.
  const tabs = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    const out = [];
    const body = document.getElementById('about-panel-body');
    for (const name of ['ABOUT', 'PROCESS', 'THE WHY']) {
      const tab = [...document.querySelectorAll('[role="tab"], button')]
        .find(b => (b.textContent||'').trim().toUpperCase() === name);
      if (!tab) { out.push({ name, missing: true }); continue; }
      tab.click();
      await sleep(700);
      const widest = [...body.querySelectorAll('*')].reduce((a, el) => {
        const r = el.getBoundingClientRect();
        return r.right > a ? r.right : a;
      }, 0);
      out.push({
        name,
        scrollWidth: body.scrollWidth,
        clientWidth: body.clientWidth,
        hOverflow: body.scrollWidth > body.clientWidth,
        widestRightVsClip: Math.round((widest - (body.getBoundingClientRect().left + body.clientWidth)) * 100) / 100,
      });
    }
    return out;
  })()`);
  console.log(`--- ${label} — per-section overflow ---`);
  console.log(JSON.stringify(tabs));

  return shipped;
};

// Desktop: right-side drawer at 33vw.
const desktop = await run('DESKTOP 1440x900', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});
if (desktop && !desktop.error) {
  const cardY = await evaluate(`(() => {
    const c = document.querySelector('.about-subscribe').getBoundingClientRect();
    return { y: Math.round(c.top), h: Math.round(c.height), x: Math.round(c.left), w: Math.round(c.width) };
  })()`);
  const p = desktop.panelBox;
  await shoot(`/tmp/${TAG}-desktop-panel.png`, {
    x: Math.floor(p.left) - 8, y: 0, width: Math.ceil(p.w) + 16, height: 900,
  });
  await shoot(`/tmp/${TAG}-desktop-card.png`, {
    x: cardY.x - 20, y: cardY.y - 20, width: cardY.w + 40, height: cardY.h + 40,
  });
  console.log(`shots: /tmp/${TAG}-desktop-panel.png /tmp/${TAG}-desktop-card.png`);
}

// Phone: full-bleed takeover.
const phone = await run('PHONE 390x844', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
if (phone && !phone.error) {
  const cardY = await evaluate(`(() => {
    const c = document.querySelector('.about-subscribe').getBoundingClientRect();
    return { y: Math.round(c.top), h: Math.round(c.height), x: Math.round(c.left), w: Math.round(c.width) };
  })()`);
  await shoot(`/tmp/${TAG}-phone-panel.png`, { x: 0, y: 0, width: 390, height: 844 });
  await shoot(`/tmp/${TAG}-phone-card.png`, {
    x: Math.max(0, cardY.x - 20), y: cardY.y - 20, width: Math.min(390, cardY.w + 40), height: cardY.h + 40,
  });
  console.log(`shots: /tmp/${TAG}-phone-panel.png /tmp/${TAG}-phone-card.png`);
}

ws.close();
chrome.kill();
