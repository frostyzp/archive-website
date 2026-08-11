/**
 * The caret on the INDEX sidebar's Category/Location accordion headers. For each
 * header: reads the glyph, its computed transform in both the expanded and the
 * collapsed state (clicking to toggle), the caret box, and the gap between the
 * label's right edge and the caret — so the chevron can be checked for pointing
 * down when open / right when closed, and for optical alignment against the
 * 13px label. Shoots each header at 3x in both states.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9377;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/facet-caret-profile',
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
await send('Page.navigate', { url: `${BASE}/?view=grid` });

const ready = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 120; i++) {
    if (document.querySelectorAll('.facet-accordion-btn').length) break;
    await sleep(200);
  }
  await sleep(2200);
  return document.querySelectorAll('.facet-accordion-btn').length;
})()`);

const MEASURE = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  return [...document.querySelectorAll('.facet-accordion-btn')].map((btn) => {
    const caret = btn.querySelector('span[aria-hidden="true"]');
    const label = [...btn.children].find((el) => el !== caret);
    const cs = getComputedStyle(caret);
    const cb = caret.getBoundingClientRect();
    const lb = label.getBoundingClientRect();
    const bb = btn.getBoundingClientRect();
    return {
      label: (label.textContent || '').trim(),
      expanded: btn.getAttribute('aria-expanded') === 'true',
      glyph: (caret.textContent || '').trim(),
      glyphCodePoint: 'U+' + (caret.textContent || '').trim().codePointAt(0).toString(16).toUpperCase(),
      ariaHidden: caret.getAttribute('aria-hidden'),
      transform: cs.transform,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      fontFamily: cs.fontFamily.split(',')[0],
      opacity: cs.opacity,
      caretBox: { x: round(cb.left), y: round(cb.top), w: round(cb.width), h: round(cb.height) },
      // Positive = caret sits to the right of the label with clear air between.
      gapLabelToCaret: round(cb.left - lb.right),
      // Both relative to the header's text box, to judge optical centring.
      caretCenterY: round(cb.top + cb.height / 2),
      labelCenterY: round(lb.top + lb.height / 2),
      caretVsLabelCenterY: round((cb.top + cb.height / 2) - (lb.top + lb.height / 2)),
      caretRightEdgeToButtonRight: round(bb.right - cb.right),
      clip: { x: Math.round(bb.left) - 4, y: Math.round(bb.top) - 4, width: Math.round(bb.width) + 8, height: Math.round(bb.height) + 8, scale: 3 },
    };
  });
})()`;

const shoot = async (clip, file) => {
  const s = await send('Page.captureScreenshot', { format: 'png', clip });
  if (s?.data) fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  return file;
};

const out = { headerCount: ready, shots: [], states: {} };

// Both accordions open on load; measure that, then click each shut and measure again.
const asLoaded = await evaluate(MEASURE);
out.states.asLoaded = asLoaded;
for (const [i, h] of asLoaded.entries()) {
  out.shots.push(await shoot(h.clip, `/tmp/facet-caret-${h.label.split(' ')[0].toLowerCase()}-${h.expanded ? 'open' : 'closed'}.png`));
  void i;
}

await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (const b of document.querySelectorAll('.facet-accordion-btn')) { b.click(); await sleep(120); }
  await sleep(600);
  return true;
})()`);

const afterToggle = await evaluate(MEASURE);
out.states.afterToggle = afterToggle;
for (const h of afterToggle) {
  out.shots.push(await shoot(h.clip, `/tmp/facet-caret-${h.label.split(' ')[0].toLowerCase()}-${h.expanded ? 'open' : 'closed'}.png`));
}

// rotate(90deg) as a matrix is 0,1,-1,0; identity is the resting right-pointing glyph.
const readTransform = (t) => (t === 'none' ? 'none (points right)' : t.startsWith('matrix(0, 1, -1, 0') ? `${t} → rotated 90° cw (points down)` : t);
out.summary = ['asLoaded', 'afterToggle'].flatMap((k) =>
  out.states[k].map((h) => `${k} · ${h.label} · aria-expanded=${h.expanded} · glyph "${h.glyph}" ${h.glyphCodePoint} · ${readTransform(h.transform)} · box ${h.caretBox.w}x${h.caretBox.h} · gap ${h.gapLabelToCaret}px · caretY-labelY ${h.caretVsLabelCenterY}px`)
);

console.log(JSON.stringify(out, null, 1));

ws.close();
chrome.kill();
