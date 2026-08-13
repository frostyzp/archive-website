/**
 * When the pile behind gives way to a note that is still arriving.
 *
 * Two clocks on the same beat: the incoming note's own travel, read off its
 * transform, and the brightness of the card it is landing on, read off its
 * filter. The claim is an overlap — the dim should be under way while the note
 * is still moving, and should still be going after it has stopped — so both are
 * sampled per frame and the moments are compared.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9700 + (process.pid % 89);
const PROFILE = `/tmp/pile-dim-${process.pid}`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1280,860',
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
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.startScreencast', { format: 'jpeg', quality: 10, everyNthFrame: 60 });

await send('Page.navigate', { url: `${BASE}/` });
for (let i = 0; i < 40; i++) {
  if (await evaluate(`!!document.querySelector('nav[aria-label="Beats"]')`)) break;
  await sleep(500);
}
await sleep(1200);

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

/* Forward until exactly one note is actually on the table.
 *
 * Beats and dealt cards are not one to one — the first gesture of a session is
 * spent on the loading gate, and every card in the pile is mounted from the
 * start, waiting offstage at full brightness and zero opacity. Counting presses
 * lands on a beat where nothing has been dealt yet and every card reads as
 * undimmed, which is indistinguishable from a dim that never fired. So this
 * steps on the state instead: one card down means the next press is the arrival
 * worth watching. */
/* Opacity and the filter live on the same box, which is not the img's immediate
   parent — reading the wrong one reported every card lit from the start and
   stepped straight past the arrival this is here to watch. */
const litCount = `(() => {
  const cardOf = (img) => {
    let el = img;
    for (let i = 0; i < 5 && el; i++) {
      el = el.parentElement;
      if (el && /brightness/.test(getComputedStyle(el).filter || '')) return el;
    }
    return null;
  };
  return [...document.querySelectorAll('main img[alt="Handwritten confession"]')]
    .map(cardOf)
    .filter((el) => el && Number(getComputedStyle(el).opacity) > 0.9).length;
})()`;
for (let i = 0; i < 8; i++) {
  const lit = await evaluate(litCount);
  process.stderr.write(`    · ${lit} note(s) down\n`);
  if (lit >= 1) break;
  await pressDown();
  await sleep(1800);
}

/* The recorder is armed first and the beat advanced through the browser's own
   input afterwards. A key dispatched from inside the page was not enough to move
   the piece on — so the run was measuring a pile that never changed, which
   reads exactly like a dim that never fires. */
await evaluate(`
  (() => {
    // The card is the box carrying the filter — the img's own ancestor chain is
    // walked rather than guessed at, since the depth of that wrapper is a
    // detail of the component and not something worth encoding here.
    const cardOf = (img) => {
      let el = img;
      for (let i = 0; i < 5 && el; i++) {
        el = el.parentElement;
        if (el && /brightness/.test(getComputedStyle(el).filter || '')) return el;
      }
      return null;
    };
    const cards = () =>
      [...document.querySelectorAll('main img[alt="Handwritten confession"]')]
        .map(cardOf)
        .filter(Boolean);

    /* Every card, every frame, and which is which worked out afterwards from
       what they did: the arriving one is whichever fades up, the one giving way
       is whichever loses brightness. Deciding that up front by DOM order was
       what put the last run on a card that was still waiting offstage. */
    window.__pile = { pts: [] };
    const t0 = performance.now();
    const step = () => {
      const t = performance.now() - t0;
      window.__pile.pts.push({
        t,
        cards: cards().map((el) => {
          const cs = getComputedStyle(el);
          return {
            o: Number(cs.opacity),
            y: new DOMMatrixReadOnly(cs.transform).m42,
            b: Number((cs.filter.match(/brightness\\(([0-9.]+)\\)/) || [])[1]),
          };
        }),
      });
      if (t < 2600) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  })()
`);
await pressDown();
await sleep(3000);
const trace = await evaluate('window.__pile');

console.log(`\n═══ PILE DIM vs ARRIVAL · ${BASE} ═══\n`);
const pts = trace?.pts || [];
const width = Math.max(0, ...pts.map((p) => p.cards.length));
const series = (i, key) => pts.map((p) => p.cards[i]?.[key]).filter((v) => v != null);

// Whichever card fades up over the window is the one arriving; whichever loses
// brightness is the one giving way to it.
let arriving = -1;
let behind = -1;
for (let i = 0; i < width; i++) {
  const o = series(i, 'o');
  const b = series(i, 'b');
  if (o.length && o[0] < 0.1 && o[o.length - 1] > 0.9) arriving = i;
  if (b.length && b[0] - b[b.length - 1] > 0.05) behind = i;
}

if (arriving < 0 || behind < 0) {
  console.log(
    `  nothing to compare — ${arriving < 0 ? 'no note arrived' : 'no card dimmed'} in the window\n`
  );
} else {
  const at = (p) => (p ? `${Math.round(p.t)}ms` : 'never');
  const b0 = pts[0].cards[behind].b;
  const b1 = pts[pts.length - 1].cards[behind].b;
  const dimStart = pts.find((p) => p.cards[behind]?.b < b0 - 0.01);
  const dimEnd = pts.find((p) => Math.abs(p.cards[behind]?.b - b1) < 0.005);

  // Landed once the arriving card's vertical position stops changing.
  let landed = null;
  for (let i = 5; i < pts.length; i++) {
    const win = pts.slice(i - 5, i + 1).map((p) => p.cards[arriving]?.y);
    if (win.every((v) => v != null) && Math.max(...win) - Math.min(...win) < 0.5) {
      landed = pts[i];
      break;
    }
  }

  console.log(`  the card behind goes ${b0.toFixed(2)} → ${b1.toFixed(2)}`);
  console.log(`  dim starts        ${at(dimStart)}`);
  console.log(`  note lands        ${at(landed)}`);
  console.log(`  dim finishes      ${at(dimEnd)}`);
  if (dimStart && landed) {
    const lead = landed.t - dimStart.t;
    const atLanding = pts.find((p) => p.t >= landed.t)?.cards[behind]?.b ?? b1;
    console.log(`\n  the dim begins ${Math.round(lead)}ms before the note comes to rest,`);
    console.log(
      `  and is ${(((b0 - atLanding) / (b0 - b1)) * 100).toFixed(0)}% done at the moment it lands`
    );
    console.log(
      `\n  ${lead > 80 && lead < 400 ? '✓' : '✗'} the pile gives way while the note is still moving`
    );
    if (dimEnd) {
      console.log(
        `  ${dimEnd.t > landed.t ? '✓' : '✗'} and is still shading after the note is down`
      );
    }
  }
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
