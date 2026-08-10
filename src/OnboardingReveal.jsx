import { createElement, Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import * as opentype from 'opentype.js';
import { useDialKit } from 'dialkit';
import { INK, inkA } from './colors';
import { PAGE_BG, PAGE_GRADIENT } from './NoiseGradient';
import { LINK_UNDERLINE } from './linkUnderline';
import {
  CARD_FILTER_ID,
  CardNoiseFilterDefs,
  TunableGrainBackground,
  useInactiveCardParams,
} from './noise';
import { NOTE_STILL_IDS } from './noteStills';
import AsciiWall from './AsciiWall';
import WordmarkGL from './WordmarkGL';
import WordmarkDraw from './WordmarkDraw';
import BodyKicker from './BodyKicker';

/* ─────────────────────────────────────────────────────────────────────
 * ONBOARDING SCROLL STORYBOARD  (mobile-first editorial reveal)
 *
 * A continuous vertical scroll (Figma "EXPLORATIONS V2 / Frame 51"). Nothing
 * animates on a global clock — every block reveals itself the moment it
 * scrolls into view. Read top-to-bottom; each row is one block:
 *
 *   HERO      title "What We Tell AI" (Figma 280:71) reveals word-by-word in
 *             TRJN DaVinci on two lines; opening question cascades in beneath it
 *             a word at a time, then the scroll arrow fades in last
 *   BOOTH     the Dolores Park booth still slides in from the left, then the
 *             intro line cascades in beneath it
 *   NOTE ①    a handwritten confession fades in through the filter
 *   BODY      "AI is entering into the most personal aspects…" cascades in
 *   NOTE ②    confession fades in through the filter
 *   FRAGMENT  "And even substituting our human relationships…" cascades in
 *   NOTE ③    confession fades in through the filter
 *   QUESTION  the closing statement + ENTER cta
 *
 * The four display copy blocks all use RevealWords below — a per-word opacity
 * cascade at WORD_DISPLAY's slower timing. No canvas: the copy is live DOM text
 * from the first frame, so it stays selectable and the authored rag is the
 * browser's own line boxes rather than a rasterized snapshot of them.
 *
 * A SKIP control is sticky (fixed) top-right the whole way down.
 * ───────────────────────────────────────────────────────────────────── */

const ease = [0.22, 1, 0.36, 1];
const SERIF = "'Faktory', Georgia, serif";
const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

// Applied to the label <span> rather than to the flex anchor, so it underlines
// only the word and not the icon gap.
const ONBOARDING_LINK_UNDERLINE = LINK_UNDERLINE;

/* The page's two calls to action — Skip Intro riding the top corner, Enter the
 * archive at the end of the scroll. Both rest a shade under full ink and light
 * up under the cursor; the dotted rule is painted in currentColor, so it
 * brightens with the words.
 *
 * In CSS rather than mouse handlers because this page re-renders on every
 * scroll beat and motion rewrites the style prop each time, which wiped an
 * imperatively-set colour a few frames after the cursor arrived — the hover
 * lit up and then dropped out from under the pointer. Nothing here may set
 * `color` inline either, or it outranks the rule. */
const CTA_HOVER_CSS = `
  .onboarding-cta { color: ${inkA(0.82)}; transition: color 0.2s ease; }
  .onboarding-cta:hover { color: ${INK}; }
`;

/** How words fade in (per-word cascade — opacity only, no rise/blur). One place
 *  for all text timing. */
const WORD = {
  staggerS: 0.055, //  delay between consecutive words
  durS: 0.62, //       per-word fade-in duration
};

/** Bigger, slower cascade for the emphasized display fragments. */
const WORD_DISPLAY = {
  staggerS: 0.11,
  durS: 0.9,
};

/**
 * Typewriter reveal — glyphs appear left-to-right at a steady cadence, like
 * typing (no caret / blinker). Pure opacity: every character is laid out from
 * the first frame (invisible), so line breaks are fixed and nothing reflows as
 * it "types," and it stays GPU-cheap. The steady per-char delay is the typing
 * rhythm; each glyph's own fade is kept short so it reads as a keystroke.
 */
const TYPEWRITER = {
  perCharS: 0.028, // cadence between characters (typing speed)
  durS: 0.08, //     per-character fade-in
};

/** How images arrive: opacity fades in WHILE the filter resolves over time. */
const IMAGE = {
  fadeS: 1.9, //           opacity + filter resolve duration
  riseY: 40, //            px the image rises as it resolves
  fromScale: 1, //         no scale on reveal (fades/develops in place)
  fromBlur: 16, //         px blur → 0
  fromGrayscale: 1, //     grayscale(1) → 0 (drains back to full tone)
  fromBrightness: 1.55, // blown-out → 1 (develops in like a print)
  ease,
};

/** Directional slide-in used by the confession notes (RevealImage's
 *  `slideFrom`): they fly in from off the side of the screen with a slight tilt
 *  on the shared ease-out, instead of developing in place. */
const SLIDE = {
  // No `x`: the distance is a viewport width, read per note in RevealImage, so
  // the note always starts clear of the edge whatever the window size.
  rotate: 5, //  deg tilt it straightens out of
  /** Longer than the old 80px nudge, since the note now crosses most of the
   *  screen. `ease` is a hard ease-out, so it covers that ground early and
   *  spends the tail decelerating into place rather than reading as slow. */
  durS: 1.15,
  /** Opacity resolves well before the travel ends, so the note reads as a solid
   *  object flying in rather than something materialising as it slides. */
  fadeS: 0.34,
};

/**
 * Reveal a block just before it hits the vertical center, so you read it as
 * you "come across it." `once` keeps it revealed after (no re-hiding on scroll
 * back up).
 */
const IN_VIEW = { once: true, margin: '0px 0px -24% 0px' };

/**
 * The narrative. Copy mirrors the Figma frame's structure (title → question →
 * cube → intro → body → fragments over confession notes → closing → question),
 * written in the project's voice. Note stills reuse the archive's onboarding
 * WebPs in `public/confession_notes_2/`.
 */
/** Hero title + opening question — timed as one sequence after the loader.
 *  Title spec: Figma AI-CONFESSIONS-RAW node 280:71 (matches /What We Tell AI.png). */
const OPENING_QUESTION =
  'What do you have to confess about your relationship with AI?';
const HERO_TITLE = {
  postLoaderDelayMs: 1000, // beat after the loader lifts (onboarding route)
  mountDelayMs: 200, //      beat after mount when the loader is skipped (main site)
  // Reveal cadence — the wordmark fades in word-by-word ("What" "We" "Tell" "AI").
  // Deliberately slow: this is the first thing on the site, so the title should
  // surface rather than appear. `fadeEase` is NOT the page's usual ease-out —
  // that curve front-loads opacity (~90% in the first quarter), which makes a
  // long duration read as a short one. A symmetric curve spreads the climb
  // across the whole duration, so the extra time is actually felt.
  staggerMs: 170, //  delay between consecutive words
  fadeMs: 1250, //    per-word fade duration
  fadeEase: [0.33, 0, 0.67, 1],
  fontFamily: "'TRJN DaVinci', Georgia, serif",
  fill: 'rgba(221, 221, 174, 0.2)', // #DDDDAE, translucent so the page grain reads through
  stroke: '#393626',
  strokeWidth: '0.01em',
  fontSize: 'min(13vw, calc(66vh / 1.85))',
  lineHeight: 0.94,
  letterSpacing: '-0.03em', // Figma −10%
  textAlign: 'center',
  maxWidth: '96vw',
  maxHeight: '66vh',
  // Particle / noise filter (Figma 254:420): feTurbulence displaces the glyph
  // edges into grain so the type reads as if it's made of / dissolving into noise.
  noiseBaseFrequency: 0.92,
  noiseOctaves: 2,
  noiseScale: 8, //   px of edge displacement (grain coarseness)
  noiseSeed: 7,
  noiseAnimate: true, // crawl the seed so the grain is alive (film-grain boil)
  noiseFps: 12, //      seed hops/sec (lower = chunkier flicker)
};
const HERO_TITLE_LINES = ['What We', 'Tell AI'];
// Total glyph count (spaces excluded). The pixel-glitch picks random indices in
// [0, count) that line up 1:1 with the per-letter spans HeroTitleText renders.
const HERO_TITLE_LETTER_COUNT = HERO_TITLE_LINES.reduce(
  (n, line) => n + line.replace(/\s/g, '').length,
  0
);

// Per-letter TEXTURE pass on the hero wordmark. Once the title has revealed,
// random glyphs switch to one surface treatment — a chunky mosaic, CRT scanlines,
// a halftone dot screen, or a grain dissolve — hold it for a beat, then switch
// back. The filter cuts straight in and out; no fade.
//
// TEXTURE ONLY: every effect resamples the glyph's SURFACE and leaves its outline
// and position alone. Effects that displaced or reshaped the outline (slice tear,
// ink-weight morph, jitter / skew nudges, corrupted stand-in marks) read as
// breakage on a hand-lettered face and are gone.
//
// Because a cut has no ramp to hide behind, the HOLD is what keeps this from
// reading as a rendering fault: over a second on the glyph is a state, whereas the
// sub-300ms flashes this started as were a flicker. Gaps are then set against that
// hold — around 1.5 in the air at a time, so the word is rarely completely still but
// two letters going at once stays the exception rather than the texture.
//
// The ink stays at the faint resting HERO_TITLE.fill throughout, so a textured
// glyph is never brighter than its neighbours. Off under prefers-reduced-motion.
const HERO_GLITCH = {
  enabled: true,
  startDelayMs: 600, //  beat after the wordmark reveals before textures begin
  minGapMs: 800, //      shortest pause between passes
  maxGapMs: 2200, //     longest pause between passes
  doubleChance: 0.32, // chance a single pass hits two glyphs at once
};

// Geometry for the texture filters (all measured in CSS px).
//
// Every one of these except pixelate works by DISCARDING ink, so the ratio of kept
// to discarded area is the real constraint: below roughly a third the glyph stops
// reading as itself and the plateau just looks like a hole in the word. Each of
// these is tuned to keep ~40-50%, coarse enough to see the pattern at hero size.
const HERO_GLITCH_FX = {
  // 8px puts ~5 cells across a lowercase glyph — coarse enough to read as low-res,
  // fine enough that the letter's silhouette survives. At 12 it collapsed to a blob.
  pixelate: { block: 8 }, //         gapless mosaic cell (larger = chunkier)
  // 3px bars rather than 1-2px: at hero size a hairline bar just reads as the
  // letter dimming, and a gap wider than the face's thin strokes swallows them.
  scanline: { cell: 5, bar: 3 }, //  one `bar`-tall lit row per `cell`-tall row → 60%
  // Same sampling trick as pixelate, but each sample grows to less than its cell,
  // so the dots stay separated by paper instead of tiling into solid blocks.
  halftone: { cell: 6, dot: 4 }, //  one `dot`-wide dot per `cell`-square cell → ~44%
  // baseFrequency sets the speckle grain; the threshold turns the smooth noise
  // into hard on/off flecks so the glyph erodes rather than just dimming. Keep it
  // low — ~0.25 gives 4px flecks. Finer than about 0.4 and the specks land below
  // the size of the page's own grain overlay, so the letter just looks dimmer.
  dissolve: { freq: 0.25, octaves: 2 },
};

// Weighted effect table. `w` is the pick weight; `hold` is the [min, max] ms the
// texture stays on the glyph — never under ~1.1s, since short flashes are what read
// as a glitch. Softer treatments (mosaic, dissolve) can linger longest.
const HERO_GLITCH_EFFECTS = [
  { id: 'pixelate', w: 30, hold: [1300, 2100] },
  { id: 'dissolve', w: 26, hold: [1400, 2200] },
  { id: 'halftone', w: 22, hold: [1200, 1900] },
  { id: 'scanline', w: 22, hold: [1150, 1800] },
];
const HERO_GLITCH_WEIGHT_TOTAL = HERO_GLITCH_EFFECTS.reduce((n, e) => n + e.w, 0);

// Which treatment plays the hero wordmark. All three sit in the same beat and
// take the same props, so this is a one-word swap.
//
//   'hand'  the wordmark art written on stroke by stroke — see WordmarkDraw.
//           Each of the art's 22 pen strokes is uncovered along its own axis, so
//           the brush texture survives and the cadence reads as handwriting.
//   'gl'    the same art materialized through the WebGL mask dissolve — see
//           WordmarkGL. Also texture-preserving, but it blooms rather than writes.
//   'draw'  letter-by-letter SVG trim path off the TRJN DaVinci outlines. Only
//           works on monoline type — it throws texture away.
//   'text'  the plain word-by-word webfont fade.
const HERO_MODE = 'hand';

/* Tick rhythm for the scroll progress rule at the top of the page. Applied as a
   mask so the dashes are cut out of whatever the bar is painted with, leaving
   its faint-to-bright ramp intact. ~11px period puts roughly 85 ticks across a
   laptop, fine enough to read as a measured rule rather than as segments. */
const PROGRESS_DASHES =
  'repeating-linear-gradient(90deg, #000 0 5px, transparent 5px 11px)';
// Letter-by-letter reveal, one glyph after the next. Glyph outlines are pulled
// from the TRJN DaVinci face (opentype.js). Two modes:
//   'fill'    — sweep the SOLID letter in behind a per-letter clip that wipes
//               across the glyph (the fill-equivalent of a trim path: real trim
//               paths only trim strokes, so the fill is revealed by a clip).
//   'outline' — trace each glyph's OUTLINE with a stroke drawn on via Framer
//               Motion `pathLength` 0→1, then settle to the fill.
// Either way each letter reveals in bright cream then settles to the faint fill,
// landing on the same resting look as the webfont hero.
const HERO_DRAW = {
  mode: 'fill', //          'fill' (wipe the solid letter in) | 'outline' (trace the outline)
  wipe: 'lr', //            fill-mode sweep direction: 'lr' | 'rl' | 'ttb' | 'btt'
  renderFontSize: 150, //   logical glyph size for the offscreen geometry (viewBox scales it)
  lineGap: 0.94, //         baseline-to-baseline as a multiple of the font size (matches lineHeight)
  letterSpacing: -0.03, //  em, matches the webfont hero's −3%
  drawMs: 460, //           per-letter reveal (fill wipe / outline draw) duration
  fillMs: 420, //           per-letter settle (bright → faint) duration
  staggerMs: 120, //        delay between consecutive letters (letter-by-letter cascade)
  fillColor: 'rgb(221, 221, 174)', // cream — opacity is animated below (fillBright → fillRest)
  fillBright: 0.92, //      fill opacity while a letter reveals (the visible "ink")
  fillRest: 0.2, //         resting fill opacity (matches the webfont hero)
  strokeColor: 'rgba(221, 221, 174, 0.9)', // outline-mode: the visible "writing" line
  strokeWidth: 1.15, //     outline-mode: px (non-scaling, so it stays hairline at any size)
  drawEase: [0.45, 0.05, 0.55, 0.95], // near-linear so each letter reveals evenly
};
const HERO_QUESTION = {
  // The question arrives a word at a time, picking up where the title's own
  // reveal leaves off. `fadeS` is what ONE word takes, not the sentence — the
  // line as a whole runs for the last word's delay plus that.
  staggerS: 0.07,
  fadeS: 0.65,
  arrowDelayS: 0.25, // beat after the question lands before the scroll cue fades in
};

const OPENING_WORDS = OPENING_QUESTION.split(' ');

/** How long the cascade runs end to end — what the scroll cue waits out. */
const OPENING_REVEAL_S =
  (OPENING_WORDS.length - 1) * HERO_QUESTION.staggerS + HERO_QUESTION.fadeS;

/** Opening question beneath the hero title — a per-word cascade, the same move
 *  the display copy further down the page makes, on the hero's slower clock.
 *  The words are laid out from the first frame and only their opacity animates,
 *  so the rag is settled before anything is visible and no line reflows as it
 *  fills in. The spaces between them are real text nodes rather than margins,
 *  which keeps the measure identical to the plain sentence. */
function HeroOpeningQuestion({ hold = false, instant = false, style, onRevealComplete }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const reduce = useReducedMotion();
  const show = inView && !hold;
  const doneRef = useRef(false);
  const onRevealCompleteRef = useRef(onRevealComplete);
  onRevealCompleteRef.current = onRevealComplete;

  useEffect(() => {
    doneRef.current = false;
  }, [hold]);

  useEffect(() => {
    if (!show || doneRef.current) return undefined;
    if (reduce || instant) {
      doneRef.current = true;
      onRevealCompleteRef.current?.();
      return undefined;
    }
    const id = setTimeout(() => {
      doneRef.current = true;
      onRevealCompleteRef.current?.();
    }, OPENING_REVEAL_S * 1000);
    return () => clearTimeout(id);
  }, [show, reduce, instant]);

  return (
    <p ref={ref} aria-label={OPENING_QUESTION} style={{ margin: 0, ...style }}>
      {OPENING_WORDS.map((w, i) => (
        <Fragment key={i}>
          {i > 0 ? ' ' : null}
          <motion.span
            aria-hidden="true"
            initial={reduce || instant ? false : { opacity: 0 }}
            animate={show ? { opacity: 1 } : undefined}
            transition={{
              duration: reduce || instant ? 0 : HERO_QUESTION.fadeS,
              ease,
              delay: reduce || instant ? 0 : i * HERO_QUESTION.staggerS,
            }}
            style={{ display: 'inline-block' }}
          >
            {w}
          </motion.span>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * Animated grain <filter> for the hero title. Crawls the feTurbulence seed on a
 * ~30fps rAF clock so the glyph edges "boil" with living noise (same trick as
 * the inactive-card grain in noise.jsx). Scoped to its own component so only
 * this tiny subtree re-renders per frame, not the whole title. Respects
 * prefers-reduced-motion (falls back to the static grain).
 */
function HeroNoiseFilter({ id, reduceMotion = false, strength = 1 }) {
  const animate = HERO_TITLE.noiseAnimate && !reduceMotion;
  const startRef = useRef(null);
  if (startRef.current == null) {
    startRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!animate) return undefined;
    let raf;
    let last = 0;
    const interval = 1000 / 30;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (t - last < interval) return;
      last = t;
      setFrame((f) => (f + 1) % 1e6);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const seed = animate
    ? HERO_TITLE.noiseSeed + Math.floor(((now - startRef.current) / 1000) * HERO_TITLE.noiseFps)
    : HERO_TITLE.noiseSeed;
  const scale = HERO_TITLE.noiseScale * strength;
  const baseFrequency = HERO_TITLE.noiseBaseFrequency * (0.7 + strength * 0.3);

  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      <defs>
        <filter id={id} x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={baseFrequency}
            numOctaves={HERO_TITLE.noiseOctaves}
            seed={seed}
            stitchTiles="stitch"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={scale}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * Shared host for the zero-size <svg> that only carries a <defs> filter. Every
 * hero glitch filter is just a <defs> payload, so they all mount the same
 * invisible, non-interactive wrapper.
 */
function HeroFilterDefs({ children }) {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      <defs>{children}</defs>
    </svg>
  );
}

/**
 * Chunky "pixelation" mosaic <filter> for a single hero glyph. The classic
 * SVG trick: flood one 1px dot per BLOCK×BLOCK cell, tile it across the glyph
 * box, keep the SourceGraphic only at those sample points, then dilate each
 * sample back into a full cell — so the letter reads as low-res blocks in its
 * own colour. Toggled onto random letters by HeroTitleText for a texture pass.
 * primitiveUnits stay userSpaceOnUse, so BLOCK is measured in CSS px.
 */
function HeroPixelateFilter({ id, block = HERO_GLITCH_FX.pixelate.block }) {
  const half = block / 2;
  return (
    <HeroFilterDefs>
      <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        {/* one dot centred in each BLOCK×BLOCK cell … */}
        <feFlood x={half} y={half} width="1" height="1" result="dot" />
        <feComposite in="dot" in2="dot" operator="over" x="0" y="0" width={block} height={block} result="cell" />
        {/* … tiled across the whole glyph box … */}
        <feTile in="cell" result="grid" />
        {/* … keep the glyph only where a dot sits … */}
        <feComposite in="SourceGraphic" in2="grid" operator="in" result="samp" />
        {/* … then grow each sample into a solid cell → mosaic. */}
        <feMorphology in="samp" operator="dilate" radius={half} />
      </filter>
    </HeroFilterDefs>
  );
}

/**
 * CRT scanline <filter> — same tile trick as HeroPixelateFilter, but the cell is
 * a `bar`-tall lit row inside a `cell`-tall row instead of a single dot, so the
 * glyph survives only on the lit rows and reads as a rasterized scan.
 */
function HeroScanlineFilter({
  id,
  cell = HERO_GLITCH_FX.scanline.cell,
  bar = HERO_GLITCH_FX.scanline.bar,
}) {
  return (
    <HeroFilterDefs>
      <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        {/* one lit bar … */}
        <feFlood x="0" y="0" width="1" height={bar} result="bar" />
        {/* … pinned to the top of a 1×cell tile … */}
        <feComposite in="bar" in2="bar" operator="over" x="0" y="0" width="1" height={cell} result="row" />
        {/* … tiled down the glyph box … */}
        <feTile in="row" result="lines" />
        {/* … and the glyph kept only where a line sits. */}
        <feComposite in="SourceGraphic" in2="lines" operator="in" />
      </filter>
    </HeroFilterDefs>
  );
}

/**
 * Halftone dot-screen <filter>. Identical sampling to HeroPixelateFilter — one
 * dot per cell, tiled, glyph kept only at the dots — but each sample is grown to
 * `dot` rather than the full cell, so the dots stay islands with paper showing
 * between them instead of fusing into a solid mosaic.
 */
function HeroHalftoneFilter({
  id,
  cell = HERO_GLITCH_FX.halftone.cell,
  dot = HERO_GLITCH_FX.halftone.dot,
}) {
  const half = cell / 2;
  return (
    <HeroFilterDefs>
      <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feFlood x={half} y={half} width="1" height="1" result="dot" />
        <feComposite in="dot" in2="dot" operator="over" x="0" y="0" width={cell} height={cell} result="cell" />
        <feTile in="cell" result="grid" />
        <feComposite in="SourceGraphic" in2="grid" operator="in" result="samp" />
        {/* dilate grows the 1px sample by `radius` on EVERY side, so the finished
            dot is 1 + 2r across — solve for r to land on `dot` exactly. */}
        <feMorphology in="samp" operator="dilate" radius={(dot - 1) / 2} />
      </filter>
    </HeroFilterDefs>
  );
}

/**
 * Grain-dissolve <filter> — the glyph erodes into flecks of its own ink. Turbulence
 * is flattened to alpha and then THRESHOLDED (the discrete transfer snaps it to
 * fully on or fully off), so compositing the glyph "in" that mask punches hard
 * speckle holes rather than laying a soft veil over it. A veil would read as the
 * letter dimming; this reads as paper showing through.
 */
function HeroDissolveFilter({
  id,
  freq = HERO_GLITCH_FX.dissolve.freq,
  octaves = HERO_GLITCH_FX.dissolve.octaves,
}) {
  return (
    <HeroFilterDefs>
      <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={freq}
          numOctaves={octaves}
          seed="9"
          result="noise"
        />
        <feColorMatrix in="noise" type="luminanceToAlpha" result="lum" />
        <feComponentTransfer in="lum" result="specks">
          <feFuncA type="discrete" tableValues="0 0 1 1" />
        </feComponentTransfer>
        <feComposite in="SourceGraphic" in2="specks" operator="in" />
      </filter>
    </HeroFilterDefs>
  );
}

/**
 * Style for a glyph currently wearing a texture — a straight <defs> id lookup, since
 * every effect is now a filter (no transforms, no character swaps). Returns null for
 * an untextured glyph. Never touches fill or opacity: a textured letter has to sit
 * at exactly the same weight as its neighbours.
 */
function heroTextureStyle(fxId, ids) {
  if (!fxId || !ids[fxId]) return null;
  return { filter: `url(#${ids[fxId]})` };
}

/** "What We Tell AI" — Figma 280:71 via native TRJN DaVinci (not SVG paths). */
function HeroTitleText({ hold = false, onRevealComplete, reduceMotion = false }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const show = inView && !hold;
  const words = HERO_TITLE_LINES.flatMap((line) => line.split(' '));
  const staggerS = reduceMotion ? 0 : HERO_TITLE.staggerMs / 1000;
  const durS = reduceMotion ? 0 : HERO_TITLE.fadeMs / 1000;
  const revealDoneRef = useRef(false);
  const onRevealCompleteRef = useRef(onRevealComplete);
  onRevealCompleteRef.current = onRevealComplete;

  useEffect(() => {
    revealDoneRef.current = false;
  }, [hold]);

  useEffect(() => {
    if (!show || revealDoneRef.current) return undefined;
    const total = reduceMotion ? 0 : (words.length - 1) * HERO_TITLE.staggerMs + HERO_TITLE.fadeMs;
    const id = setTimeout(() => {
      revealDoneRef.current = true;
      onRevealCompleteRef.current?.();
    }, total);
    return () => clearTimeout(id);
  }, [show, reduceMotion, words.length]);

  // Per-letter texture pass. `textures` maps a glyph index → the effect id that glyph
  // is currently wearing. A self-rescheduling timer picks 1–2 random glyphs and a
  // weighted effect for each, then clears each on its own hold — so with the gaps
  // this short, passes overlap and expire out of phase rather than pulsing in unison.
  // Torn down and reset whenever the title is hidden or reduced-motion is on.
  const uid = useId().replace(/:/g, '');
  const fxIds = {
    pixelate: `hero-fx-pixelate-${uid}`,
    scanline: `hero-fx-scanline-${uid}`,
    halftone: `hero-fx-halftone-${uid}`,
    dissolve: `hero-fx-dissolve-${uid}`,
  };
  const [textures, setTextures] = useState(() => new Map());
  // Which glyphs are mid-pass, mirrored outside React state: the scheduler runs from
  // inside an effect that intentionally doesn't re-subscribe on every pass, so reading
  // `textures` awould see a stale map.
  const busyRef = useRef(new Set());
  useEffect(() => {
    if (reduceMotion || !HERO_GLITCH.enabled || !show || HERO_TITLE_LETTER_COUNT === 0) {
      return undefined;
    }
    let alive = true;
    const timers = new Set();
    const rand = (a, b) => a + Math.random() * (b - a);
    const drop = (t) => {
      clearTimeout(t);
      timers.delete(t);
    };
    const pickEffect = () => {
      let r = Math.random() * HERO_GLITCH_WEIGHT_TOTAL;
      for (const e of HERO_GLITCH_EFFECTS) {
        r -= e.w;
        if (r <= 0) return e;
      }
      return HERO_GLITCH_EFFECTS[0];
    };
    const fire = () => {
      if (!alive) return;
      const n = Math.random() < HERO_GLITCH.doubleChance ? 2 : 1;
      // Draw only from glyphs that are free. Re-picking a glyph already mid-pass would
      // cut its hold short and restart it, which at these gap lengths would happen
      // often enough to reintroduce the flicker.
      const free = [];
      for (let i = 0; i < HERO_TITLE_LETTER_COUNT; i += 1) {
        if (!busyRef.current.has(i)) free.push(i);
      }
      const picks = [];
      for (let k = 0; k < n && free.length; k += 1) {
        const [i] = free.splice(Math.floor(Math.random() * free.length), 1);
        const effect = pickEffect();
        busyRef.current.add(i);
        picks.push({ i, id: effect.id, holdMs: rand(effect.hold[0], effect.hold[1]) });
      }
      if (picks.length) {
        setTextures((prev) => {
          const m = new Map(prev);
          picks.forEach(({ i, id }) => m.set(i, id));
          return m;
        });
        picks.forEach(({ i, holdMs }) => {
          const off = setTimeout(() => {
            busyRef.current.delete(i);
            setTextures((prev) => {
              const m = new Map(prev);
              m.delete(i);
              return m;
            });
            drop(off);
          }, holdMs);
          timers.add(off);
        });
      }
      const next = setTimeout(() => {
        drop(next);
        fire();
      }, rand(HERO_GLITCH.minGapMs, HERO_GLITCH.maxGapMs));
      timers.add(next);
    };
    const start = setTimeout(() => {
      drop(start);
      fire();
    }, HERO_GLITCH.startDelayMs);
    timers.add(start);
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      timers.clear();
      busyRef.current.clear();
      setTextures(new Map());
    };
  }, [reduceMotion, show]);

  let wordIdx = 0;
  let letterIdx = 0;
  const glyphStyle = {
    color: 'transparent',
    WebkitTextFillColor: HERO_TITLE.fill,
    WebkitTextStroke: `${HERO_TITLE.strokeWidth} ${HERO_TITLE.stroke}`,
    paintOrder: 'stroke fill',
  };

  const noiseId = `hero-title-noise-${useId().replace(/:/g, '')}`;

  return (
    <figure
      ref={ref}
      style={{
        margin: 0,
        display: 'flex',
        justifyContent: 'center',
        width: 'fit-content',
        maxWidth: HERO_TITLE.maxWidth,
      }}
    >
      <HeroNoiseFilter id={noiseId} reduceMotion={reduceMotion} />
      <HeroPixelateFilter id={fxIds.pixelate} />
      <HeroScanlineFilter id={fxIds.scanline} />
      <HeroHalftoneFilter id={fxIds.halftone} />
      <HeroDissolveFilter id={fxIds.dissolve} />
      <h1
        aria-label="What We Tell AI"
        style={{
          margin: 0,
          fontFamily: HERO_TITLE.fontFamily,
          fontStyle: 'italic',
          fontWeight: 500,
          fontSize: HERO_TITLE.fontSize,
          lineHeight: HERO_TITLE.lineHeight,
          letterSpacing: HERO_TITLE.letterSpacing,
          textAlign: HERO_TITLE.textAlign,
          width: 'fit-content',
          maxWidth: HERO_TITLE.maxWidth,
          filter: `url(#${noiseId})`,
          ...glyphStyle,
        }}
      >
        {HERO_TITLE_LINES.map((line) => {
          const lineWords = line.split(' ');
          return (
            <span
              key={line}
              style={{ display: 'block', textAlign: 'center', whiteSpace: 'nowrap' }}
            >
              {lineWords.map((w, wi) => {
                const i = wordIdx;
                wordIdx += 1;
                return (
                  <span key={`${line}-${w}-${wi}`}>
                    <motion.span
                      aria-hidden="true"
                      initial={reduceMotion ? false : { opacity: 0 }}
                      animate={show ? { opacity: 1 } : undefined}
                      transition={{
                        duration: durS,
                        ease: HERO_TITLE.fadeEase,
                        delay: show ? i * staggerS : 0,
                      }}
                      style={{ display: 'inline-block', ...glyphStyle }}
                    >
                      {/* Per-letter spans so a texture pass can hit individual
                          glyphs. An active letter picks up a filter but never a
                          colour: fill/stroke keep inheriting HERO_TITLE.fill from the
                          word above, so a textured glyph is exactly as faint as its
                          neighbours — only its surface changes. */}
                      {w.split('').map((ch, ci) => {
                        const gi = letterIdx;
                        letterIdx += 1;
                        return (
                          <span
                            key={ci}
                            style={{
                              display: 'inline-block',
                              ...heroTextureStyle(textures.get(gi), fxIds),
                            }}
                          >
                            {ch}
                          </span>
                        );
                      })}
                    </motion.span>
                    {wi < lineWords.length - 1 ? ' ' : null}
                  </span>
                );
              })}
            </span>
          );
        })}
      </h1>
    </figure>
  );
}

/** Loads the TRJN DaVinci hero face once and parses it for outline extraction. */
function useHeroFont() {
  const [font, setFont] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(encodeURI('/TRJNDaVinci-Medium-Italic-Trial.otf'));
        if (!res.ok) return;
        const parsed = opentype.parse(await res.arrayBuffer());
        if (!cancelled) setFont(parsed);
      } catch {
        /* leave null — caller renders nothing until the face is ready */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return font;
}

/** Collapsed → full rect geometry for a per-letter fill wipe, by direction. The
 *  clip rect starts pinned to one edge of the glyph box and grows to cover it,
 *  sweeping the fill in (trim-path applied to the fill). */
function heroWipeRect(dir, rx, ry, rw, rh, reduceMotion) {
  const full = { x: rx, y: ry, width: rw, height: rh };
  const zero =
    {
      lr: { x: rx, y: ry, width: 0, height: rh },
      rl: { x: rx + rw, y: ry, width: 0, height: rh },
      ttb: { x: rx, y: ry, width: rw, height: 0 },
      btt: { x: rx, y: ry + rh, width: rw, height: 0 },
    }[dir] || { x: rx, y: ry, width: 0, height: rh };
  return { initial: reduceMotion ? full : zero, animate: full };
}

/** "What We Tell AI" revealed letter-by-letter (see HERO_DRAW): either a per-
 *  letter fill wipe ('fill') or an outline trim path ('outline'). Same size /
 *  position / grain as HeroTitleText, so it drops into the hero beat
 *  interchangeably. Settles to the identical faint-cream resting look. */
function HeroTitleDraw({ hold = false, onRevealComplete, reduceMotion = false }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const show = inView && !hold;
  const font = useHeroFont();
  const size = HERO_DRAW.renderFontSize;

  // Per-letter glyph outlines for the two centered lines + the union bbox that
  // becomes the <svg> viewBox. Kept in reading order so the draw-on can walk
  // them one letter at a time (spaces advance the pen but emit no path).
  const geo = useMemo(() => {
    if (!font) return null;
    const ls = HERO_DRAW.letterSpacing * size;
    const lineH = size * HERO_DRAW.lineGap;
    const lineWidth = (line) => {
      let w = 0;
      for (const ch of line) w += font.getAdvanceWidth(ch, size) + ls;
      return w - ls; // no trailing letter-spacing
    };
    const widths = HERO_TITLE_LINES.map(lineWidth);
    const maxW = Math.max(0, ...widths);
    const glyphs = [];
    const bb = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    HERO_TITLE_LINES.forEach((line, li) => {
      let x = (maxW - widths[li]) / 2; // center each line against the widest
      const y = li * lineH;
      for (const ch of line) {
        const adv = font.getAdvanceWidth(ch, size);
        if (ch !== ' ') {
          const p = font.getPath(ch, x, y, size);
          const d = p.toPathData(2);
          if (d) {
            const gb = p.getBoundingBox();
            // Per-letter bbox drives the fill-mode clip wipe; union bbox → viewBox.
            glyphs.push({ d, x1: gb.x1, y1: gb.y1, x2: gb.x2, y2: gb.y2 });
            if (gb.x1 < bb.x1) bb.x1 = gb.x1;
            if (gb.y1 < bb.y1) bb.y1 = gb.y1;
            if (gb.x2 > bb.x2) bb.x2 = gb.x2;
            if (gb.y2 > bb.y2) bb.y2 = gb.y2;
          }
        }
        x += adv + ls;
      }
    });
    if (!glyphs.length || !Number.isFinite(bb.x1)) return null;
    return { glyphs, bbox: bb };
  }, [font, size]);

  const n = geo?.glyphs.length || 0;
  const draw = !reduceMotion;
  const staggerS = draw ? HERO_DRAW.staggerMs / 1000 : 0;
  const drawS = draw ? HERO_DRAW.drawMs / 1000 : 0;
  const fillS = draw ? HERO_DRAW.fillMs / 1000 : 0;

  // Fire onRevealComplete once the last letter has drawn + filled, so the opening
  // question sequences in after — same contract as HeroTitleText.
  const notifiedRef = useRef(false);
  const onDoneRef = useRef(onRevealComplete);
  onDoneRef.current = onRevealComplete;
  useEffect(() => {
    notifiedRef.current = false;
  }, [hold]);
  useEffect(() => {
    if (!show || !geo || notifiedRef.current) return undefined;
    const total = draw ? (n - 1) * HERO_DRAW.staggerMs + HERO_DRAW.drawMs + HERO_DRAW.fillMs : 0;
    const id = setTimeout(() => {
      notifiedRef.current = true;
      onDoneRef.current?.();
    }, total);
    return () => clearTimeout(id);
  }, [show, geo, draw, n]);

  const rawId = useId().replace(/:/g, '');
  const noiseId = `hero-draw-noise-${rawId}`;
  const clipBase = `hero-fill-${rawId}`;

  if (!geo) {
    // Reserve the hero's footprint so the layout doesn't jump before the font loads.
    return (
      <figure
        ref={ref}
        aria-label="What We Tell AI"
        style={{ margin: 0, width: 'min(96vw, 900px)', height: HERO_TITLE.maxHeight }}
      />
    );
  }

  const { bbox } = geo;
  const pad = size * 0.07; // italic overhang + hairline stroke breathing room
  const vbW = bbox.x2 - bbox.x1 + pad * 2;
  const vbH = bbox.y2 - bbox.y1 + pad * 2;
  const viewBox = `${bbox.x1 - pad} ${bbox.y1 - pad} ${vbW} ${vbH}`;
  // Scale the SVG so each glyph renders at the same on-screen size as the webfont
  // hero: cssWidth = fontSize × (viewBoxWidth / renderFontSize).
  const cssWidth = `calc((${HERO_TITLE.fontSize}) * ${(vbW / size).toFixed(4)})`;

  return (
    <figure
      ref={ref}
      style={{
        margin: 0,
        display: 'flex',
        justifyContent: 'center',
        width: 'fit-content',
        maxWidth: HERO_TITLE.maxWidth,
      }}
    >
      <HeroNoiseFilter id={noiseId} reduceMotion={reduceMotion} strength={0.45} />
      <svg
        role="img"
        aria-label="What We Tell AI"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{
          display: 'block',
          width: cssWidth,
          height: 'auto',
          maxWidth: HERO_TITLE.maxWidth,
          maxHeight: HERO_TITLE.maxHeight,
          aspectRatio: `${vbW} / ${vbH}`,
          overflow: 'visible',
          filter: `url(#${noiseId})`,
        }}
      >
        {geo.glyphs.map((g, i) => {
          const base = show ? i * staggerS : 0;

          // FILL MODE — sweep the solid glyph in behind a per-letter clip that
          // wipes across it, then settle the ink from bright → faint.
          if (HERO_DRAW.mode === 'fill') {
            const gp = size * 0.03; // clear the glyph edges fully at the sweep's end
            const rx = g.x1 - gp;
            const ry = g.y1 - gp;
            const rw = g.x2 - g.x1 + gp * 2;
            const rh = g.y2 - g.y1 + gp * 2;
            const clipId = `${clipBase}-${i}`;
            const rect = heroWipeRect(HERO_DRAW.wipe, rx, ry, rw, rh, reduceMotion);
            return (
              <g key={`${i}-${g.d.length}`}>
                <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                  <motion.rect
                    initial={rect.initial}
                    animate={show ? rect.animate : undefined}
                    transition={{ duration: drawS, ease: HERO_DRAW.drawEase, delay: base }}
                  />
                </clipPath>
                <motion.path
                  d={g.d}
                  clipPath={`url(#${clipId})`}
                  fill={HERO_DRAW.fillColor}
                  initial={{
                    fillOpacity: reduceMotion ? HERO_DRAW.fillRest : HERO_DRAW.fillBright,
                  }}
                  animate={show ? { fillOpacity: HERO_DRAW.fillRest } : undefined}
                  transition={{ fillOpacity: { duration: fillS, ease, delay: base + drawS } }}
                />
              </g>
            );
          }

          // OUTLINE MODE — trace each glyph's outline (pathLength), fill in, fade
          // the drawing stroke out.
          const finalState = { pathLength: 1, fillOpacity: 1, strokeOpacity: 0 };
          return (
            <motion.path
              key={`${i}-${g.d.length}`}
              d={g.d}
              fill={HERO_TITLE.fill}
              stroke={HERO_DRAW.strokeColor}
              strokeWidth={HERO_DRAW.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={
                reduceMotion
                  ? finalState
                  : { pathLength: 0, fillOpacity: 0, strokeOpacity: 1 }
              }
              animate={show ? finalState : undefined}
              transition={{
                pathLength: { duration: drawS, ease: HERO_DRAW.drawEase, delay: base },
                fillOpacity: { duration: fillS, ease, delay: base + drawS * 0.6 },
                strokeOpacity: { duration: fillS, ease, delay: base + drawS },
              }}
            />
          );
        })}
      </svg>
    </figure>
  );
}

const INTRO_LINE =
  'We asked strangers to write a confession about their relationship with AI — artificial intelligence.';
// Left hanging on purpose — BodyKicker finishes the sentence with the three
// verbs, each set at its own angle. Line breaks are authored, not wrapped, so
// the rag matches the Figma comp at every viewport width.
const BODY_LINE = [
  'AI is entering into the most',
  'personal aspects of our lives,',
  'changing how we',
].join('\n');
const FRAGMENT_LINE = ['And even', 'substituting our', 'human relationships…'].join(
  '\n'
);
const FINAL_QUESTION = [
  'Every note is a real story',
  'from a real person',
  'about living with',
  'this new technology',
].join('\n');

// The three notes the intro walks through. Hand-picked, so the ids are authored
// here — but each `transcript` must be the sheet's Transcription for that Global
// ID verbatim, since it's presented as what the person actually wrote.
const NOTES = [
  {
    id: 'AC_171',
    serial: 'AC-171',
    transcript: 'ChatGPT writes 99.9% of all my emails & actually many of my texts now too =)',
  },
  {
    id: 'AC_148',
    serial: 'AC-148',
    transcript: 'I asked it to read my writing & praise it... smh',
  },
  {
    id: 'AC_185',
    serial: 'AC-185',
    transcript: 'Forgive my sin: I talk to AI way more than to ALL people in my life, combined :(',
  },
];
const noteSrc = (id) => `/confession_notes_2/${id}.webp`;

/* ─── Reveal primitives ───────────────────────────────────────────────── */

/**
 * Reveal `text` when it scrolls into view. Default is a per-word cascade (each
 * word fades in on a stagger — opacity only, no rise or blur). Pass `typewriter`
 * to reveal it one character at a time at a steady cadence instead (no caret).
 * The whole string is exposed once to assistive tech via aria-label; the
 * animated fragments are aria-hidden.
 *
 * Embed `\n` in `text` for authored line breaks — each line is its own block, so
 * the rag is the one that was written rather than whatever the measure happens
 * to wrap to. Pass `justify` to spread each line edge-to-edge. The cascade runs
 * continuously across the breaks, so the stagger doesn't restart per line.
 */
function RevealWords({
  text,
  as = 'p',
  cfg = WORD,
  delayStart = 0,
  typewriter = false,
  hold = false,
  justify = false,
  start,
  style,
}) {
  const ref = useRef(null);
  const scrolledInto = useInView(ref, IN_VIEW);
  // `start` replaces the scroll trigger where there is no scroll — see the
  // beat telling of this page, which holds everything in one fixed screen.
  const inView = start === undefined ? scrolledInto : start;
  const reduce = useReducedMotion();
  // `hold` keeps the words at their initial (hidden) state even when in view —
  // used to defer the hero question until the opening loader lifts.
  const show = inView && !hold;

  // Each line carries the running word count before it, which is what the
  // stagger counts off.
  const lines = useMemo(() => {
    let n = 0;
    return text.split('\n').map((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      const start = n;
      n += words.length;
      return { words, start };
    });
  }, [text]);
  const ariaText = useMemo(() => text.replace(/\n/g, ' '), [text]);

  // Typewriter: reveal each glyph in reading order at a steady cadence. Chars
  // are laid out (invisible) from the first frame, so the line breaks are fixed
  // and nothing reflows while it types; only opacity animates. Spaces are their
  // own glyphs, keeping words unbreakable and wraps only at whitespace.
  if (typewriter) {
    return createElement(
      as,
      { ref, 'aria-label': text, style: { margin: 0, ...style } },
      [...text].map((ch, i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          initial={reduce ? false : { opacity: 0 }}
          animate={show ? { opacity: 1 } : undefined}
          transition={{
            duration: reduce ? 0 : TYPEWRITER.durS,
            ease,
            delay: reduce ? 0 : delayStart + i * TYPEWRITER.perCharS,
          }}
        >
          {ch}
        </motion.span>
      ))
    );
  }

  return createElement(
    as,
    {
      ref,
      'aria-label': ariaText,
      // Full width then capped by the caller's maxWidth, so a justified line
      // has a measure to spread across rather than shrinking to its content.
      style: { margin: '0 auto', width: '100%', ...style },
    },
    lines.map((line, li) => (
      <span
        key={li}
        style={
          justify
            ? { display: 'flex', justifyContent: 'space-between', width: '100%' }
            : { display: 'block' }
        }
      >
        {line.words.map((w, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            initial={reduce ? false : { opacity: 0 }}
            animate={show ? { opacity: 1 } : undefined}
            transition={{
              duration: reduce ? 0 : cfg.durS,
              ease,
              delay: reduce ? 0 : delayStart + (line.start + i) * cfg.staggerS,
            }}
            style={{ display: 'inline-block', ...(justify ? null : { marginRight: '0.28em' }) }}
          >
            {w}
          </motion.span>
        ))}
      </span>
    ))
  );
}

/**
 * The EXPLORE page's inactive→active card treatment, replayed on a note as it
 * slides in. Values are lifted from the stack's own source so the two stay
 * recognizably the same move: the degraded start comes from
 * `useInactiveCardParams` (blur / grayscale / opacity), the curves from
 * `st.cardImg`'s transition, and the grain hold from `GRAIN_HOLD_MS` — all in
 * src/SideDial.jsx.
 *
 * Three differences. On EXPLORE the note is already on screen when you select
 * it, so it sharpens the instant you do; here it is still travelling, so the
 * resolve is held until `activateAtS` and lands as the note settles. EXPLORE
 * snaps the blur/grayscale off, because CSS can't interpolate a filter chain
 * that contains a `url()` — this splits the two across nested elements (grain on
 * the wrapper, blur/grayscale on the image) in the same order, so the resolve
 * can actually animate. And the stack's scale-up is dropped entirely: the note
 * is already moving across the page, so growing it as well read as two moves at
 * once. It develops at its final size.
 */
const CARD_ACTIVATE = {
  // Fallbacks only — the live values come from the shared "Inactive Cards"
  // DialKit panel, so dialing the stack's degraded look dials this too.
  // No `fromScale`: the note travels and develops, but never resizes — see below.
  fromOpacity: 0.75,
  fromBlur: 4, //         px
  fromGrayscale: 1,
  resolveS: 0.4, //       st.cardImg transform duration
  resolveEase: [0.33, 1, 0.68, 1],
  opacityS: 0.3, //       st.cardImg opacity duration
  opacityEase: [0.4, 0, 0.2, 1],
  opacityDelayS: 0.12, // opacity trails the transform
  grainHoldS: 0.35, //    GRAIN_HOLD_MS — noise lingers after the note is sharp
  activateAtS: 0.34, //   beat into the slide where it becomes "active"
};

/**
 * A confession still (or the hero cube) that reveals on scroll-into-view.
 *
 * Default is a develop-in-place fade — blur / grayscale / brightness resolving
 * over time, like a print coming up. With `slideFrom`, the note instead travels
 * in from that side and runs the EXPLORE page's inactive→active card treatment
 * as it arrives (see CARD_ACTIVATE).
 */
function RevealImage({ src, alt = '', width, maxHeight, aspectRatio, cfg = IMAGE, glow = false, serial, transcript, hold = false, slideFrom }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const reduce = useReducedMotion();
  const [decoded, setDecoded] = useState(false);
  // `hold` keeps the reveal paused (e.g. until the opening loader lifts) so the
  // image fades in once it's actually on screen, not hidden behind the loader.
  const show = inView && (decoded || reduce) && !hold;

  // `slideFrom` swaps the develop-in-place fade for a directional slide: the
  // note flies in from off its side of the screen while straightening out of a
  // slight tilt (rotate), settling on the shared ease-out. The root clips
  // overflow-x, so the off-screen start never spawns a horizontal scrollbar.
  const sliding = slideFrom === 'left' || slideFrom === 'right';
  const dir = slideFrom === 'left' ? -1 : 1;

  // How far out the note waits: one viewport width to its side, which clears the
  // edge for any note at any window size, since one centred in the page never
  // needs more than that. Read once, because this feeds `initial` — a mount-time
  // value with nothing to update later. The root clips overflow-x, so parking a
  // note out there never spawns a horizontal scrollbar.
  const [travel] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));

  // Shared "Inactive Cards" DialKit panel — tuning the stack tunes this too.
  const inactive = useInactiveCardParams();
  const activating = sliding && !reduce;
  const grainEnabled = activating && (inactive.noise?.enabled ?? true);
  const [grainHeld, setGrainHeld] = useState(true);

  // Same shape as the stack's grain hold: the note is sharp first, then the
  // noise wears off a beat later.
  useEffect(() => {
    if (!grainEnabled || !show) return undefined;
    setGrainHeld(true);
    const t = setTimeout(
      () => setGrainHeld(false),
      (CARD_ACTIVATE.activateAtS + CARD_ACTIVATE.resolveS + CARD_ACTIVATE.grainHoldS) * 1000
    );
    return () => clearTimeout(t);
  }, [grainEnabled, show]);

  const showGrain = grainEnabled && grainHeld;

  const from = sliding
    ? {
        opacity: inactive.opacity ?? CARD_ACTIVATE.fromOpacity,
        filter: `blur(${inactive.blur ?? CARD_ACTIVATE.fromBlur}px) grayscale(${
          inactive.grayscale ?? CARD_ACTIVATE.fromGrayscale
        })`,
      }
    : {
        opacity: 0,
        y: cfg.riseY ?? IMAGE.riseY,
        scale: cfg.fromScale ?? IMAGE.fromScale,
        filter: `blur(${cfg.fromBlur ?? IMAGE.fromBlur}px) grayscale(${cfg.fromGrayscale ?? IMAGE.fromGrayscale}) brightness(${cfg.fromBrightness ?? IMAGE.fromBrightness})`,
      };
  const to = sliding
    ? { opacity: 1, filter: 'blur(0px) grayscale(0)' }
    : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px) grayscale(0) brightness(1)' };

  const imgTransition = sliding
    ? {
        filter: { duration: CARD_ACTIVATE.resolveS, ease: CARD_ACTIVATE.resolveEase, delay: CARD_ACTIVATE.activateAtS },
        opacity: {
          duration: CARD_ACTIVATE.opacityS,
          ease: CARD_ACTIVATE.opacityEase,
          delay: CARD_ACTIVATE.activateAtS + CARD_ACTIVATE.opacityDelayS,
        },
      }
    : { duration: reduce ? 0 : (cfg.fadeS ?? IMAGE.fadeS), ease, delay: reduce ? 0 : cfg.delayS ?? 0 };

  const img = (
    <motion.img
      src={src}
      alt={alt}
      draggable={false}
      loading="eager"
      onLoad={() => setDecoded(true)}
      onError={() => setDecoded(true)}
      initial={reduce ? false : from}
      animate={show ? to : undefined}
      transition={imgTransition}
      style={{
        display: 'block',
        // `maxHeight` → height-driven: contain the image within a viewport-tall
        // box, letting width follow the aspect ratio. Uses a viewport-relative
        // max width (not 100%) so the hero can break out of the narrow text
        // column to reach its height cap, while never overflowing the screen.
        // Otherwise fall back to width-driven sizing.
        ...(maxHeight
          ? { width: 'auto', height: 'auto', maxWidth: '96vw', maxHeight }
          : { width: width || 'min(100%, 560px)', height: 'auto' }),
        aspectRatio,
        objectFit: 'contain',
        borderRadius: 2,
        // Sliding notes animate their own filter (blur/grayscale), so leave it
        // to motion rather than pinning it here.
        ...(sliding ? null : { filter: glow ? 'drop-shadow(0 0 40px rgba(120,150,255,0.14))' : 'none' }),
      }}
    />
  );

  return (
    <figure
      ref={ref}
      style={{
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        width: '100%',
      }}
    >
      {sliding ? (
        <>
          {/* Mounted only while the grain is up, so the filter's animated seed
              isn't driving a rAF loop for the whole page. */}
          {showGrain && <CardNoiseFilterDefs params={inactive} />}
          <motion.div
            initial={reduce ? false : { opacity: 0, x: dir * travel, rotate: dir * SLIDE.rotate }}
            animate={show ? { opacity: 1, x: 0, rotate: 0 } : undefined}
            transition={
              reduce
                ? { duration: 0 }
                : { duration: SLIDE.durS, ease, opacity: { duration: SLIDE.fadeS, ease } }
            }
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              filter: showGrain ? `url(#${CARD_FILTER_ID})` : 'none',
            }}
          >
            {img}
          </motion.div>
        </>
      ) : (
        img
      )}
      {(transcript || serial) && (
        <motion.figcaption
          initial={reduce ? false : { opacity: 0 }}
          animate={show ? { opacity: 1 } : undefined}
          transition={{ duration: reduce ? 0 : 0.9, ease, delay: reduce ? 0 : 0.5 }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            maxWidth: 'min(92%, 460px)',
            marginTop: 8,
          }}
        >
          {transcript && <p style={TRANSCRIPT_STYLE}>{transcript}</p>}
          {serial && <span style={SERIAL_STYLE}>{serial}</span>}
        </motion.figcaption>
      )}
    </figure>
  );
}

