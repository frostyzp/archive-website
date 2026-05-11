import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const EMOTIONS = [
  { id: 'refusal', label: 'Refusal', gradient: 'linear-gradient(to top, #1a1a1a, #111 70%)' },
  { id: 'harm', label: 'Harm', gradient: 'linear-gradient(to top, #4a1a1a, #111 70%)' },
  { id: 'therapist', label: 'Therapist', gradient: 'linear-gradient(to top, #2a1a4a, #111 70%)' },
  { id: 'love', label: 'Love', gradient: 'linear-gradient(to top, #4a1a2e, #111 70%)' },
  { id: 'family', label: 'Family', gradient: 'linear-gradient(to top, #1a3a3a, #111 70%)' },
  { id: 'ghostwriter', label: 'Ghostwriter', gradient: 'linear-gradient(to top, #4a3a1a, #111 70%)' },
];

const NOTES = [
  '/notes/AC_006.png',
  '/notes/AC_007%201.png',
  '/notes/AC_063.png',
  '/notes/AC_141.png',
];
const CARDS_PER_THEME = NOTES.length;

// cubic-bezier(0.86, 0, 0.07, 1) — Newton-Raphson solver for snap easing.
function makeCubicBezier(x1, y1, x2, y2) {
  const bx = (t) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  const dx = (t) =>
    3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const slope = dx(t);
      if (Math.abs(slope) < 1e-6) break;
      const xt = bx(t) - x;
      if (Math.abs(xt) < 1e-6) break;
      t -= xt / slope;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    return by(t);
  };
}
const SNAP_EASE = makeCubicBezier(0.86, 0, 0.07, 1);

// Easing + duration for the JS-driven card carousel snap-back. Native CSS
// scroll-snap doesn't expose timing controls, so the carousel below disables
// it and animates `scrollLeft` manually.
const CARD_SNAP_EASE = makeCubicBezier(0.65, 0.05, 0.36, 1);
const CARD_SNAP_DURATION = 520;
const CARD_SNAP_DEBOUNCE = 120;

/* ── Compass Dial (Canvas 2D) ──────────────────── */

