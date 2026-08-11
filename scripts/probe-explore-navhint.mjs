/**
 * EXPLORE's top keyboard legend (LEFT / RIGHT + THEME) is centred in the viewport
 * while the archive nav bar's wordmark and INDEX / EXPLORE grow from the left, so
 * the two close on each other as the window narrows. Sweeps viewport widths in one
 * browser and reports the gap between them at each, to find the width where they
 * touch — i.e. where the legend has to give up and hide.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9339;
const WIDTHS = [1440, 1366, 1280, 1200, 1150, 1100, 1050, 1024, 980, 940, 900, 860, 820, 790];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/explore-navhint-profile',
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
await send('Page.navigate', { url: `${BASE}/?view=explore` });
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 120; i++) {
    if ([...document.querySelectorAll('span')].some(s => (s.textContent||'').trim() === 'THEME')) break;
    await sleep(200);
  }
  await sleep(2400);
  return true;
})()`);

/* Smallest element holding the whole legend, vs. the leftmost nav chrome. */
const MEASURE = `(() => {
  const legend = [...document.querySelectorAll('div')]
    .filter((d) => {
      const t = (d.textContent || '');
      return /LEFT/.test(t) && /RIGHT/.test(t) && /THEME/.test(t);
    })
    .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];

  const nav = [...document.querySelectorAll('button, a')].filter((b) =>
    /^(index|explore)$/i.test((b.textContent || '').trim()) ||
    /what we tell ai/i.test(b.getAttribute('aria-label') || '')
  );

  if (!legend) return { legend: null, navCount: nav.length };
  const l = legend.getBoundingClientRect();
  // Only chrome on the same horizontal band as the legend can collide with it.
  const band = nav.filter((n) => {
    const b = n.getBoundingClientRect();
    return b.top < l.bottom && b.bottom > l.top;
  });
  const nearest = band
    .map((n) => {
      const b = n.getBoundingClientRect();
      return { label: (n.textContent || '').trim() || 'wordmark', right: Math.round(b.right) };
    })
    .sort((a, b) => b.right - a.right)[0];

  return {
    legend: { left: Math.round(l.left), right: Math.round(l.right), width: Math.round(l.width) },
    nearest: nearest || null,
    gap: nearest ? Math.round(l.left - nearest.right) : null,
  };
})()`;

const rows = [];
for (const width of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(700);
  const m = await evaluate(MEASURE);
  rows.push({ width, ...m });
  if (String(process.env.SHOTS || '').split(',').includes(String(width))) {
    const s = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width, height: 150, scale: 1 },
    });
    if (s?.data) fs.writeFileSync(`/tmp/navhint-${width}.png`, Buffer.from(s.data, 'base64'));
  }
}

for (const r of rows) {
  if (!r.legend) {
    console.log(String(r.width).padStart(5) + 'px  legend not rendered');
    continue;
  }
  const gap = r.gap;
  const verdict = gap === null ? '?' : gap < 0 ? `OVERLAP ${-gap}px` : `${gap}px clear`;
  console.log(
    String(r.width).padStart(5) + 'px  legend ' +
      String(r.legend.left).padStart(4) + '–' + String(r.legend.right).padEnd(5) +
      '  nearest chrome: ' + String(r.nearest?.label).padEnd(9) +
      ' ends ' + String(r.nearest?.right).padStart(4) + '  →  ' + verdict
  );
}

ws.close();
chrome.kill();
