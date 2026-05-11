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

const SIZE = 440;

// cubic-bezier(0.86, 0, 0.07, 1) — solves for t given x via Newton-Raphson,
// then evaluates y(t).
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

/* ── Side Compass Dial ─────────────────────────── */
// Same logic as the top-mounted dial, but the "active direction" points LEFT
// (toward the cards) instead of UP. Visual offset = +π instead of −π/2.

function SideCompassDial({ emotions, activeEmotion, onEmotionChange }) {
  const canvasRef = useRef(null);
  const currentAngleRef = useRef(0);
  const rafRef = useRef(null);
  const snapAnimRef = useRef(null);
  const snapTimerRef = useRef(null);

  const R = SIZE / 2 - 16;
  const CX = SIZE / 2;
  const CY = SIZE / 2;

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
    const offset = Math.PI; // active label points LEFT

    emos.forEach((_, i) => {
      const dividerAngle = angle + i * localStep + offset + localStep / 2;
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
      const a = angle + i * localStep + offset;
      const isActive = emo.id === active;
      // Anchor radius: the right edge of each label sits here; body extends
      // outward toward the dial perimeter. Smaller value = right edge sits
      // closer to the dial center.
      const labelR = R * 0.25;
      const lx = CX + Math.cos(a) * labelR;
      const ly = CY + Math.sin(a) * labelR;
      ctx.save();
      ctx.translate(lx, ly);
      // Rotate so the active label (at a = π, left side) reads horizontally;
      // others rotate radially around the dial.
      ctx.rotate(a - Math.PI);
      ctx.font = isActive
        ? "600 22px 'News Plantin', Georgia, serif"
        : "400 19px 'News Plantin', Georgia, serif";
      ctx.fillStyle = isActive ? '#e5e5e5' : 'rgba(255,255,255,0.28)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(emo.label, 0, 0);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(CX, CY, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();
  }, []);

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
      // cubic-bezier(0.86, 0, 0.07, 1)
      const ease = SNAP_EASE;

      const tick = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        currentAngleRef.current = start + distance * ease(progress);
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
    if (dist > R || dist < R * 0.15) return;

    const emos = emotionsRef.current;
    const localStep = (Math.PI * 2) / emos.length;
    const clickAngle = Math.atan2(dy, dx);
    const rel = clickAngle - currentAngleRef.current - Math.PI;
    const idx = ((Math.round(rel / localStep) % emos.length) + emos.length) % emos.length;
    snapToIndexRef.current(idx);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{
        width: SIZE,
        height: SIZE,
        cursor: 'pointer',
        touchAction: 'none',
        position: 'absolute',
        left: 0,
        top: 0,
      }}
    />
  );
}

/* ── Vertical Cards Stack ──────────────────────── */

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
  exit: { transition: { staggerChildren: 0.04, staggerDirection: -1 } },
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

function VerticalCardStack({ activeEmotion }) {
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Test: reverse the order of notes for the Ghostwriter category.
  const notes = activeEmotion === 'ghostwriter' ? [...NOTES].reverse() : NOTES;

  useEffect(() => {
    setActiveIndex(0);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [activeEmotion]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const cards = el.querySelectorAll('[data-card]');
    const containerCenter = el.scrollTop + el.offsetHeight / 2;
    let closest = 0;
    let closestDist = Infinity;
    cards.forEach((card, i) => {
      const cardCenter = card.offsetTop + card.offsetHeight / 2;
      const dist = Math.abs(containerCenter - cardCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setActiveIndex(closest);
  };

  const scrollToIndex = (i) => {
    const el = scrollRef.current;
    if (!el) return;
    const cards = el.querySelectorAll('[data-card]');
    const card = cards[i];
    if (!card) return;
    const target = card.offsetTop + card.offsetHeight / 2 - el.offsetHeight / 2;
    el.scrollTo({ top: target, behavior: 'smooth' });
    setActiveIndex(i);
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
        style={st.scrollContainer}
      >
        {Array.from({ length: CARDS_PER_THEME }, (_, i) => {
          const isActive = i === activeIndex;
          return (
            <motion.div
              key={i}
              data-card
              variants={cardVariants}
              onClick={() => scrollToIndex(i)}
              style={{
                ...st.cardWrapper,
                cursor: isActive ? 'default' : 'pointer',
              }}
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

export default function DialDemoV4() {
  const [activeEmotion, setActiveEmotion] = useState(EMOTIONS[0].id);
  const activeData = EMOTIONS.find((e) => e.id === activeEmotion);

  return (
    <div style={st.root}>
      <AnimatePresence>
        <motion.div
          key={activeEmotion}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          style={{ ...st.bgGradient, background: activeData.gradient }}
        />
      </AnimatePresence>

      {/* Vertical stack of cards on the left */}
      <div style={st.cardsArea}>
        <VerticalCardStack activeEmotion={activeEmotion} />
      </div>

      {/* Dial pinned middle-right; only its left half is visible */}
      <div style={st.dialClip}>
        <SideCompassDial
          emotions={EMOTIONS}
          activeEmotion={activeEmotion}
          onEmotionChange={setActiveEmotion}
        />
      </div>
    </div>
  );
}

const st = {
  root: {
    width: '100%',
    height: '100%',
    minHeight: '100vh',
    background: '#111',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: 'var(--font-primary, system-ui, sans-serif)',
  },
  bgGradient: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
  },
  cardsArea: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'center',
    zIndex: 1,
  },
  scrollContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollSnapType: 'y mandatory',
    width: '100%',
    height: '100%',
    paddingTop: 'calc(50vh - 160px)',
    paddingBottom: 'calc(50vh - 160px)',
    alignItems: 'center',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  cardWrapper: {
    flexShrink: 0,
    width: 320,
    scrollSnapAlign: 'center',
  },
  cardImg: {
    width: '100%',
    height: 'auto',
    display: 'block',
    transition: 'opacity 0.35s ease, transform 0.35s ease, filter 0.35s ease',
    pointerEvents: 'none',
  },
  // Right-edge clip: shows only the LEFT half of the canvas, so the dial
  // appears to come out of the right side of the page.
  dialClip: {
    position: 'absolute',
    top: '50%',
    right: 0,
    transform: 'translateY(-50%)',
    width: SIZE / 2,
    height: SIZE,
    overflow: 'hidden',
    zIndex: 10,
  },
};
