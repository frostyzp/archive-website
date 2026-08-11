/**
 * The grid search field, desktop rail and phone filter row: reports the space left
 * for text once the magnifier's padding is taken out, against the width the
 * placeholder actually needs — so "does the icon truncate the placeholder" is
 * measured rather than eyeballed. Shoots each field too.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9340;
/** Desktop rail, then the phone filter row (below MOBILE_MQ's 760px). */
const CASES = [
  { name: 'desktop-rail', width: 1440, height: 900 },
  { name: 'phone-row', width: 430, height: 900 },
];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/search-field-profile',
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

const MEASURE = `(() => {
  const el = document.querySelector('.grid-search-input');
  if (!el) return { error: 'no search input' };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft);
  const padR = parseFloat(cs.paddingRight);
  const textBox = r.width - padL - padR - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);

  // What the placeholder needs, measured in the field's own font + tracking.
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = cs.fontSize + ' ' + cs.fontFamily;
  const text = el.placeholder;
  const tracking = parseFloat(cs.letterSpacing) || 0;
  const needed = ctx.measureText(text).width + tracking * text.length;

  return {
    placeholder: text,
    fieldWidth: Math.round(r.width),
    paddingLeft: Math.round(padL),
    hasIcon: cs.backgroundImage.includes('svg'),
    iconInset: cs.backgroundPosition,
    textBox: Math.round(textBox),
    placeholderNeeds: Math.round(needed),
    fits: needed <= textBox,
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
  };
})()`;

const out = {};
for (const c of CASES) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: c.width,
    height: c.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    for (let i = 0; i < 120; i++) {
      if (document.querySelector('.grid-search-input')) break;
      await sleep(200);
    }
    await sleep(2000);
    return true;
  })()`);
  const m = await evaluate(MEASURE);
  /* Type into it through React's own setter, then confirm the glyph is still
     there and the caret text starts clear of it. */
  const typed = await evaluate(`(() => {
    const el = document.querySelector('.grid-search-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'god');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const cs = getComputedStyle(el);
    return {
      value: el.value,
      iconStillDrawn: cs.backgroundImage.includes('svg'),
      textStartsAt: Math.round(parseFloat(cs.paddingLeft)),
    };
  })()`);
  await sleep(400);
  out[c.name] = { ...m, typed };
  if (m?.rect) {
    const s = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: Math.max(0, m.rect.x - 8), y: Math.max(0, m.rect.y - 8), width: m.rect.w + 16, height: m.rect.h + 16, scale: 3 },
    });
    if (s?.data) fs.writeFileSync(`/tmp/search-${c.name}.png`, Buffer.from(s.data, 'base64'));
  }
}

for (const [name, m] of Object.entries(out)) {
  if (m.error) { console.log(name, m.error); continue; }
  console.log(`── ${name}  (${m.fieldWidth}px field)`);
  console.log(`   icon present: ${m.hasIcon}   position: ${m.iconInset}   padding-left: ${m.paddingLeft}px`);
  console.log(`   placeholder "${m.placeholder}" needs ${m.placeholderNeeds}px, has ${m.textBox}px → ${m.fits ? 'fits' : 'TRUNCATED'}`);
  console.log(`   with "${m.typed?.value}" typed: icon still drawn ${m.typed?.iconStillDrawn}, text starts at ${m.typed?.textStartsAt}px`);
}

ws.close();
chrome.kill();
