/**
 * The first look at EXPLORE.
 *
 * Walks the real path a visitor takes — index, then the EXPLORE tab — and checks
 * three things in order: the line is up with the carousel held at nothing, a
 * click sends the line away and brings the notes up, and coming back a second
 * time in the same page session skips the line entirely.
 *
 * Carousel visibility is read off the stack's wrapper opacity rather than from
 * the cards, since the cards are fully painted the whole time and it is the
 * wrapper that holds them back.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9500 + (process.pid % 40);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/explore-intro-${process.pid}`,
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

const STATE = `
  (() => {
    const intro = document.querySelector('button[aria-label="Start exploring"]');
    // The stack wrapper is the motion div that holds a [data-card]; walk up from
    // a card to the first ancestor carrying its own opacity.
    /* Cards carry their own opacity (the coverflow dims the neighbours), so
       reading the nearest styled ancestor just reads the card back. What
       matters is what reaches the eye: multiply every opacity from the active
       card up to <body>. */
    const card = document.querySelector('[data-card]');
    let effective = card ? 1 : null;
    for (let el = card; el && el !== document.body; el = el.parentElement) {
      effective *= Number(getComputedStyle(el).opacity);
    }
    /* The button now holds a wrapper span with the sentence and the cue inside
       it, so pick each by its text — the wrapper itself carries no font. */
    const leaf = (re) => {
      if (!intro) return null;
      const el = [...intro.querySelectorAll('span')]
        .find((s) => !s.querySelector('span') && re.test(s.textContent || ''));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        font: cs.fontFamily,
        size: cs.fontSize,
        tracking: cs.letterSpacing,
        color: cs.color,
        opacity: Number(cs.opacity),
      };
    };
    const sentence = leaf(/Swipe through/);
    const cue = leaf(/continue/i);
    const font = sentence ? sentence.font : null;
    return {
      introText: intro ? intro.textContent.trim() : null,
      introOpacity: intro ? Number(getComputedStyle(intro).opacity) : null,
      introFont: font,
      sentence,
      cue,
      carousel: effective == null ? null : Math.round(effective * 1000) / 1000,
      cards: document.querySelectorAll('[data-card]').length,
      wheel: [...new Set([...document.querySelectorAll('span')]
        .map((s) => (s.children.length ? '' : (s.textContent || '').trim()))
        .filter((t) => /^\\[\\s*[A-Z][A-Z \\-]*\\s*\\]$/.test(t)))].length,
    };
  })()
`;

const clickText = async (re) =>
  evaluate(`
    (() => {
      const el = [...document.querySelectorAll('button, a, [role="button"]')]
        .find((b) => ${re}.test((b.textContent || '').trim()));
      if (!el) return false;
      el.click();
      return true;
    })()
  `);

const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s?.data) writeFileSync(`scripts/${name}.png`, Buffer.from(s.data, 'base64'));
};

await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`/EXPLORE/.test(document.body.textContent || '')`)) break;
  await sleep(500);
}
await sleep(2500);

console.log(`\n═══ FIRST LOOK AT EXPLORE · ${BASE} ═══\n`);

/* ── 1 · arrive on EXPLORE for the first time ── */
await clickText('/^explore$/i');
await sleep(2600);
const first = await evaluate(STATE);
await shot('explore-intro');
console.log('  FIRST VISIT');
console.log(`    line              ${first.introText ? `"${first.introText}"` : 'not shown'}`);
console.log(`    line opacity      ${first.introOpacity}`);
console.log(`    sentence          ${first.sentence?.size} ${first.sentence?.font}`);
console.log(`    cue               ${first.cue?.size} ${first.cue?.font}`);
console.log(`    cue tracking      ${first.cue?.tracking}   colour ${first.cue?.color}`);
console.log(`    carousel opacity  ${first.carousel}   (${first.cards} cards mounted)`);
console.log(`    themes on wheel   ${first.wheel}`);

/* ── 2 · click it away ── */
await evaluate(`document.querySelector('button[aria-label="Start exploring"]')?.click()`);
await sleep(160);
const mid = await evaluate(STATE);
await sleep(1400);
const after = await evaluate(STATE);
await shot('explore-intro-after');
console.log('\n  AFTER THE CLICK');
console.log(`    +160ms  line ${mid.introOpacity ?? 'gone'} · carousel ${mid.carousel}`);
console.log(`    +1.5s   line ${after.introOpacity ?? 'gone'} · carousel ${after.carousel}`);

/* ── 3 · leave and come back in the same page session ── */
await clickText('/^index$/i');
await sleep(2200);
await clickText('/^explore$/i');
await sleep(2600);
const second = await evaluate(STATE);
console.log('\n  SECOND VISIT (same page session)');
console.log(`    line              ${second.introText ? `"${second.introText}"` : 'not shown'}`);
console.log(`    carousel opacity  ${second.carousel}`);

const ok = [
  ['line shows on arrival', !!first.introText && first.introOpacity > 0.9],
  ['sentence set in Faktory', /Faktory/i.test(first.sentence?.font || '')],
  ['cue set in Courier', /courier/i.test(first.cue?.font || '')],
  ['cue is the smaller of the two', parseFloat(first.cue?.size) < parseFloat(first.sentence?.size)],
  ['carousel held back', first.carousel === 0],
  ['cards mounted behind it', first.cards > 0],
  ['wheel still visible', first.wheel > 0],
  ['line gone after click', after.introOpacity == null],
  ['notes came up', after.carousel > 0.9],
  ['notes faded, not cut', mid.carousel > 0 && mid.carousel < 0.9],
  ['second visit skips it', !second.introText && second.carousel === 1],
];
console.log('');
for (const [label, pass] of ok) console.log(`  ${pass ? '✓' : '✗'} ${label}`);
console.log('');

chrome.kill();
ws.close();
process.exit(0);
