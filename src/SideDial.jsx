import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  CARD_FILTER_ID,
  CardNoiseFilterDefs,
  useInactiveCardParams,
} from './noise.jsx';

export const EMOTIONS = [
  { id: 'refusal', label: 'Refusal', gradient: 'linear-gradient(to left, #1a1a1a, #111 70%)' },
  { id: 'harm', label: 'Harm', gradient: 'linear-gradient(to left, #4a1a1a, #111 70%)' },
  { id: 'therapist', label: 'Therapist', gradient: 'linear-gradient(to left, #2a1a4a, #111 70%)' },
  { id: 'love', label: 'Love', gradient: 'linear-gradient(to left, #4a1a2e, #111 70%)' },
  { id: 'family', label: 'Family', gradient: 'linear-gradient(to left, #1a3a3a, #111 70%)' },
  { id: 'ghostwriter', label: 'Ghostwriter', gradient: 'linear-gradient(to left, #4a3a1a, #111 70%)' },
];

// Default canvas pixel size for the compass dials. The bottom dial in
// App.jsx overrides this via the `size` prop to take up more viewport room.
const SIZE = 440;

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
const SNAP_EASE = makeCubicBezier(0.77, 0, 0.18, 1);

// Intro spin: how far the dial is "wound up" before settling, and how long
// it takes to unwind into its resting orientation on first mount.
//
// Sequence: the spin starts IMMEDIATELY on mount (delay = 0) while the
// dial is still invisible (opacity 0). The wrapping motion.div in App.jsx
// then fades the dial in after a short delay, so the user sees the dial
// appear *mid-spin* and ride the rest of the rotation into place. Standard
// ease-out-quart curve so the spin decelerates as it settles.
const INTRO_SPIN_TURNS = 1.25;
const INTRO_SPIN_DURATION = 1300;
const INTRO_SPIN_START_DELAY = 0;
const INTRO_SPIN_EASE = makeCubicBezier(0.165, 0.84, 0.44, 1);

/* ── Bottom Compass Dial ───────────────────────── */

// Active-state fade duration (ms). The label color, alpha and size all
// interpolate over this window when the active emotion changes.
const LABEL_FADE_MS = 400;
// cubic-bezier(0.4, 0, 0.2, 1) — standard "ease" for color/alpha fades.
const LABEL_FADE_EASE = makeCubicBezier(0.4, 0, 0.2, 1);

/**
 * Compass dial pinned to the bottom of the viewport — only the top half is
 * visible (the parent clips it). The active label points straight UP and is
 * rendered horizontally; non-active labels rotate around it as the user
 * wheels the dial. Same interaction model as the side variant: scroll-wheel
 * + click + smooth snap to the nearest sector.
 */
