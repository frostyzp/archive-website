/**
 * Throwaway: locate + measure the note "category" and "transcript" on every
 * surface that reads a note on a phone, and prove the category's top edge sits
 * below the transcript's bottom edge with a sane gap.
 *
 * Surfaces (SURFACES=a,b,c to subset):
 *   explore        ?view=explore  — NoteOpenView standalone (mobile: vertical
 *                                   carousel + fixed category stepper)
 *   index-overlay  ?view=grid + tap tile — NoteOpenView overlay
 *   theme-drawer   ?view=theme + tap note — NoteDrawer (Theme row / Transcription)
 *   wall-lightbox  ?view=wall  + tap tile — Lightbox (THEME row / transcription)
 *
 * MODE=discover dumps text-bearing elements with rects, in top order.
 * MODE=measure  reports the pair + gap, and screenshots each surface.
 *
 * Env: WIDTHS=390x844,320x844  TAG=before|after  NOTE=<index of tile to open>
 * Safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = Number(process.env.PORT || 9351);
const MODE = process.env.MODE || 'measure';
const TAG = process.env.TAG || 'before';
const NOTE = Number(process.env.NOTE || 0);
/** Extra settle before measuring. The meta / transcription blocks enter with a
 *  6px rise, and a rect read while that is still running reports every block 6px
 *  low — which reads exactly like a layout change if you don't wait it out. */
const SETTLE = Number(process.env.SETTLE || 0);
const SHOT = process.env.SHOT !== '0';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/cat-transcript-profile-${PORT}`,
  '--window-size=390,844',
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
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { __error: r.exceptionDetails.text || JSON.stringify(r.exceptionDetails) };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

async function viewport(width, height) {
  const mobile = width < 760;
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    ...(mobile ? { screenWidth: width, screenHeight: height } : {}),
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 0 });
}

async function goto(url) {
  await send('Page.navigate', { url: `${BASE}${url}` });
  await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    for (let i = 0; i < 200; i++) {
      if (document.querySelector('img')) break;
      await sleep(100);
    }
    await sleep(2900);
    return true;
  })()`);
}

/** Click the Nth note image. `min` drops the wordmark and, on normal views, any
 *  chrome glyphs; the Experiment contact sheet needs it lowered to ~20px. */
const clickTile = (n, min = 60) => `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const tiles = [...document.querySelectorAll('img')]
    .map((i) => ({ i, r: i.getBoundingClientRect() }))
    .filter(({ i, r }) => r.width > ${min} && r.height > ${min} && !/logo|wordmark/i.test(i.src || ''))
    .sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left));
  if (!tiles.length) return 'no tile';
  const pick = tiles[Math.min(${n}, tiles.length - 1)].i;
  pick.scrollIntoView({ block: 'center' });
  await sleep(400);
  const clickable = pick.closest('[data-vcard], [role="button"], button, a') || pick;
  clickable.click();
  pick.click();
  await sleep(2800);
  return 'clicked';
})()`;

/** ThemeView → NoteDrawer: only the active MIDDLE copy's tilt box enlarges, and
 *  it advertises itself with cursor:zoom-in — the reliable way to find it among
 *  the stack's duplicate copies. */
const clickActiveCard = (n = 0) => `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const drawer = () => document.querySelector('[role="dialog"][aria-label="Note detail"]');
  // Stepping notes: clicking a NON-active card only activates it (the enlarge
  // click is gated on isActive), so reaching note n takes activate-then-open.
  if (${n} > 0) {
    const cards = [...document.querySelectorAll('[data-card]')];
    const target = cards[Math.min(${n}, cards.length - 1)];
    if (target) {
      (target.querySelector('[data-tilt-target]') || target).click();
      await sleep(1400);
    }
  }
  const zoom = [...document.querySelectorAll('[data-tilt-target]')]
    .filter((el) => getComputedStyle(el).cursor === 'zoom-in');
  const targets = zoom.length
    ? zoom
    : [...document.querySelectorAll('[data-card][data-active] [data-tilt-target]')];
  if (!targets.length) return 'no enlarge target';
  for (const box of targets) {
    box.scrollIntoView({ block: 'center' });
    await sleep(300);
    box.click();
    await sleep(1600);
    if (drawer()) { await sleep(1400); return 'clicked'; }
  }
  return 'clicked (no drawer)';
})()`;

