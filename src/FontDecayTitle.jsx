/* eslint-disable react/prop-types */
// FontDecayTitle
//
// Clean vector rendering of the landing hero title ("What We Tell AI").
// The glyph outlines are pulled from the chosen OpenType face (opentype.js) and
// painted as filled <path>s inside a responsive <svg> — so the type stays
// razor-sharp at any width and "just renders the font", no texture/decay.
//
// The one-time, word-by-word fade entrance is preserved (revealGate /
// onRevealComplete) so the landing onboarding sequence still drives it. Ink
// colour + face live in the DialKit "Title" panel (reveal with `?dial=1`).

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import * as opentype from 'opentype.js';
import { useDialKit } from 'dialkit';

/* ─── Fonts available on this site (public/) ──────────────────────── */
const FONTS = [
  { name: 'TRJN DaVinci Medium Italic', url: '/TRJNDaVinci-Medium-Italic-Trial.otf' },
  { name: 'TRJN DaVinci Italic', url: '/TRJNDaVinci-Italic-Trial.otf' },
  { name: 'Reckless Italic', url: '/recklessItalic.otf' },
  { name: 'News Plantin', url: '/NewsPlantin.ttf' },
  { name: 'OT Brut Regular', url: '/OTBrut-Regular.otf' },
  { name: 'OT Brut Mono', url: '/OTBrut-RegularMono.otf' },
  { name: 'Redaction 35', url: '/Redaction35-Italic.otf' },
  { name: 'Redaction 50', url: '/Redaction50-Italic.otf' },
  { name: 'Redaction 70', url: '/Redaction70-Italic.otf' },
];
const DEFAULT_FONT = 'TRJN DaVinci Medium Italic';

/* Logical glyph size for the offscreen geometry. The <svg> viewBox scales the
   resulting paths to the on-screen width, so this only sets coordinate
   precision, not the rendered size. */
const RENDER_FONT_SIZE = 150;

/* Gentle ease-out for the word-by-word entrance. */
const REVEAL_EASE = [0.22, 0.61, 0.36, 1];