/**
 * RevealMaskArt — renders a black-background line-art screenshot as tinted type
 * on the page. An SVG <mask> (mask-type: luminance) turns the image's brightness
 * into alpha, so black pixels become fully transparent and only the light type
 * paints: no rectangle edge, any tint, crisp at any size. A `feComponentTransfer`
 * threshold first crushes the screenshot's near-black noise to true zero so no
 * faint veil remains. Fades / de-blurs into view like the note photos.
 */
function RevealMaskArt({ src, w, h, width, color = '#e6ded0', alt = '', slope = 6, intercept = -0.55, durS = 1.6 }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const reduce = useReducedMotion();
  const uid = useId().replace(/[:]/g, '');
  const maskId = `art-mask-${uid}`;
  const crushId = `art-crush-${uid}`;
  return (
    <motion.div
      ref={ref}
      role="img"
      aria-label={alt}
      initial={reduce ? false : { opacity: 0, y: 24, filter: 'blur(10px)' }}
      animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : undefined}
      transition={{ duration: reduce ? 0 : durS, ease }}
      style={{ width, maxWidth: '100%' }}
    >
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block', height: 'auto' }} aria-hidden="true">
        <defs>
          <filter id={crushId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="linear" slope={slope} intercept={intercept} />
              <feFuncG type="linear" slope={slope} intercept={intercept} />
              <feFuncB type="linear" slope={slope} intercept={intercept} />
            </feComponentTransfer>
          </filter>
          <mask id={maskId}>
            <image
              href={src}
              x="0"
              y="0"
              width={w}
              height={h}
              preserveAspectRatio="xMidYMid meet"
              filter={`url(#${crushId})`}
            />
          </mask>
        </defs>
        <rect x="0" y="0" width={w} height={h} fill={color} mask={`url(#${maskId})`} />
      </svg>
    </motion.div>
  );
}

