/**
 * Mobile EXPLORE: is the category stepper on screen behind the first look, and
 * does it sit on top of the transcript?
 *
 * The stepper and counter are fixed to the bottom of the viewport while the
 * transcript scrolls under them, so "overlap" is a question about boxes, not
 * about z-index. Reports the two rectangles and how much of the transcript the
 * stepper covers, in both the first-look state and the settled one.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9690 + (process.pid % 40);
const W = Number(process.env.W || 390);
const H = Number(process.env.H || 844);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/exp-step-${process.pid}`,
  `--window-size=${W},${H}`,
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

const READ = `
  (() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) };
    };
    const vis = (el) => {
      /* Cumulative opacity, since the stepper is faded by an ancestor. */
      let o = 1, n = el;
      while (n && n !== document.body) {
        o *= parseFloat(getComputedStyle(n).opacity || '1');
        n = n.parentElement;
      }
      return Math.round(o * 100) / 100;
    };

    /* The stepper is the row holding the two chevrons. */
    const prev = document.querySelector('[aria-label="Previous category"]');
    const stepper = prev ? prev.parentElement : null;
    /* The counter reads NN/MM. */
    const counter = [...document.querySelectorAll('div')].find(
      (d) => d.childElementCount === 0 && /^\\d{2}\\/\\d{2}$/.test((d.textContent || '').trim())
    );
    /* The transcript block under the active note, by its own class. */
    const transcript = [...document.querySelectorAll('.transcript-reveal')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top < innerHeight && r.bottom > 0;
      })
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    const intro = [...document.querySelectorAll('button')].find((b) =>
      /swipe through curated stacks/i.test(b.textContent || '')
    );

    /* The other end of the same squeeze: shrinking the stage moves the note up,
       so the DATE / LOCATION block is the thing that can end up under the nav. */
    const dateLabel = [...document.querySelectorAll('span')].find(
      (el) => (el.textContent || '').trim() === 'DATE'
    );
    const wordmark = document.querySelector('header img, nav img') ||
      [...document.querySelectorAll('img')].find((i) => {
        const r = i.getBoundingClientRect();
        return r.top < 120 && r.width > 60 && r.height < 60;
      });
    const burger = [...document.querySelectorAll('button')].find((b) =>
      /menu/i.test(b.getAttribute('aria-label') || '')
    );
    const navBottom = Math.max(
      wordmark ? wordmark.getBoundingClientRect().bottom : 0,
      burger ? burger.getBoundingClientRect().bottom : 0
    );

    const s = box(stepper), t = box(transcript), c = box(counter);
    let overlap = null;
    if (s && t) overlap = Math.max(0, Math.min(s.bottom, t.bottom) - Math.max(s.top, t.top));
    return {
      stepper: s, stepperVis: stepper ? vis(stepper) : null,
      counter: c, counterVis: counter ? vis(counter) : null,
      transcript: t,
      meta: box(dateLabel),
      navBottom: Math.round(navBottom),
      topClear: dateLabel ? Math.round(dateLabel.getBoundingClientRect().top - navBottom) : null,
      transcriptText: transcript ? (transcript.textContent || '').trim().slice(0, 54) : null,
      intro: !!intro,
      overlap,
      vh: innerHeight,
    };
  })()
`;

const show = (tag, m) => {
  console.log(`\n  ── ${tag} ──`);
  console.log(`     first look on screen ... ${m.intro ? 'yes' : 'no'}`);
  console.log(`     stepper ................ ${m.stepper ? `y ${m.stepper.top}–${m.stepper.bottom}` : '—'}   opacity ${m.stepperVis ?? '—'}`);
  console.log(`     counter ................ ${m.counter ? `y ${m.counter.top}–${m.counter.bottom}` : '—'}   opacity ${m.counterVis ?? '—'}`);
  console.log(`     transcript ............. ${m.transcript ? `y ${m.transcript.top}–${m.transcript.bottom}` : '—'}`);
  if (m.transcriptText) console.log(`       "${m.transcriptText}…"`);
  console.log(`     stepper over transcript  ${m.overlap == null ? '—' : `${m.overlap}px`}`);
  console.log(`     nav ends y ${m.navBottom} · DATE starts y ${m.meta ? m.meta.top : '—'} · clearance ${m.topClear == null ? '—' : `${m.topClear}px`}`);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 1, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${BASE}/?view=explore` });
for (let i = 0; i < 50; i++) {
  if (await evaluate(`/swipe through curated/i.test(document.body.textContent || '')`)) break;
  await sleep(400);
}
await sleep(2200);

console.log(`\n═══ MOBILE EXPLORE · STEPPER vs TRANSCRIPT · ${W}×${H} · ${BASE} ═══`);
show('first look', await evaluate(READ));
let s = await send('Page.captureScreenshot', { format: 'png' });
if (s?.data) writeFileSync('scripts/explore-step-a-intro.png', Buffer.from(s.data, 'base64'));

await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /swipe through curated stacks/i.test(x.textContent || '')
    );
    if (b) b.click();
  })()
`);
await sleep(3200);
show('after dismissing', await evaluate(READ));
s = await send('Page.captureScreenshot', { format: 'png' });
if (s?.data) writeFileSync('scripts/explore-step-b-settled.png', Buffer.from(s.data, 'base64'));

// Walk a few notes: the collision only shows on the long transcripts, so the
// first note tells you almost nothing.
console.log('\n  ── scanning notes for the worst collision ──');
let worst = { overlap: -1 };
for (let i = 0; i < 10; i++) {
  await evaluate(`
    (() => {
      const el = document.querySelector('[data-vcard]')?.parentElement;
      if (el) el.scrollBy({ top: el.clientHeight * 0.9, behavior: 'auto' });
    })()
  `);
  await sleep(900);
  const m = await evaluate(READ);
  if (!m.transcript) continue;
  const line = `     note ${String(i + 2).padStart(2)}  transcript ends y ${String(m.transcript.bottom).padStart(3)}  stepper starts y ${m.stepper ? m.stepper.top : '—'}  overlap ${m.overlap}px`;
  console.log(line);
  if (m.overlap > worst.overlap) worst = { ...m, i };
}
if (worst.overlap > 0) {
  s = await send('Page.captureScreenshot', { format: 'png' });
  if (s?.data) writeFileSync('scripts/explore-step-c-overlap.png', Buffer.from(s.data, 'base64'));
  console.log(`\n     worst overlap ${worst.overlap}px → scripts/explore-step-c-overlap.png`);
}

console.log('\n  shots → scripts/explore-step-a-intro.png · scripts/explore-step-b-settled.png\n');

chrome.kill();
ws.close();
process.exit(0);
