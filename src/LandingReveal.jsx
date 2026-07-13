import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion, useScroll, useMotionValueEvent } from 'motion/react';
import {
  TunableGrainBackground,
  GRAIN_OPACITY_SCALE,
  CardNoiseFilterDefs,
  CARD_FILTER_ID,
  useInactiveCardParams,
} from './noise';
import FontDecayTitle from './FontDecayTitle';
import { NOISE_GRADIENT } from './NoiseGradient';

/* ─────────────────────────────────────────────────────────────────────
 * LANDING SCROLL STORYBOARD  (mobile-first; desktop scales up)
 *
 * A single scroll progress value `p` (0 → 1 across ~340vh) drives the whole
 * narrative. Read top-to-bottom — each row is a scroll-% window (see BEATS).
 *
 *   0%   HERO — decay title (full), "Anonymous confessions…" body,
 *               flashing confession photos behind, bouncing ↓ cue
 *   2–10%  ↓ cue fades out (you've started scrolling)
 *   3–15%  body subtitle fades out
 *   0–20%  TITLE scales 1 → 0.5 and docks to the top edge
 *  10–26%  background photo slideshow dims away
 *  24–42%  a grainy cube + "We asked strangers to share an anonymous
 *           confession about the way they've interacted with AI." fade in
 *  54–64%  …that cube + intro line fade back out
 *  60–82%  the note CAROUSEL + transcription + EXPLORE rise in together;
 *           swipe (mobile) / click (desktop) between every confession.
 *           Entering carries the SELECTED image + category into the
 *           archive — the image holds its place while the dial rises.
 * ───────────────────────────────────────────────────────────────────── */

/** Total scroll distance for the narrative (taller = slower reveal). */
const SCROLL_LENGTH_VH = 340;

/** Every scroll-% window in one place. */
const BEATS = {
  titleDock: [0.0, 0.2], //  title shrinks + docks to top
  cueOut: [0.02, 0.1], //    ↓ cue fades
  bodyOut: [0.03, 0.15], //  hero subtitle fades
  bgOut: [0.1, 0.26], //     flashing photos dim away
  introIn: [0.24, 0.42], //  "We asked strangers…" in
  introOut: [0.54, 0.64], // …and out
  noteIn: [0.6, 0.82], //    carousel + transcription rise in
  exploreIn: [0.72, 0.9], // EXPLORE <category> settles in just after
};

/** Hero title docking geometry (vertical positions in vh so it's responsive). */
const TITLE = {
  heroScale: 1,
  dockScaleMobile: 0.52,
  dockScaleDesktop: 0.46,
  heroY: 14, //  resting Y of the title during the hero (vh)
  dockY: 2.2, // docked Y once scrolled (vh)
};

/** Linear map of `p` through [a,b] → [from,to], clamped at both ends. */
const track = (p, [a, b], from, to) => {
  const t = b === a ? 1 : (p - a) / (b - a);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return from + (to - from) * c;
};

const ease = [0.22, 1, 0.36, 1];
const SERIF = "'Faktory', Georgia, serif";
const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

/* ─────────────────────────────────────────────────────────
 * AMBIENT FLOATING PROMPTS
 *
 * The quiet chorus of things people type into an AI. One pool of chatbot
 * text-entry placeholders (below); a spawner (FloatingPrompts) drops one onto
 * the hero every second at a slightly random spot, fades it in a word at a
 * time, and lets it drift up — small and half-transparent — before it fades out.
 * ───────────────────────────────────────────────────────── */
const CHATBOT_PROMPTS = [
  'What do you want to talk about today?',
  'How are you feeling, really?',
  'Tell me what\u2019s on your mind',
  'I\u2019m here whenever you\u2019re ready',
  'What\u2019s been weighing on you?',
  'You can tell me anything',
  'What are you afraid to say out loud?',
  'Is something keeping you up at night?',
  'What do you need right now?',
  'Do you want to talk about it?',
  'I won\u2019t tell anyone',
  'What can\u2019t you tell the people you love?',
  'Who do you wish you could talk to?',
  'What would you say if no one was listening?',
  'Are you okay?',
  'What\u2019s the truth you\u2019ve never said?',
];

