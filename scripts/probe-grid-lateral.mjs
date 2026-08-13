/**
 * How much of a wall tile's sideways travel happens late.
 *
 * The complaint this answers: the tiles read as flying up and then sliding
 * horizontally into position near the end. Two things in the flight could cause
 * that — the bow, which displaces the route perpendicular to its own direction
 * (and for a tile rising out of the bottom middle, perpendicular is mostly
 * horizontal), and the sheer horizontal distance an outer tile has to cover
 * from a single centred origin.
 *
 * So, per tile: total horizontal travel, what share of it lands in the last
 * third of the flight, and how far the route bulges off the straight line to
 * the cell. A route with no late horizontal spends |dx| evenly against |dy| and
 * has a bulge near zero.
 *
 * The page is loaded with ?slow= so the frames are far enough apart to sample
 * honestly. BOW / SPREAD override the dials through the same localStorage key
 * DialKit persists to, so a candidate value can be measured without hand-
 * turning the panel.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const VARIANT = process.env.VARIANT || 'handoff';
const SLOW = Number(process.env.SLOW || 8);
const PORT = 9700 + (process.pid % 89);
const PROFILE = `/tmp/grid-lateral-${process.pid}`;

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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

/* Dials, if this run is measuring a candidate value rather than the defaults.
   Written before the app's first paint, since useDialKit reads its store on
   mount. The key and shape are DialKit's own; an unknown key is ignored, which
   is why the run prints what it managed to set. */
const overrides = {};
if (process.env.BOW != null) overrides['flight.bow'] = Number(process.env.BOW);
if (process.env.SPREAD != null) overrides['launch.spread'] = Number(process.env.SPREAD);
if (process.env.SPREAD_X != null) overrides['launch.spreadX'] = Number(process.env.SPREAD_X);

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (() => {
      const want = ${JSON.stringify(overrides)};
      if (!Object.keys(want).length) return;
      const merge = (raw) => {
        let v = {};
        try { v = JSON.parse(raw) || {}; } catch {}
        return JSON.stringify({ ...v, ...want });
      };
      for (const k of Object.keys(localStorage)) {
        if (/dial/i.test(k)) localStorage.setItem(k, merge(localStorage.getItem(k)));
      }
      localStorage.setItem('dialkit:Grid Hand-off', merge(localStorage.getItem('dialkit:Grid Hand-off')));
    })();
  `,
});

await send('Page.navigate', { url: `${BASE}/entrance?tab=handoff&slow=${SLOW}&dial=1` });
await sleep(2500);
await evaluate(
  `window.dispatchEvent(new KeyboardEvent('keydown', { key: '${
    ['fountain', 'handoff', 'spout'].indexOf(VARIANT) + 1
  }' })), 1`
);
await sleep(400);

/* Sample every tile's centre per frame for the whole flight, then fire. The
   recorder is installed first so the launch frame itself is caught — that frame
   is where the route starts, and a route measured without it is missing the
   longest hop it makes. */
const report = await evaluate(`
  new Promise((resolve) => {
    const tiles = [...document.querySelectorAll('[data-tile]')];
    const track = tiles.map((el) => ({ id: el.dataset.tile, el, pts: [] }));
    const t0 = performance.now();
    let raf;
    const step = () => {
      const t = performance.now() - t0;
      track.forEach((s) => {
        const r = s.el.getBoundingClientRect();
        s.pts.push([t, r.left + r.width / 2, r.top + r.height / 2, r.width]);
      });
      if (t < ${Math.round(2600 * SLOW)}) raf = requestAnimationFrame(step);
      else finish();
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      resolve(track.map((s) => {
        // Trim to the moving part: the tile is parked before its own delay and
        // at rest after it lands, and leading/trailing stillness would dilute
        // every share this measures.
        const moved = (a, b) => Math.hypot(b[1] - a[1], b[2] - a[2]) > 0.5;
        let a = 0;
        while (a < s.pts.length - 1 && !moved(s.pts[a], s.pts[a + 1])) a++;
        let b = s.pts.length - 1;
        while (b > a + 1 && !moved(s.pts[b - 1], s.pts[b])) b--;
        const pts = s.pts.slice(a, b + 1);
        if (pts.length < 4) return { id: s.id, still: true };
        const [t1, x1, y1] = pts[0];
        const [t2, x2, y2] = pts[pts.length - 1];
        const span = t2 - t1 || 1;
        let dx = 0;
        let dy = 0;
        let lateDx = 0;
        let bulge = 0;
        const chord = Math.hypot(x2 - x1, y2 - y1) || 1;
        for (let i = 1; i < pts.length; i++) {
          const ax = Math.abs(pts[i][1] - pts[i - 1][1]);
          dx += ax;
          dy += Math.abs(pts[i][2] - pts[i - 1][2]);
          if ((pts[i][0] - t1) / span > 0.667) lateDx += ax;
          // Perpendicular distance from the straight line between the ends.
          const d =
            Math.abs(
              (x2 - x1) * (pts[i][2] - y1) - (y2 - y1) * (pts[i][1] - x1)
            ) / chord;
          if (d > bulge) bulge = d;
        }
        return {
          id: s.id,
          wide: { from: Math.round(pts[0][3]), to: Math.round(pts[pts.length - 1][3]) },
          net: { x: Math.round(x2 - x1), y: Math.round(y2 - y1) },
          travel: { x: Math.round(dx), y: Math.round(dy) },
          lateShare: dx > 1 ? lateDx / dx : 0,
          bulge: Math.round(bulge),
          bulgeShare: bulge / chord,
          frames: pts.length,
        };
      }));
    };
    requestAnimationFrame(step);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
  })
`);

const set = Object.keys(overrides).length
  ? Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(' ')
  : 'defaults';
console.log(`\n═══ LATERAL TRAVEL · ${VARIANT} · ${set} · slow=${SLOW} ═══`);
console.log('  tile        width       net dx   |dx|   |dy|   late |dx|   bulge off the line');
const rows = (report || []).filter((r) => !r.still);
rows.forEach((r) => {
  console.log(
    `  ${r.id.padEnd(10)} ${`${r.wide.from}→${r.wide.to}px`.padEnd(11)} ${String(r.net.x).padStart(
      6
    )}  ${String(r.travel.x).padStart(5)}  ${String(r.travel.y).padStart(5)}   ${(r.lateShare * 100)
      .toFixed(0)
      .padStart(3)}%       ${String(r.bulge).padStart(4)}px  (${(r.bulgeShare * 100).toFixed(
      0
    )}% of the chord)`
  );
});
if (rows.length) {
  const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const wide = rows.filter((r) => Math.abs(r.net.x) > 40);
  console.log(
    `\n  ${rows.length} tiles moved · mean late |dx| share ${(mean((r) => r.lateShare) * 100).toFixed(
      0
    )}% · mean bulge ${(mean((r) => r.bulgeShare) * 100).toFixed(1)}% of the chord`
  );
  console.log(
    `  of the ${wide.length} that cross more than 40px sideways: mean |dx| ${Math.round(
      wide.reduce((s, r) => s + r.travel.x, 0) / (wide.length || 1)
    )}px · worst ${Math.max(...wide.map((r) => r.travel.x))}px`
  );
}
console.log('');

chrome.kill();
ws.close();
process.exit(0);