const DISCOVER = `(() => {
  const out = [];
  const walk = (el, depth) => {
    if (depth > 44) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      if (own.length > 0 || el.tagName === 'IMG') {
        const cs = getComputedStyle(el);
        out.push({
          tag: el.tagName.toLowerCase(),
          data: [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name).join(','),
          aria: el.getAttribute('aria-label') || '',
          text: (own || '').slice(0, 60),
          top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
          w: Math.round(r.width), h: Math.round(r.height),
          pos: cs.position, order: cs.order,
          size: cs.fontSize,
        });
      }
    }
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(document.body, 0);
  return out.sort((a, b) => a.top - b.top);
})()`;

/* Finds the pair structurally, so the same probe reads before + after.
 *
 * transcript — in order of preference:
 *   1. the block right after a "Transcription" label (NoteDrawer / Lightbox)
 *   2. the union of [data-word] spans (EXPLORE's animated TranscriptReveal)
 *   3. the largest run of prose
 * category — in order of preference:
 *   1. the row whose label is Theme / THEME (NoteDrawer / Lightbox / caption)
 *   2. the fixed-position uppercase chrome word (EXPLORE's stepper)
 */
const MEASURE = `(() => {
  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    if (parseFloat(s.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('').trim();

  let transcript = null, transcriptVia = null;

  /* Scope: when a Theme/THEME meta row is on screen (Lightbox / NoteDrawer /
   * caption), the note's own column is the nearest ancestor of that row that
   * also holds a large image. Searching inside it keeps the wall view's few
   * hundred background tiles from winning the "largest prose" contest. */
  const themeRowEl = [...document.querySelectorAll('span, div')].find((el) => vis(el) && /^theme$/i.test(ownText(el)));
  let scope = document.body;
  let scopeVia = 'document';
  if (themeRowEl) {
    let n = themeRowEl;
    for (let i = 0; i < 12 && n && n !== document.body; i++) {
      n = n.parentElement;
      if (!n) break;
      const img = [...n.querySelectorAll('img')].find((im) => im.getBoundingClientRect().width > 150);
      if (img) { scope = n; scopeVia = 'note column (Theme row + image)'; break; }
    }
  }
  /* The column child that holds the metadata. Its values are prose-shaped
   * ("San Francisco, CA") and on some notes out-measure a terse transcription
   * ("Never fucking used it"), so the transcript search excludes it wholesale
   * rather than trying to out-score it. */
  const metaChild = scope === document.body || !themeRowEl
    ? null
    : [...scope.children].find((c) => c.contains(themeRowEl)) || null;

  const tLabel = [...scope.querySelectorAll('div, span')].find((el) => vis(el) && /^transcription$/i.test(ownText(el)));
  if (tLabel) {
    // The prose sits next to the label inside a shared wrapper.
    const body = tLabel.nextElementSibling
      || [...(tLabel.parentElement?.children || [])].find((c) => c !== tLabel && (c.textContent || '').trim().length > 20);
    if (body && vis(body)) {
      transcript = rect(body);
      transcript.text = (body.textContent || '').trim().slice(0, 50);
      transcript.len = (body.textContent || '').trim().length;
      transcript.labelRect = rect(tLabel);
      transcriptVia = 'Transcription label + body';
    }
  }

  if (!transcript) {
    const words = [...document.querySelectorAll('[data-word]')].filter(vis);
    if (words.length) {
      const rs = words.map((w) => w.getBoundingClientRect());
      transcript = {
        top: Math.round(Math.min(...rs.map((r) => r.top))),
        bottom: Math.round(Math.max(...rs.map((r) => r.bottom))),
        left: Math.round(Math.min(...rs.map((r) => r.left))),
        right: Math.round(Math.max(...rs.map((r) => r.right))),
        w: Math.round(Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left))),
        h: Math.round(Math.max(...rs.map((r) => r.bottom)) - Math.min(...rs.map((r) => r.top))),
        text: words.map((w) => w.textContent).join(' ').slice(0, 50),
        len: words.map((w) => w.textContent).join(' ').length,
        words: words.length,
      };
      transcriptVia = '[data-word] union (TranscriptReveal)';
      // The block that actually owns those words, for parent/order reporting.
      const host = words[0].closest('div');
      if (host) transcript.hostRect = rect(host);
    }
  }

  if (!transcript) {
    // Lightbox: the transcription carries no label, so it is found as the run of
    // prose that is NOT a metadata value. Metadata values are recognised by the
    // all-caps label sitting beside them in their row — that structural test is
    // what keeps "San Francisco, CA" out, rather than a length threshold (some
    // transcriptions are only a few words: "Never fucking used it").
    const META_LABEL = /^(DATE|LOCATION|THEME|COLLECTED|NOTE)$/i;
    const inMetaRow = (el) => {
      const row = el.parentElement;
      if (!row) return false;
      return [...row.children].some((c) => {
        if (c === el) return false;
        const own = ownText(c);
        return own && META_LABEL.test(own);
      });
    };
    const prose = [...scope.querySelectorAll('div, p, span')].filter((el) => {
      if (!vis(el)) return false;
      // A wrapper around a <style> reports the whole CSS payload as textContent.
      if (el.querySelector('style, script')) return false;
      if (metaChild && (metaChild === el || metaChild.contains(el))) return false;
      const t = (el.textContent || '').trim();
      if (t.length < 12 || !/[a-z]{3}/.test(t)) return false;
      if (/@keyframes|\\{|\\}|px;/.test(t)) return false;
      if (META_LABEL.test(t)) return false;
      if (inMetaRow(el)) return false;
      // innermost element owning essentially this whole string
      return ![...el.children].some((c) => (c.textContent || '').trim().length > t.length * 0.8);
    }).sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0];
    if (prose) {
      transcript = rect(prose);
      transcript.text = (prose.textContent || '').trim().slice(0, 50);
      transcript.len = (prose.textContent || '').trim().length;
      transcriptVia = 'unlabelled prose run (not a meta value)';
    }
  }

  let category = null, categoryVia = null;

  const cLabel = [...document.querySelectorAll('span, div')].find((el) => vis(el) && /^theme$/i.test(ownText(el)));
  if (cLabel) {
    const row = cLabel.parentElement;
    const val = [...(row?.children || [])].find((c) => c !== cLabel && (c.textContent || '').trim());
    category = rect(row || cLabel);
    category.text = val ? (val.textContent || '').trim() : ownText(cLabel);
    category.labelRect = rect(cLabel);
    if (val) category.valueRect = rect(val);
    categoryVia = 'Theme/THEME meta row';
  }

  if (!category) {
    // EXPLORE / THEME chrome: the category word, set in a fixed bottom-docked
    // block. The DOM text is mixed case ("Therapist") and CSS uppercases it, so
    // match on the rendered casing, not the source string.
    const RESERVED = /^(INDEX|EXPLORE|BACK|LEFT|RIGHT|THEME|DATE|LOCATION|ABOUT|N\\/A|NOTE|NOTES|CATEGORY)$/;
    const chrome = [...document.querySelectorAll('div, span, button')].filter((el) => {
      if (!vis(el)) return false;
      const raw = ownText(el);
      if (!raw) return false;
      const cs = getComputedStyle(el);
      const shown = cs.textTransform === 'uppercase' ? raw.toUpperCase() : raw;
      // A single word / short phrase of letters — the category name, stripped of
      // the decorative brackets THEME view draws around it.
      const bare = shown.replace(/^[\\[\\(\\s]+|[\\]\\)\\s]+$/g, '').trim();
      if (!/^[A-Z][A-Z /&'-]{1,26}$/.test(bare)) return false;
      if (RESERVED.test(bare)) return false;
      let n = el, fixed = false;
      for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
        if (getComputedStyle(n).position === 'fixed') { fixed = true; break; }
      }
      if (!fixed) return false;
      return true;
    });
    if (chrome.length) {
      // The lowest such word is the docked category feature.
      const el = chrome.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
      category = rect(el);
      category.text = ownText(el);
      categoryVia = 'docked category label (fixed chrome)';
    }
  }

  /* DOM order of the note column's children, plus any CSS order override, so
   * the report can state whether visual order and reading order agree. */
  const columnChildren = scope === document.body ? null : [...scope.children].map((c, i) => {
    const cs = getComputedStyle(c);
    const r = c.getBoundingClientRect();
    const label = c.querySelector('img') ? 'IMAGE'
      : /^theme$/i.test(ownText(c.querySelector('span, div') || c)) ? 'META(+theme)'
      : (c.textContent || '').trim().slice(0, 28) || '(empty)';
    return { domIndex: i, label, cssOrder: cs.order, top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });

  return {
    url: location.href, vw: innerWidth, vh: innerHeight,
    scopeVia, columnChildren,
    transcript, transcriptVia, category, categoryVia,
  };
})()`;