/** Temporary stand-in for art that isn't final yet — a dark grey box with a
 *  centered label. Fades in on scroll like the other stills so the beat still
 *  reads. Swap back to the real <RevealMaskArt/> once the asset lands. */
function PlaceholderBox({ width, aspectRatio = '1024 / 729', label = 'placeholder' }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const reduce = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      role="img"
      aria-label={label}
      initial={reduce ? false : { opacity: 0 }}
      animate={inView ? { opacity: 1 } : undefined}
      transition={{ duration: reduce ? 0 : 0.9, ease }}
      style={{
        width,
        maxWidth: '100%',
        aspectRatio,
        display: 'grid',
        placeItems: 'center',
        background: '#2a2a2a',
        border: '1px solid rgba(207,202,183,0.08)',
        borderRadius: 2,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: 'rgba(207,202,183,0.4)',
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}

/** The booth still slides over rather than flying in: it shares the notes' tilt
 *  and direction so the alternation still reads, but not their off-screen trip —
 *  it's a photo seated in the intro's column, not one of the confessions. */
const BOOTH_SLIDE = {
  x: 80, //      px it starts off to its left
  rotate: SLIDE.rotate,
  durS: 0.9, //  the notes' old timing, which suits this shorter distance
};

/** The confession-booth still that opens the intro — the Dolores Park
 *  "Confession Box" sign. Centered, sliding in from the left with a slight tilt
 *  (setting up the alternation with the first note, which arrives from the
 *  right). The asset already carries its own white border + tilt on a black
 *  field, so the corners melt into the near-black page and no extra frame is
 *  needed. */
function IntroBoothStill({ width }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const reduce = useReducedMotion();
  return (
    <div
      ref={ref}
      style={{
        width,
        maxWidth: '100%',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <motion.img
        src="/intro-booth-park.png"
        alt="A hand-painted “Confession Box — everyone has an AI secret” sign staked in Dolores Park."
        draggable={false}
        loading="eager"
        initial={reduce ? false : { opacity: 0, x: -BOOTH_SLIDE.x, rotate: -BOOTH_SLIDE.rotate }}
        animate={inView ? { opacity: 1, x: 0, rotate: 0 } : undefined}
        transition={{ duration: reduce ? 0 : BOOTH_SLIDE.durS, ease }}
        style={{ flex: '0 0 auto', width: '56%', height: 'auto', display: 'block' }}
      />
    </div>
  );
}

/** Typed transcription beneath a note (mono, muted) — mirrors the archive's
 *  TRANSCRIPTION_TEXT treatment. */
const TRANSCRIPT_STYLE = {
  margin: 0,
  fontFamily: MONO,
  fontSize: 13,
  lineHeight: 1.65,
  letterSpacing: '0.01em',
  color: 'rgba(207, 202, 183, 0.72)',
  textAlign: 'center',
};

const SERIAL_STYLE = {
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: '0.24em',
  textTransform: 'uppercase',
  color: 'rgba(207, 202, 183, 0.4)',
};

/** A vertically-generous section so each block reveals as its own beat. */
function Beat({ children, minVh = 0, style, ref }) {
  return (
    <section
      ref={ref}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: minVh ? `${minVh}vh` : undefined,
        margin: '0 auto',
        padding: 'clamp(64px, 13vh, 150px) 0',
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/* ─── Opening loader ───────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────
 * OPENING LOADER STORYBOARD  (~2.3s · 22-still confession riffle)
 *
 * Read top-to-bottom. Times are ms from the moment the site opens.
 *
 *      0ms   first confession still HARD-CUTS in — no crossfade, just a
 *            tiny scale settle (startScale → 1.0) — held the longest
 *            (firstHold ≈ 155ms once time-scaled). Every still is drained to
 *            black & white, tilted ±maxTilt°, with grain masked to its own
 *            paper shape — colour arrives only with the archive itself.
 *      …     stills riffle past faster and faster; each hold eases from
 *            firstHold → lastHold, and the whole run is time-scaled to land
 *            on exactly `totalMs` no matter how many `flips` there are. So
 *            `flips` sets the CADENCE (more flips = quicker cuts), while
 *            firstHold / lastHold only shape the acceleration curve.
 *   ~1100ms  COLLAPSE — the whole stack scales down hard (1.0 → collapseTo)
 *            over the last `collapseMs` (1200ms). That window is now over half
 *            the run, so the stills keep riffling all the way down as the stack
 *            recedes, rather than collapsing as a separate final beat.
 *   ~1840ms  the last still starts dissolving (noteFadeLeadMs before the end),
 *            over noteFadeS — so it's fully gone ~2180ms, while the stack is
 *            STILL shrinking. The note recedes into nothing instead of riding
 *            the collapse down at full opacity and being cut off at the handoff.
 *   ~2300ms  the collapse finishes on empty backdrop and the card crossfades
 *            out (fadeOutS) → the hero title reveals.
 *
 * Every knob lives in the LOADER config below and is exposed live in the
 * "Opening Loader" DialKit panel (open any page with ?dial=1). Hit the
 * panel's ⟳ Replay button to watch it again without reloading.
 * ───────────────────────────────────────────────────────────────── */
const LOADER = {
  // Every still in public/confession_notes_2/ — the run samples `flips` of them
  // at random, so drawing from the whole archive keeps the intro fresh per visit.
  pool: NOTE_STILL_IDS,
  flips: 22, //        how many stills flip past before the hero
  totalMs: 2300, //    whole card, first still → hero handoff
  firstHold: 300, //   ms the first still lingers (slowest)
  lastHold: 105, //    ms the final stills whip by (fastest)
  developS: 0.5, //    per-still scale-settle duration (hard-cut, no opacity fade)
  startScale: 1.03, // scale each still cuts in at, settling → 1.0
  maxTilt: 3, //       deg of random ± rotation per still
  fadeOutS: 0.24, //   loader → hero crossfade-out
  grayscale: true, //  drains the stills to black & white
  // Final collapse — whole stack shrinks away in the last beat before handoff.
  collapseMs: 1200, // ms window for the final scale-down
  collapseTo: 0.2, //  scale the stack lands on (much smaller than the riffle)
  collapseEase: [0.55, 0, 1, 0.45], // ease-in: accelerates away
  // The last still dissolves DURING the collapse rather than riding it all the
  // way down and then cutting: the note is gone while the stack is still
  // shrinking, so it reads as receding into nothing instead of being switched
  // off at full opacity. Keep noteFadeS shorter than noteFadeLeadMs or the fade
  // runs past the collapse and the cut comes back.
  noteFadeLeadMs: 460, // ms before the handoff that the still starts dissolving
  noteFadeS: 0.34, //    how long that dissolve takes
  // Endgame collapse (per-flip stepping — optional extra punch before collapse).
  shrinkCount: 0, //   0 = rely on collapseMs alone
  shrinkTo: 0.91, //   scale the very last still lands on (1 = no collapse)
  shrinkS: 0.16, //    s per step — deliberately quicker than developS
  // ease-out-expo: all the travel up front, then a hard settle.
  shrinkEase: [0.19, 1, 0.22, 1],
};

/**
 * ~2.3s opening title card. Flips through a stack of random confession stills —
 * all pinned in the same spot — spawning faster and faster,
 * then crossfades out to reveal the hero. Every value comes from the LOADER
 * config, overridable per-instance via `config` (the DialKit panel). Reduced
 * motion skips straight to the hero.
 */
function OpeningLoader({ onDone, config }) {
  const cfg = { ...LOADER, ...config };
  const flips = Math.max(2, Math.round(cfg.flips));
  const [frame, setFrame] = useState(0);
  const [stackScale, setStackScale] = useState(1);
  // Flips once the still should start dissolving — part-way through the
  // collapse, not at the handoff (see noteFadeLeadMs).
  const [noteFaded, setNoteFaded] = useState(false);
  // Which stills have decoded. The stills are full-size webps (~170KB each), so
  // on a slow connection the run's worth of them can't possibly land inside
  // totalMs — the schedule below stays fixed regardless and simply shows the most
  // recent still that IS ready, rather than cutting to a blank <img>.
  const [ready, setReady] = useState(() => new Set());

  const shots = useMemo(() => {
    const pool = [...LOADER.pool].sort(() => Math.random() - 0.5).slice(0, flips);
    return pool.map((id) => ({
      id,
      rot: Math.round((Math.random() * 2 - 1) * cfg.maxTilt),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flips, cfg.maxTilt]);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      onDone();
      return undefined;
    }
    setFrame(0);
    setReady(new Set());
    setStackScale(1);
    setNoteFaded(false);
    shots.forEach((s, i) => {
      const im = new Image();
      // A still that errors is deliberately left un-ready, so it gets skipped
      // instead of cutting to a broken image.
      im.onload = () => setReady((prev) => new Set(prev).add(i));
      im.src = noteSrc(s.id);
      if (im.complete && im.naturalWidth > 0) setReady((prev) => new Set(prev).add(i));
    });
    // Accelerating flips (firstHold → lastHold) time-scaled to fill exactly
    // totalMs, so the whole card lasts `totalMs` regardless of the flip count.
    const n = shots.length;
    const holds = [];
    for (let k = 1; k < n; k += 1) {
      const t = (k - 1) / Math.max(1, n - 2);
      holds.push(cfg.firstHold - (cfg.firstHold - cfg.lastHold) * t);
    }
    const rawSum = holds.reduce((a, b) => a + b, 0) || 1;
    const scale = (cfg.totalMs - cfg.lastHold) / rawSum;
    const timers = [];
    let acc = 0;
    holds.forEach((h, idx) => {
      acc += h * scale;
      timers.push(setTimeout(() => setFrame(idx + 1), acc));
    });
    const collapseAt = Math.max(0, cfg.totalMs - cfg.collapseMs);
    timers.push(setTimeout(() => setStackScale(cfg.collapseTo), collapseAt));
    const fadeAt = Math.max(0, cfg.totalMs - cfg.noteFadeLeadMs);
    timers.push(setTimeout(() => setNoteFaded(true), fadeAt));
    const done = setTimeout(onDone, cfg.totalMs);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shots,
    cfg.firstHold,
    cfg.lastHold,
    cfg.totalMs,
    cfg.collapseMs,
    cfg.collapseTo,
    cfg.noteFadeLeadMs,
  ]);

  // Walk back from the scheduled beat to the most recent still that has decoded.
  // On a fast connection that's the scheduled one; on a slow one the previous
  // still just holds a beat longer instead of the card flashing empty. Before the
  // very first still lands there's nothing to show, so only the backdrop renders.
  let visibleIdx = -1;
  for (let j = Math.min(frame, shots.length - 1); j >= 0; j -= 1) {
    if (ready.has(j)) {
      visibleIdx = j;
      break;
    }
  }
  const shot = visibleIdx >= 0 ? shots[visibleIdx] : null;

  // Endgame collapse. `tail` is this still's 0-based position inside the trailing
  // group (negative before it). Each trailing still cuts in at wherever the
  // previous one landed and whips down one more step, so the scale reads as one
  // continuous collapse across the last few flips rather than a per-still bounce.
  // Count off the END of the run that actually rendered, not `flips` — the pool
  // caps the sample, so a `flips` above the pool size would otherwise push the
  // collapse past the last still and never fire it.
  const shrinkCount = Math.min(Math.round(cfg.shrinkCount), shots.length);
  const tail = shrinkCount > 0 ? frame - (shots.length - shrinkCount) : -1;
  const shrinking = tail >= 0;
  const shrinkStep = (step) => 1 - (1 - cfg.shrinkTo) * (step / shrinkCount);
  const fromScale = shrinking ? shrinkStep(tail) : cfg.startScale;
  const toScale = shrinking ? shrinkStep(tail + 1) : 1;
  const scaleTransition = shrinking
    ? { duration: cfg.shrinkS, ease: cfg.shrinkEase }
    : { duration: cfg.developS, ease };

  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: cfg.fadeOutS, ease }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        // Mirror the page's radial backdrop (same gradient as the root grain
        // layer) rather than a flat black card. It's positioned identically
        // (fixed, top-center ellipse), so when the loader crossfades out the
        // background stays put and only the stills → hero swap underneath.
        background: PAGE_GRADIENT,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'clamp(20px, 4.5vh, 36px)',
          padding: '0 24px',
        }}
      >
        {/* Fixed frame so the stack flips in place. Stills hard-cut from one to
            the next — no opacity crossfade, no blur (a tiny scale settle keeps
            each still from feeling static), until the trailing stills take over
            and collapse the stack down instead. */}
        <motion.div
          animate={{ scale: stackScale, opacity: noteFaded ? 0 : 1 }}
          // Split per property: the scale keeps running its long collapse while
          // the opacity dissolves on its own, shorter clock underneath it.
          transition={{
            scale:
              stackScale === 1
                ? { duration: 0 }
                : { duration: cfg.collapseMs / 1000, ease: cfg.collapseEase },
            opacity: { duration: noteFaded ? cfg.noteFadeS : 0, ease },
          }}
          style={{
            position: 'relative',
            width: 'clamp(190px, 40vw, 330px)',
            height: 'clamp(210px, 40vh, 300px)',
            willChange: 'transform',
          }}
        >
          <AnimatePresence>
            {shot ? (
            <motion.div
              key={frame}
              initial={{ scale: fromScale }}
              animate={{ scale: toScale }}
              transition={scaleTransition}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                willChange: 'transform',
              }}
            >
              <img
                src={noteSrc(shot.id)}
                alt=""
                draggable={false}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  transform: `rotate(${shot.rot}deg)`,
                  borderRadius: 2,
                  boxShadow: '0 14px 44px rgba(0,0,0,0.5)',
                  filter: cfg.grayscale ? 'grayscale(1)' : 'none',
                }}
              />
              {/* Noise masked to the note's own shape — the grain sits ON the
                  image, following its alpha, not the page behind it. */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  mixBlendMode: 'soft-light',
                  pointerEvents: 'none',
                  transform: `rotate(${shot.rot}deg)`,
                  WebkitMaskImage: `url("${noteSrc(shot.id)}")`,
                  maskImage: `url("${noteSrc(shot.id)}")`,
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                }}
              >
                <TunableGrainBackground opacityScale={1} />
              </div>
            </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ─── Component ────────────────────────────────────────────────────────── */

export default function OnboardingReveal({
  onEnter = () => window.location.assign('/?view=grid'),
  skipEntrance = false,
} = {}) {
  const reduce = useReducedMotion();
  // The site plays the opening loader on open (App passes no skipEntrance).
  // `skipEntrance` stays as an opt-out that drops the 2s confession-still loader
  // but KEEPS the hero title's particle fade-in. Reduced motion is at rest.
  const showLoader = !skipEntrance && !reduce;
  const rootRef = useRef(null);
  const [loading, setLoading] = useState(showLoader);
  const [titleGate, setTitleGate] = useState(reduce);
  const [heroTitleRevealed, setHeroTitleRevealed] = useState(reduce);
  const [heroQuestionRevealed, setHeroQuestionRevealed] = useState(reduce);
  // Bumping this remounts the loader from a clean slate — used by the DialKit
  // Replay action so tweaks can be re-watched without a page reload.
  const [loaderRun, setLoaderRun] = useState(0);

  // Live-tunable opening-loader knobs, mirrored from the LOADER config. Only
  // visible on ?dial=1 (DialRoot is dev-gated in main.jsx); values otherwise
  // fall through to the defaults. The ⟳ Replay action re-shows the loader.
  const loaderDials = useDialKit(
    'Opening Loader',
    {
      flips: [LOADER.flips, 4, 60, 1],
      totalMs: [LOADER.totalMs, 500, 5000, 50],
      firstHold: [LOADER.firstHold, 40, 800, 10],
      lastHold: [LOADER.lastHold, 20, 400, 5],
      developS: [LOADER.developS, 0, 1.5, 0.05],
      startScale: [LOADER.startScale, 1, 1.2, 0.01],
      maxTilt: [LOADER.maxTilt, 0, 15, 0.5],
      fadeOutS: [LOADER.fadeOutS, 0, 1, 0.02],
      collapseMs: [LOADER.collapseMs, 100, 1500, 25],
      collapseTo: [LOADER.collapseTo, 0.05, 1, 0.01],
      noteFadeLeadMs: [LOADER.noteFadeLeadMs, 0, 1500, 20],
      noteFadeS: [LOADER.noteFadeS, 0.05, 1.2, 0.02],
      shrinkCount: [LOADER.shrinkCount, 0, 8, 1],
      shrinkTo: [LOADER.shrinkTo, 0.3, 1, 0.01],
      shrinkS: [LOADER.shrinkS, 0.04, 0.6, 0.01],
      grayscale: LOADER.grayscale,
      replay: { type: 'action', label: '⟳ Replay' },
    },
    {
      onAction: (action) => {
        if (action !== 'replay') return;
        window.scrollTo(0, 0);
        setLoading(true);
        setLoaderRun((r) => r + 1);
      },
    }
  );

  // The skip control steps aside once the closing beat is up: that beat carries
  // the archive's own way in, and offering two entrances at once makes the
  // reader choose between them at the exact moment the piece is trying to land.
  // The negative bottom margin holds it until the beat is properly on screen
  // rather than the instant its top edge clears the fold.
  const enterBeatRef = useRef(null);
  const atClosingBeat = useInView(enterBeatRef, { margin: '0px 0px -45% 0px' });

  // Thin top progress hairline for the whole scroll.
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  // Reveal the rule by clipping it rather than scaling it: the ticks are painted
  // across the full width, so clipping fills a fixed row of them while scaling
  // would stretch the dash pattern itself and slide every tick as you scroll.
  // The spring can overshoot either end, hence the clamp — a negative inset
  // grows the box instead of shrinking it.
  const progressClip = useTransform(
    progress,
    (v) => `inset(0 ${(1 - Math.min(1, Math.max(0, v))) * 100}% 0 0)`
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Lock scroll while the opening loader is up.
  useEffect(() => {
    if (!loading) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [loading]);

  // Start the hero title reveal: a beat after the loader lifts (onboarding
  // route) or a shorter beat after mount (main site, no loader). Reduced motion
  // is already at rest.
  useEffect(() => {
    if (reduce) return undefined;
    if (loading) {
      setTitleGate(false);
      setHeroTitleRevealed(false);
      setHeroQuestionRevealed(false);
      return undefined;
    }
    const delay = skipEntrance ? HERO_TITLE.mountDelayMs : HERO_TITLE.postLoaderDelayMs;
    const id = setTimeout(() => setTitleGate(true), delay);
    return () => clearTimeout(id);
  }, [loading, reduce, skipEntrance]);

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        minHeight: '100vh',
        color: '#CFCAB7',
        background: PAGE_BG,
        overflowX: 'hidden',
      }}
    >
      {/* ~2.3s opening loader — flips through random confessions, then lifts to
          reveal the hero. `key={loaderRun}` lets the DialKit Replay remount it. */}
      <AnimatePresence>
        {loading && (
          <OpeningLoader
            key={loaderRun}
            onDone={() => setLoading(false)}
            config={loaderDials}
          />
        )}
      </AnimatePresence>

      {/* Full-page film grain — the shared archive/landing texture
          (`TunableGrainBackground` → DialKit "Grain"). Isolated over a copy of
          the page gradient so the overlay blend has something to bite into
          (mirrors the grid/theme backdrop) instead of washing out on flat black. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          isolation: 'isolate',
          pointerEvents: 'none',
          background: PAGE_BG,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: PAGE_GRADIENT }} />
        <TunableGrainBackground />
      </div>

      {/* Scroll progress hairline — a measured row of ticks filling left to
          right. The gradient keeps the original ramp from faint to bright, and
          the mask is what cuts it into dashes; masking (not a repeating
          background) is what lets the two stay independent. */}
      <motion.div
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          clipPath: progressClip,
          background: 'linear-gradient(90deg, rgba(207,202,183,0.15), rgba(207,202,183,0.7))',
          WebkitMaskImage: PROGRESS_DASHES,
          maskImage: PROGRESS_DASHES,
          zIndex: 60,
        }}
      />

      {/* STICKY SKIP — a real hyperlink to the archive index (grid) page, fixed
          so it rides along the scroll until the closing beat. A normal click
          runs the smooth in-app transition; the href keeps it a genuine link
          (open-in-new-tab, middle-click, keyboard).

          Faded out rather than unmounted, so it can come back if you scroll up.
          Hidden from the pointer AND from tab order while it's invisible —
          otherwise it stays a click target over the closing copy and a keyboard
          user lands on something nobody can see. */}
      <style>{CTA_HOVER_CSS}</style>

      <motion.a
        className="onboarding-cta"
        href="/?view=grid"
        onClick={(e) => {
          e.preventDefault();
          onEnter();
        }}
        aria-hidden={atClosingBeat}
        tabIndex={atClosingBeat ? -1 : 0}
        initial={false}
        animate={{ opacity: atClosingBeat ? 0 : 1 }}
        transition={{ duration: reduce ? 0 : 0.4, ease }}
        style={{
          position: 'fixed',
          top: 'clamp(16px, 3.4vh, 30px)',
          right: 'clamp(16px, 3.4vw, 34px)',
          zIndex: 70,
          display: 'inline-flex',
          alignItems: 'center',
          // Space the two word items apart (inline-flex collapses the plain
          // whitespace between them, so add an explicit gap).
          gap: '0.5em',
          padding: '11px 20px',
          background: 'transparent',
          borderRadius: 999,
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: 12.5,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          lineHeight: 1,
          // Kill the UA default link underline so it doesn't paint a continuous
          // rule across the gaps — the per-word spans carry the underline.
          textDecoration: 'none',
          pointerEvents: atClosingBeat ? 'none' : 'auto',
        }}
      >
        <span style={ONBOARDING_LINK_UNDERLINE}>Skip Intro</span>
      </motion.a>

      {/* Content column — a narrow editorial measure, centered on the page. */}
      <main
        style={{
          position: 'relative',
          zIndex: 2,
          maxWidth: 660,
          margin: '0 auto',
          padding: '0 clamp(22px, 6vw, 40px)',
          textAlign: 'center',
        }}
      >
        {/* HERO — over the confession field (see AsciiWall), which holds through
            the first screen and fades out before the booth. */}
        <Beat
          minVh={100}
          style={{
            position: 'relative',
            paddingTop: 'clamp(24px, 6vh, 80px)',
            gap: 'clamp(26px, 5vh, 52px)',
          }}
        >
          {/* Same gate the title takes, so the field starts writing a beat after
              the title starts revealing rather than on its own clock. */}
          <AsciiWall start={!loading && titleGate} />
          {createElement(
            {
              hand: WordmarkDraw,
              gl: WordmarkGL,
              draw: HeroTitleDraw,
            }[HERO_MODE] || HeroTitleText,
            {
              hold: loading || !titleGate,
              reduceMotion: reduce,
              onRevealComplete: () => setHeroTitleRevealed(true),
            }
          )}
          <HeroOpeningQuestion
            hold={loading || !heroTitleRevealed}
            instant={reduce}
            onRevealComplete={() => setHeroQuestionRevealed(true)}
            style={{
              maxWidth: 400,
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 'clamp(14px, 2vw, 18px)',
              lineHeight: 1.45,
              letterSpacing: '0.01em',
              textTransform: 'uppercase',
              color: 'rgba(207,202,183,0.82)',
            }}
          />
          <ScrollCue show={!loading && heroQuestionRevealed} />
        </Beat>

        {/* BOOTH + INTRO */}
        <Beat style={{ gap: 'clamp(30px, 6vh, 60px)' }}>
          {/* The Dolores Park booth still slides in, then the intro line
              cascades in word by word beneath it. */}
          <IntroBoothStill width="min(100%, 900px)" />
          <RevealWords
            text={INTRO_LINE}
            as="h2"
            cfg={WORD_DISPLAY}
            // Same display treatment as the section[3] fragments, just a touch
            // smaller since the intro is a longer full sentence.
            style={{ ...FRAGMENT_STYLE, fontSize: 'clamp(26px, 5vw, 46px)' }}
          />
        </Beat>

        {/* NOTE ① — slides in from the right (notes alternate sides). */}
        <Beat>
          <RevealImage
            src={noteSrc(NOTES[0].id)}
            alt="Handwritten confession"
            transcript={NOTES[0].transcript}
            slideFrom="right"
          />
        </Beat>

        {/* BODY — the statement cascades in and stops short; the three verbs
            that finish it land off-axis, and ascii noise creeps in around them
            (see BodyKicker). */}
        <Beat style={{ gap: 'clamp(10px, 2vh, 20px)' }}>
          <RevealWords
            text={BODY_LINE}
            as="h2"
            cfg={WORD_DISPLAY}
            style={FRAGMENT_STYLE}
          />
          <BodyKicker style={FRAGMENT_STYLE} />
        </Beat>

        {/* NOTE ② — slides in from the left. */}
        <Beat>
          <RevealImage
            src={noteSrc(NOTES[1].id)}
            alt="Handwritten confession"
            transcript={NOTES[1].transcript}
            slideFrom="left"
          />
        </Beat>

        {/* FRAGMENT */}
        <Beat>
          <RevealWords
            text={FRAGMENT_LINE}
            as="h2"
            cfg={WORD_DISPLAY}
            style={FRAGMENT_STYLE}
          />
        </Beat>

        {/* NOTE ③ — back to the right, continuing the alternation. */}
        <Beat>
          <RevealImage
            src={noteSrc(NOTES[2].id)}
            alt="Handwritten confession"
            transcript={NOTES[2].transcript}
            slideFrom="right"
          />
        </Beat>

        {/* QUESTION + ENTER — also what the sticky skip watches for, to get out
            of its way. */}
        <Beat ref={enterBeatRef} minVh={100} style={{ gap: 'clamp(34px, 7vh, 68px)' }}>
          <RevealWords
            text={FINAL_QUESTION}
            as="h2"
            cfg={WORD_DISPLAY}
            justify
            style={{
              maxWidth: 480,
              fontFamily: SERIF,
              fontWeight: 400,
              fontSize: 'clamp(26px, 4.4vw, 42px)',
              lineHeight: 1.28,
              letterSpacing: '0.005em',
              color: INK,
            }}
          />
          <EnterButton onClick={onEnter} />
        </Beat>
      </main>
    </div>
  );
}

