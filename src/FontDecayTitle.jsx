/* eslint-disable react/prop-types */
// FontDecayTitle
//
// A decayed, particle/network rendering of the landing hero title
// ("What We Tell AI"). Adapted from the Font Decay Tuner prototype, trimmed to
// only the controls this site needs:
//   • Layer B · Grain    — edge roughen, multi-pass stroke jitter, edge-biased stipple
//   • Layer C · Network   — particle web linking the grain dots (optionally oscillating)
//   • Appearance          — solid fill toggle, ink colour, paper colour + opacity
//   • Font                — choose which loaded face the title is drawn with
//
// The knobs live in the global DialKit panel (mounted in main.jsx; reveal with
// `?dial=1`). The canvas is transparent by default so the landing background
// shows through behind the title.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as opentype from 'opentype.js';
import { createNoise2D } from 'simplex-noise';
import { useDialKit } from 'dialkit';

/* ─── Fonts available on this site (public/) ──────────────────────── */
const FONTS = [
  { name: 'Reckless Italic', url: '/recklessItalic.otf' },
  { name: 'News Plantin', url: '/NewsPlantin.ttf' },
  { name: 'OT Brut Regular', url: '/OTBrut-Regular.otf' },
  { name: 'OT Brut Mono', url: '/OTBrut-RegularMono.otf' },
  { name: 'Redaction 35', url: '/Redaction35-Italic.otf' },
  { name: 'Redaction 50', url: '/Redaction50-Italic.otf' },
  { name: 'Redaction 70', url: '/Redaction70-Italic.otf' },
];
const DEFAULT_FONT = 'Reckless Italic';

/* Logical glyph size used for the offscreen geometry. The canvas is then
   displayed responsively (CSS), so this only sets the internal resolution /
   detail density, not the on-screen size. */
const RENDER_FONT_SIZE = 150;
const FLATTEN_STEPS = 8;

/* ─── Seeded RNG + noise ──────────────────────────────────────────── */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─── Bezier flattening ───────────────────────────────────────────── */
function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}
function quad(p0, p1, p2, t) {
  const u = 1 - t;
  const a = u * u, b = 2 * u * t, c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

function flattenCommands(commands, steps) {
  const contours = [];
  let cur = null;
  let prev = null;
  for (const c of commands) {
    if (c.type === 'M') {
      if (cur && cur.length) contours.push(cur);
      cur = [{ x: c.x, y: c.y }];
      prev = { x: c.x, y: c.y };
    } else if (c.type === 'L') {
      cur.push({ x: c.x, y: c.y });
      prev = { x: c.x, y: c.y };
    } else if (c.type === 'C') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        cur.push(cubic(prev, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }, t));
      }
      prev = { x: c.x, y: c.y };
    } else if (c.type === 'Q') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        cur.push(quad(prev, { x: c.x1, y: c.y1 }, { x: c.x, y: c.y }, t));
      }
      prev = { x: c.x, y: c.y };
    } else if (c.type === 'Z') {
      if (cur) cur.closed = true;
    }
  }
  if (cur && cur.length) contours.push(cur);
  return contours;
}

/* ─── Grain roughen (high-freq vertex displacement) ───────────────── */
function roughenContours(contours, noise, roughAmp, roughFreq) {
  if (roughAmp <= 0) return contours;
  return contours.map((c) => {
    const out = c.map((p) => {
      const dx = noise(p.x * roughFreq + 31, p.y * roughFreq + 17) * roughAmp;
      const dy = noise(p.x * roughFreq + 71, p.y * roughFreq + 57) * roughAmp;
      return { x: p.x + dx, y: p.y + dy };
    });
    out.closed = c.closed;
    return out;
  });
}

function contoursToPath(contours) {
  let d = '';
  for (const c of contours) {
    if (c.length < 2) continue;
    d += `M${c[0].x.toFixed(2)} ${c[0].y.toFixed(2)}`;
    for (let i = 1; i < c.length; i++) d += `L${c[i].x.toFixed(2)} ${c[i].y.toFixed(2)}`;
    if (c.closed) d += 'Z';
  }
  return d;
}