export function BottomCompassDial({
  emotions,
  activeEmotion,
  onEmotionChange,
  size = SIZE,
  /** When set, thin radial spokes in the active dial sector (one per note in category). */
  breadcrumb = null,
}) {
  const canvasRef = useRef(null);
  const currentAngleRef = useRef(0);
  const rafRef = useRef(null);
  const snapAnimRef = useRef(null);
  const snapTimerRef = useRef(null);
  const pipAnimRafRef = useRef(null);
  const breadcrumbRef = useRef(breadcrumb);
  /** Smoothed outer endpoint radius (px) per category tick along each radial. */
  const pipRadialOuterRef = useRef([]);
  breadcrumbRef.current = breadcrumb;
  // Per-emotion "active progress" (0 = inactive, 1 = fully active). Animated
  // toward the target whenever activeEmotion changes so the highlight
  // crossfades over LABEL_FADE_MS instead of snapping instantly.
  const fadeProgressRef = useRef(new Map());
  const fadeAnimRef = useRef(null);

  // Margin scales with size so the divider lines don't crowd the rim at
  // larger sizes. The original 16px @ 440 ≈ 3.6%; use the same ratio.
  const R = size / 2 - Math.round(size * 0.036);
  const CX = size / 2;
  const CY = size / 2;
  // Labels sit on a circle of `labelR` from center. Pushed further out than
  // the side-dial original (0.32) so adjacent labels at larger sizes don't
  // crowd into each other.
  const LABEL_R_RATIO = 0.5;
  const labelR = R * LABEL_R_RATIO;
  // Font sizes are intentionally NOT scaled with `size` — the labels are
  // text content, not graphics, so they should stay at a comfortable
  // reading size regardless of how big the dial canvas gets. Otherwise
  // adjacent labels overlap badly at large sizes.
  const baseFontSize = 17;
  const fontSizeBoost = 2;
  // Show literally the top half of the canvas — classic half-disc-emerging-
  // from-the-bottom-edge look. Labels far from the active (rotating around
  // the bottom of the dial) get clipped intentionally; they swing into
  // view as the dial spins.
  const visibleHeight = size / 2;
  const canvasTopOffset = 0;

  const emotionsRef = useRef(emotions);
  const activeEmotionRef = useRef(activeEmotion);
  const onEmotionChangeRef = useRef(onEmotionChange);
  emotionsRef.current = emotions;
  activeEmotionRef.current = activeEmotion;
  onEmotionChangeRef.current = onEmotionChange;

  // Seed the fade map: the initial active emotion is fully highlighted, the
  // rest are fully inactive. Only runs once.
  if (fadeProgressRef.current.size === 0) {
    emotions.forEach((e) => {
      fadeProgressRef.current.set(e.id, e.id === activeEmotion ? 1 : 0);
    });
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    // Canvas is sized to the visible half-disc only (size × visibleHeight)
    // — the dial's geometric center sits at the bottom edge of the canvas
    // (CY = visibleHeight = size/2), so anything drawn below the center
    // would land outside the canvas and get naturally clipped. Keeps the
    // DOM/render footprint half the size of the original square canvas.
    if (canvas.width !== size * dpr || canvas.height !== visibleHeight * dpr) {
      canvas.width = size * dpr;
      canvas.height = visibleHeight * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, visibleHeight);

    const angle = currentAngleRef.current;
    const emos = emotionsRef.current;
    const active = activeEmotionRef.current;
    const localStep = (Math.PI * 2) / emos.length;
    const offset = -Math.PI / 2; // active label points UP
    const innerStart = R * 0.06;
    const dividerOuter = R * 0.48;
    const DIAL_SPOKE_GREY = 'rgba(160,160,160,0.45)';

    const bc = breadcrumbRef.current;
    const pipLens = pipRadialOuterRef.current;
    // Smoothed outer radius (px) along each pip's radial; inactive = short
    // spoke, active = modestly longer spoke (still grey, not full reach to label).
    const rStart = innerStart;
    const rSpan = Math.max(8, labelR - innerStart);
    const SHORT_R = rStart + rSpan * 0.18;
    const LONG_R = rStart + rSpan * 0.44;
    let pipNeedsFrame = false;
    if (bc && bc.total > 1) {
      const n = bc.total;
      if (pipLens.length !== n) {
        pipLens.length = n;
        for (let i = 0; i < n; i++) pipLens[i] = SHORT_R;
      }
      for (let i = 0; i < n; i++) {
        const target = i === bc.position ? LONG_R : SHORT_R;
        const cur = pipLens[i];
        const next = cur + (target - cur) * 0.2;
        pipLens[i] = next;
        if (Math.abs(target - next) > 0.45) pipNeedsFrame = true;
      }
    } else if (pipLens.length > 0) {
      pipLens.length = 0;
    }

    // Divider lines: start at a small inner radius (so the round caps
    // don't all stack on top of each other at exact center, which would
    // produce a visibly brighter blob) and extend to R * 0.54.
    emos.forEach((_, i) => {
      const dividerAngle = angle + i * localStep + offset + localStep / 2;
      ctx.beginPath();
      ctx.moveTo(
        CX + Math.cos(dividerAngle) * innerStart,
        CY + Math.sin(dividerAngle) * innerStart,
      );
      ctx.lineTo(
        CX + Math.cos(dividerAngle) * dividerOuter,
        CY + Math.sin(dividerAngle) * dividerOuter,
      );
      ctx.strokeStyle = DIAL_SPOKE_GREY;
      ctx.lineWidth = 4;
      // `round` line caps give the divider tips a soft semicircle finish
      // instead of a flat blunt edge, which matches the dial's organic
      // compass-needle aesthetic.
      ctx.lineCap = 'round';
      ctx.stroke();
    });

    // Within-category ticks: thin radial spokes in the active sector (same
    // origin as the dial dividers). Inactive = short grey spoke; active =
    // slightly longer grey spoke (no white highlight).
    if (bc && bc.total > 1) {
      const activeIdx = emos.findIndex((e) => e.id === active);
      if (activeIdx >= 0) {
        const thetaL = angle + activeIdx * localStep + offset - localStep / 2;
        const thetaSpan = localStep;
        const LINE_W = Math.max(1, size * 0.0024);
        for (let k = 0; k < bc.total; k++) {
          const t = (k + 0.5) / bc.total;
          const theta = thetaL + t * thetaSpan;
          const rx = Math.cos(theta);
          const ry = Math.sin(theta);
          const r1 = pipLens[k] ?? SHORT_R;
          const isOn = k === bc.position;
          ctx.beginPath();
          ctx.moveTo(CX + rx * rStart, CY + ry * rStart);
          ctx.lineTo(CX + rx * r1, CY + ry * r1);
          ctx.strokeStyle = isOn ? DIAL_SPOKE_GREY : 'rgba(118,118,118,0.4)';
          ctx.lineWidth = isOn ? LINE_W * 1.15 : LINE_W;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }
    }

    emos.forEach((emo, i) => {
      const a = angle + i * localStep + offset;
      const lx = CX + Math.cos(a) * labelR;
      const ly = CY + Math.sin(a) * labelR;
      // p ∈ [0,1] — current "activeness" of this label. Lerps font size,
      // color, and alpha between the inactive and active styles.
      const p = fadeProgressRef.current.get(emo.id) ?? (emo.id === active ? 1 : 0);
      const fontSize = baseFontSize + fontSizeBoost * p;
      const fontWeight = p > 0.5 ? 600 : 400;
      // Inactive: rgba(255,255,255,0.28). Active: #e5e5e5 = rgb(229,229,229).
      const r = Math.round(255 + (229 - 255) * p);
      const g = Math.round(255 + (229 - 255) * p);
      const b = Math.round(255 + (229 - 255) * p);
      const alpha = 0.28 + (1 - 0.28) * p;
      const inactiveAmt = 1 - p;
      ctx.save();
      ctx.translate(lx, ly);
      // Rotate so labels read horizontally when at the top of the dial; the
      // sides tilt naturally into a tangent as they rotate around. (a + π/2
      // is the inverse of the offset above, so the active label has zero
      // rotation.)
      ctx.rotate(a + Math.PI / 2);
      if (inactiveAmt > 0.001) {
        // Simple Gaussian blur for inactive labels (no grain overlay — that
        // composite was reading as a hard edge around the glyph bounds).
        const blurPx = Math.min(2.1, inactiveAmt * 1.9);
        ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
      } else {
        ctx.filter = 'none';
      }
      ctx.font = `${fontWeight} ${fontSize}px 'News Plantin', Georgia, serif`;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emo.label, 0, 0);
      ctx.filter = 'none';

      ctx.restore();
    });

    if (pipNeedsFrame && pipAnimRafRef.current == null) {
      pipAnimRafRef.current = requestAnimationFrame(() => {
        pipAnimRafRef.current = null;
        draw();
      });
    }

    // Center hub removed — divider lines' rounded caps converge at the
    // center on their own; an explicit hub circle felt redundant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  useEffect(() => {
    draw();
  }, [breadcrumb, draw]);

  // When the active emotion changes, animate every label's fade progress
  // toward its target (1 for the new active, 0 for the rest) over LABEL_FADE_MS.
  // Each tick redraws the canvas; multiple rapid changes (e.g. a fast scroll
  // through categories) cleanly retarget by replacing the running animation.
  useEffect(() => {
    const map = fadeProgressRef.current;
    const emos = emotionsRef.current;
    const startValues = new Map();
    emos.forEach((e) => {
      startValues.set(e.id, map.get(e.id) ?? 0);
    });
    const targets = new Map();
    emos.forEach((e) => {
      targets.set(e.id, e.id === activeEmotion ? 1 : 0);
    });

    if (fadeAnimRef.current) cancelAnimationFrame(fadeAnimRef.current);
    const startTime = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / LABEL_FADE_MS, 1);
      const eased = LABEL_FADE_EASE(t);
      emos.forEach((e) => {
        const s = startValues.get(e.id) ?? 0;
        const target = targets.get(e.id) ?? 0;
        map.set(e.id, s + (target - s) * eased);
      });
      draw();
      if (t < 1) {
        fadeAnimRef.current = requestAnimationFrame(tick);
      } else {
        fadeAnimRef.current = null;
      }
    };

    fadeAnimRef.current = requestAnimationFrame(tick);
    return () => {
      if (fadeAnimRef.current) {
        cancelAnimationFrame(fadeAnimRef.current);
        fadeAnimRef.current = null;
      }
    };
  }, [activeEmotion, draw]);

  // Animate the dial to whatever activeEmotion becomes — including external
  // changes driven by scroll position in the card stack. When the dial itself
  // triggered the change, animateTo is effectively a no-op (target ≈ current).
  useEffect(() => {
    const emos = emotionsRef.current;
    const idx = emos.findIndex((e) => e.id === activeEmotion);
    if (idx < 0) return;
    const localStep = (Math.PI * 2) / emos.length;
    const baseTarget = -(idx * localStep);
    const start = currentAngleRef.current;
    const TWO_PI = Math.PI * 2;
    const target = baseTarget + Math.round((start - baseTarget) / TWO_PI) * TWO_PI;
    if (Math.abs(target - start) < 1e-3) return;
    animateToRef.current(target);
  }, [activeEmotion]);

  const animateTo = useCallback(
    (target, duration = 400, easeFn = SNAP_EASE) => {
      if (snapAnimRef.current) cancelAnimationFrame(snapAnimRef.current);
      const start = currentAngleRef.current;
      const distance = target - start;
      if (Math.abs(distance) < 1e-4) return;
      const startTime = performance.now();

      const tick = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        currentAngleRef.current = start + distance * easeFn(progress);
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
  const animateToRef = useRef(animateTo);
  snapToNearestRef.current = snapToNearest;
  snapToIndexRef.current = snapToIndex;
  animateToRef.current = animateTo;

  // Intro spin: pre-rotate the dial by INTRO_SPIN_TURNS full turns and ease
  // it into the active emotion's resting orientation. Gated on activeEmotion
  // being non-null because the parent sets it asynchronously after data
  // loads — running this before then would spin an empty dial and the
  // subsequent activeEmotion-snap effect would override it with a 400ms
  // jump. After the first run, introDoneRef makes this a no-op so it never
  // re-fires on later category changes.
  const introDoneRef = useRef(false);
  useEffect(() => {
    if (introDoneRef.current) return;
    if (!activeEmotion) return;
    const emos = emotionsRef.current;
    const idx = emos.findIndex((e) => e.id === activeEmotion);
    if (idx < 0) return;
    introDoneRef.current = true;

    const localStep = (Math.PI * 2) / emos.length;
    const target = -(idx * localStep);
    currentAngleRef.current = target - Math.PI * 2 * INTRO_SPIN_TURNS;
    draw();

    const t = setTimeout(() => {
      animateToRef.current(target, INTRO_SPIN_DURATION, INTRO_SPIN_EASE);
    }, INTRO_SPIN_START_DELAY);
    return () => clearTimeout(t);
  }, [activeEmotion, draw]);

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
      if (pipAnimRafRef.current) {
        cancelAnimationFrame(pipAnimRafRef.current);
        pipAnimRafRef.current = null;
      }
    };
  }, [draw]);

  const handleClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = visibleHeight / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const dx = cx - CX;
    const dy = cy - CY;
    const dist = Math.hypot(dx, dy);
    if (dist > R || dist < R * 0.15) return;

    const emos = emotionsRef.current;
    const localStep = (Math.PI * 2) / emos.length;
    const clickAngle = Math.atan2(dy, dx);
    // Inverse of the `offset` used in draw(): label i sits at canvas-angle
    // (currentAngle + i*step - π/2), so solve for i.
    const rel = clickAngle - currentAngleRef.current + Math.PI / 2;
    const idx = ((Math.round(rel / localStep) % emos.length) + emos.length) % emos.length;
    snapToIndexRef.current(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // Self-clipping wrapper: the canvas is the full square but only the strip
  // around the labels is shown, with the canvas shifted upward so the
  // active label sits LABEL_TOP_PAD from the top edge.
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: visibleHeight,
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{
          width: size,
          height: visibleHeight,
          cursor: 'pointer',
          touchAction: 'none',
          position: 'absolute',
          left: 0,
          top: canvasTopOffset,
        }}
      />
    </div>
  );
}