function CompassDial({ emotions, activeEmotion, onEmotionChange }) {
  const canvasRef = useRef(null);
  const currentAngleRef = useRef(0);
  const rafRef = useRef(null);
  const snapAnimRef = useRef(null);
  const snapTimerRef = useRef(null);

  const SIZE = 440;
  const R = SIZE / 2 - 16;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const step = (Math.PI * 2) / emotions.length;

  // Refs so draw/handleWheel can stay stable across renders.
  const emotionsRef = useRef(emotions);
  const activeEmotionRef = useRef(activeEmotion);
  const onEmotionChangeRef = useRef(onEmotionChange);
  emotionsRef.current = emotions;
  activeEmotionRef.current = activeEmotion;
  onEmotionChangeRef.current = onEmotionChange;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== SIZE * dpr || canvas.height !== SIZE * dpr) {
      canvas.width = SIZE * dpr;
      canvas.height = SIZE * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const angle = currentAngleRef.current;
    const emos = emotionsRef.current;
    const active = activeEmotionRef.current;
    const localStep = (Math.PI * 2) / emos.length;

    emos.forEach((_, i) => {
      const dividerAngle = angle + i * localStep - Math.PI / 2 + localStep / 2;
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.lineTo(
        CX + Math.cos(dividerAngle) * R * 0.95,
        CY + Math.sin(dividerAngle) * R * 0.95,
      );
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    emos.forEach((emo, i) => {
      const a = angle + i * localStep - Math.PI / 2;
      const isActive = emo.id === active;
      const labelR = R * 0.55;
      const lx = CX + Math.cos(a) * labelR;
      const ly = CY + Math.sin(a) * labelR;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(a + Math.PI / 2);
      ctx.font = isActive
        ? "600 22px 'News Plantin', Georgia, serif"
        : "400 19px 'News Plantin', Georgia, serif";
      ctx.fillStyle = isActive ? '#e5e5e5' : 'rgba(255,255,255,0.28)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emo.label, 0, 0);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(CX, CY, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();
  }, []);

  // Repaint when active label changes (so the highlight updates mid-snap).
  useEffect(() => {
    draw();
  }, [activeEmotion, draw]);

  const animateTo = useCallback(
    (target, duration = 250) => {
      if (snapAnimRef.current) cancelAnimationFrame(snapAnimRef.current);
      const start = currentAngleRef.current;
      const distance = target - start;
      if (Math.abs(distance) < 1e-4) return;
      const startTime = performance.now();

      const tick = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        currentAngleRef.current = start + distance * SNAP_EASE(progress);
        draw();
        if (progress < 1) {
          snapAnimRef.current = requestAnimationFrame(tick);
        } else {
          snapAnimRef.current = null;
        }
      };

      snapAnimRef.current = requestAnimationFrame(tick);
    },
    [draw]
  );

  const snapToIndex = useCallback(
    (idx) => {
      const emos = emotionsRef.current;
      const localStep = (Math.PI * 2) / emos.length;
      const baseTarget = -(idx * localStep);
      const start = currentAngleRef.current;
      const TWO_PI = Math.PI * 2;
      const target = baseTarget + Math.round((start - baseTarget) / TWO_PI) * TWO_PI;

      animateTo(target);
      onEmotionChangeRef.current(emos[idx].id);
    },
    [animateTo]
  );

  const snapToNearest = useCallback(() => {
    const emos = emotionsRef.current;
    const localStep = (Math.PI * 2) / emos.length;
    const raw = currentAngleRef.current;
    const normalized = (((-raw) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.round(normalized / localStep) % emos.length;
    snapToIndex(idx);
  }, [snapToIndex]);

  // Refs so listeners stay stable.
  const snapToNearestRef = useRef(snapToNearest);
  const snapToIndexRef = useRef(snapToIndex);
  snapToNearestRef.current = snapToNearest;
  snapToIndexRef.current = snapToIndex;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e) => {
      e.preventDefault();
      if (snapAnimRef.current) {
        cancelAnimationFrame(snapAnimRef.current);
        snapAnimRef.current = null;
      }
      const sensitivity = 0.003;
      currentAngleRef.current += e.deltaY * sensitivity;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);

      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      snapTimerRef.current = setTimeout(() => snapToNearestRef.current(), 150);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (snapAnimRef.current) cancelAnimationFrame(snapAnimRef.current);
    };
  }, [draw]);

  const handleClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = SIZE / rect.width;
    const scaleY = SIZE / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const dx = cx - CX;
    const dy = cy - CY;
    const dist = Math.hypot(dx, dy);
    if (dist > R || dist < R * 0.15) return; // ignore center / outside

    const emos = emotionsRef.current;
    const localStep = (Math.PI * 2) / emos.length;
    // Label i is drawn at canvas angle = current + i*step - π/2.
    // Solve for i given the click's canvas-space angle.
    const clickAngle = Math.atan2(dy, dx);
    const rel = clickAngle - currentAngleRef.current + Math.PI / 2;
    const idx = ((Math.round(rel / localStep) % emos.length) + emos.length) % emos.length;
    snapToIndexRef.current(idx);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{
        width: 440,
        height: 440,
        cursor: 'pointer',
        touchAction: 'none',
      }}
    />
  );
}

/* ── Cards Carousel ────────────────────────────── */

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
  exit: {
    transition: { staggerChildren: 0.04, staggerDirection: -1 },
  },
};

const cardVariants = {
  hidden: {
    opacity: 0,
    scale: 0.7,
    transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.32, ease: [0, 0, 0.2, 1] },
  },
  exit: {
    opacity: 0,
    scale: 0.7,
    transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
  },
};