/* Lightbox slot sweep: the transcription sits in a slot of a FIXED number of
 * lines, and long notes overflow it rather than growing it. That was invisible
 * while nothing followed the slot; with the category moved underneath, overflow
 * becomes a collision. Steps through notes and reports the tallest text against
 * the slot, i.e. how many lines the slot actually has to hold. */
const SWEEP = `(() => {
  const slot = [...document.querySelectorAll('div')].filter((d) => {
    const cs = getComputedStyle(d);
    if (cs.flexShrink !== '0') return false;
    const h = parseFloat(cs.height);
    // 4 lines of 14px/1.55 ≈ 86.8px — the transcription slot's declared height.
    if (!(h > 60 && h < 200)) return false;
    const p = d.querySelector('p, span');
    return !!p && (p.textContent || '').trim().length > 0;
  })[0];
  if (!slot) return { none: true };
  const text = slot.querySelector('p, span');
  const lh = parseFloat(getComputedStyle(text).lineHeight);
  const th = text.getBoundingClientRect().height;
  const sh = slot.getBoundingClientRect().height;
  return {
    chars: (text.textContent || '').trim().length,
    textH: Math.round(th),
    slotH: Math.round(sh),
    lines: Math.round(th / lh),
    slotLines: Math.round(sh / lh),
    overflow: Math.round(th - sh),
  };
})()`;