function bboxOf(contours) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Two-pass chamfer distance transform: distance (px) to the nearest
// background pixel (binary === 0).
function distanceTransform(binary, w, h) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = binary[i] ? INF : 0;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) v = Math.min(v, d[i - w] + a);
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + b);
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + b);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) v = Math.min(v, d[i + w] + a);
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + b);
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + b);
      d[i] = v;
    }
  }
  return d;
}

/* ─── Stipple: pixel positions for the grain dots + network nodes ──── */
function computeStipple(d, fit, {
  stippleDensity, dotSize, edgeBias, edgeFalloff, edgeSpill, seed, w, h,
}) {
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.translate(fit.offsetX, fit.offsetY);
  octx.scale(fit.scale, fit.scale);
  octx.fillStyle = '#fff';
  octx.fill(new Path2D(d), 'evenodd');

  const img = octx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const insideMask = new Uint8Array(n);
  const outsideMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const on = img[(i << 2) + 3] > 128 ? 1 : 0;
    insideMask[i] = on;
    outsideMask[i] = on ? 0 : 1;
  }
  const distIn = distanceTransform(insideMask, w, h);
  const distOut = distanceTransform(outsideMask, w, h);

  const falloff = Math.max(1, edgeFalloff);
  const spill = Math.max(0, edgeSpill);

  const prob = (i) => {
    if (insideMask[i]) {
      const edge = Math.exp(-distIn[i] / falloff);
      return (1 - edgeBias) + edgeBias * edge;
    }
    if (spill > 0 && distOut[i] < spill * 3) {
      return edgeBias * Math.exp(-distOut[i] / spill);
    }
    return 0;
  };

  const px = Math.max(1, Math.round(dotSize));
  const cellKey = (gx, gy) => gx * 100003 + gy;
  const rng = mulberry32(seed * 101 + 7);
  const total = Math.round(w * h * 0.16 * stippleDensity);

  const dots = [];
  const seen = new Set();
  for (let k = 0; k < total; k++) {
    const x = rng() * w;
    const y = rng() * h;
    const i = (y | 0) * w + (x | 0);
    const p = prob(i);
    if (p <= 0 || rng() > p) continue;
    const gx = Math.floor(x / px) * px;
    const gy = Math.floor(y / px) * px;
    const ck = cellKey(gx / px, gy / px);
    if (seen.has(ck)) continue;
    seen.add(ck);
    dots.push({ x: gx, y: gy, s: px, a: 0.5 + rng() * 0.5 });
  }

  let nodes = [];
  if (dots.length > 1) {
    const crng = mulberry32(seed * 333 + 9);
    const targetNodes = 520;
    const nodeProb = Math.min(1, targetNodes / dots.length);
    nodes = dots
      .filter(() => crng() < nodeProb)
      .map((dd) => ({ x: dd.x + dd.s / 2, y: dd.y + dd.s / 2 }));
  }

  return { dots, nodes };
}

