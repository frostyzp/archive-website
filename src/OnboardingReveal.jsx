import { createElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useSpring } from 'motion/react';
import * as opentype from 'opentype.js';
import { useDialKit } from 'dialkit';
import { INK, inkA } from './colors';
import { TunableGrainBackground } from './noise';

/* ─────────────────────────────────────────────────────────────────────
 * ONBOARDING SCROLL STORYBOARD  (mobile-first editorial reveal)
 *
 * A continuous vertical scroll (Figma "EXPLORATIONS V2 / Frame 51"). Nothing
 * animates on a global clock — every block reveals itself the moment it
 * scrolls into view. Read top-to-bottom; each row is one block:
 *
 *   HERO      title "What We Tell AI" (Figma 280:71) reveals word-by-word in
 *             TRJN DaVinci on two lines; opening question fades in beneath
 *   CUBE      the glowing cube fades in as its blur / grayscale filter
 *             resolves over ~1.9s, then the intro line reveals word-by-word
 *   BODY      "AI is quietly entering…" reveals word-by-word
 *   NOTE ①    a handwritten confession fades in through the filter
 *   FRAGMENT  "changing our habits," (large, word-by-word)
 *   NOTE ②    confession fades in through the filter
 *   FRAGMENT  "and even replacing our human relationships." (word-by-word)
 *   NOTE ③    confession fades in through the filter
 *   CLOSING   closing statement reveals word-by-word
 *   QUESTION  the final philosophical question + ENTER cta
 *
 * A SKIP control is sticky (fixed) top-right the whole way down.
 * ───────────────────────────────────────────────────────────────────── */

const ease = [0.22, 1, 0.36, 1];
const SERIF = "'Faktory', Georgia, serif";
const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

// Dotted hyperlink underline — matches the archive nav (ARCHIVE_LINK_UNDERLINE in
// App.jsx) so the Skip Intro / Enter the archive links read as the same kind of
// text link. Applied to the label <span> (not the flex anchor) so it underlines
// only the word, not the icon gap.
const ONBOARDING_LINK_UNDERLINE = {
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationThickness: '1px',
  textUnderlineOffset: '3px',
};

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
 *  `slideFrom`): they arrive from alternating sides with a slight tilt on the
 *  shared ease-out, instead of developing in place. */
const SLIDE = {
  x: 80, //      px the note starts off to its side
  rotate: 5, //  deg tilt it straightens out of
  durS: 0.9, //  slide + settle duration
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
  staggerMs: 100,
  fadeMs: 620,
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

// Occasional per-letter "pixelation" glitch on the hero wordmark. Once the title
// has revealed, random single glyphs briefly snap to a chunky SVG mosaic (see
// HeroPixelateFilter) and flare from the faint resting fill up to near-full
// opacity, then resolve — a quiet digital artifact on the hand-lettered type.
// Fully disabled under prefers-reduced-motion.
const HERO_PIXEL_GLITCH = {
  enabled: true,
  block: 12, //          mosaic cell size in CSS px (larger = chunkier pixels)
  startDelayMs: 600, //  beat after the wordmark reveals before glitches begin
  minGapMs: 1500, //     shortest pause between glitches
  maxGapMs: 4200, //     longest pause between glitches
  minHoldMs: 110, //     shortest time a glyph stays pixelated
  maxHoldMs: 320, //     longest hold
  doubleChance: 0.26, // chance a single glitch hits two glyphs at once
};

// When true the hero wordmark is drawn on letter-by-letter (SVG trim path) via
// `HeroTitleDraw` instead of the word-by-word opacity fade of `HeroTitleText`.
// Flip to false to restore the plain webfont reveal.
// Trace-path draw disabled for now — falls back to the plain webfont reveal.
const HERO_DRAW_ON = false;
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
  fadeS: 0.65,
};