const FRAGMENT_STYLE = {
  maxWidth: 620,
  fontFamily: SERIF,
  fontWeight: 400,
  fontSize: 'clamp(30px, 6vw, 56px)',
  lineHeight: 1.15,
  letterSpacing: '-0.01em',
  color: INK,
};

/** Bouncing ↓ cue in the hero; fades out once you start scrolling. */
const SCROLL_CUE = {
  fadeS: 0.9,
  noiseStrength: 0.45, // fraction of hero-title grain (lower = subtler)
};

function ScrollCue({ show = false }) {
  const reduce = useReducedMotion();
  const [gone, setGone] = useState(false);
  const filterId = `scroll-cue-noise-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    const onScroll = () => setGone(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: gone ? 0 : show ? 0.7 : 0 }}
      transition={{
        duration: reduce ? 0 : SCROLL_CUE.fadeS,
        ease,
        delay: reduce ? 0 : show ? HERO_QUESTION.arrowDelayS : 0,
      }}
      style={{ lineHeight: 1 }}
    >
      <HeroNoiseFilter id={filterId} reduceMotion={reduce} strength={SCROLL_CUE.noiseStrength} />
      <motion.span
        animate={reduce ? undefined : { y: [0, 9, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          display: 'inline-block',
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: 48,
          color: 'rgba(207,202,183,0.7)',
          filter: `url(#${filterId})`,
        }}
      >
        &darr;
      </motion.span>
    </motion.div>
  );
}

