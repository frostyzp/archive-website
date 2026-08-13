/**
 * Does the beats rail paint anything behind its marks?
 *
 * Reads the computed background, shadow and pseudo-element fills for the nav,
 * its buttons and the rules themselves, then samples the actual pixels just
 * outside the leftmost mark and compares them to page background far away from
 * the rail. If the rail were painting a panel, those two samples would differ.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9860 + (process.pid % 40);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/beats-bg-${process.pid}`,
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
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (e) =>
  (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))
    ?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${BASE}/` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`!!document.querySelector('nav[aria-label="Beats"]')`)) break;
  await sleep(500);
}
await sleep(1200);

/* Step off the hero so the rail is lit — on beat 0 it's faded out entirely. */
for (const type of ['rawKeyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', {
    type,
    key: 'ArrowDown',
    code: 'ArrowDown',
    windowsVirtualKeyCode: 40,
    nativeVirtualKeyCode: 40,
  });
}
await sleep(2000);

const paint = await evaluate(`
  (() => {
    const nav = document.querySelector('nav[aria-label="Beats"]');
    if (!nav) return null;
    const look = (el, label) => {
      const s = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      const after = getComputedStyle(el, '::after');
      const painted = (cs) => cs.content !== 'none' &&
        cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      return {
        label,
        backgroundColor: s.backgroundColor,
        backgroundImage: s.backgroundImage,
        boxShadow: s.boxShadow,
        border: s.borderTopWidth + ' ' + s.borderTopStyle,
        backdropFilter: s.backdropFilter,
        pseudo: [painted(before) && '::before', painted(after) && '::after']
          .filter(Boolean).join(' ') || 'none',
      };
    };
    const btn = nav.querySelector('button');
    const mark = btn && btn.querySelector('span');
    const r = nav.getBoundingClientRect();
    return {
      rows: [look(nav, 'nav'), btn && look(btn, 'button'), mark && look(mark, 'mark')].filter(Boolean),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
  })()
`);

console.log(`\n═══ BEATS RAIL · WHAT IT PAINTS · ${BASE} ═══\n`);
if (!paint) {
  console.log('  rail not found\n');
} else {
  for (const r of paint.rows) {
    console.log(`  ${r.label.padEnd(7)} bg ${r.backgroundColor}`);
    console.log(`  ${''.padEnd(7)} image ${r.backgroundImage}`);
    console.log(`  ${''.padEnd(7)} shadow ${r.boxShadow}   border ${r.border}`);
    console.log(`  ${''.padEnd(7)} backdrop ${r.backdropFilter}   pseudo ${r.pseudo}`);
    console.log('');
  }

  /* Pixel check: inside the rail's box but in a gap between marks, versus a
     patch of page far from it. The grain makes exact equality impossible, so
     compare averages over a small block. */
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const { rect } = paint;
  const avg = await evaluate(`
    (async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${shot.data}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const ctx = c.getContext('2d');
      const block = (x, y, w, h) => {
        const d = ctx.getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
        return [r/n, g/n, b/n].map((v) => Math.round(v));
      };
      /* Sweep rightward from the rail. A panel shows up as a step at the rail's
         edge; the page's own gradient shows up as a smooth ramp that keeps
         going long after the rail has ended. */
      const sweep = [];
      for (let x = ${rect.x} - 14; x < ${rect.x} + 600; x += 14) {
        sweep.push({ x: Math.round(x - ${rect.x}), rgb: block(x, ${rect.y} + 8, 10, 10) });
      }
      return {
        insideRail: block(${rect.x + rect.w - 12}, ${rect.y + 8}, 10, 10),
        farFromRail: block(${rect.x + 400}, ${rect.y + 8}, 10, 10),
        railW: ${rect.w},
        sweep,
      };
    })()
  `);
  const d = Math.max(...avg.insideRail.map((v, i) => Math.abs(v - avg.farFromRail[i])));
  console.log(`  pixels inside the rail box   rgb(${avg.insideRail.join(', ')})`);
  console.log(`  pixels far from the rail     rgb(${avg.farFromRail.join(', ')})`);
  console.log(`  difference ${d} levels\n`);

  console.log('  brightness sweeping right from the rail (rail ends at +' + Math.round(avg.railW) + 'px):');
  for (const s of avg.sweep) {
    const lum = Math.round((s.rgb[0] + s.rgb[1] + s.rgb[2]) / 3);
    const edge = s.x <= avg.railW && s.x >= 0 ? ' ←rail' : '';
    console.log(`    +${String(s.x).padStart(4)}px  ${String(lum).padStart(3)}  ${'█'.repeat(lum)}${edge}`);
  }
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