/* ─── Network web (re-drawn each frame so linkDistance can oscillate) ─ */
function drawNetwork(ctx, nodes, { linkDistance, linkDensity, lineWidth, fg, seed, pixelSize }) {
  if (!nodes || nodes.length < 2 || linkDistance <= 0) return;
  const px = Math.max(1, Math.round(pixelSize || 1));
  const thick = Math.max(1, Math.round(lineWidth));
  const cell = linkDistance;
  const grid = new Map();
  const key = (cx, cy) => cx * 100000 + cy;
  nodes.forEach((p, idx) => {
    const k = key((p.x / cell) | 0, (p.y / cell) | 0);
    const arr = grid.get(k);
    if (arr) arr.push(idx); else grid.set(k, [idx]);
  });

  const maxLinks = 3;
  const maxD2 = cell * cell;
  const crng = mulberry32(seed * 333 + 9);

  const cells = new Set();
  const stamp = (sx, sy) => {
    const cxp = Math.floor(sx / px);
    const cyp = Math.floor(sy / px);
    for (let oy = 0; oy < thick; oy++) {
      for (let ox = 0; ox < thick; ox++) {
        cells.add((cxp + ox) * 100000 + (cyp + oy));
      }
    }
  };

  for (let idx = 0; idx < nodes.length; idx++) {
    const p = nodes[idx];
    const cx = (p.x / cell) | 0;
    const cy = (p.y / cell) | 0;
    let links = 0;
    for (let gx = cx - 1; gx <= cx + 1 && links < maxLinks; gx++) {
      for (let gy = cy - 1; gy <= cy + 1 && links < maxLinks; gy++) {
        const arr = grid.get(key(gx, gy));
        if (!arr) continue;
        for (const j of arr) {
          if (j <= idx) continue;
          const q = nodes[j];
          const dx = q.x - p.x, dy = q.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > maxD2) continue;
          if (crng() > linkDensity) continue;
          const steps = Math.max(1, Math.ceil(Math.sqrt(d2) / px));
          for (let s = 0; s <= steps; s++) {
            const tt = s / steps;
            stamp(p.x + dx * tt, p.y + dy * tt);
          }
          if (++links >= maxLinks) break;
        }
      }
    }
  }

  ctx.save();
  ctx.fillStyle = fg;
  ctx.globalAlpha = 0.9;
  for (const k of cells) {
    const cxp = Math.floor(k / 100000);
    const cyp = k - cxp * 100000;
    ctx.fillRect(cxp * px, cyp * px, px, px);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawDots(ctx, dots, fg) {
  ctx.save();
  ctx.fillStyle = fg;
  for (const d of dots) {
    ctx.globalAlpha = d.a;
    ctx.fillRect(d.x, d.y, d.s, d.s);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ─── Component ───────────────────────────────────────────────────── */
export default function FontDecayTitle({
  text = 'What We Tell AI',
  maxWidthPx = 760,
  glow = true,
  // Multi-line support: `text` may contain "\n". `lineOffsetsEm` shifts each
  // line horizontally (in em, i.e. multiples of the render font size) to create
  // a staggered layout; `lineGap` is the baseline-to-baseline distance as a
  // multiple of the font size. Single-line callers can ignore both.
  lineOffsetsEm,
  lineGap = 1.05,
  // Optional per-line font face override (array of FONTS names, indexed by
  // line). Lines without an entry fall back to the DialKit-selected face.
  lineFonts,
  // When true, each line is horizontally centered against the widest line
  // (overrides `lineOffsetsEm`) so a stacked title reads centered.
  centerLines = false,
  // One-time entrance: fade the title in word-by-word. `revealStaggerMs` is the
  // delay between consecutive words (0 disables the entrance entirely);
  // `revealDurationMs` is how long each word takes to fade in. Once the last
  // word lands, rendering hands back to the normal draw — steady state is
  // unchanged.
  revealStaggerMs = 0,
  revealDurationMs = 650,
  // Fired once when the word-by-word entrance finishes — or immediately (once
  // the glyphs are ready) when no entrance runs. Lets callers sequence
  // follow-on content (e.g. a subtitle) to appear after the title lands.
  onRevealComplete,
}) {
  const canvasRef = useRef(null);
  const [fonts, setFonts] = useState({}); // { name: font }
  const [seed] = useState(1);
  // Word-by-word entrance timing, kept in refs so it survives StrictMode's
  // double-mount and font-load redraws: `revealStartRef` anchors elapsed time
  // (a re-run continues the fade instead of restarting it) and `revealDoneRef`
  // latches completion so later redraws skip straight to the steady-state draw.
  const revealStartRef = useRef(null);
  const revealDoneRef = useRef(false);
  // Latches the onRevealComplete notification so it fires exactly once across
  // StrictMode double-mounts and steady-state redraws.
  const revealNotifiedRef = useRef(false);
  const onRevealCompleteRef = useRef(onRevealComplete);
  onRevealCompleteRef.current = onRevealComplete;

  /* ── DialKit panel — only the four requested groups ── */
  const dial = useDialKit('Title Decay', {
    'Layer B · Grain': {
      roughAmplitude: [0, 0, 16, 0.5],
      roughFrequency: [0.08, 0.02, 0.3, 0.005],
      strokePasses: [6, 0, 12, 1],
      strokeJitter: [1.5, 0, 10, 0.5],
      strokeWidth: [1, 0, 6, 0.5],
      stippleDensity: [1.15, 0, 5, 0.05],
      dotSize: [2, 1, 8, 1],
      edgeBias: [0.08, 0, 1, 0.05],
      edgeFalloff: [50, 4, 200, 2],
      edgeSpill: [7, 0, 60, 1],
    },
    'Layer C · Network': {
      connect: true,
      linkDistance: [35, 10, 200, 5],
      linkDensity: [0.03, 0, 1, 0.01],
      lineWidth: [0.5, 0.25, 3, 0.25],
      oscillate: true,
      oscRange: [10, 0, 120, 5],
      oscSpeed: [0.05, 0.05, 4, 0.05],
    },
    Appearance: {
      solidFill: false,
      ink: { type: 'color', default: '#e5e5e5' },
      paper: { type: 'color', default: '#050505' },
      paperOpacity: [0, 0, 1, 0.05],
    },
    Font: {
      face: { type: 'select', options: FONTS.map((f) => f.name), default: DEFAULT_FONT },
    },
  });

  const lb = dial['Layer B · Grain'] || {};
  const lc = dial['Layer C · Network'] || {};
  const ap = dial.Appearance || {};
  const fnt = dial.Font || {};

  const roughAmp = lb.roughAmplitude ?? 0;
  const roughFreq = lb.roughFrequency ?? 0.08;
  const strokePasses = lb.strokePasses ?? 0;
  const strokeJitter = lb.strokeJitter ?? 0;
  const strokeWidth = lb.strokeWidth ?? 0;
  const stippleDensity = lb.stippleDensity ?? 0;
  const dotSize = lb.dotSize ?? 1;
  const edgeBias = lb.edgeBias ?? 0;
  const edgeFalloff = lb.edgeFalloff ?? 36;
  const edgeSpill = lb.edgeSpill ?? 8;

  const connect = lc.connect ?? true;
  const linkDistance = lc.linkDistance ?? 42;
  const linkDensity = lc.linkDensity ?? 0.12;
  const lineWidth = lc.lineWidth ?? 1;
  const oscillate = lc.oscillate ?? false;
  const oscRange = lc.oscRange ?? 12;
  const oscSpeed = lc.oscSpeed ?? 0.3;

  const fillOn = ap.solidFill ?? false;
  const fg = ap.ink ?? '#e5e5e5';
  const paper = ap.paper ?? '#050505';
  const paperOpacity = ap.paperOpacity ?? 0;

  const faceName = fnt.face ?? DEFAULT_FONT;

  /* ── Load every site font once ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = {};
      for (const f of FONTS) {
        try {
          const res = await fetch(encodeURI(f.url));
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          loaded[f.name] = opentype.parse(buf);
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setFonts(loaded);
    })();
    return () => { cancelled = true; };
  }, []);

  const font = fonts[faceName] || fonts[DEFAULT_FONT] || Object.values(fonts)[0] || null;

  // Serialized so inline-array props don't bust the memo every render.
  const offsetsKey = (lineOffsetsEm || []).join('|');
  const lineFontsKey = (lineFonts || []).join('|');
  // Which faces (if any) are loaded yet — gates the memo so per-line fonts
  // recompute once their file finishes loading.
  const loadedKey = Object.keys(fonts).sort().join('|');

  /* ── Geometry: glyph outline → flatten → grain roughen → path "d".
        Also segments the title into per-word paths + bboxes (in glyph coords)
        so the entrance can fade words in one at a time. ── */
  const geo = useMemo(() => {
    if (!font || !text) return null;
    const lines = String(text).split('\n');
    const offsets = lineOffsetsEm || [];
    const perLine = lineFonts || [];
    const lineH = RENDER_FONT_SIZE * lineGap;
    const faceFor = (li) => fonts[perLine[li]] || font;
    // Per-line advance widths (needed to center lines against the widest one).
    const lineWidths = lines.map((line, li) => {
      const lf = faceFor(li);
      let w = 0;
      for (const ch of line) w += lf.getAdvanceWidth(ch, RENDER_FONT_SIZE);
      return w;
    });
    const maxLineW = Math.max(0, ...lineWidths);
    const noise = createNoise2D(mulberry32(seed));
    const commands = [];
    const words = [];
    lines.forEach((line, li) => {
      // Per-line face override → fall back to the selected/default face.
      const lineFont = faceFor(li);
      let x = centerLines
        ? (maxLineW - lineWidths[li]) / 2
        : (offsets[li] || 0) * RENDER_FONT_SIZE;
      const y = li * lineH;
      // Walk word/whitespace tokens: x keeps advancing through the gaps, but
      // each visible word becomes its own path segment (in reading order).
      for (const tok of line.split(/(\s+)/)) {
        if (!tok) continue;
        if (/^\s+$/.test(tok)) {
          for (const ch of tok) x += lineFont.getAdvanceWidth(ch, RENDER_FONT_SIZE);
          continue;
        }
        const wcmds = [];
        for (const ch of tok) {
          const p = lineFont.getPath(ch, x, y, RENDER_FONT_SIZE);
          wcmds.push(...p.commands);
          x += lineFont.getAdvanceWidth(ch, RENDER_FONT_SIZE);
        }
        commands.push(...wcmds);
        const wbase = flattenCommands(wcmds, FLATTEN_STEPS);
        if (wbase.length) {
          words.push({
            d: contoursToPath(roughenContours(wbase, noise, roughAmp, roughFreq)),
            bbox: bboxOf(wbase),
          });
        }
      }
    });
    const base = flattenCommands(commands, FLATTEN_STEPS);
    if (!base.length) return null;
    const rough = roughenContours(base, noise, roughAmp, roughFreq);
    return { bbox: bboxOf(base), d: contoursToPath(rough), words };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, fonts, text, seed, roughAmp, roughFreq, lineGap, offsetsKey, lineFontsKey, centerLines, loadedKey]);

  /* ── Canvas box: natural glyph bbox + padding for grain/spill ── */
  const layout = useMemo(() => {
    if (!geo) return null;
    const pad = Math.ceil(roughAmp + edgeSpill + dotSize + 16);
    const w = Math.ceil(geo.bbox.w) + pad * 2;
    const h = Math.ceil(geo.bbox.h) + pad * 2;
    const offsetX = pad - geo.bbox.minX;
    const offsetY = pad - geo.bbox.minY;
    return { w, h, fit: { scale: 1, offsetX, offsetY } };
  }, [geo, roughAmp, edgeSpill, dotSize]);

  /* ── Stipple (expensive; recomputed only when grain inputs change) ── */
  const stip = useMemo(() => {
    if (!geo || !layout || stippleDensity <= 0) return null;
    return computeStipple(geo.d, layout.fit, {
      stippleDensity, dotSize, edgeBias, edgeFalloff, edgeSpill,
      seed, w: layout.w, h: layout.h,
    });
  }, [geo, layout, stippleDensity, dotSize, edgeBias, edgeFalloff, edgeSpill, seed]);

  /* ── Draw ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { w, h } = layout;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');

    // Static base: paper (optional) + glyph fill/stroke.
    const base = document.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    const bctx = base.getContext('2d');
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paperOpacity > 0) {
      bctx.globalAlpha = paperOpacity;
      bctx.fillStyle = paper;
      bctx.fillRect(0, 0, w, h);
      bctx.globalAlpha = 1;
    }

    if (geo) {
      bctx.save();
      bctx.translate(layout.fit.offsetX, layout.fit.offsetY);
      const path2d = new Path2D(geo.d);
      if (fillOn) {
        bctx.fillStyle = fg;
        bctx.fill(path2d, 'evenodd');
      }
      if (strokePasses > 0 && strokeWidth > 0) {
        bctx.strokeStyle = fg;
        bctx.lineJoin = 'round';
        bctx.lineCap = 'round';
        const rng = mulberry32(seed * 7 + 13);
        for (let i = 0; i < strokePasses; i++) {
          bctx.save();
          const jx = (rng() - 0.5) * 2 * strokeJitter;
          const jy = (rng() - 0.5) * 2 * strokeJitter;
          bctx.translate(jx, jy);
          bctx.globalAlpha = 0.35 + rng() * 0.5;
          bctx.lineWidth = strokeWidth;
          bctx.stroke(path2d);
          bctx.restore();
        }
        bctx.globalAlpha = 1;
      }
      bctx.restore();
    }

    const paint = (t) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      if (!stip) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let effLink = linkDistance;
      if (connect && oscillate && oscRange > 0) {
        effLink = Math.max(2, linkDistance + Math.sin(t * oscSpeed) * oscRange);
      }
      if (connect && effLink > 0) {
        drawNetwork(ctx, stip.nodes, {
          linkDistance: effLink, linkDensity, lineWidth, fg, seed,
          pixelSize: Math.max(1, Math.round(dotSize)),
        });
      }
      drawDots(ctx, stip.dots, fg);
    };

    let raf = 0;
    let cancelled = false;
    const startSteadyState = () => {
      if (cancelled) return;
      if (connect && oscillate && oscRange > 0) {
        const loop = (now) => {
          paint(now / 1000);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } else {
        paint(0);
      }
    };

    // One-time word-by-word entrance. Each word is pre-rendered (its glyph
    // strokes/fill + its share of the grain dots & network) onto its own layer,
    // then the layers are composited with a staggered, eased alpha. When the
    // last word lands we hand off to the normal (tuned) draw, so the resting
    // look is byte-for-byte unchanged.
    const words = geo?.words || [];
    const revealOn = revealStaggerMs > 0 && words.length > 1 && stip && !revealDoneRef.current;

    if (revealOn) {
      if (revealStartRef.current == null) revealStartRef.current = performance.now();
      // Assign each grain dot/node to a word by its position (word bbox in
      // canvas coords, padded to catch edge spill); gaps fall to the nearest.
      const margin = edgeSpill + dotSize + 2;
      const wbb = words.map((wd) => ({
        minX: wd.bbox.minX + layout.fit.offsetX - margin,
        maxX: wd.bbox.maxX + layout.fit.offsetX + margin,
        minY: wd.bbox.minY + layout.fit.offsetY - margin,
        maxY: wd.bbox.maxY + layout.fit.offsetY + margin,
        cx: (wd.bbox.minX + wd.bbox.maxX) / 2 + layout.fit.offsetX,
        cy: (wd.bbox.minY + wd.bbox.maxY) / 2 + layout.fit.offsetY,
      }));
      const wordOf = (x, y) => {
        let hit = -1;
        for (let i = 0; i < wbb.length; i++) {
          const b = wbb[i];
          if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) {
            if (hit < 0) hit = i;
            else if ((x - b.cx) ** 2 + (y - b.cy) ** 2 < (x - wbb[hit].cx) ** 2 + (y - wbb[hit].cy) ** 2) hit = i;
          }
        }
        if (hit >= 0) return hit;
        let best = 0, bd = Infinity;
        for (let i = 0; i < wbb.length; i++) {
          const dd = (x - wbb[i].cx) ** 2 + (y - wbb[i].cy) ** 2;
          if (dd < bd) { bd = dd; best = i; }
        }
        return best;
      };
      const dotsByWord = words.map(() => []);
      const nodesByWord = words.map(() => []);
      for (const dd of stip.dots) dotsByWord[wordOf(dd.x + dd.s / 2, dd.y + dd.s / 2)].push(dd);
      for (const nd of stip.nodes) nodesByWord[wordOf(nd.x, nd.y)].push(nd);

      const pixSize = Math.max(1, Math.round(dotSize));
      const layers = words.map((wd, i) => {
        const lc = document.createElement('canvas');
        lc.width = canvas.width;
        lc.height = canvas.height;
        const lx = lc.getContext('2d');
        // Glyph strokes/fill — same recipe as the shared base, this word only.
        lx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lx.translate(layout.fit.offsetX, layout.fit.offsetY);
        const wp = new Path2D(wd.d);
        if (fillOn) {
          lx.fillStyle = fg;
          lx.fill(wp, 'evenodd');
        }
        if (strokePasses > 0 && strokeWidth > 0) {
          lx.strokeStyle = fg;
          lx.lineJoin = 'round';
          lx.lineCap = 'round';
          const rng = mulberry32(seed * 7 + 13 + i * 97);
          for (let k = 0; k < strokePasses; k++) {
            lx.save();
            lx.translate((rng() - 0.5) * 2 * strokeJitter, (rng() - 0.5) * 2 * strokeJitter);
            lx.globalAlpha = 0.35 + rng() * 0.5;
            lx.lineWidth = strokeWidth;
            lx.stroke(wp);
            lx.restore();
          }
          lx.globalAlpha = 1;
        }
        // Grain dots + network (absolute coords → reset the glyph offset).
        lx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (connect && linkDistance > 0) {
          drawNetwork(lx, nodesByWord[i], {
            linkDistance, linkDensity, lineWidth, fg, seed, pixelSize: pixSize,
          });
        }
        drawDots(lx, dotsByWord[i], fg);
        return lc;
      });

      const ease3 = (x) => 1 - Math.pow(1 - x, 3);
      const t0 = revealStartRef.current;
      const endMs = (layers.length - 1) * revealStaggerMs + revealDurationMs;
      const frame = (now) => {
        const e = now - t0;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (paperOpacity > 0) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.globalAlpha = paperOpacity;
          ctx.fillStyle = paper;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        for (let i = 0; i < layers.length; i++) {
          const a = ease3(Math.min(1, Math.max(0, (e - i * revealStaggerMs) / revealDurationMs)));
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          ctx.drawImage(layers[i], 0, 0);
        }
        ctx.globalAlpha = 1;
        if (e < endMs) {
          raf = requestAnimationFrame(frame);
        } else {
          revealDoneRef.current = true;
          startSteadyState();
          if (!revealNotifiedRef.current) {
            revealNotifiedRef.current = true;
            onRevealCompleteRef.current?.();
          }
        }
      };
      raf = requestAnimationFrame(frame);
      return () => { cancelled = true; cancelAnimationFrame(raf); };
    }

    startSteadyState();
    // No entrance running (disabled, single word, or already done): once the
    // glyphs are actually drawable, hand off immediately. `stip` gates against
    // firing before the title is ready (font/geometry still loading).
    if (stip && !revealNotifiedRef.current) {
      revealNotifiedRef.current = true;
      onRevealCompleteRef.current?.();
    }
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [geo, layout, stip, fillOn, fg, paper, paperOpacity, strokePasses, strokeJitter, strokeWidth, connect, linkDistance, linkDensity, lineWidth, dotSize, edgeSpill, oscillate, oscRange, oscSpeed, seed, revealStaggerMs, revealDurationMs]);

  const cssW = layout ? `min(${layout.w}px, ${maxWidthPx}px, 88vw)` : `min(${maxWidthPx}px, 88vw)`;
  const glowFilter = glow
    ? 'drop-shadow(0 0 18px rgba(255,255,255,0.35)) drop-shadow(0 0 46px rgba(255,255,255,0.16))'
    : 'none';

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={text}
      style={{
        display: 'block',
        width: cssW,
        height: 'auto',
        filter: glowFilter,
      }}
    />
  );
}
