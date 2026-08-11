/**
 * The About drawer's credits card: reports the rendered colour of every label
 * (CONTACT / PROJECT LEAD / …) beside the value opposite it, so "do the two sides
 * match now" is checked against computed style rather than by eye. Also shoots the
 * card so the flattened hierarchy can be looked at.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9338;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--user-data-dir=/tmp/about-credits-profile',
  `--window-size=${process.env.W || 1440},${process.env.H || 900}`,
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

/* Open the About drawer and scroll the credits card into view. */
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 100; i++) {
    if ([...document.querySelectorAll('button, a')].some(b => /^about$/i.test((b.textContent||'').trim()))) break;
    await sleep(200);
  }
  await sleep(1800);
  [...document.querySelectorAll('button, a')].find(b => /^about$/i.test((b.textContent||'').trim())).click();
  await sleep(1600);
  const card = document.querySelector('.about-credits-card');
  card?.scrollIntoView({ block: 'center' });
  await sleep(900);
  return true;
})()`);

const rows = await evaluate(`(() => {
  const card = document.querySelector('.about-credits-card');
  if (!card) return { error: 'credits card not found' };
  return {
    rows: [...card.children].map((row) => {
      const label = row.firstElementChild;
      const value = row.lastElementChild;
      const leaf = value.querySelector('a, span') || value;
      // Does the label's own text box run into any of the values opposite it?
      // The label column is minmax(0, 1fr) and single words can't wrap, so a wide
      // value squeezes the column to nothing and the label overflows underneath.
      const lb = label.getBoundingClientRect();
      const collisions = [...value.querySelectorAll('a, span')].concat(
        value.matches('a, span') ? [value] : []
      ).filter((v) => {
        const vb = v.getBoundingClientRect();
        return vb.left < lb.right && vb.right > lb.left && vb.top < lb.bottom && vb.bottom > lb.top;
      }).map((v) => (v.textContent || '').trim());
      return {
        label: (label.textContent || '').trim(),
        labelColor: getComputedStyle(label).color,
        value: (leaf.textContent || '').trim(),
        valueColor: getComputedStyle(leaf).color,
        match: getComputedStyle(label).color === getComputedStyle(leaf).color,
        labelWidth: Math.round(lb.width),
        rowWidth: Math.round(row.getBoundingClientRect().width),
        overlapsWith: collisions,
      };
    }),
    cardRect: (() => {
      const r = card.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
  };
})()`);

/* The card's links declare a :hover colour in the shared stylesheet but carry an
   inline `color`, which outranks any non-!important rule. Hover one for real and
   read the computed colour to see whether the rule ever lands. */
const hoverCheck = await (async () => {
  const box = await evaluate(`(() => {
    const a = document.querySelector('.about-contact-link');
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
             resting: getComputedStyle(a).color };
  })()`);
  if (!box) return { error: 'no contact link' };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await sleep(500);
  const hovered = await evaluate(
    `getComputedStyle(document.querySelector('.about-contact-link')).color`
  );
  return {
    resting: box.resting,
    hovered,
    hoverRuleDeclares: 'rgb(207, 202, 183)',
    hoverActuallyChangesColor: hovered !== box.resting,
  };
})();

if (rows?.cardRect) {
  const c = rows.cardRect;
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: c.x - 16, y: c.y - 16, width: c.w + 32, height: c.h + 32, scale: 2 },
  });
  if (shot?.data) fs.writeFileSync('/tmp/about-credits.png', Buffer.from(shot.data, 'base64'));
}

console.log(JSON.stringify({ ...rows, hoverCheck }, null, 1));
ws.close();
chrome.kill();