/** Opening question beneath the hero title — one opacity fade, not word-by-word. */
function HeroOpeningQuestion({ hold = false, instant = false, style }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const reduce = useReducedMotion();
  const show = inView && !hold;

  return (
    <motion.p
      ref={ref}
      aria-label={OPENING_QUESTION}
      initial={reduce || instant ? false : { opacity: 0 }}
      animate={show ? { opacity: 1 } : undefined}
      transition={{
        duration: reduce || instant ? 0 : HERO_QUESTION.fadeS,
        ease,
      }}
      style={{ margin: 0, ...style }}
    >
      {OPENING_QUESTION}
    </motion.p>
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
 * Chunky "pixelation" mosaic <filter> for a single hero glyph. The classic
 * SVG trick: flood one 1px dot per BLOCK×BLOCK cell, tile it across the glyph
 * box, keep the SourceGraphic only at those sample points, then dilate each
 * sample back into a full cell — so the letter reads as low-res blocks in its
 * own colour. Toggled onto random letters by HeroTitleText for a brief glitch.
 * primitiveUnits stay userSpaceOnUse, so BLOCK is measured in CSS px.
 */
function HeroPixelateFilter({ id, block = HERO_PIXEL_GLITCH.block }) {
  const half = block / 2;
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      <defs>
        <filter
          id={id}
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
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
      </defs>
    </svg>
  );
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

  // Per-letter pixelation glitch. `pix` holds the glyph indices currently
  // mosaicked; a self-rescheduling timer fires a glitch on 1–2 random glyphs,
  // holds briefly, then clears them. Torn down (and reset) whenever the title
  // is hidden or reduced-motion is on.
  const pixelateId = `hero-title-pixelate-${useId().replace(/:/g, '')}`;
  const [pix, setPix] = useState(() => new Set());
  useEffect(() => {
    if (reduceMotion || !HERO_PIXEL_GLITCH.enabled || !show || HERO_TITLE_LETTER_COUNT === 0) {
      return undefined;
    }
    let alive = true;
    const timers = new Set();
    const rand = (a, b) => a + Math.random() * (b - a);
    const drop = (t) => {
      clearTimeout(t);
      timers.delete(t);
    };
    const fire = () => {
      if (!alive) return;
      const n = Math.random() < HERO_PIXEL_GLITCH.doubleChance ? 2 : 1;
      const picks = [];
      while (picks.length < n && picks.length < HERO_TITLE_LETTER_COUNT) {
        const p = Math.floor(Math.random() * HERO_TITLE_LETTER_COUNT);
        if (!picks.includes(p)) picks.push(p);
      }
      setPix((prev) => new Set([...prev, ...picks]));
      const off = setTimeout(() => {
        setPix((prev) => {
          const s = new Set(prev);
          picks.forEach((p) => s.delete(p));
          return s;
        });
        drop(off);
      }, rand(HERO_PIXEL_GLITCH.minHoldMs, HERO_PIXEL_GLITCH.maxHoldMs));
      timers.add(off);
      const next = setTimeout(() => {
        drop(next);
        fire();
      }, rand(HERO_PIXEL_GLITCH.minGapMs, HERO_PIXEL_GLITCH.maxGapMs));
      timers.add(next);
    };
    const start = setTimeout(() => {
      drop(start);
      fire();
    }, HERO_PIXEL_GLITCH.startDelayMs);
    timers.add(start);
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      timers.clear();
      setPix(new Set());
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
      <HeroPixelateFilter id={pixelateId} />
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
                        ease,
                        delay: show ? i * staggerS : 0,
                      }}
                      style={{ display: 'inline-block', ...glyphStyle }}
                    >
                      {/* Per-letter spans so the glitch can hit individual glyphs:
                          an active letter snaps to the SVG mosaic and flares from
                          the faint resting fill up to near-full opacity. */}
                      {w.split('').map((ch, ci) => {
                        const gi = letterIdx;
                        letterIdx += 1;
                        const active = pix.has(gi);
                        return (
                          <span
                            key={ci}
                            style={{
                              display: 'inline-block',
                              ...(active
                                ? {
                                    filter: `url(#${pixelateId})`,
                                    WebkitTextFillColor: 'rgba(221, 221, 174, 0.92)',
                                  }
                                : null),
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
const BODY_LINE =
  'AI is entering into the most personal aspects of our lives, changing how we communicate, work, and think…';
const CLOSING_LINE =
  'And even substituting our human relationships…';
const FINAL_QUESTION = 'Every note is a real story, from a real person, about living with this new technology.';

const NOTES = [
  {
    id: 'AC_185',
    serial: 'AC-185',
    transcript: 'Forgive my sin: I talk to AI way more than to ALL the people in my life, combined :)',
  },
  {
    id: 'AC_148',
    serial: 'AC-148',
    transcript: 'I asked it to read my writing & praise it... smh',
  },
  {
    id: 'AC_190',
    serial: 'AC-190',
    transcript:
      "In the early months of ChatGPT's release, I prayed to the chatbot every single day, attempting to find purpose and meaning in religion. ChatGPT hallucinated and convinced me that God is dead.",
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
 */
function RevealWords({
  text,
  as = 'p',
  cfg = WORD,
  delayStart = 0,
  typewriter = false,
  hold = false,
  style,
}) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const reduce = useReducedMotion();
  // `hold` keeps the words at their initial (hidden) state even when in view —
  // used to defer the hero question until the opening loader lifts.
  const show = inView && !hold;

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

  const words = text.split(' ');

  return createElement(
    as,
    { ref, 'aria-label': text, style: { margin: 0, ...style } },
    words.map((w, i) => (
      <motion.span
        key={i}
        aria-hidden="true"
        initial={reduce ? false : { opacity: 0 }}
        animate={show ? { opacity: 1 } : undefined}
        transition={{
          duration: reduce ? 0 : cfg.durS,
          ease,
          delay: reduce ? 0 : delayStart + i * cfg.staggerS,
        }}
        style={{ display: 'inline-block', marginRight: '0.28em' }}
      >
        {w}
      </motion.span>
    ))
  );
}

/**
 * A confession still (or the hero cube) that fades in WHILE a blur / grayscale
 * / brightness filter resolves over time — like a print developing. Driven by
 * scroll-into-view.
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
  // note travels in from its side (x) while straightening out of a slight tilt
  // (rotate), settling on the shared ease-out. The root clips overflow-x, so the
  // off-side start never spawns a horizontal scrollbar.
  const sliding = slideFrom === 'left' || slideFrom === 'right';
  const dir = slideFrom === 'left' ? -1 : 1;

  const from = sliding
    ? { opacity: 0, x: dir * SLIDE.x, rotate: dir * SLIDE.rotate }
    : {
        opacity: 0,
        y: cfg.riseY ?? IMAGE.riseY,
        scale: cfg.fromScale ?? IMAGE.fromScale,
        filter: `blur(${cfg.fromBlur ?? IMAGE.fromBlur}px) grayscale(${cfg.fromGrayscale ?? IMAGE.fromGrayscale}) brightness(${cfg.fromBrightness ?? IMAGE.fromBrightness})`,
      };
  const to = sliding
    ? { opacity: 1, x: 0, rotate: 0 }
    : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px) grayscale(0) brightness(1)' };
  const durS = sliding ? SLIDE.durS : (cfg.fadeS ?? IMAGE.fadeS);

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
      <motion.img
        src={src}
        alt={alt}
        draggable={false}
        loading="eager"
        onLoad={() => setDecoded(true)}
        onError={() => setDecoded(true)}
        initial={reduce ? false : from}
        animate={show ? to : undefined}
        transition={{ duration: reduce ? 0 : durS, ease, delay: reduce ? 0 : cfg.delayS ?? 0 }}
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
          filter: glow ? 'drop-shadow(0 0 40px rgba(120,150,255,0.14))' : 'none',
        }}
      />
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

/** The two confession-booth stills that open the intro (the Dolores Park
 *  "Confession Box" sign + the example-secrets table). Laid out like a scrapbook
 *  — a taller portrait print on the left, a wider landscape print dropped a
 *  little lower on the right. Each develops in (blur / grayscale / brightness
 *  resolve) like the confession notes, the second a beat behind the first. The
 *  assets already carry their own white border + tilt on a black field, so the
 *  corners melt into the near-black page and no extra frame is needed. */
function IntroBoothCollage({ width }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const reduce = useReducedMotion();
  const from = {
    opacity: 0,
    y: IMAGE.riseY,
    filter: `blur(${IMAGE.fromBlur}px) grayscale(${IMAGE.fromGrayscale}) brightness(${IMAGE.fromBrightness})`,
  };
  const to = { opacity: 1, y: 0, filter: 'blur(0px) grayscale(0) brightness(1)' };
  return (
    <div
      ref={ref}
      style={{
        width,
        maxWidth: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
    >
      <motion.img
        src="/intro-booth-park.png"
        alt="A hand-painted “Confession Box — everyone has an AI secret” sign staked in Dolores Park."
        draggable={false}
        loading="eager"
        initial={reduce ? false : from}
        animate={inView ? to : undefined}
        transition={{ duration: reduce ? 0 : IMAGE.fadeS, ease }}
        style={{ flex: '0 0 auto', width: '56%', height: 'auto', display: 'block' }}
      />
      <motion.img
        src="/intro-booth-table.png"
        alt="The booth table: framed example confessions, a drop box, and a “follow along” QR code."
        draggable={false}
        loading="eager"
        initial={reduce ? false : from}
        animate={inView ? to : undefined}
        transition={{ duration: reduce ? 0 : IMAGE.fadeS, ease, delay: reduce ? 0 : 0.18 }}
        style={{
          flex: '0 0 auto',
          width: '62%',
          height: 'auto',
          display: 'block',
          marginTop: 'clamp(18px, 5vw, 52px)',
          // Pull the close-up left so it overlaps the park shot — a stacked,
          // scattered-photo look rather than two tiles with a gutter.
          marginLeft: '-18%',
        }}
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
function Beat({ children, minVh = 0, style }) {
  return (
    <section
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
 * OPENING LOADER STORYBOARD  (~2s · black & white confession flip)
 *
 * Read top-to-bottom. Times are ms from the moment the site opens.
 *
 *      0ms   first confession still HARD-CUTS in — no crossfade, just a
 *            tiny scale settle (startScale → 1.0) — held the longest
 *            (firstHold). Every still is grayscale, tilted ±maxTilt°, with
 *            film grain masked to its own paper shape.
 *      …     stills flip past faster and faster; each hold eases from
 *            firstHold → lastHold, and the whole run is time-scaled to land
 *            on exactly `totalMs` no matter how many `flips` there are.
 *   ~2000ms  the card crossfades out (fadeOutS) → the hero title reveals.
 *
 * Every knob lives in the LOADER config below and is exposed live in the
 * "Opening Loader" DialKit panel (open any page with ?dial=1). Hit the
 * panel's ⟳ Replay button to watch it again without reloading.
 * ───────────────────────────────────────────────────────────────── */
const LOADER = {
  // Confession ids the flip pulls from (all present in public/confession_notes_2/).
  pool: [
    'AC_001', 'AC_005', 'AC_012', 'AC_017', 'AC_045', 'AC_055', 'AC_066',
    'AC_078', 'AC_089', 'AC_095', 'AC_110', 'AC_125', 'AC_140', 'AC_150',
    'AC_160', 'AC_171', 'AC_181', 'AC_185', 'AC_190', 'AC_200',
  ],
  flips: 12, //        how many stills flip past before the hero
  totalMs: 2000, //    whole card, first still → hero handoff
  firstHold: 300, //   ms the first still lingers (slowest)
  lastHold: 70, //     ms the final stills whip by (fastest)
  developS: 0.5, //    per-still scale-settle duration (hard-cut, no opacity fade)
  startScale: 1.03, // scale each still cuts in at, settling → 1.0
  maxTilt: 3, //       deg of random ± rotation per still
  fadeOutS: 0.22, //   loader → hero crossfade-out
  grayscale: true, //  render the stills black & white
};

/**
 * ~2s opening title card. Flips through a stack of random confession stills —
 * all pinned in the same spot, black & white — spawning faster and faster,
 * then crossfades out to reveal the hero. Every value comes from the LOADER
 * config, overridable per-instance via `config` (the DialKit panel). Reduced
 * motion skips straight to the hero.
 */
function OpeningLoader({ onDone, config }) {
  const cfg = { ...LOADER, ...config };
  const flips = Math.max(2, Math.round(cfg.flips));
  const [frame, setFrame] = useState(0);

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
    shots.forEach((s) => {
      const im = new Image();
      im.src = noteSrc(s.id);
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
    const done = setTimeout(onDone, cfg.totalMs);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, cfg.firstHold, cfg.lastHold, cfg.totalMs]);

  const shot = shots[frame] || shots[shots.length - 1];

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
        background:
          'radial-gradient(ellipse 120% 80% at 50% 0%, #161515 0%, #0B0A0A 42%, #050404 74%, #010000 100%)',
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
            each still from feeling static). */}
        <div
          style={{
            position: 'relative',
            width: 'clamp(190px, 40vw, 330px)',
            height: 'clamp(210px, 40vh, 300px)',
          }}
        >
          <AnimatePresence>
            <motion.div
              key={frame}
              initial={{ scale: cfg.startScale }}
              animate={{ scale: 1 }}
              transition={{ duration: cfg.developS, ease }}
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
          </AnimatePresence>
        </div>
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
  // Bumping this remounts the loader from a clean slate — used by the DialKit
  // Replay action so tweaks can be re-watched without a page reload.
  const [loaderRun, setLoaderRun] = useState(0);

  // Live-tunable opening-loader knobs, mirrored from the LOADER config. Only
  // visible on ?dial=1 (DialRoot is dev-gated in main.jsx); values otherwise
  // fall through to the defaults. The ⟳ Replay action re-shows the loader.
  const loaderDials = useDialKit(
    'Opening Loader',
    {
      flips: [LOADER.flips, 4, 20, 1],
      totalMs: [LOADER.totalMs, 500, 5000, 50],
      firstHold: [LOADER.firstHold, 40, 800, 10],
      lastHold: [LOADER.lastHold, 20, 400, 5],
      developS: [LOADER.developS, 0, 1.5, 0.05],
      startScale: [LOADER.startScale, 1, 1.2, 0.01],
      maxTilt: [LOADER.maxTilt, 0, 15, 0.5],
      fadeOutS: [LOADER.fadeOutS, 0, 1, 0.02],
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

  // Thin top progress hairline for the whole scroll.
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });

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
        background: '#010000',
        overflowX: 'hidden',
      }}
    >
      {/* 2s opening loader — flips through random confessions, then lifts to
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
          background: '#010000',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse 120% 80% at 50% 0%, #161515 0%, #0B0A0A 42%, #050404 74%, #010000 100%)',
          }}
        />
        <TunableGrainBackground />
      </div>

      {/* Scroll progress hairline. */}
      <motion.div
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          transformOrigin: '0% 50%',
          scaleX: progress,
          background: 'linear-gradient(90deg, rgba(207,202,183,0.15), rgba(207,202,183,0.7))',
          zIndex: 60,
        }}
      />

      {/* STICKY SKIP — a real hyperlink to the archive index (grid) page, fixed
          so it rides along the entire scroll. A normal click runs the smooth
          in-app transition; the href keeps it a genuine link (open-in-new-tab,
          middle-click, keyboard). */}
      <a
        href="/?view=grid"
        onClick={(e) => {
          e.preventDefault();
          onEnter();
        }}
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
          color: inkA(0.82),
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: 12.5,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          lineHeight: 1,
          // Kill the UA default link underline so it doesn't paint a continuous
          // rule across the gaps — the per-word spans carry the underline.
          textDecoration: 'none',
          transition: 'color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = INK;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = inkA(0.82);
        }}
      >
        <span style={ONBOARDING_LINK_UNDERLINE}>Skip Intro</span>
      </a>

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
        {/* HERO */}
        <Beat minVh={100} style={{ paddingTop: 'clamp(24px, 6vh, 80px)', gap: 'clamp(26px, 5vh, 52px)' }}>
          {HERO_DRAW_ON ? (
            <HeroTitleDraw
              hold={loading || !titleGate}
              reduceMotion={reduce}
              onRevealComplete={() => setHeroTitleRevealed(true)}
            />
          ) : (
            <HeroTitleText
              hold={loading || !titleGate}
              reduceMotion={reduce}
              onRevealComplete={() => setHeroTitleRevealed(true)}
            />
          )}
          <HeroOpeningQuestion
            hold={loading || !heroTitleRevealed}
            instant={reduce}
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
          <ScrollCue />
        </Beat>

        {/* CUBE + INTRO */}
        <Beat style={{ gap: 'clamp(30px, 6vh, 60px)' }}>
          {/* The confession-booth stills (Dolores Park sign + example-secrets
              table) develop in as a scrapbook pair, then the intro line reveals
              word-by-word beneath them. */}
          <IntroBoothCollage width="min(100%, 900px)" />
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

        {/* BODY — the whole sentence is one emphasized statement, parallel to
            the "and even replacing our human relationships." fragment below. */}
        <Beat>
          <RevealWords text={BODY_LINE} as="h2" cfg={WORD_DISPLAY} style={FRAGMENT_STYLE} />
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
          <RevealWords text="and even replacing our human relationships." as="h2" cfg={WORD_DISPLAY} style={FRAGMENT_STYLE} />
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

        {/* CLOSING — an emphasized section statement, matching the other
            display fragments. */}
        <Beat>
          <RevealWords text={CLOSING_LINE} as="h2" cfg={WORD_DISPLAY} style={FRAGMENT_STYLE} />
        </Beat>

        {/* QUESTION + ENTER */}
        <Beat minVh={100} style={{ gap: 'clamp(34px, 7vh, 68px)' }}>
          <RevealWords
            text={FINAL_QUESTION}
            as="h2"
            cfg={WORD_DISPLAY}
            style={{
              maxWidth: 620,
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
  noiseStrength: 0.45, // fraction of hero-title grain (lower = subtler)
};

function ScrollCue() {
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
      animate={{ opacity: gone ? 0 : 0.7 }}
      transition={{ duration: 0.9, ease, delay: reduce ? 0 : 1.6 }}
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

/** Final ENTER cta — mono, all-caps, matching the archive's EXPLORE button. */
function EnterButton({ onClick }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduce = useReducedMotion();
  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: reduce ? 0 : 0.7, ease, delay: reduce ? 0 : 0.5 }}
      style={{
        padding: '17px 40px',
        background: 'transparent',
        border: 'none',
        borderRadius: 999,
        color: '#CFCAB7',
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