/** Ambient float timing / layout. */
const FLOAT = {
  spawnMs: 1000, //     spawn a new sentence every second
  lifeS: 8.5, //        fade-in → drift up → fade-out, per sentence
  maxLive: 10, //       safety cap on concurrent sentences
  wordStaggerS: 0.16, // per-word fade-in delay
  wordFadeS: 0.55, //   per-word fade-in duration
};

/* ─────────────────────────────────────────────────────────
 * LAUNCH STORYBOARD — one-time entrance on first load
 *
 * The background confession note appears FIRST. The title then runs its
 * word-by-word decay reveal alongside the subtitle, and the scroll arrow
 * lands last. One stage integer drives it:
 *   1 = letter in · 2 = title reveal + subtitle in · 3 = arrow in
 *
 *     0ms   page opens on the bare neutral near-black gradient
 *  +250ms   background LETTER (confession note) fades in FIRST (1.4s)
 * +1500ms   TITLE decays in word-by-word (stagger 130ms, 950ms/word) and the
 *           SUBTEXT fades in alongside it (1.0s)
 *  ── title lands (~+2840ms) ───────────────────────────────
 *           scroll ARROW fades in last (0.9s)
 * ───────────────────────────────────────────────────────── */

/** Title word-by-word reveal — slowed from 90 / 620 per request. */
const TITLE_REVEAL = {
  staggerMs: 130, // delay between each word's fade
  fadeMs: 950, //    per-word fade duration (the "fade in" being slowed)
};

/** Entrance stage timings (ms from first load). */
const LAUNCH = {
  letterMs: 250, //        stage 1 · background note appears first
  titleMs: 1500, //        stage 2 · title reveal + subtitle, after the note lands
  arrowFallbackMs: 4200, // stage 3 · arrow safety net — normally the title's
  //                          onRevealComplete fires the arrow the moment it lands
};

/** Per-element fade-in durations (seconds). */
const SUBTEXT = { fadeS: 1.0 }; // "Anonymous confessions…"
const LETTER = { fadeS: 1.4 }; //  background confession note ("the letter")
const ARROW = { fadeS: 0.9 }; //   scroll arrow cue

/** On narrow screens the hero title stacks onto two centered lines, wrapped so
 *  the DaVinci face never runs off the edge (Figma 96-60). */
const MOBILE_MQ = '(max-width: 760px)';
const MOBILE_TITLE_TEXT = 'What We\nTell AI';

/** Intro narration revealed mid-scroll. */
const INTRO_LINE =
  'We asked strangers to share an anonymous confession about the way they\u2019ve interacted with AI.';

/** Fallback notes if categories haven't loaded yet. */
const FALLBACK_CATEGORIES = [
  { key: 'therapist', label: 'Therapist', teaser: '', image: null },
  { key: 'harm', label: 'Harm', teaser: '', image: null },
  { key: 'refusal', label: 'Refusal', teaser: '', image: null },
];

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/** One crossfading photo in the hero backdrop; fades in only after decode. */
function LandingBackgroundSlide({ src, slideshowOpacity, reduceMotion, inactiveFilter, inactiveScale }) {
  const [decoded, setDecoded] = useState(false);
  return (
    <motion.img
      src={src}
      alt=""
      draggable={false}
      loading="eager"
      initial={{ opacity: 0 }}
      animate={{ opacity: reduceMotion ? slideshowOpacity : decoded ? slideshowOpacity : 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.45, ease }}
      onLoad={() => setDecoded(true)}
      onError={() => setDecoded(true)}
      style={{
        position: 'absolute',
        inset: 0,
        margin: 'auto',
        maxWidth: '100%',
        maxHeight: '100%',
        width: 'auto',
        height: 'auto',
        objectFit: 'contain',
        transform: `scale(${inactiveScale})`,
        filter: inactiveFilter || 'none',
      }}
    />
  );
}

