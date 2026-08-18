/**
 * Is the "N Confessions" tally gone from the index, and is that all that went?
 *
 * Checks the count is absent on both grid entrances (the onboarding rise and a
 * direct load), that the tile numbers it used to align with are still there, and
 * that the band above the first row didn't collapse — the count was absolutely
 * placed so the tiles shouldn't have moved.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9440 + (process.pid % 40);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/grid-count-${process.pid}`,
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
    const count = document.querySelector('.grid-count');
    const nums = [...document.querySelectorAll('.grid-tile-num')];
    const first = nums[0];
    return {
      countNode: !!count,
      // Anything anywhere still saying "N Confessions"?
      tallyText: (document.body.innerText.match(/\\b\\d+\\s+Confessions?\\b/) || [null])[0],
      tileNums: nums.length,
      firstTileTop: first ? Math.round(first.getBoundingClientRect().top) : null,
      firstTileLeft: first ? Math.round(first.getBoundingClientRect().left) : null,
    };
  })()
`;

const rows = [];
for (const [label, url, wait] of [
  ['direct load', `${BASE}/?view=grid`, 4000],
  ['from onboarding', `${BASE}/`, 0],
]) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`/EXPLORE|Beats/.test(document.body.textContent || '') ||
      !!document.querySelector('nav[aria-label="Beats"]')`)) break;
    await sleep(500);
  }
  if (label === 'from onboarding') {
    await sleep(2000);
    // Step to the closing beat, then swipe up into the index.
    for (let i = 0; i < 6; i++) {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type, key: 'ArrowDown', code: 'ArrowDown',
          windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40,
        });
      }
      await sleep(1400);
    }
    await sleep(1500);
    await evaluate(`
      (() => {
        const a = [...document.querySelectorAll('a, button')]
          .find((e) => /archive|enter/i.test((e.textContent || e.getAttribute('aria-label') || '')));
        if (a) a.click();
      })()
    `);
    await sleep(4500);
  } else {
    await sleep(wait);
  }
  rows.push([label, await evaluate(STATE)]);
}

console.log(`\n═══ INDEX TALLY · ${BASE} ═══\n`);
for (const [label, s] of rows) {
  console.log(`  ${label}`);
  console.log(`    .grid-count node      ${s.countNode ? '✗ still rendered' : '✓ gone'}`);
  console.log(`    "N Confessions" text  ${s.tallyText ? `✗ "${s.tallyText}"` : '✓ nowhere on the page'}`);
  console.log(`    tile numbers          ${s.tileNums}`);
  console.log(`    first tile at         top ${s.firstTileTop}, left ${s.firstTileLeft}`);
  console.log('');
}
const [a, b] = rows.map(([, s]) => s);
if (a && b) {
  console.log(
    `  tiles land in the same place either way   ${a.firstTileLeft === b.firstTileLeft ? '✓' : `✗ ${a.firstTileLeft} vs ${b.firstTileLeft}`}`
  );
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) {
  writeFileSync('scripts/grid-no-count.png', Buffer.from(shot.data, 'base64'));
  console.log('\n  crop → scripts/grid-no-count.png');
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