// Default canvas pixel size — App.jsx may override via the `size` prop.
export const BOTTOM_DIAL_SIZE = SIZE;

/**
 * Returns the rendered (visible/clipped) height of BottomCompassDial at a
 * given canvas size. The dial shows the top half of its canvas.
 */
export const getBottomDialVisibleHeight = (size) => size / 2;

/**
 * Slot of `activeConfession` within its category for dial tick marks.
 * Returns null when the category has 0 or 1 note (no ticks).
 */
export function getCategoryBreadcrumbInfo(confessions, activeConfession) {
  if (!activeConfession) return null;
  const totals = new Map();
  confessions.forEach((c) => {
    totals.set(c.category, (totals.get(c.category) || 0) + 1);
  });
  const seen = new Map();
  const map = new Map();
  confessions.forEach((c) => {
    const pos = seen.get(c.category) || 0;
    map.set(c.id, { position: pos, total: totals.get(c.category) || 1 });
    seen.set(c.category, pos + 1);
  });
  const info = map.get(activeConfession.id);
  if (!info || info.total <= 1) return null;
  return { total: info.total, position: info.position };
}

/* ── Category Breadcrumb (dial canvas ticks) ───── */

/* ── Horizontal Cards Stack ────────────────────── */

// Snappy ease-out for entrances (responsive, settles in).
const EASE_OUT = [0.165, 0.84, 0.44, 1];

