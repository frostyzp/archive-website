import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion, useScroll, useMotionValueEvent } from 'motion/react';
import {
  TunableGrainBackground,
  GRAIN_OPACITY_SCALE,
  CardNoiseFilterDefs,
  CARD_FILTER_ID,
  useInactiveCardParams,
} from './noise';
import FontDecayTitle from './FontDecayTitle';

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
 *  24–42%  "We asked strangers to share an anonymous confession
 *           about the way they've interacted with AI." fades in
 *  54–64%  …that intro line fades back out
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
const SERIF = "'Reckless Italic', 'News Plantin', Georgia, serif";
const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

/** On narrow screens the hero title stacks onto two centered lines. */
const MOBILE_MQ = '(max-width: 760px)';
const MOBILE_TITLE_TEXT = 'What We\nTell AI';
/** Per-line typeface: "What We" lighter redaction, "Tell AI" heavier. */
const MOBILE_TITLE_FONTS = ['Redaction 35', 'Redaction 50'];

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
function NoteCard({ note, isActive, reduceMotion, inactiveFilter, inactiveParams, onSelect, fill }) {
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
        transition: reduceMotion ? 'none' : 'transform 0.34s cubic-bezier(0.22,1,0.36,1)',
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
            objectFit: 'contain',
            borderRadius: 2,
            opacity: isActive ? 1 : sideOpacity,
            filter: isActive ? 'none' : inactiveFilter || 'none',
            transition: reduceMotion ? 'none' : 'opacity 0.34s ease, filter 0.34s ease',
            boxShadow: isActive ? '0 18px 44px rgba(0,0,0,0.55)' : '0 10px 26px rgba(0,0,0,0.45)',
          }}
        />
      ) : (
        <div
          data-note-img
          style={{
            width: '100%',
            aspectRatio: '3 / 4',
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
        gap: 22,
        flexWrap: 'wrap',
        maxWidth: 'min(92vw, 900px)',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      {notes.map((note, i) => (
        <div key={note.key} data-note-slide>
          <NoteCard
            note={note}
            isActive={activeIdx === i}
            reduceMotion={reduceMotion}
            inactiveFilter={inactiveFilter}
            inactiveParams={inactiveParams}
            onSelect={() => setActiveIdx(i)}
          />
        </div>
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

  // The hero subtitle holds back until the title's word-by-word reveal lands —
  // FontDecayTitle calls onRevealComplete when it finishes. A fallback timer
  // guarantees the subtitle still appears if that signal never arrives.
  const [titleRevealed, setTitleRevealed] = useState(false);
  useEffect(() => {
    if (titleRevealed) return;
    const t = window.setTimeout(() => setTitleRevealed(true), 2600);
    return () => window.clearTimeout(t);
  }, [titleRevealed]);

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
        background: '#060509',
      }}
    >
      {/* Sticky stage — everything animates within this pinned 100vh frame. */}
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
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
            <div style={{ position: 'relative', width: 'min(92vw, 760px)', height: '70vh', maxHeight: '70vh' }}>
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
            </div>
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
              'radial-gradient(ellipse 85% 75% at 50% 42%, rgba(6,5,9,0.34) 0%, rgba(6,5,9,0.66) 55%, rgba(6,5,9,0.86) 100%)',
          }}
        />

        {/* Full-viewport grain. */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, isolation: 'isolate', pointerEvents: 'none' }}>
          <TunableGrainBackground opacityScale={GRAIN_OPACITY_SCALE} />
        </div>

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
            maxWidthPx={isMobile ? 360 : 620}
            centerLines={isMobile}
            lineFonts={isMobile ? MOBILE_TITLE_FONTS : undefined}
            lineGap={1.12}
            revealStaggerMs={reduceMotion ? 0 : 90}
            revealDurationMs={620}
            onRevealComplete={() => setTitleRevealed(true)}
          />
        </div>

        {/* Hero subtitle — fades in only after the title's word-by-word reveal
            lands (outer motion.div), then fades out as you scroll (inner <p>'s
            scroll-linked opacity; nested opacity multiplies the two phases,
            which never overlap in time). */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: titleRevealed ? 1 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.7, ease }}
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

        {/* Intro narration — fades in then out mid-scroll. */}
        <p
          style={{
            position: 'absolute',
            top: '34%',
            left: 0,
            right: 0,
            margin: '0 auto',
            maxWidth: 640,
            padding: '0 28px',
            fontFamily: SERIF,
            fontStyle: 'italic',
            fontSize: 'clamp(18px, 2.6vw, 24px)',
            fontWeight: 400,
            lineHeight: 1.5,
            letterSpacing: '0.02em',
            color: 'rgba(229, 229, 229, 0.92)',
            textAlign: 'center',
            zIndex: 4,
            opacity: introOpacity,
            visibility: introOpacity <= 0.01 ? 'hidden' : 'visible',
            transform: `translateY(${introY}px)`,
            pointerEvents: 'none',
          }}
        >
          {INTRO_LINE}
        </p>

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

        {/* Scroll cue — bounces in the hero, fades once you start. */}
        <div
          aria-hidden="true"
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
            opacity: cueOpacity,
            visibility: cueOpacity <= 0.01 ? 'hidden' : 'visible',
            pointerEvents: 'none',
          }}
        >
          <motion.span
            animate={reduceMotion ? undefined : { y: [0, 8, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            style={{ display: 'inline-block' }}
          >
            &darr;
          </motion.span>
        </div>
      </div>
    </motion.div>
  );
}