const ALL = {
  explore: { url: '/?view=explore', open: null },
  theme: { url: '/?view=theme', open: null },
  'index-overlay': { url: '/?view=grid', open: clickTile(NOTE) },
  'theme-drawer': { url: '/?view=theme', open: clickActiveCard(NOTE) },
  'wall-lightbox': { url: '/?view=wall', open: clickTile(NOTE) },
  // Hidden tab, but a tap (not just hover) fills the stage, so it IS a phone
  // surface: contact-sheet thumbnail → enlarged note + caption.
  experiment: { url: '/?view=experiment', open: clickTile(NOTE, 20) },
};
const names = (process.env.SURFACES || Object.keys(ALL).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const WIDTHS = (process.env.WIDTHS || '390x844,320x844').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number);
  return { w, h: h || 844 };
});

if (MODE === 'sweep') {
  const steps = Number(process.env.STEPS || 40);
  for (const { w, h } of WIDTHS) {
    await viewport(w, h);
    await goto('/?view=wall');
    await evaluate(clickTile(0));
    let worst = null;
    const seen = [];
    for (let i = 0; i < steps; i++) {
      const s = await evaluate(SWEEP);
      if (s && !s.none && !s.__error) {
        seen.push(s);
        if (!worst || s.textH > worst.textH) worst = s;
      }
      // ArrowRight / d steps the Lightbox to the next note.
      await evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return true; })()`);
      await sleep(450);
    }
    const slotLines = seen.length ? seen[0].slotLines : '?';
    console.log(`\n===== SLOT SWEEP @ ${w}x${h} (${seen.length}/${steps} notes read) =====`);
    console.log(`  slot holds ${slotLines} lines (${seen.length ? seen[0].slotH : '?'}px)`);
    if (worst) {
      console.log(`  tallest transcription: ${worst.chars} chars, ${worst.lines} lines, ${worst.textH}px → overflow ${worst.overflow}px`);
      const over = seen.filter((s) => s.overflow > 0);
      console.log(`  notes overflowing the slot: ${over.length}/${seen.length}` +
        (over.length ? `  (max ${Math.max(...over.map((s) => s.lines))} lines)` : ''));
      const hist = {};
      for (const s of seen) hist[s.lines] = (hist[s.lines] || 0) + 1;
      console.log('  lines → count: ' + Object.keys(hist).sort((a, b) => a - b).map((k) => `${k}:${hist[k]}`).join('  '));
    }
  }
  ws.close();
  chrome.kill();
  process.exit(0);
}

const results = [];
for (const name of names) {
  const surface = ALL[name];
  if (!surface) { console.log(`unknown surface ${name}`); continue; }
  for (const { w, h } of WIDTHS) {
    await viewport(w, h);
    await goto(surface.url);
    if (surface.open) {
      const r = await evaluate(surface.open);
      if (r !== 'clicked') console.log(`  [${name} @${w}] open: ${JSON.stringify(r)}`);
    }
    if (SETTLE) await sleep(SETTLE);

    if (MODE === 'discover') {
      const dump = await evaluate(DISCOVER);
      console.log(`\n===== DISCOVER ${name} @ ${w}x${h} =====`);
      if (!Array.isArray(dump)) { console.log(JSON.stringify(dump)); continue; }
      for (const d of dump) {
        console.log(
          `y ${String(d.top).padStart(5)}–${String(d.bottom).padEnd(5)} x${String(d.left).padStart(4)} ` +
          `${String(d.w).padStart(4)}x${String(d.h).padEnd(4)} ${d.tag.padEnd(6)} ${d.pos.padEnd(8)} ord:${String(d.order).padEnd(4)} ${String(d.size).padEnd(8)} ` +
          `${d.data ? '[' + d.data + '] ' : ''}${d.aria ? '{' + d.aria + '} ' : ''}${JSON.stringify(d.text)}`
        );
      }
      continue;
    }

    const m = await evaluate(MEASURE);
    const row = { name, w, h, ...m };
    results.push(row);
    console.log(`\n===== ${TAG.toUpperCase()} ${name} @ ${w}x${h} =====`);
    if (m?.__error) { console.log(m.__error); continue; }
    console.log(`  transcript (${m.transcriptVia}): ${m.transcript ? `y ${m.transcript.top}–${m.transcript.bottom} x ${m.transcript.left}–${m.transcript.right} (${m.transcript.len} chars) ${JSON.stringify(m.transcript.text)}` : 'NOT FOUND'}`);
    console.log(`  category   (${m.categoryVia}): ${m.category ? `y ${m.category.top}–${m.category.bottom} x ${m.category.left}–${m.category.right} ${JSON.stringify(m.category.text)}` : 'NOT FOUND'}`);
    if (m.columnChildren) {
      console.log(`  column children (DOM order → visual top), scope: ${m.scopeVia}`);
      for (const c of m.columnChildren) {
        console.log(`    [${c.domIndex}] order:${String(c.cssOrder).padEnd(4)} y ${String(c.top).padStart(4)}–${String(c.bottom).padEnd(4)} ${JSON.stringify(c.label)}`);
      }
    }
    if (m.transcript && m.category) {
      const gap = m.category.top - m.transcript.bottom;
      console.log(`  → ${gap >= 0 ? `category BELOW transcript, gap ${gap}px` : `category ABOVE/overlapping transcript (${gap}px)`}`);
    }
    if (SHOT) {
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      if (s?.data) {
        const p = `/tmp/catorder-${TAG}-${name}-${w}.png`;
        fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
        console.log(`  shot: ${p}`);
      }
    }
  }
}

console.log('\n===== SUMMARY (' + TAG + ') =====');
for (const r of results) {
  const verdict = !r.transcript || !r.category
    ? (!r.transcript && !r.category ? 'neither element present' : !r.category ? 'no category on this surface' : 'no transcript on this surface')
    : (r.category.top - r.transcript.bottom >= 0
        ? `OK  category below (gap ${r.category.top - r.transcript.bottom}px)`
        : `BAD category above (${r.category.top - r.transcript.bottom}px)`);
  console.log(`  ${String(r.name).padEnd(15)} @${String(r.w).padEnd(5)} ${verdict}`);
}

ws.close();
chrome.kill();
