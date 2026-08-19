/**
 * Reads back the desktop pass: About tab ink, EXPLORE dial colour + count size,
 * INDEX preview metadata size against its transcription, and checks the wider
 * metadata block still fits its column.
 *
 * Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const PORT = 9630 + (process.pid % 40);
const W = Number(process.env.W || 1440);
const H = Number(process.env.H || 900);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/pass-${process.pid}`,
  `--window-size=${W},${H}`,
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
const shot = async (name, clip, scale = 2) => {
  const s = await send('Page.captureScreenshot', clip ? { format: 'png', clip: { ...clip, scale } } : { format: 'png' });
  if (s?.data) writeFileSync(`scripts/pass-${name}.png`, Buffer.from(s.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

console.log(`\n═══ DESKTOP PASS · ${W}×${H} · ${BASE} ═══`);

/* ── INDEX: About tab ink vs the wordmark ─────────────────────────────── */
await send('Page.navigate', { url: `${BASE}/?view=grid` });
for (let i = 0; i < 60; i++) {
  if (await evaluate(`document.querySelectorAll('.grid-tile').length > 4`)) break;
  await sleep(400);
}
await sleep(2500);

const tab = await evaluate(`
  (() => {
    const t = document.querySelector('.about-drawer-tab');
    if (!t) return null;
    const span = t.querySelector('span');
    const cs = getComputedStyle(span || t);
    const logo = [...document.querySelectorAll('img')].find((i) => /wordmark/.test(i.src || ''));
    const lb = logo ? logo.closest('button') : null;
    return {
      label: (t.textContent || '').trim(),
      color: cs.color,
      fontSize: cs.fontSize,
      wordmark: logo ? { src: logo.src.split('/').pop(), buttonOpacity: lb ? getComputedStyle(lb).opacity : null } : null,
    };
  })()
`);
console.log(`\n  ABOUT TAB (closed)`);
console.log(`     label ................ ${tab?.label}`);
console.log(`     colour ............... ${tab?.color}`);
console.log(`     wordmark ............. ${tab?.wordmark?.src} @ opacity ${tab?.wordmark?.buttonOpacity}`);
await shot('about-tab', { x: W - 90, y: 0, width: 90, height: 140 });

/* ── INDEX preview: metadata vs transcription ─────────────────────────── */
await evaluate(`document.querySelectorAll('.grid-tile')[2].click()`);
await sleep(2200);
const lb = await evaluate(`
  (() => {
    // Rendered prose only: no <style>/<script> payloads, no CSS text, and
    // nothing from the lattice (whose alphabet has no lowercase in it).
    const prose = (e) => {
      const s = (e.textContent || '').trim();
      return (
        s.length > 40 &&
        /[a-z]{3}\\s+[a-z]{3}/.test(s) &&
        !/[{};]/.test(s) &&
        !e.querySelector('style, script') &&
        e.getBoundingClientRect().width > 0
      );
    };
    const all = [...document.querySelectorAll('span, div, p')];
    const label = all.find((e) => e.children.length === 0 && /^(DATE|LOCATION|THEME)$/.test((e.textContent || '').trim()));
    const row = label ? label.parentElement : null;
    const value = row ? [...row.children].find((c) => c !== label) : null;
    // Scope to the preview itself. The About drawer stays mounted behind the
    // sheet with several paragraphs of body copy in it, so anything searching
    // the whole document finds that instead of this note's transcription. Walk
    // up from the metadata block until the subtree also holds the note image;
    // that ancestor is the preview.
    let root = label;
    while (root && !(root.querySelector('img') && root.contains(label))) root = root.parentElement;
    const text = root
      ? [...root.querySelectorAll('span, div, p')]
          .filter((e) => e.children.length === 0 && prose(e))
          .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0]
      : null;
    const block = row ? row.parentElement : null;
    const px = (e) => (e ? getComputedStyle(e).fontSize : null);
    const box = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) };
    };
    // Overflow: does any value run wider than the half-column it is given?
    const rows = block ? [...block.children] : [];
    const overflow = rows.map((r) => {
      const cells = [...r.children];
      return cells.map((c) => ({
        t: (c.textContent || '').trim().slice(0, 22),
        over: Math.round(c.scrollWidth - c.clientWidth),
      }));
    });
    return {
      labelSize: px(label), valueSize: px(value), textSize: px(text),
      labelText: label ? label.textContent.trim() : null,
      block: box(block), text: box(text),
      overflow,
    };
  })()
`);
console.log(`\n  INDEX PREVIEW METADATA`);
console.log(`     label ................ ${lb?.labelSize}   (${lb?.labelText})`);
console.log(`     value ................ ${lb?.valueSize}`);
console.log(`     transcription ........ ${lb?.textSize}`);
console.log(`     match ................ ${lb?.labelSize === lb?.textSize ? 'YES' : 'NO'}`);
console.log(`     block ................ ${lb?.block?.w}px wide`);
for (const r of lb?.overflow || []) {
  const bad = r.filter((c) => c.over > 0);
  if (bad.length) console.log(`     ! overflow ........... ${bad.map((c) => `"${c.t}" +${c.over}px`).join(', ')}`);
}
await shot('index-preview', { x: W / 2 - 330, y: 0, width: 660, height: 620 });
await shot('index-preview-full');