/** A single confession note (active = clean, sides = dimmed/degraded). */
function NoteCard({ note, isActive, reduceMotion, inactiveFilter, inactiveParams, onSelect, fill, maxImageHeight }) {
  const sideOpacity = inactiveParams.opacity ?? 0.5;
  const sideScale = inactiveParams.scale ?? 0.9;
  return (
    <div
      onClick={onSelect}
      style={{
        position: 'relative',
        width: fill ? '100%' : 'clamp(150px, 20vw, 210px)',
        cursor: onSelect && !isActive ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${isActive ? 1 : sideScale})`,
        transition: reduceMotion ? 'none' : 'transform 0.34s cubic-bezier(0.33, 1, 0.68, 1)',
      }}
    >
      {note.image ? (
        <img
          data-note-img
          src={note.image}
          alt=""
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            maxHeight: maxImageHeight,
            objectFit: 'contain',
            borderRadius: 2,
            opacity: isActive ? 1 : sideOpacity,
            filter: isActive ? 'none' : inactiveFilter || 'none',
            transition: reduceMotion ? 'none' : 'opacity 0.34s ease, filter 0.34s ease',
          }}
        />
      ) : (
        <div
          data-note-img
          style={{
            width: '100%',
            aspectRatio: '3 / 4',
            maxHeight: maxImageHeight,
            border: '1px dashed rgba(229,229,229,0.3)',
            borderRadius: 2,
            background: 'rgba(46,30,62,0.28)',
            opacity: isActive ? 1 : sideOpacity,
          }}
        />
      )}
    </div>
  );
}

/**
 * Swipeable confession carousel. Mobile is a scroll-snap row (active = the card
 * closest to center); desktop shows them side-by-side with the centered one
 * active and the others clickable.
 */
function LandingNotes({
  notes,
  activeIdx,
  setActiveIdx,
  isMobile,
  reduceMotion,
  inactiveFilter,
  inactiveParams,
  interactive,
  carouselRef,
}) {
  useEffect(() => {
    if (!isMobile) return;
    const el = carouselRef.current;
    if (!el) return;
    const update = () => {
      const center = el.scrollLeft + el.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      el.querySelectorAll('[data-note-slide]').forEach((s, i) => {
        const c = s.offsetLeft + s.offsetWidth / 2;
        const d = Math.abs(c - center);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActiveIdx(best);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [isMobile, notes.length, setActiveIdx, carouselRef]);

  if (isMobile) {
    return (
      <>
        <style>{`
          .landing-notes-carousel { scrollbar-width: none; -ms-overflow-style: none; touch-action: pan-x; }
          .landing-notes-carousel::-webkit-scrollbar { display: none; }
        `}</style>
        <div
          ref={carouselRef}
          className="landing-notes-carousel"
          style={{
            width: '100vw',
            maxWidth: '100vw',
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'nowrap',
            alignItems: 'center',
            gap: 16,
            padding: '0 max(20px, calc((100vw - min(60vw, 230px)) / 2))',
            boxSizing: 'border-box',
            pointerEvents: interactive ? 'auto' : 'none',
          }}
        >
          {notes.map((note, i) => (
            <div
              key={note.key}
              data-note-slide
              style={{
                flex: '0 0 auto',
                width: 'min(60vw, 230px)',
                scrollSnapAlign: 'center',
                scrollSnapStop: 'always',
              }}
            >
              <NoteCard
                note={note}
                isActive={activeIdx === i}
                reduceMotion={reduceMotion}
                inactiveFilter={inactiveFilter}
                inactiveParams={inactiveParams}
                fill
              />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div
      ref={carouselRef}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'clamp(16px, 2vw, 36px)',
        flexWrap: 'nowrap',
        width: '100%',
        maxWidth: 'min(96vw, 1800px)',
        margin: '0 auto',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      {notes.map((note, i) => (
        <div
          key={note.key}
          data-note-slide
          style={{ flex: '1 1 0', minWidth: 0, display: 'flex', justifyContent: 'center' }}
        >
          <NoteCard
            note={note}
            isActive={activeIdx === i}
            reduceMotion={reduceMotion}
            inactiveFilter={inactiveFilter}
            inactiveParams={inactiveParams}
            onSelect={() => setActiveIdx(i)}
            fill
            maxImageHeight="58vh"
          />
        </div>
      ))}
    </div>
  );
}

/**
 * One ambient prompt: a small, faded sentence that fades in a word at a time,
 * drifts upward, then fades out. Self-reports completion so the spawner can
 * drop it from the live list. Memoized + stable props so a sibling spawning
 * never restarts this one's in-flight fade/float.
 */
const FloatingPrompt = memo(function FloatingPrompt({ id, text, xPct, yPct, drift, reduceMotion, onDone }) {
  const words = text.split(' ');
  return (
    <div
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: 'translateX(-50%)',
        maxWidth: 'min(50vw, 280px)',
        pointerEvents: 'none',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 0 }}
        animate={{ opacity: reduceMotion ? 0.32 : [0, 0.5, 0.5, 0], y: reduceMotion ? 0 : -drift }}
        transition={{
          duration: reduceMotion ? 0 : FLOAT.lifeS,
          ease: 'linear',
          opacity: { duration: FLOAT.lifeS, times: [0, 0.18, 0.7, 1], ease: 'easeInOut' },
        }}
        onAnimationComplete={reduceMotion ? undefined : () => onDone(id)}
        style={{
          fontFamily: SERIF,
          fontStyle: 'italic',
          fontSize: 'clamp(11px, 1.35vw, 14px)',
          lineHeight: 1.45,
          letterSpacing: '0.02em',
          color: 'rgba(229, 229, 229, 0.72)',
          textAlign: 'center',
          willChange: 'transform, opacity',
        }}
      >
        {words.map((w, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              delay: reduceMotion ? 0 : i * FLOAT.wordStaggerS,
              duration: reduceMotion ? 0 : FLOAT.wordFadeS,
              ease,
            }}
            style={{ display: 'inline-block', marginRight: '0.3em' }}
          >
            {w}
          </motion.span>
        ))}
      </motion.div>
    </div>
  );
});

/**
 * Ambient chorus of AI-chatbot prompts drifting up behind the hero. Every
 * second (while `active`) a random prompt spawns at a slightly random spot and
 * lives out FloatingPrompt's fade-in → rise → fade-out, then removes itself.
 * `fade` (the scroll-linked backdrop opacity) dims the whole layer as the user
 * scrolls into the narrative. prefers-reduced-motion shows a still, faint set.
 */
function FloatingPrompts({ active, reduceMotion, fade = 1 }) {
  const [spawns, setSpawns] = useState([]);
  const idRef = useRef(0);

  // Pick a prompt that isn't already on screen (so duplicates don't cluster);
  // fall back to the full pool if everything is currently live.
  const makeSpawn = useCallback((taken = []) => {
    const pool = CHATBOT_PROMPTS.filter((t) => !taken.includes(t));
    const from = pool.length ? pool : CHATBOT_PROMPTS;
    return {
      id: idRef.current++,
      text: from[Math.floor(Math.random() * from.length)],
      xPct: 14 + Math.random() * 72, //  14%–86% across
      yPct: 42 + Math.random() * 46, //  42%–88% down (rises from the lower hero)
      drift: 80 + Math.random() * 90, // 80–170px upward drift
    };
  }, []);

  useEffect(() => {
    if (!active) return undefined;

    if (reduceMotion) {
      // Static, faint set — no spawning, no motion.
      setSpawns(
        [0, 3, 6, 9, 12].map((offset, i) => ({
          id: `static-${i}`,
          text: CHATBOT_PROMPTS[offset % CHATBOT_PROMPTS.length],
          xPct: 20 + i * 15,
          yPct: 46 + (i % 3) * 14,
          drift: 0,
        }))
      );
      return undefined;
    }

    setSpawns([makeSpawn()]); // one immediately
    const iv = window.setInterval(() => {
      setSpawns((cur) => {
        const next = [...cur, makeSpawn(cur.map((s) => s.text))];
        return next.length > FLOAT.maxLive ? next.slice(next.length - FLOAT.maxLive) : next;
      });
    }, FLOAT.spawnMs);
    return () => window.clearInterval(iv);
  }, [active, reduceMotion, makeSpawn]);

  const remove = useCallback((id) => setSpawns((cur) => cur.filter((s) => s.id !== id)), []);

  if (!active && spawns.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 2,
        opacity: fade,
      }}
    >
      {spawns.map((s) => (
        <FloatingPrompt key={s.id} {...s} reduceMotion={reduceMotion} onDone={remove} />
      ))}
    </div>
  );
}

/**
 * Landing onboarding — a scroll-driven narrative. The hero title docks to the
 * top as you scroll, an intro line narrates, then a swipeable carousel of every
 * confession (plus its transcription and an EXPLORE CTA) rises in. Entering
 * carries the selected image + category into the archive.
 */
export default function LandingReveal({ onEnter, backgroundImageSrcs = [], categories }) {
  const reduceMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const [slideIdx, setSlideIdx] = useState(0);

  const scrollRef = useRef(null);
  const carouselRef = useRef(null);

  // Every confession note (one per archive category) — swipe through them all.
  const notes = useMemo(
    () => (categories?.length ? categories : FALLBACK_CATEGORIES),
    [categories]
  );

  // Active note = the centered/selected one. Mobile starts on the first card
  // (carousel scroll origin); desktop starts on the middle of the row.
  const [activeIdx, setActiveIdx] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches
      ? 0
      : Math.floor(((categories?.length || FALLBACK_CATEGORIES.length) - 1) / 2)
  );
  const active = notes[Math.min(activeIdx, notes.length - 1)] || notes[0];

  // Blurred confession-photo backdrop behind the hero.
  const inactive = useInactiveCardParams();
  const noiseEnabled = inactive.noise?.enabled ?? true;
  const inactiveFilter = [
    inactive.blur > 0 ? `blur(${inactive.blur}px)` : '',
    inactive.grayscale > 0 ? `grayscale(${inactive.grayscale})` : '',
    noiseEnabled ? `url(#${CARD_FILTER_ID})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const nBg = backgroundImageSrcs.length;
  /** Slightly dimmer than archive cards so the hero type stays dominant. */
  const slideshowOpacity = inactive.opacity * 0.6;

  // Crossfade through the photos behind the hero.
  useEffect(() => {
    if (reduceMotion || nBg <= 1) return;
    const id = window.setInterval(() => setSlideIdx((i) => (i + 1) % nBg), 2200);
    return () => window.clearInterval(id);
  }, [nBg, reduceMotion]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  /* ── Single scroll progress drives the whole storyboard. We mirror it into
        React state and compute every style from `p` so the reveals are simple,
        predictable numbers (no scattered flags). ── */
  const { scrollYProgress } = useScroll({ target: scrollRef, offset: ['start start', 'end end'] });
  const [p, setP] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => setP(v));

  // ── Launch sequence ───────────────────────────────────────────────
  // One stage integer drives the whole entrance (no scattered flags):
  //   1 = background letter in (FIRST) · 2 = title reveal + subtitle in ·
  //   3 = scroll arrow in
  // Stages 1–2 run on mount timers; the title (gated to start at stage 2 via
  // `revealGate`) fires onRevealComplete when its word-by-word reveal lands,
  // which advances to the arrow. A fallback timer covers a missed signal.
  // prefers-reduced-motion shows everything at once.
  const [launchStage, setLaunchStage] = useState(reduceMotion ? 3 : 0);
  const bumpStage = useCallback((to) => setLaunchStage((s) => (s < to ? to : s)), []);
  const revealArrow = useCallback(() => bumpStage(3), [bumpStage]);
  useEffect(() => {
    if (reduceMotion) {
      setLaunchStage(3);
      return undefined;
    }
    const timers = [
      setTimeout(() => bumpStage(1), LAUNCH.letterMs),
      setTimeout(() => bumpStage(2), LAUNCH.titleMs),
      setTimeout(() => bumpStage(3), LAUNCH.arrowFallbackMs),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduceMotion, bumpStage]);

  const dockScale = isMobile ? TITLE.dockScaleMobile : TITLE.dockScaleDesktop;
  const titleScale = track(p, BEATS.titleDock, TITLE.heroScale, dockScale);
  const titleY = track(p, BEATS.titleDock, TITLE.heroY, TITLE.dockY); // vh
  const cueOpacity = track(p, BEATS.cueOut, 0.7, 0);
  const bodyOpacity = track(p, BEATS.bodyOut, 1, 0);
  const bgOpacity = track(p, BEATS.bgOut, 1, 0);
  const introOpacity =
    p < BEATS.introOut[0] ? track(p, BEATS.introIn, 0, 1) : track(p, BEATS.introOut, 1, 0);
  const introY = track(p, BEATS.introIn, 16, 0);
  const noteOpacity = track(p, BEATS.noteIn, 0, 1);
  const noteY = track(p, BEATS.noteIn, 28, 0);
  const exploreOpacity = track(p, BEATS.exploreIn, 0, 1);

  // The carousel + CTA only become interactive once they're basically on screen.
  const noteReady = p >= BEATS.noteIn[0] + 0.04;

  // Enter the archive, handing off the selected image's exact on-screen rect so
  // it can stay put (same size/position) while the dial rises underneath.
  const handleEnter = () => {
    if (!noteReady) return;
    const slides = carouselRef.current?.querySelectorAll('[data-note-slide]');
    const slide = slides && slides[Math.min(activeIdx, slides.length - 1)];
    const img = slide?.querySelector('[data-note-img]') || slide;
    const rect = img?.getBoundingClientRect();
    onEnter(
      active?.key,
      active?.image,
      rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null
    );
  };

  const exploreLabel = (active?.label || '').toUpperCase();

  return (
    <motion.div
      key="landing"
      ref={scrollRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.55, ease: 'easeIn' } }}
      transition={{ duration: 0.6, ease }}
      style={{
        position: 'relative',
        height: `${SCROLL_LENGTH_VH}vh`,
        background: '#010000',
      }}
    >
      {/* Sticky stage — everything animates within this pinned 100vh frame.
          Neutral near-black backdrop with a faint charcoal lift behind the hero
          title, fading to black at the edges (Figma 172-37). */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'hidden',
          background: NOISE_GRADIENT,
        }}
      >
        {/* Flashing confession photos behind the hero (dim away on scroll). */}
        {nBg > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              opacity: bgOpacity,
            }}
          >
            <CardNoiseFilterDefs params={inactive} />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: launchStage >= 1 ? 1 : 0 }}
              transition={{ duration: reduceMotion ? 0 : LETTER.fadeS, ease }}
              style={{ position: 'relative', width: 'min(92vw, 760px)', height: '70vh', maxHeight: '70vh' }}
            >
              <AnimatePresence>
                <LandingBackgroundSlide
                  key={`${slideIdx % nBg}-${backgroundImageSrcs[slideIdx % nBg]}`}
                  src={backgroundImageSrcs[slideIdx % nBg]}
                  slideshowOpacity={slideshowOpacity}
                  reduceMotion={reduceMotion}
                  inactiveFilter={inactiveFilter}
                  inactiveScale={inactive.scale}
                />
              </AnimatePresence>
            </motion.div>
          </div>
        )}

        {/* Readability wash so type stays legible over the photos. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse 85% 75% at 50% 42%, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.48) 55%, rgba(0,0,0,0.78) 100%)',
          }}
        />

        {/* Full-viewport grain. */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, isolation: 'isolate', pointerEvents: 'none' }}>
          <TunableGrainBackground opacityScale={GRAIN_OPACITY_SCALE} />
        </div>

        {/* Ambient chatbot prompts drifting up behind the hero — only during the
            hero, dimming with the backdrop as you scroll into the narrative. */}
        <FloatingPrompts active={launchStage >= 1 && p < 0.32} reduceMotion={reduceMotion} fade={bgOpacity} />

        {/* Hero title — docks to the top as you scroll. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            transformOrigin: 'center top',
            transform: `translateY(${titleY}vh) scale(${titleScale})`,
            zIndex: 6,
            pointerEvents: 'none',
          }}
        >
          <FontDecayTitle
            text={isMobile ? MOBILE_TITLE_TEXT : 'What We Tell AI'}
            maxWidthPx={isMobile ? 360 : 2000}
            glow={false}
            centerLines={isMobile}
            lineGap={1.12}
            revealStaggerMs={reduceMotion ? 0 : TITLE_REVEAL.staggerMs}
            revealDurationMs={TITLE_REVEAL.fadeMs}
            revealGate={launchStage >= 2}
            onRevealComplete={revealArrow}
          />
        </div>

        {/* Hero subtitle — fades in only after the title's word-by-word reveal
            lands (outer motion.div), then fades out as you scroll (inner <p>'s
            scroll-linked opacity; nested opacity multiplies the two phases,
            which never overlap in time). */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: launchStage >= 2 ? 1 : 0 }}
          transition={{ duration: reduceMotion ? 0 : SUBTEXT.fadeS, ease }}
          style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}
        >
          <p
            style={{
              position: 'absolute',
              // Sits clear below the (taller, two-line) mobile title — the title
              // rests at heroY (14vh) and is ~170px tall, so we start the subtitle
              // low enough to never collide, with a margin on small screens.
              top: 'clamp(310px, 43vh, 440px)',
              left: 0,
              right: 0,
              margin: '0 auto',
              maxWidth: 560,
              padding: '0 24px',
              fontFamily: SERIF,
              fontStyle: 'italic',
              fontSize: 'clamp(16px, 2.2vw, 22px)',
              fontWeight: 400,
              lineHeight: 1.45,
              letterSpacing: '0.02em',
              color: 'rgba(229, 229, 229, 0.8)',
              textAlign: 'center',
              opacity: bodyOpacity,
              visibility: bodyOpacity <= 0.01 ? 'hidden' : 'visible',
              pointerEvents: 'none',
            }}
          >
            Anonymous confessions about AI&rsquo;s
            <br /> presence in our intimate lives
          </p>
        </motion.div>

        {/* Intro narration — a grainy cube fades in above the line, then the
            whole group fades back out mid-scroll. Both share the introOpacity /
            introY beat (BEATS.introIn → introOut) so they read as one unit. */}
        <div
          style={{
            position: 'absolute',
            top: '42%',
            left: 0,
            right: 0,
            margin: '0 auto',
            maxWidth: 640,
            padding: '0 28px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(20px, 4.5vh, 44px)',
            zIndex: 4,
            opacity: introOpacity,
            visibility: introOpacity <= 0.01 ? 'hidden' : 'visible',
            transform: `translate(0, calc(-50% + ${introY}px))`,
            pointerEvents: 'none',
          }}
        >
          {/* The cube's black backdrop is pre-baked to transparent (alpha =
              luminance) so it composites cleanly over the hero gradient — a CSS
              `screen` blend would be isolated by this wrapper's opacity/z-index
              stacking context and leave a hard black rectangle. */}
          <img
            src="/intro-cube-glow.png"
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              display: 'block',
              width: 'clamp(160px, 24vw, 260px)',
              height: 'auto',
              aspectRatio: '1024 / 948',
            }}
          />
          <p
            style={{
              margin: 0,
              fontFamily: SERIF,
              fontStyle: 'italic',
              fontSize: 'clamp(18px, 2.6vw, 24px)',
              fontWeight: 400,
              lineHeight: 1.5,
              letterSpacing: '0.02em',
              color: 'rgba(229, 229, 229, 0.92)',
              textAlign: 'center',
            }}
          >
            {INTRO_LINE}
          </p>
        </div>

        {/* Note carousel + transcription + EXPLORE — rise in together near the
            end of the scroll. Swipe/click between every confession. */}
        <div
          style={{
            position: 'absolute',
            top: 'clamp(96px, 16vh, 200px)',
            left: 0,
            right: 0,
            bottom: 'clamp(28px, 5vh, 64px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            zIndex: 5,
            opacity: noteOpacity,
            visibility: noteOpacity <= 0.01 ? 'hidden' : 'visible',
            transform: `translateY(${noteY}px)`,
            pointerEvents: 'none',
          }}
        >
          <CardNoiseFilterDefs params={inactive} />
          <LandingNotes
            notes={notes}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            isMobile={isMobile}
            reduceMotion={reduceMotion}
            inactiveFilter={inactiveFilter}
            inactiveParams={inactive}
            interactive={noteReady}
            carouselRef={carouselRef}
          />

          {/* Active transcription. */}
          <div style={{ minHeight: 64, width: 'clamp(240px, 84vw, 380px)' }}>
            <AnimatePresence mode="wait">
              {active?.teaser ? (
                <motion.p
                  key={active.key}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.32, ease }}
                  style={{
                    margin: 0,
                    fontFamily: SERIF,
                    fontStyle: 'italic',
                    fontSize: 'clamp(14px, 1.7vw, 17px)',
                    lineHeight: 1.5,
                    letterSpacing: '0.01em',
                    color: 'rgba(229, 229, 229, 0.82)',
                    textAlign: 'center',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {active.teaser}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>

          {/* EXPLORE <CATEGORY> — mono, all caps; uses the selected note. */}
          <button
            onClick={handleEnter}
            style={{
              padding: '12px 26px',
              background: 'transparent',
              border: 'none',
              color: '#e5e5e5',
              cursor: noteReady ? 'pointer' : 'default',
              fontFamily: MONO,
              fontSize: 14,
              fontWeight: 400,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              textAlign: 'center',
              lineHeight: 1.7,
              whiteSpace: 'nowrap',
              opacity: exploreOpacity,
              pointerEvents: noteReady ? 'auto' : 'none',
            }}
          >
            Explore
            <br />
            <span style={{ color: '#ffffff' }}>&ldquo;{exploreLabel}&rdquo;</span>
          </button>
        </div>

        {/* Scroll cue — fades in last (stage 3), bounces, then fades out as you
            scroll. Entrance opacity (motion.div) multiplies the scroll-linked
            fade-out (inner span's cueOpacity); the two never overlap in time. */}
        <motion.div
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: launchStage >= 3 ? 1 : 0 }}
          transition={{ duration: reduceMotion ? 0 : ARROW.fadeS, ease }}
          style={{
            position: 'absolute',
            bottom: 'clamp(36px, 9vh, 84px)',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily: MONO,
            fontSize: 30,
            lineHeight: 1,
            color: 'rgba(229, 229, 229, 0.7)',
            zIndex: 6,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              opacity: cueOpacity,
              visibility: cueOpacity <= 0.01 ? 'hidden' : 'visible',
            }}
          >
            <motion.span
              animate={reduceMotion ? undefined : { y: [0, 8, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              style={{ display: 'inline-block' }}
            >
              &darr;
            </motion.span>
          </span>
        </motion.div>
      </div>
    </motion.div>
  );
}