function CardCarousel({ activeEmotion }) {
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // RAF id for the in-flight snap-back animation, debounce timer for scroll-
  // end detection, and a flag so our own scrollLeft writes don't retrigger
  // snap on the next `scroll` event.
  const snapAnimRef = useRef(null);
  const snapTimerRef = useRef(null);
  const isSnappingRef = useRef(false);

  // Test: reverse the order of notes for the Ghostwriter category.
  const notes = activeEmotion === 'ghostwriter' ? [...NOTES].reverse() : NOTES;

  const findClosestIndex = (el) => {
    const cards = el.querySelectorAll('[data-card]');
    const containerCenter = el.scrollLeft + el.offsetWidth / 2;
    let closest = 0;
    let closestDist = Infinity;
    cards.forEach((card, i) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(containerCenter - cardCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    return { index: closest, cards };
  };

  const cancelSnap = () => {
    if (snapAnimRef.current) {
      cancelAnimationFrame(snapAnimRef.current);
      snapAnimRef.current = null;
    }
    if (snapTimerRef.current) {
      clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
    }
    isSnappingRef.current = false;
  };

  const animateScrollTo = (el, targetLeft, duration) => {
    const startLeft = el.scrollLeft;
    const distance = targetLeft - startLeft;
    if (Math.abs(distance) < 0.5) return;
    const startTime = performance.now();
    isSnappingRef.current = true;

    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      el.scrollLeft = startLeft + distance * CARD_SNAP_EASE(progress);
      if (progress < 1) {
        snapAnimRef.current = requestAnimationFrame(tick);
      } else {
        snapAnimRef.current = null;
        isSnappingRef.current = false;
      }
    };

    snapAnimRef.current = requestAnimationFrame(tick);
  };

  const scheduleSnap = () => {
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const { index, cards } = findClosestIndex(el);
      const card = cards[index];
      if (!card) return;
      const target = card.offsetLeft + card.offsetWidth / 2 - el.offsetWidth / 2;
      animateScrollTo(el, target, CARD_SNAP_DURATION);
    }, CARD_SNAP_DEBOUNCE);
  };

  useEffect(() => {
    cancelSnap();
    setActiveIndex(0);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ left: 0, behavior: 'instant' });
    }
  }, [activeEmotion]);

  useEffect(() => () => cancelSnap(), []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { index } = findClosestIndex(el);
    setActiveIndex(index);
    // Don't re-arm the snap while our own animation is driving scrollLeft.
    if (isSnappingRef.current) return;
    scheduleSnap();
  };

  // User starts a new gesture → kill any pending/in-flight snap so we don't
  // fight their input.
  const handlePointerDown = () => cancelSnap();
  const handleWheel = () => {
    if (isSnappingRef.current) cancelSnap();
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeEmotion || 'all'}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={containerVariants}
        ref={scrollRef}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onTouchStart={handlePointerDown}
        onWheel={handleWheel}
        style={st.scrollContainer}
      >
        {Array.from({ length: CARDS_PER_THEME }, (_, i) => {
          const isActive = i === activeIndex;
          return (
            <motion.div
              key={i}
              data-card
              variants={cardVariants}
              style={st.cardWrapper}
            >
              <img
                src={notes[i % notes.length]}
                alt="confession"
                style={{
                  ...st.cardImg,
                  opacity: isActive ? 1 : 0.4,
                  transform: `scale(${isActive ? 1.12 : 0.9})`,
                  filter: isActive ? 'none' : 'blur(4px)',
                }}
              />
            </motion.div>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Main Component ────────────────────────────── */

export default function DialDemo() {
  const [activeEmotion, setActiveEmotion] = useState(EMOTIONS[0].id);
  const activeData = EMOTIONS.find((e) => e.id === activeEmotion);

  return (
    <div style={st.root}>
      {/* Background gradient — crossfades between categories */}
      <AnimatePresence>
        <motion.div
          key={activeEmotion}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          style={{
            ...st.bgGradient,
            background: activeData.gradient,
          }}
        />
      </AnimatePresence>
      {/* Index numbers */}
      <div style={st.pageNumbers}>
        {EMOTIONS.map((e, i) => (
          <span
            key={e.id}
            style={{
              ...st.pageNum,
              opacity: e.id === activeEmotion ? 1 : 0.25,
              fontWeight: e.id === activeEmotion ? 700 : 400,
            }}
          >
            {i + 12}
          </span>
        ))}
      </div>

      {/* Scrollable cards */}
      <div style={st.cardsArea}>
        <CardCarousel activeEmotion={activeEmotion} />
      </div>

      {/* Canvas compass dial — only top half visible */}
      <div style={st.dialClip}>
        <CompassDial
          emotions={EMOTIONS}
          activeEmotion={activeEmotion}
          onEmotionChange={setActiveEmotion}
        />
      </div>
    </div>
  );
}

/* ── Styles ───────────────────────────────────── */

const st = {
  root: {
    width: '100%',
    height: '100%',
    minHeight: '100vh',
    background: '#111',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
    fontFamily: 'var(--font-primary, system-ui, sans-serif)',
  },
  bgGradient: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
  },

  pageNumbers: {
    display: 'flex',
    gap: 14,
    paddingTop: 60,
    zIndex: 10,
  },
  pageNum: {
    fontSize: 13,
    color: '#fff',
    letterSpacing: '0.5px',
    cursor: 'default',
    transition: 'opacity 0.3s',
  },

  cardsArea: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    zIndex: 1,
  },
  scrollContainer: {
    display: 'flex',
    gap: 20,
    overflowX: 'auto',
    overflowY: 'hidden',
    // Native scroll-snap is disabled — JS handles snap-back so we can use a
    // custom cubic-bezier and a longer, more deliberate duration.
    scrollSnapType: 'none',
    width: '100%',
    padding: '40px 0',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    paddingLeft: 'calc(50% - 280px)',
    paddingRight: 'calc(50% - 280px)',
  },
  cardWrapper: {
    flexShrink: 0,
    width: 560,
  },
  cardImg: {
    width: '100%',
    height: 'auto',
    display: 'block',
    transition: 'opacity 0.35s ease, transform 0.35s ease, filter 0.35s ease',
    pointerEvents: 'none',
  },

  dialClip: {
    width: 440,
    height: 220,
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
    zIndex: 10,
    marginBottom: 0,
  },
};