/* ─── Component ───────────────────────────────────────────────────── */
export default function FontDecayTitle({
  text = 'What We Tell AI',
  maxWidthPx = 760,
  glow = false,
  // Multi-line support: `text` may contain "\n". `lineGap` is the baseline-to-
  // baseline distance as a multiple of the font size. `centerLines` centers
  // each line against the widest one (for a stacked mobile title).
  lineGap = 1.05,
  centerLines = false,
  // One-time entrance: fade the title in word-by-word. `revealStaggerMs` is the
  // delay between consecutive words (0 disables the entrance); `revealDurationMs`
  // is how long each word takes to fade in.
  revealStaggerMs = 0,
  revealDurationMs = 650,
  // Holds the entrance closed until the caller flips this true (kept mounted so
  // fonts/geometry preload). Defaults open for callers that don't gate.
  revealGate = true,
  // Fired once when the entrance finishes — or immediately (once the glyphs are
  // ready and the gate is open) when no entrance runs. Lets callers sequence
  // follow-on content (e.g. the scroll cue) after the title lands.
  onRevealComplete,
}) {
  const reduceMotion = useReducedMotion();
  const [fonts, setFonts] = useState({}); // { name: opentype.Font }

  // Latches the onRevealComplete notification so it fires exactly once across
  // StrictMode double-mounts and redraws.
  const revealNotifiedRef = useRef(false);
  const onRevealCompleteRef = useRef(onRevealComplete);
  onRevealCompleteRef.current = onRevealComplete;

  /* ── DialKit: only colour + face now that the decay is gone. ── */
  const dial = useDialKit('Title', {
    Appearance: { ink: { type: 'color', default: '#6A6666' } },
    Font: { face: { type: 'select', options: FONTS.map((f) => f.name), default: DEFAULT_FONT } },
  });
  const ink = dial.Appearance?.ink ?? '#6A6666';
  const faceName = dial.Font?.face ?? DEFAULT_FONT;

  /* ── Load every site font once (buffers parsed for outline extraction). ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = {};
      for (const f of FONTS) {
        try {
          const res = await fetch(encodeURI(f.url));
          if (!res.ok) continue;
          loaded[f.name] = opentype.parse(await res.arrayBuffer());
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setFonts(loaded);
    })();
    return () => { cancelled = true; };
  }, []);

  const font = fonts[faceName] || fonts[DEFAULT_FONT] || Object.values(fonts)[0] || null;
  // Which faces are loaded — gates the memo so the face recomputes once its file
  // finishes loading.
  const loadedKey = Object.keys(fonts).sort().join('|');

  /* ── Geometry: glyph outlines → per-word SVG path "d" + union bbox.
        Words are kept in reading order so the entrance can fade them in one at a
        time; the union bbox becomes the <svg> viewBox (which scales the paths to
        fill the on-screen width). ── */
  const geo = useMemo(() => {
    if (!font || !text) return null;
    const lines = String(text).split('\n');
    const lineH = RENDER_FONT_SIZE * lineGap;
    const lineWidths = lines.map((line) => font.getAdvanceWidth(line, RENDER_FONT_SIZE));
    const maxLineW = Math.max(0, ...lineWidths);
    const words = [];
    const bb = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    lines.forEach((line, li) => {
      let x = centerLines ? (maxLineW - lineWidths[li]) / 2 : 0;
      const y = li * lineH;
      // Walk word/whitespace tokens: x keeps advancing through the gaps, but
      // each visible word becomes its own path segment (in reading order).
      for (const tok of line.split(/(\s+)/)) {
        if (!tok) continue;
        if (/^\s+$/.test(tok)) {
          x += font.getAdvanceWidth(tok, RENDER_FONT_SIZE);
          continue;
        }
        const p = font.getPath(tok, x, y, RENDER_FONT_SIZE);
        const d = p.toPathData(2);
        x += font.getAdvanceWidth(tok, RENDER_FONT_SIZE);
        if (!d) continue;
        const wb = p.getBoundingBox();
        words.push({ d });
        if (wb.x1 < bb.x1) bb.x1 = wb.x1;
        if (wb.y1 < bb.y1) bb.y1 = wb.y1;
        if (wb.x2 > bb.x2) bb.x2 = wb.x2;
        if (wb.y2 > bb.y2) bb.y2 = wb.y2;
      }
    });
    if (!words.length || !Number.isFinite(bb.x1)) return null;
    return { words, bbox: bb };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, text, lineGap, centerLines, loadedKey]);

  const wordCount = geo?.words.length || 0;
  const reveal = !reduceMotion && revealStaggerMs > 0 && wordCount > 1;

  /* ── Fire onRevealComplete once: after the staggered fade (or immediately
        when there's no entrance), but only once the glyphs exist and the gate
        is open. Decoupled from the per-word motion so it can't be missed. ── */
  useEffect(() => {
    if (!geo || !revealGate || revealNotifiedRef.current) return;
    const total = reveal ? (wordCount - 1) * revealStaggerMs + revealDurationMs : 0;
    const id = setTimeout(() => {
      revealNotifiedRef.current = true;
      onRevealCompleteRef.current?.();
    }, total);
    return () => clearTimeout(id);
  }, [geo, revealGate, reveal, wordCount, revealStaggerMs, revealDurationMs]);

  if (!geo) return null;

  const { bbox } = geo;
  const pad = 6; // breathing room for italic overhang / glow
  const vbW = bbox.x2 - bbox.x1 + pad * 2;
  const vbH = bbox.y2 - bbox.y1 + pad * 2;
  const viewBox = `${bbox.x1 - pad} ${bbox.y1 - pad} ${vbW} ${vbH}`;
  const cssW = `min(${Math.ceil(vbW)}px, ${maxWidthPx}px, 92vw)`;
  const glowFilter = glow
    ? 'drop-shadow(0 0 18px rgba(255,255,255,0.35)) drop-shadow(0 0 46px rgba(255,255,255,0.16))'
    : 'none';

  const staggerS = revealStaggerMs / 1000;
  const durS = revealDurationMs / 1000;

  return (
    <svg
      role="img"
      aria-label={text}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      style={{
        display: 'block',
        width: cssW,
        height: 'auto',
        aspectRatio: `${vbW} / ${vbH}`,
        overflow: 'visible',
        filter: glowFilter,
      }}
    >
      {geo.words.map((wd, i) => (
        <motion.path
          key={`${i}-${wd.d.length}`}
          d={wd.d}
          fill={ink}
          initial={reveal ? { opacity: 0 } : false}
          animate={{ opacity: revealGate ? 1 : 0 }}
          transition={{
            duration: reveal ? durS : 0,
            ease: REVEAL_EASE,
            delay: reveal && revealGate ? i * staggerS : 0,
          }}
        />
      ))}
    </svg>
  );
}