/* Shared with OnboardingBeats — the same piece, stepped on swipes instead of
   scrolled. Everything below is the writing and the furniture, which both
   tellings hold in common; only the mechanic that moves between beats differs.
   Exported from here rather than lifted into a module of its own so this file
   stays the one place the onboarding's copy and timings are authored. */
export {
  OpeningLoader,
  HeroOpeningQuestion,
  ScrollCue,
  EnterButton,
  RevealWords,
  WORD_DISPLAY,
  FRAGMENT_STYLE,
  INTRO_LINE,
  BODY_LINE,
  FRAGMENT_LINE,
  FINAL_QUESTION,
  NOTES,
  noteSrc,
  CTA_HOVER_CSS,
  ONBOARDING_LINK_UNDERLINE,
  PROGRESS_DASHES,
  MONO,
  SERIF,
  ease,
};

/** Final ENTER cta — mono, all-caps, matching the archive's EXPLORE button. */
// `delayS` lets a caller hang the button off the end of the words above it
// rather than the shared default, which is set for the scrolled telling.
function EnterButton({ onClick, start, delayS = 0.5 }) {
  const ref = useRef(null);
  const scrolledInto = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const inView = start === undefined ? scrolledInto : start;
  const reduce = useReducedMotion();
  return (
    <motion.button
      ref={ref}
      className="onboarding-cta"
      onClick={onClick}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: reduce ? 0 : 0.7, ease, delay: reduce ? 0 : delayS }}
      style={{
        // The label is 214px of tracked-out mono against a column of
        // min(74vw, 660px), so with 40px either side it broke over two lines
        // below ~400px wide. It is one phrase and reads as one line: held
        // together here, with the side padding giving way on a narrow screen so
        // the button shrinks rather than running off it.
        padding: '17px clamp(18px, 5vw, 40px)',
        whiteSpace: 'nowrap',
        background: 'transparent',
        border: 'none',
        borderRadius: 999,
        cursor: 'pointer',
        fontFamily: MONO,
        fontSize: 15,
        letterSpacing: '0.24em',
        textTransform: 'uppercase',
      }}
    >
      <span style={ONBOARDING_LINK_UNDERLINE}>Enter the archive</span>
    </motion.button>
  );
}
