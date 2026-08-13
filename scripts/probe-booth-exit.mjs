/**
 * Is the booth still on screen while the notes scatter?
 *
 * The booth is the one photo in the exit that never travels — it fades where it
 * lies — so the question is not when its animation ends but whether it is still
 * legible at the moment the notes are leaving. Both are sampled per frame: the
 * booth's opacity, and how far each note has got toward the screen edge.
 *
 * The number that settles it is the booth's opacity at the moment the first note
 * crosses out of the viewport, since that is the frame where the pile visibly
 * opens and anything left behind is exposed.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9950 + (process.pid % 40);
const PROFILE = `/tmp/booth-exit-${process.pid}`;

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
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.startScreencast', { format: 'jpeg', quality: 10, everyNthFrame: 60 });

const pressDown = async () => {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'ArrowDown',
      code: 'ArrowDown',
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 40,
    });
  }
};
const swipe = async ({ x = 60, y = 700, dy = -140, steps = 5 } = {}) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: Math.round(y + (dy * i) / steps), id: 1 }],
    });
    await sleep(14);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

await send('Page.navigate', { url: `${BASE}/` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`!!document.querySelector('nav[aria-label="Beats"]')`)) break;
  await sleep(500);
}
await sleep(1500);

const BEAT = `(() => {
  const nav = document.querySelector('nav[aria-label="Beats"]');
  const dots = nav ? [...nav.querySelectorAll('button')] : [];
  return dots.findIndex((b) => b.getAttribute('aria-current') === 'step');
})()`;
for (let i = 0; i < 8; i++) {
  const b = await evaluate(BEAT);
  if (b >= 4) break;
  await pressDown();
  await sleep(1500);
}
await sleep(2800);

/* The booth is picked out by its source rather than by position in the pile —
   it is the one photo that is not a note scan, and after the notes launch the
   DOM order is no guide to what is where. */
await evaluate(`
  (() => {
    const cardOf = (img) => {
      let el = img;
      for (let i = 0; i < 5 && el; i++) {
        el = el.parentElement;
        if (el && /brightness|opacity/.test(el.getAttribute('style') || '')) return el;
      }
      return img.parentElement;
    };
    const all = () => [...document.querySelectorAll('main img')].filter((i) =>
      /booth|confession_notes/.test(i.getAttribute('src') || ''));

    window.__booth = { pts: [] };
    const t0 = performance.now();
    const loop = () => {
      const t = performance.now() - t0;
      const booth = all().find((i) => /booth/.test(i.getAttribute('src') || ''));
      const notes = all().filter((i) => !/booth/.test(i.getAttribute('src') || ''));
      window.__booth.pts.push({
        t,
        boothO: booth ? Number(getComputedStyle(cardOf(booth)).opacity) : null,
        // Whether each note still has any part of itself inside the viewport.
        notesOnScreen: notes.filter((i) => {
          const r = i.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        }).length,
        noteCount: notes.length,
      });
      if (t < 2200) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })()
`);

await swipe();
await sleep(2800);
const pts = (await evaluate('window.__booth && window.__booth.pts')) || [];

console.log(`\n═══ THE BOOTH vs THE SCATTER · ${BASE} ═══\n`);
const started = pts.find((p) => p.boothO != null && p.boothO < 0.98);
if (!started) {
  console.log('  the booth never began fading — the exit may not have fired\n');
} else {
  const rel = pts.filter((p) => p.t >= started.t).map((p) => ({ ...p, t: p.t - started.t }));
  const full = rel[0]?.noteCount ?? 3;
  const firstNoteGone = rel.find((p) => p.notesOnScreen < full);
  const allNotesGone = rel.find((p) => p.notesOnScreen === 0);
  const boothFaint = rel.find((p) => p.boothO <= 0.1);
  const boothGone = rel.find((p) => p.boothO <= 0.02);
  const at = (p) => (p ? `${Math.round(p.t)}ms` : 'never');
  const boothAt = (p) => (p ? (rel.find((q) => q.t >= p.t)?.boothO ?? 0).toFixed(2) : '—');

  console.log(`  booth below 10% opacity   ${at(boothFaint)}`);
  console.log(`  booth gone                ${at(boothGone)}`);
  console.log(`  first note leaves frame   ${at(firstNoteGone)}`);
  console.log(`  last note leaves frame    ${at(allNotesGone)}`);
  console.log(`\n  booth opacity when the first note clears: ${boothAt(firstNoteGone)}`);
  console.log(`  booth opacity when the last note clears:  ${boothAt(allNotesGone)}`);
  const ok = firstNoteGone && boothFaint && boothFaint.t <= firstNoteGone.t;
  console.log(
    `\n  ${ok ? '✓' : '✗'} the booth is out of sight before the pile opens`
  );
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