// Does the whole preview still fit the viewport now the metadata block is
// taller? Reports the bottom of the transcription against the fold.
const fit = await evaluate(`
  (() => {
    const all = [...document.querySelectorAll('span, div, p')];
    const t = all
      .filter((e) => {
        const s = (e.textContent || '').trim();
        return (
          e.children.length === 0 &&
          s.length > 40 &&
          /[a-z]{3}\\s+[a-z]{3}/.test(s) &&
          !/[{};]/.test(s)
        );
      })
      .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
    const img = [...document.querySelectorAll('img')]
      .map((i) => ({ i, r: i.getBoundingClientRect() }))
      .sort((a, b) => b.r.height - a.r.height)[0];
    return {
      transcriptBottom: t ? Math.round(t.getBoundingClientRect().bottom) : null,
      transcriptSize: t ? getComputedStyle(t).fontSize : null,
      transcriptText: t ? (t.textContent || '').trim().slice(0, 40) : null,
      imgBottom: img ? Math.round(img.r.bottom) : null,
      fold: window.innerHeight,
    };
  })()
`);
console.log(`     transcription ........ ${fit?.transcriptSize}  "${fit?.transcriptText}…"`);
console.log(`     note bottom .......... ${fit?.imgBottom} / fold ${fit?.fold}`);
console.log(`     text bottom .......... ${fit?.transcriptBottom} / fold ${fit?.fold}  ${fit?.transcriptBottom > fit?.fold ? '! CLIPPED' : 'ok'}`);

/* ── EXPLORE: dial colour, counts, legend ─────────────────────────────── */
await send('Page.navigate', { url: `${BASE}/?view=explore` });
for (let i = 0; i < 60; i++) {
  if (await evaluate(`/anywhere to continue/i.test(document.body.textContent || '')`)) break;
  await sleep(400);
}
await sleep(1600);
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll('button')].find((x) => /anywhere to continue/i.test(x.textContent || ''));
    if (b) b.click();
  })()
`);
await sleep(2600);

const ex = await evaluate(`
  (() => {
    const all = [...document.querySelectorAll('span, div')];
    const leaf = (re) => all.find((e) => e.children.length === 0 && re.test((e.textContent || '').trim()));
    const cat = all.find((e) => /^\\[\\s*[A-Z]+\\s*\\]$/.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 40);
    const catGlyph = cat ? (cat.querySelector('span') || cat) : null;
    const counts = all
      .filter((e) => /^\\d\\d\\s*\\/\\s*\\d\\d$/.test((e.textContent || '').trim()))
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { t: e.textContent.trim(), size: getComputedStyle(e).fontSize, y: Math.round(r.top), x: Math.round(r.left) };
      })
      .filter((c, i, a) => a.findIndex((z) => z.y === c.y && z.x === c.x) === i);
    const legendLabel = leaf(/^THEME$/);
    const legendKey = leaf(/^←$/) || leaf(/^→$/);
    // The transcript is split into one span per word, so it has children and is
    // not a leaf. Take the narrowest element holding a long run of text that
    // isn't part of the lattice, and read the colour off one of its words.
    const transcript = all
      .filter((e) => {
        const s = (e.textContent || '').trim();
        return s.length > 50 && !/grid-lattice/.test(e.className || '') && /\\s/.test(s);
      })
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    const tWord = transcript
      ? [...transcript.querySelectorAll('span')].find((s) => (s.textContent || '').trim()) || transcript
      : null;
    const px = (e) => (e ? getComputedStyle(e).fontSize : null);
    const col = (e) => (e ? getComputedStyle(e).color : null);
    return {
      cat: { text: cat ? cat.textContent.trim() : null, color: col(catGlyph), size: px(catGlyph) },
      counts,
      legend: { labelColor: col(legendLabel), keyColor: col(legendKey), labelSize: px(legendLabel) },
      transcript: { color: col(tWord), size: px(tWord), text: transcript ? (transcript.textContent || '').trim().slice(0, 34) : null },
    };
  })()
`);
console.log(`\n  EXPLORE`);
console.log(`     [ category ] ......... ${ex?.cat?.text}  ${ex?.cat?.color}  ${ex?.cat?.size}`);
console.log(`     transcript ........... ${ex?.transcript?.color}  ${ex?.transcript?.size}  "${ex?.transcript?.text}…"`);
console.log(`     match ................ ${ex?.cat?.color === ex?.transcript?.color ? 'YES' : 'NO'}`);
console.log(`     counts:`);
for (const c of ex?.counts || []) console.log(`       "${c.t}"  ${c.size}  at y=${c.y}`);
console.log(`     legend label ......... ${ex?.legend?.labelColor} @ ${ex?.legend?.labelSize}`);
console.log(`     legend key glyph ..... ${ex?.legend?.keyColor}`);
await shot('explore', { x: 0, y: 0, width: W, height: 700 });
await shot('explore-dial', { x: 0, y: 200, width: 420, height: 460 });
// Tight on the legend at 4x — the arrow glyphs are grained, and this is where
// dropping them off pure white would show as mush if it were going to.
await shot('explore-legend', { x: W / 2 - 130, y: 8, width: 260, height: 60 }, 4);

console.log('');
chrome.kill();
ws.close();
process.exit(0);
