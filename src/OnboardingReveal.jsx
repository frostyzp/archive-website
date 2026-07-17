import { createElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useSpring } from 'motion/react';
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

  let wordIdx = 0;
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
                  <span key={`${line}-${w}`}>
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
                      {w}
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

const INTRO_LINE =
  'We asked strangers to write a confession about their relationship with AI — artificial intelligence.';
const BODY_LINE =
  'It is quietly entering the most intimate parts of our lives, changing our habits...';
const CLOSING_LINE =
  'Every note is a record of what we admit to intelligent systems we are learning to live with.';
const FINAL_QUESTION = 'So what do you tell AI?';

const NOTES = [
  {
    id: 'AC_185',
    serial: 'AC-185',
    transcript: 'Forgive my sin: I talk to AI way more than to ALL the people in my life, combined :)',
  },
  {
    id: 'AC_171',
    serial: 'AC-171',
    transcript: 'ChatGPT writes 99.9% of all my emails & actually many of my texts now too!!',
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

/** Confession stills the loader flips through (all present in public/). */
const LOADER_POOL = [
  'AC_001', 'AC_005', 'AC_012', 'AC_017', 'AC_045', 'AC_055', 'AC_066',
  'AC_078', 'AC_089', 'AC_095', 'AC_110', 'AC_125', 'AC_140', 'AC_150',
  'AC_160', 'AC_171', 'AC_181', 'AC_185', 'AC_190', 'AC_200',
];
const LOADER_FLIPS = 12;

/* ─────────────────────────────────────────────────────────────────
 * OPENING LOADER STORYBOARD  (~2s · black & white)
 *
 *    0ms   first confession fades in, holds longest
 *    …     stills flip faster and faster, each crossfading (opacity) over
 *          the last — all rendered black & white
 * 2000ms   loader crossfades out → hero
 * ───────────────────────────────────────────────────────────────── */
const LOADER_TOTAL_MS = 2000; //   whole opening card, start → hero
const LOADER_FIRST_HOLD = 300; //  first still lingers the longest
const LOADER_LAST_HOLD = 70; //    final stills whip by
const LOADER_DEVELOP_S = 0.5; //   per-still scale settle (stills hard-cut, no fade)

/**
 * ~2s opening title card. Flips through a dozen random confession stills — all
 * stacked in the same spot, rendered black & white — spawning faster and faster,
 * then fades to reveal the hero. Reduced-motion finishes instantly.
 */
function OpeningLoader({ onDone }) {
  const [frame, setFrame] = useState(0);

  const shots = useMemo(() => {
    const pool = [...LOADER_POOL].sort(() => Math.random() - 0.5).slice(0, LOADER_FLIPS);
    return pool.map((id) => ({ id, rot: Math.round((Math.random() * 2 - 1) * 3) }));
  }, []);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      onDone();
      return undefined;
    }
    shots.forEach((s) => {
      const im = new Image();
      im.src = noteSrc(s.id);
    });
    // Accelerating flips (LOADER_FIRST_HOLD → LOADER_LAST_HOLD) scaled to fill
    // exactly LOADER_TOTAL_MS, so the whole card lasts 2s regardless of count.
    const n = shots.length;
    const holds = [];
    for (let k = 1; k < n; k += 1) {
      const t = (k - 1) / Math.max(1, n - 2);
      holds.push(LOADER_FIRST_HOLD - (LOADER_FIRST_HOLD - LOADER_LAST_HOLD) * t);
    }
    const rawSum = holds.reduce((a, b) => a + b, 0) || 1;
    const scale = (LOADER_TOTAL_MS - LOADER_LAST_HOLD) / rawSum;
    const timers = [];
    let acc = 0;
    holds.forEach((h, idx) => {
      acc += h * scale;
      timers.push(setTimeout(() => setFrame(idx + 1), acc));
    });
    const done = setTimeout(onDone, LOADER_TOTAL_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shot = shots[frame];

  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease }}
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
              initial={{ scale: 1.03 }}
              animate={{ scale: 1 }}
              transition={{ duration: LOADER_DEVELOP_S, ease }}
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
                  filter: 'grayscale(1)', // stills read black & white
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
  // `skipEntrance` (main site) drops the 2s confession-still loader but KEEPS
  // the hero title's particle fade-in. Reduced motion shows everything at rest.
  const showLoader = !skipEntrance && !reduce;
  const rootRef = useRef(null);
  const [loading, setLoading] = useState(showLoader);
  const [titleGate, setTitleGate] = useState(reduce);
  const [heroTitleRevealed, setHeroTitleRevealed] = useState(reduce);

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
          reveal the hero. */}
      <AnimatePresence>
        {loading && <OpeningLoader onDone={() => setLoading(false)} />}
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
          <HeroTitleText
            hold={loading || !titleGate}
            reduceMotion={reduce}
            onRevealComplete={() => setHeroTitleRevealed(true)}
          />
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
          {/* CUBE — placeholder until the final confession-box art is ready.
              Swap back to the real art when it lands:
              <RevealMaskArt src="/intro-cube-parks.png" w={1024} h={729}
                width="min(100%, 640px)" color="#e6ded0" slope={5} intercept={-0.4}
                durS={2} alt="…" /> */}
          <PlaceholderBox width="min(100%, 640px)" aspectRatio="1024 / 729" />
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