// Number of times the confession array is repeated end-to-end. The user is
// kept in the middle copy; if they scroll into the first or last copy the
// scrollLeft is silently shifted by ±copyWidth so they're back in the middle.
// This produces an "infinite" loop in both directions.
//
// 3 is the minimum that gives smooth wrap-around (one buffer copy on each
// side of the active middle copy). Increasing it adds DOM cost with no
// behavioral benefit.
const COPY_COUNT = 3;
const MIDDLE_COPY = Math.floor(COPY_COUNT / 2);

export function HorizontalConfessionStack({
  confessions,
  activeIndex,
  onActiveChange,
  // Seconds to wait before the wave-from-center stagger begins. Used by the
  // theme-page entrance choreography so the dial can fade in + spin first
  // and the cards cascade in once it's settled.
  entranceDelay = 0,
}) {
  const scrollRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const inactive = useInactiveCardParams();
  const noiseEnabled = inactive.noise?.enabled ?? true;
  const inactiveFilter = [
    inactive.blur > 0 ? `blur(${inactive.blur}px)` : '',
    inactive.grayscale > 0 ? `grayscale(${inactive.grayscale})` : '',
    noiseEnabled ? `url(#${CARD_FILTER_ID})` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const n = confessions.length;
  // Which card the cursor is currently over (one card at a time). Drives the
  // metadata overlay (globalId / tags / transcription) on hover.
  const [hoveredKey, setHoveredKey] = useState(null);

  // Render the confessions array COPY_COUNT times back-to-back. Each render
  // item carries its `logicalIndex` (0..n-1) — copies of the same logical
  // card share visual styling and active state.
  const renderItems = useMemo(() => {
    const out = [];
    for (let copy = 0; copy < COPY_COUNT; copy++) {
      for (let i = 0; i < n; i++) {
        out.push({ confession: confessions[i], copy, logicalIndex: i });
      }
    }
    return out;
  }, [confessions, n]);

  // Suppress handleScroll during programmatic scrolls (smooth scroll to a
  // dial-clicked card, or instant re-center across copy boundaries).
  const isProgScrollingRef = useRef(false);
  const progScrollTargetRef = useRef(null);
  const progScrollSafetyTimerRef = useRef(null);
  // Debounced settle timer: after the user stops scrolling we snap whichever
  // card is closest to the viewport center into exact center. This is
  // deliberately decoupled from the React activeIndex state so we can react
  // even when the centered card was already the active one.
  const snapSettleTimerRef = useRef(null);
  // Wall-clock of the last snap so we can apply a short cooldown — image
  // loads and layout shifts during the first second otherwise create a
  // feedback loop where each snap completes, fires more scroll events, and
  // immediately schedules another snap.
  const lastSnapAtRef = useRef(0);
  // Set true once we believe layout has finished settling (images loaded,
  // intrinsic widths committed). Until then we suppress snap scheduling so
  // the user lands on a stable view rather than a jittering one.
  const layoutSettledRef = useRef(false);
  // Latest activeIndex (logical 0..n-1).
  const activeIndexRef = useRef(activeIndex);
  // Source of the latest activeIndex change. 'user' = handleScroll set it
  // (don't auto-scroll, that fights the user). 'external' = dial click /
  // card click / initial mount (DO scroll to center).
  const activeIndexSourceRef = useRef('external');
  // Period of the loop in pixels = width of one full copy of the array.
  // Measured from DOM after layout (and re-measured if it changes).
  const copyWidthRef = useRef(0);
  // Has the initial scroll into the middle copy happened yet?
  const hasInitialScrolledRef = useRef(false);

  const setActiveFromUserScroll = (i) => {
    activeIndexSourceRef.current = 'user';
    onActiveChange(i);
  };

  const setActiveFromClick = (i) => {
    activeIndexSourceRef.current = 'external';
    onActiveChange(i);
  };

  // ── Helpers ────────────────────────────────────────────────

  // Find the render-index of the copy of `logicalIdx` whose horizontal
  // center is closest to `referenceCenter` (a scrollLeft + width/2 value).
  // With 3 copies, the candidates are logicalIdx, logicalIdx + n, logicalIdx + 2n.
  const findClosestRenderIndex = (logicalIdx, referenceCenter) => {
    const el = scrollRef.current;
    if (!el) return -1;
    const cards = el.querySelectorAll('[data-card]');
    let best = -1;
    let bestDist = Infinity;
    for (let copy = 0; copy < COPY_COUNT; copy++) {
      const idx = copy * n + logicalIdx;
      const card = cards[idx];
      if (!card) continue;
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(cardCenter - referenceCenter);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    }
    return best;
  };

  const measureCopyWidth = () => {
    const el = scrollRef.current;
    if (!el) return 0;
    const cards = el.querySelectorAll('[data-card]');
    if (cards.length < n * 2) return 0;
    const w = cards[n].offsetLeft - cards[0].offsetLeft;
    if (w > 0) copyWidthRef.current = w;
    return copyWidthRef.current;
  };

  // Apply per-card arc-drop based on the card's distance from the viewport
  // center. Cards trace the TOP of a large semi-circle: the active
  // (centered) card sits at the apex; cards on the sides slide down along
  // the upper arc as they move outward. Images don't tilt — only their
  // vertical position changes. Done via direct DOM writes (not React
  // state) so the transform tracks the user's scroll exactly without an
  // extra render per frame.
  const ARC_RADIUS = 2400;         // semi-circle radius in px — bigger = gentler arc
  // Hard cap on vertical drop. Set to 0 to keep cards on a flat horizontal
  // baseline as the user scrolls — no arc-drop. Bump back up (e.g. 50) to
  // restore the wheel-like swoop where side cards trace the top of a
  // circle. If you re-enable, ensure cardWrapper has matching headroom
  // (each side ≥ 0.06 × maxCardHeight + ARC_DROP_MAX) so dropped cards
  // don't get clipped by the scroll container's overflow:hidden.
  const ARC_DROP_MAX = 0;
  const updateCardTilts = () => {
    const el = scrollRef.current;
    if (!el) return;
    const cards = el.querySelectorAll('[data-card]');
    if (cards.length === 0) return;
    const containerCenter = el.scrollLeft + el.offsetWidth / 2;
    cards.forEach((card) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distPx = cardCenter - containerCenter;

      // Vertical drop along the upper arc of a circle of radius ARC_RADIUS.
      // y = R - sqrt(R² - x²) — the classic "rise over run" of a circle's
      // arc relative to its peak. Capped so cards far past the viewport
      // edges don't free-fall.
      const r2 = ARC_RADIUS * ARC_RADIUS;
      const dropRaw = ARC_RADIUS - Math.sqrt(Math.max(0, r2 - distPx * distPx));
      const drop = Math.min(ARC_DROP_MAX, dropRaw);

      const tiltTarget = card.querySelector('[data-tilt-target]');
      if (tiltTarget) {
        tiltTarget.style.transform = `translateY(${drop.toFixed(2)}px)`;
      }
    });
  };

  // ── Initial scroll: drop into middle copy at activeIndex ──
  // Polls until cards have measurable width (images may not have loaded
  // yet). Uses instant scroll so the user never sees the wrong copy. Also
  // suppresses the resulting `scroll` event from triggering snap-setup —
  // otherwise on mount we'd queue a snap that fires while images are still
  // shifting layout, creating a visible spazz.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let cancelled = false;
    const tryInit = () => {
      if (cancelled || hasInitialScrolledRef.current) return;
      const copyW = measureCopyWidth();
      if (copyW <= 0) {
        requestAnimationFrame(tryInit);
        return;
      }
      const cards = el.querySelectorAll('[data-card]');
      const card = cards[MIDDLE_COPY * n + activeIndex];
      if (!card) {
        requestAnimationFrame(tryInit);
        return;
      }
      const target = Math.max(0, card.offsetLeft + card.offsetWidth / 2 - el.offsetWidth / 2);
      // Mark this as a programmatic scroll so handleScroll's first event
      // (fired by the assignment below) early-returns instead of arming
      // the snap settle timer.
      isProgScrollingRef.current = true;
      progScrollTargetRef.current = target;
      el.scrollLeft = target;
      hasInitialScrolledRef.current = true;
      updateCardTilts();
    };
    tryInit();
    return () => {
      cancelled = true;
    };
    // We deliberately only run on mount — re-running on activeIndex change
    // is handled by the dedicated effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark layout as settled after a generous post-mount wait so the
  // snap-to-center logic doesn't fight image loads. 800ms covers most
  // image decode times for ~30 small PNGs over a fast connection; on
  // slow connections the worst case is a slightly delayed first snap.
  useEffect(() => {
    const t = setTimeout(() => {
      layoutSettledRef.current = true;
      // Re-measure once layout has settled so wrap-around math uses the
      // correct copy width going forward, and recompute tilts now that
      // image widths are stable.
      measureCopyWidth();
      updateCardTilts();
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── External activeIndex changes → scroll to closest copy ──
  useEffect(() => {
    activeIndexRef.current = activeIndex;
    if (activeIndexSourceRef.current === 'user') {
      activeIndexSourceRef.current = 'external';
      return;
    }
    if (!hasInitialScrolledRef.current) return; // initial scroll handles it
    const el = scrollRef.current;
    if (!el) return;

    const scrollToActive = () => {
      const containerCenter = el.scrollLeft + el.offsetWidth / 2;
      const renderIdx = findClosestRenderIndex(activeIndex, containerCenter);
      if (renderIdx < 0) return;
      const cards = el.querySelectorAll('[data-card]');
      const card = cards[renderIdx];
      const target = card.offsetLeft + card.offsetWidth / 2 - el.offsetWidth / 2;
      const maxScroll = el.scrollWidth - el.clientWidth;
      const clamped = Math.max(0, Math.min(target, maxScroll));
      if (Math.abs(el.scrollLeft - clamped) < 4) return;

      isProgScrollingRef.current = true;
      progScrollTargetRef.current = clamped;
      el.scrollTo({ left: clamped, behavior: 'smooth' });

      if (progScrollSafetyTimerRef.current) clearTimeout(progScrollSafetyTimerRef.current);
      const distance = Math.abs(clamped - el.scrollLeft);
      const ceilingMs = Math.min(2500, 400 + distance * 0.6);
      progScrollSafetyTimerRef.current = setTimeout(() => {
        isProgScrollingRef.current = false;
        progScrollTargetRef.current = null;
      }, ceilingMs);
    };

    const raf = requestAnimationFrame(scrollToActive);
    return () => cancelAnimationFrame(raf);
  }, [activeIndex]);

  useEffect(() => {
    return () => {
      if (progScrollSafetyTimerRef.current) clearTimeout(progScrollSafetyTimerRef.current);
      if (snapSettleTimerRef.current) clearTimeout(snapSettleTimerRef.current);
    };
  }, []);

  // Smoothly snap the card currently closest to the viewport center into
  // exact center. Idempotent — bails if we're already close to the target,
  // so it's safe to call from the settle timer even when nothing needs to
  // change. Uses a generous 8px tolerance to absorb image-load layout
  // jitter without continuously re-snapping. Mirrors the choreography used
  // by external activeIndex changes (same prog-scroll suppression + safety
  // timer).
  const snapToCenteredCard = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (isProgScrollingRef.current) return;
    if (!layoutSettledRef.current) return;
    const cards = el.querySelectorAll('[data-card]');
    if (cards.length === 0) return;

    const containerCenter = el.scrollLeft + el.offsetWidth / 2;
    let closestIdx = 0;
    let closestDist = Infinity;
    cards.forEach((card, i) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(containerCenter - cardCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    });

    const card = cards[closestIdx];
    const target = card.offsetLeft + card.offsetWidth / 2 - el.offsetWidth / 2;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const clamped = Math.max(0, Math.min(target, maxScroll));
    if (Math.abs(el.scrollLeft - clamped) < 8) return;

    isProgScrollingRef.current = true;
    progScrollTargetRef.current = clamped;
    lastSnapAtRef.current = Date.now();
    el.scrollTo({ left: clamped, behavior: 'smooth' });

    if (progScrollSafetyTimerRef.current) clearTimeout(progScrollSafetyTimerRef.current);
    const distance = Math.abs(clamped - el.scrollLeft);
    const ceilingMs = Math.min(2500, 400 + distance * 0.6);
    progScrollSafetyTimerRef.current = setTimeout(() => {
      isProgScrollingRef.current = false;
      progScrollTargetRef.current = null;
    }, ceilingMs);
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;

    // Tilts follow scroll position regardless of source (user or
    // programmatic) — so smooth-snaps and dial-driven scrolls also see
    // the cards rotate as they move.
    updateCardTilts();

    // Programmatic-scroll suppression: ignore events fired by our own
    // scrollTo / scrollLeft assignments. Clear once we've reached the
    // target. The 4px tolerance matches snap precision — clearing too
    // aggressively (e.g. <2px) lets the trailing tail of a smooth-scroll
    // process normally and re-arm the snap timer.
    if (isProgScrollingRef.current) {
      const target = progScrollTargetRef.current;
      if (target != null && Math.abs(el.scrollLeft - target) < 4) {
        isProgScrollingRef.current = false;
        progScrollTargetRef.current = null;
        if (progScrollSafetyTimerRef.current) {
          clearTimeout(progScrollSafetyTimerRef.current);
          progScrollSafetyTimerRef.current = null;
        }
      }
      return;
    }

    const cards = el.querySelectorAll('[data-card]');
    if (cards.length === 0) return;
    const containerCenter = el.scrollLeft + el.offsetWidth / 2;

    // Find centered render index across all copies.
    let closestRender = 0;
    let closestDist = Infinity;
    cards.forEach((card, i) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(containerCenter - cardCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closestRender = i;
      }
    });

    const copy = Math.floor(closestRender / n);
    const logicalIdx = closestRender % n;

    // Re-center if the user has drifted into the first or last copy. Shift
    // by exactly one copyWidth so the visible content doesn't change — same
    // logical card stays under their cursor.
    const copyW = copyWidthRef.current || measureCopyWidth();
    if (copyW > 0 && (copy === 0 || copy === COPY_COUNT - 1)) {
      const shift = copy === 0 ? copyW : -copyW;
      const newLeft = el.scrollLeft + shift;
      isProgScrollingRef.current = true;
      progScrollTargetRef.current = newLeft;
      el.scrollLeft = newLeft;
    }

    if (logicalIdx !== activeIndexRef.current) {
      setActiveFromUserScroll(logicalIdx);
    }

    // Schedule a snap-to-center after the user stops scrolling. Reset on
    // every scroll event so the snap only fires once the gesture truly
    // settles. Several gates protect against on-mount spazzing:
    //   - prefers-reduced-motion → never auto-scroll
    //   - layoutSettledRef → wait until images have committed widths
    //   - 350ms cooldown after the previous snap → no oscillation
    if (!reduceMotion && layoutSettledRef.current) {
      const sinceLastSnap = Date.now() - lastSnapAtRef.current;
      if (sinceLastSnap < 350) return;
      if (snapSettleTimerRef.current) clearTimeout(snapSettleTimerRef.current);
      snapSettleTimerRef.current = setTimeout(() => {
        snapSettleTimerRef.current = null;
        snapToCenteredCard();
      }, 140);
    }
  };

  return (
    <div ref={scrollRef} onScroll={handleScroll} style={st.scrollContainer}>
      <CardNoiseFilterDefs params={inactive} />
      {renderItems.map((item, renderIdx) => {
        const isActive = item.logicalIndex === activeIndex;
        const cardKey = `${item.copy}-${item.confession.id}`;
        // Metadata only surfaces for the active (centered/snapped) card.
        // Inactive cards are intentionally muted — hover does nothing on
        // them so the user has to scroll/click to bring a card into focus
        // before they can read its details.
        const showMeta = isActive && hoveredKey === cardKey;
        // Breadcrumb ticks used to render here; they now live in
        // BottomCompassDial as thin radial spokes in the active sector.
        // Stagger the entrance as a wave radiating outward from the active
        // card — that's where the user is focused on mount, so the focal
        // card appears first and its neighbours wash in around it. Outer
        // copies (off-screen buffer for infinite scroll) never get
        // staggered since the user can't see them entering. Per-step
        // ≈60ms (clearly perceptible) capped at 600ms total cascade.
        const staggerDelay =
          item.copy === MIDDLE_COPY
            ? Math.min(Math.abs(item.logicalIndex - activeIndex) * 0.06, 0.6)
            : 0;
        return (
          <motion.div
            key={cardKey}
            data-card
            initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: 0.22,
                    ease: EASE_OUT,
                    delay: staggerDelay + entranceDelay,
                  }
            }
            onClick={() => setActiveFromClick(item.logicalIndex)}
            onMouseEnter={() => setHoveredKey(cardKey)}
            onMouseLeave={() =>
              setHoveredKey((k) => (k === cardKey ? null : k))
            }
            style={{
              ...st.cardWrapper,
              cursor: isActive ? 'default' : 'pointer',
              willChange: 'transform, opacity',
            }}
          >
            <div data-tilt-target style={st.cardImageBox}>
              <img
                src={item.confession.image}
                alt={`Confession ${item.confession.id}`}
                draggable={false}
                style={{
                  ...st.cardImg,
                  opacity: isActive ? 1 : inactive.opacity,
                  transform: `scale(${isActive ? 1.12 : inactive.scale})`,
                  filter: isActive ? 'none' : inactiveFilter || 'none',
                }}
              />
            </div>

            {/* Hover-only metadata block — only the transcription is shown
                under the active card. The globalId + tags pills row used to
                sit above the transcription but is hidden now (the sidebar
                metadata panel still surfaces id/tags for the active card).
                Whole block is absolutely positioned so it doesn't grow the
                card wrapper's layout footprint. */}
            <div style={st.metaBlock}>
              {item.confession.transcription && (
                <div
                  style={{
                    ...st.metaTranscription,
                    opacity: showMeta ? 1 : 0,
                    transform: showMeta ? 'translateY(0)' : 'translateY(-4px)',
                  }}
                >
                  {item.confession.transcription}
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

const st = {
  scrollContainer: {
    display: 'flex',
    flexDirection: 'row',
    gap: 24,
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollSnapType: 'none',
    // Disable browser-side scroll anchoring so async image loads (which
    // grow card widths) don't trigger phantom scroll events that drive
    // the snap detector into a feedback loop.
    overflowAnchor: 'none',
    width: '100%',
    height: '100%',
    // Pad the start/end so the first / last card can scroll fully into the
    // viewport center. Width assumed to be roughly half of the largest card
    // (~520px / 2 = 260) — a touch generous so trim cards still center.
    paddingLeft: 'calc(50% - 260px)',
    paddingRight: 'calc(50% - 260px)',
    alignItems: 'center',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  cardWrapper: {
    flexShrink: 0,
    // Card height = container height MINUS 220px headroom (110 each side)
    // so the active card's 1.12 scale transform (~6% past the wrapper,
    // ~24.5px at maxHeight 408) PLUS the side-card arc-drop (ARC_DROP_MAX
    // 50px) PLUS the metadata block (sits at top: calc(100% + 36px) below
    // the wrapper) all fit without being clipped by the scroll container's
    // overflow-y: hidden. maxHeight reduced ~15% from the previous 480 →
    // 408 so the wrapper itself is smaller and more headroom remains for
    // the metadata stack underneath. Width follows the image's natural
    // aspect ratio (img: height 100% / width auto).
    position: 'relative',
    height: 'calc(100% - 220px)',
    maxHeight: 408,
  },
  cardImageBox: {
    position: 'relative',
    height: '100%',
    // width: auto — settles to the image's intrinsic width after load
    display: 'block',
    // Rotation pivot at the card's center so cards "tilt away" symmetrically
    // around their own midpoint. The `transform` itself is written from JS
    // on each scroll event (see updateCardTilts) — a short transition
    // smooths over the gaps between scroll events without lagging behind
    // an active drag.
    transformOrigin: '50% 50%',
    transition: 'transform 120ms cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'transform',
  },
  metaBlock: {
    // Absolutely-positioned wrapper for the metadata stack (id + tags row
    // followed by transcription). Sits below the image without affecting
    // the card wrapper's layout dimensions, so neighbouring cards aren't
    // pushed apart by metadata visibility. The 36px offset clears the
    // active card's 1.12-scaled visual extent (~6% past wrapper bottom).
    position: 'absolute',
    top: 'calc(100% + 36px)',
    left: 0,
    width: '100%',
    pointerEvents: 'none',
  },
  metaRow: {
    // Single row above the transcription: globalId on the left, tags on
    // the right. Each pill stays at its own opacity transition timing.
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
    transition: 'opacity 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  metaPill: {
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: 10,
    letterSpacing: '0.08em',
    color: 'rgba(255,255,255,0.85)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  metaPillTags: {
    // Lets the tags pill shrink + ellipsis when the joined tag string is
    // longer than the available right-hand width.
    maxWidth: '60%',
    textAlign: 'right',
  },
  metaTranscription: {
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: 11,
    lineHeight: 1.55,
    letterSpacing: '0.01em',
    color: 'rgba(229,229,229,0.85)',
    transition:
      'opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1), transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
    // Cap so a long confession doesn't bleed into the dial. The sidebar
    // still shows the full transcription for the active card.
    maxHeight: '5.5em',
    overflow: 'hidden',
    maskImage:
      'linear-gradient(to bottom, #000 0, #000 70%, transparent 100%)',
    WebkitMaskImage:
      'linear-gradient(to bottom, #000 0, #000 70%, transparent 100%)',
  },
  cardImg: {
    height: '100%',
    width: 'auto',
    display: 'block',
    // Staggered active-state choreography:
    //   1. transform (scale) leads — image grows in first, snappy ease-out.
    //   2. opacity + filter follow ~120ms behind, so the image is already
    //      committing to its new size before it brightens / unblurs.
    // The same delays apply on deactivation (scale shrinks, then dims) which
    // reads as a clean "stepping back" gesture.
    transition:
      'transform 0.40s cubic-bezier(0.165, 0.84, 0.44, 1) 0s, ' +
      'opacity 0.30s cubic-bezier(0.4, 0, 0.2, 1) 0.12s, ' +
      'filter 0.30s cubic-bezier(0.4, 0, 0.2, 1) 0.30s',
    pointerEvents: 'none',
  },
};
