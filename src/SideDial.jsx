import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import {
  CARD_FILTER_ID,
  CardNoiseFilterDefs,
  useInactiveCardParams,
} from './noise.jsx';
import { TRANSCRIPTION_TEXT } from './text';
import { BASELINE_PROBE_STYLE, useTextDissolve } from './textDissolve';
import { INK } from './colors';
import { formatCategoryLabel } from './themes';
import { useNoteSound } from './sounds';
import { CURSOR_FLOAT, cursorOffset, floatAngles } from './cursorFloat';

export const EMOTIONS = [
  { id: 'therapist', label: 'Therapist', gradient: 'linear-gradient(to left, #2a1a4a, #111 70%)' },
  { id: 'harm', label: 'Harm', gradient: 'linear-gradient(to left, #4a1a1a, #111 70%)' },
  { id: 'refusal', label: 'Refusal', gradient: 'linear-gradient(to left, #1a1a1a, #111 70%)' },
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
const SNAP_EASE = makeCubicBezier(0.5, 0, 0.3, 1);

// Intro spin: how far the dial is "wound up" before settling, and how long
// it takes to unwind into its resting orientation on first mount.
//
// Sequence: the spin starts IMMEDIATELY on mount (delay = 0) while the
// dial is still invisible (opacity 0). The wrapping motion.div in App.jsx
// then fades the dial in after a short delay, so the user sees the dial
// appear *mid-spin* and ride the rest of the rotation into place. Standard
// ease-out-quart curve so the spin decelerates as it settles.
const INTRO_SPIN_TURNS = 1.5;
export const INTRO_SPIN_DURATION = 2400;
const INTRO_SPIN_START_DELAY = 0;
// Exported so the theme page can slide the notes in on the exact same curve,
// keeping the note travel and the dial spin perfectly in sync.
export const INTRO_SPIN_EASE_BEZIER = [0.165, 0.84, 0.44, 1];
const INTRO_SPIN_EASE = makeCubicBezier(...INTRO_SPIN_EASE_BEZIER);

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
  /** Phones/narrow viewports: the dial shrinks but the labels don't (fixed
   *  font), so long words crowd together near the bottom. When true we push
   *  the labels onto a larger-radius circle so they sit higher and spread
   *  apart. */
  compact = false,
  /** When set, shows a small `n/total notes` under the active dial label (multi-note categories). */
  breadcrumb = null,
  /** Delay (ms) before the first-mount intro spin starts — lets a landing→archive
   *  handoff fade its bridge note out first, then spin the dial in. */
  introSpinDelayMs = INTRO_SPIN_START_DELAY,
}) {
  const canvasRef = useRef(null);
  const currentAngleRef = useRef(0);
  const rafRef = useRef(null);
  const snapAnimRef = useRef(null);
  const snapTimerRef = useRef(null);
  const breadcrumbRef = useRef(breadcrumb);
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
  // crowd into each other. On phones the dial is small but the labels keep
  // their fixed reading size, so we push them onto a larger-radius circle —
  // this lifts the active label up and fans the neighbours out so long
  // words ("Companionship", "Ghostwriter") stop overlapping.
  const LABEL_R_RATIO = compact ? 0.72 : 0.5;
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

    const bc = breadcrumbRef.current;

    // Divider lines: radial spokes from the hub, longer than before, with a
    // linear gradient that fades out toward the outer tip.
    const dividerTipR = R * 0.58;
    emos.forEach((_, i) => {
      const dividerAngle = angle + i * localStep + offset + localStep / 2;
      const cos = Math.cos(dividerAngle);
      const sin = Math.sin(dividerAngle);
      const x0 = CX + cos * innerStart;
      const y0 = CY + sin * innerStart;
      const x1 = CX + cos * dividerTipR;
      const y1 = CY + sin * dividerTipR;
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, 'rgba(160,160,160,0.52)');
      grad.addColorStop(0.38, 'rgba(160,160,160,0.44)');
      grad.addColorStop(0.72, 'rgba(160,160,160,0.18)');
      grad.addColorStop(1, 'rgba(160,160,160,0)');
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
    });

    emos.forEach((emo, i) => {
      const a = angle + i * localStep + offset;
      const lx = CX + Math.cos(a) * labelR;
      const ly = CY + Math.sin(a) * labelR;
      // p ∈ [0,1] — current "activeness" of this label. Lerps font size,
      // color, and alpha between the inactive and active styles.
      const p = fadeProgressRef.current.get(emo.id) ?? (emo.id === active ? 1 : 0);
      const fontSize = baseFontSize + fontSizeBoost * p;
      const fontWeight = p > 0.5 ? 600 : 400;
      // Inactive: ink at 28% alpha. Active: full ink rgb(207,202,183).
      const r = 207;
      const g = 202;
      const b = 183;
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
      ctx.font = `${fontWeight} ${fontSize}px 'Faktory', Georgia, serif`;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Display-only uppercase — the underlying `emo.label` (Title Case) still
      // drives filtering, gradient keys, and the label/category comparison below.
      ctx.fillText(formatCategoryLabel(emo.label), 0, 0);
      ctx.filter = 'none';

      const cat = bc?.category;
      const labelMatch =
        cat &&
        emo.label &&
        emo.label.toLowerCase() === String(cat).toLowerCase();
      if (
        bc &&
        bc.total > 1 &&
        emo.id === active &&
        labelMatch &&
        p > 0.9
      ) {
        const sub = `${bc.position + 1}/${bc.total} NOTES`;
        const subPx = Math.max(10, Math.round(size * 0.021));
        const subY = fontSize * 0.5 + 6;
        ctx.font = `500 ${subPx}px "Courier New", Courier, monospace`;
        ctx.fillStyle = `rgba(207,202,183,${0.38 + 0.4 * p})`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(sub, 0, subY);
      }

      ctx.restore();
    });

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
  //
  // The intro spin (below) owns first-paint positioning: it winds the dial up
  // and eases it into the seeded category. This snap stays suppressed until the
  // intro has fully settled — otherwise an early activeEmotion change (the
  // card-stack alignment, or a React StrictMode dev double-mount) fires a 400ms
  // snap that steals the wound-up rotation, so the spin never reads as a spin.
  const introSettledRef = useRef(false);
  useEffect(() => {
    if (!introSettledRef.current) return;
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

  // Intro spin: wind the dial up by INTRO_SPIN_TURNS and ease it into the
  // seeded category's resting orientation. Driven by a single rAF anchored to a
  // persisted timestamp (rather than setTimeout + animateTo) so React
  // StrictMode's dev double-mount can't break it: a remount keeps the same
  // anchor/target and simply continues the spin where it left off, instead of
  // early-returning and letting the snap steal the rotation. `introSpinDelayMs`
  // holds the wound-up frame (dial still fading in) before the unwind begins;
  // once it lands, `introSettledRef` hands control back to the snap effect.
  const introAnchorRef = useRef(null);
  const introTargetRef = useRef(0);
  const introWoundRef = useRef(0);
  useEffect(() => {
    if (introSettledRef.current) return;
    if (!activeEmotion) return;
    const emos = emotionsRef.current;
    const idx = emos.findIndex((e) => e.id === activeEmotion);
    if (idx < 0) return;

    if (introAnchorRef.current == null) {
      const localStep = (Math.PI * 2) / emos.length;
      const target = -(idx * localStep);
      introTargetRef.current = target;
      introWoundRef.current = target - Math.PI * 2 * INTRO_SPIN_TURNS;
      currentAngleRef.current = introWoundRef.current;
      introAnchorRef.current = performance.now();
      draw();
    }

    const anchor = introAnchorRef.current;
    const target = introTargetRef.current;
    const wound = introWoundRef.current;
    let raf = 0;
    const tick = (now) => {
      const e = now - anchor;
      if (e < introSpinDelayMs) {
        currentAngleRef.current = wound;
        draw();
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min((e - introSpinDelayMs) / INTRO_SPIN_DURATION, 1);
      currentAngleRef.current = wound + (target - wound) * INTRO_SPIN_EASE(p);
      draw();
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        currentAngleRef.current = target;
        draw();
        introSettledRef.current = true;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeEmotion, draw, introSpinDelayMs]);

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

  const LABEL_CURSOR_HIT = Math.max(44, size * 0.1);

  const handlePointerMove = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = size / rect.width;
      const scaleY = visibleHeight / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;
      const dx = px - CX;
      const dy = py - CY;
      const dist = Math.hypot(dx, dy);

      if (dist > R) {
        canvas.style.cursor = 'default';
        return;
      }
      if (dist < R * 0.15) {
        canvas.style.cursor = 'ns-resize';
        return;
      }

      const emos = emotionsRef.current;
      const ang = currentAngleRef.current;
      const localStep = (Math.PI * 2) / Math.max(emos.length, 1);
      const off = -Math.PI / 2;
      let best = Infinity;
      for (let i = 0; i < emos.length; i++) {
        const a = ang + i * localStep + off;
        const lx = CX + Math.cos(a) * labelR;
        const ly = CY + Math.sin(a) * labelR;
        best = Math.min(best, Math.hypot(px - lx, py - ly));
      }
      canvas.style.cursor = best <= LABEL_CURSOR_HIT ? 'pointer' : 'ns-resize';
    },
    [size, R, CX, CY, labelR, visibleHeight]
  );

  const handlePointerLeave = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = 'ns-resize';
  }, []);

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
        onMouseMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        style={{
          width: size,
          height: visibleHeight,
          cursor: 'ns-resize',
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
/**
 * Slot of `activeConfession` within its category (for dial `n/total notes` label).
 * Returns null when the category has 0 or 1 note. Includes `category` so
 * the dial can match the active emotion label case-insensitively.
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
  return {
    total: info.total,
    position: info.position,
    category: activeConfession.category,
  };
}

/**
 * Which category the active note is in, out of ALL distinct categories in the
 * set (ordered by first appearance) — drives the "n / total" CATEGORY counter
 * on the stack page. (This counter used to live on the dial; it now sits with
 * the note-index breadcrumb under the transcript instead.) Returns null when
 * there's a single category, i.e. nothing to count against.
 */
function getCategorySlotInfo(confessions, activeConfession) {
  if (!activeConfession) return null;
  const order = [];
  const seen = new Set();
  confessions.forEach((c) => {
    if (seen.has(c.category)) return;
    seen.add(c.category);
    order.push(c.category);
  });
  const position = order.indexOf(activeConfession.category);
  const total = order.length;
  if (total <= 1 || position < 0) return null;
  return { position, total, category: activeConfession.category };
}

/* ── Category slot counter (dial label) ──────────── */

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
// Shown next to the cursor over the ACTIVE (centered) card, whose image click
// opens the full note.
const ACTIVE_CARD_TOOLTIP = 'VIEW NOTE';
const INACTIVE_TOOLTIP_GAP = 12;
// Conservative width so we flip before the label clips off-screen.
const INACTIVE_TOOLTIP_EST_WIDTH = 220;
const TRANSCRIPT_FADE_S = 0.22;

/* ─────────────────────────────────────────────────────────
 * ACTIVE NOTE — META REVEAL STORYBOARD
 *
 * Fires when a card scrolls to center and becomes the active note.
 * Times are ms after the note becomes active:
 *
 *  400ms   date · location row fades in
 *  800ms   transcription reveals — words stagger-fade in fast,
 *          one every 18ms, each over 0.28s
 *
 * The transcription renders absolutely below the date row (st.transcriptReveal)
 * so its variable length never changes the card's height — a long confession
 * never grows or reflows the note. The image + date row alone size the card.
 * ───────────────────────────────────────────────────────── */

const META_TIMING = {
  metaRow: 400, // ms to wait before the date · location row fades in
  transcriptStart: 800, // ms to wait before the transcription reveal begins
};

/* Transcription — word-by-word stagger-fade (snappy). Now the no-WebGL fallback
 * for the dissolve below; still the reveal every visitor gets if the context
 * can't be had. */
const TRANSCRIPT_REVEAL = {
  wordStagger: 0.018, // s between each successive word beginning to fade
  wordFadeS: 0.28, // s for a single word's opacity fade
};

/**
 * Transcription — the WebGL mask dissolve (textDissolve.js), the same move the
 * onboarding copy arrives on. The transcription is the one piece of handwriting
 * on the page that has been turned into type, so having it condense out of a
 * cloudy field rather than tick in word by word suits what it is: something
 * being read off the note, not printed.
 *
 * Retuned for body copy, which the onboarding settings are actively wrong for:
 *
 *   maxBlur   The hero is 40px display type, where a 14px un-blur radius reads
 *             as a soft edge. At 12.5px that radius spans a whole line and the
 *             block dissolves in as a glow with no letters in it. 6px is about
 *             one character here.
 *   chroma    Off. The front's chromatic split is 2x the blur radius, so at this
 *             size it pulled red and blue clean off strokes ~1px wide and left
 *             the green channel sitting on them alone — the transcript came in
 *             green. The warm flare glow, which is the nicer half of that
 *             effect, is untouched by this.
 *   doneAt    Early (0.88, vs 0.94), so the cross-fade to the DOM carries the
 *             last of the resolve. Canvas type has no hinting and grayscale AA,
 *             which at this size reads as coarse, pixelated letterforms — so
 *             the raster is never left standing in for finished text.
 *   stiffness Up from 9 to 14 (~1.2s rather than ~1.5s) so the transcript
 *             resolves close to the beat the old word stagger took (~0.8s) and
 *             the note doesn't sit half-legible.
 */
const TRANSCRIPT_DISSOLVE = {
  maxBlur: 6, //     px of un-blur at the front — roughly one character wide
  stiffness: 14, //  ~1.2s for the front to clear the block
  chroma: 0, //      no colour split on 1px strokes
  doneAt: 0.88, //   hand off with some blur still on, and resolve in the DOM
  handoffS: 0.34, // longer than the default, since it is doing real work now
};

/* Inactive card opacity by ring distance from the active/centered note.
 * Kept faint so the focus stays firmly on the centered note; neighbours are
 * just a hint of what's on either side. */
const INACTIVE_OPACITY = {
  near: 0.14, // directly left/right of the active note (ring 1)
  far: 0.06, // two or more notes out (ring 2+)
};

// The active note's image is emphasised with a CSS transform scale. Because
// it's a transform (not layout), the image visually overflows its box — so the
// transcription/meta below must be sized to the *scaled* width to line up with
// the image's real edges. Single source of truth for both.
export const ACTIVE_IMG_SCALE = 1.12;

// ── Active-note size (single source of truth) ─────────────────────────────
// The card is HEIGHT-DRIVEN: its height is a fraction of the viewport (capped in
// px), and the width then settles to the image's own aspect ratio, capped so a
// wide (landscape) note never spills past the screen edges. The desktop active
// card is scaled a further ACTIVE_IMG_SCALE on top. Bump these to grow the note.
export const CARD_HEIGHT_VH = 46; //    desktop filmstrip note height (vh)
export const CARD_HEIGHT_MAX = 512; //  px cap on that height
export const CARD_WIDTH_VW = 84; //     width cap for wide/landscape notes (vw)
export const CARD_WIDTH_MAX = 560; //   px cap on that width
// Mobile carousel notes run a touch shorter than desktop so the prev/next peeks
// survive; V_STACK_PAD_VH (below) is derived from this so centering stays exact.
const CARD_HEIGHT_VH_MOBILE = 44;

// When a card becomes active, hold its film grain for a beat before it clears,
// so the note "settles" into focus instead of de-graining the instant it's
// selected. Done in JS (not a CSS filter transition) because the grain is an
// SVG `url()` filter, which the browser refuses to interpolate/transition — it
// would otherwise snap off immediately regardless of any transition-delay.
const GRAIN_HOLD_MS = 350;

/* ── Mobile vertical carousel tuning ──────────────────────────────────────
 * The horizontal filmstrip above doesn't fit a phone: the note goes near
 * full-width so there's no room for left/right neighbours. On mobile the
 * stack rotates 90° — notes are stacked vertically, the active one centred,
 * the previous peeking from the top edge and the next from the bottom. Native
 * vertical scroll-snap drives it (swipe up/down). */
// Gap (px) between stacked notes. Bigger gap ⇒ smaller neighbour peek.
// The active note's transcript is taken out of flow (see st.vMetaBlock) so every
// item measures the same height, which means this gap is also the only thing
// separating that transcript from the next note — hence it has to clear the
// transcript's own cap (~112px) plus its offset, rather than the ~118 that used
// to be enough when the transcript pushed the next note down by its own height.
const V_STACK_GAP = 140;
// Vertical padding (vh) above the first / below the last note so either can
// scroll to the exact viewport centre: (100 − noteVh)/2, kept in sync with the
// mobile note height so the active note always lands dead-centre.
const V_STACK_PAD_VH = (100 - CARD_HEIGHT_VH_MOBILE) / 2;
// Px the resting note sits BELOW the exact viewport centre. Zero — the note is
// centred. It used to sit lower to duck a category label pinned over the top of
// the stack; that label now rides at the bottom with the note counter (see
// NoteOpenView's mStepperWrap), so the chrome is bottom-weighted and any
// downward bias would push the note toward the crowded edge, not away from it.
//
// Kept as a named constant because three places must agree on it or the snap
// fights the scroll detector: `scroll-padding-top` (which moves the snapport's
// centre, and so where CSS parks a note), the JS centring/detection math, and
// the start/end padding (which is what lets the first and last note reach that
// position at all — get it wrong under mandatory snap and the end notes become
// unreachable).
const V_CENTER_OFFSET = 0;
// Px a note may sit off the resting line before we bother correcting it. Only
// ever absorbs sub-pixel layout residue — a real move to the next note is ~500px
// — and stops that residue being handed to the snap engine (see
// scrollItemToCenter for why that's destructive).
const SNAP_EPSILON = 2;
// Neighbour opacity by ring distance. Higher than the horizontal strip's faint
// 0.18/0.07 so the peeking prev/next notes actually read on a phone against the
// pure-black backdrop.
const V_INACTIVE_OPACITY = { near: 0.46, far: 0.14 };
// How many notes either side of the focus to mount fully (image + meta). The
// rest are height-only spacers so scroll-snap geometry stays correct without
// downloading/decoding every note in the category.
const V_RENDER_WINDOW = 2;
const V_SCROLL_SETTLE_MS = 150;
const V_IMAGE_HEIGHT = `min(${CARD_HEIGHT_VH_MOBILE}vh, ${CARD_HEIGHT_MAX}px)`;

const HOVER_EASE = 'cubic-bezier(0.17, 0.84, 0.44, 1)';

// All chrome text in the confession stack (legend, DATE / LOCATION, transcript,
// counters, tooltip) is set in Courier New — small + minimal — so the page reads
// as a plain typewritten index. Kept local to this component; the dial canvas
// and the rest of the site keep their own type. Falls back to the mono stack.
const COURIER = '"Courier New", Courier, ui-monospace, SFMono-Regular, Menlo, monospace';

// Keyboard-navigation mini guide for the confession stack.
// Top-of-view keyboard legend for the dial. Each item is a label above a dark
// key box: EXIT sits apart from the LEFT/RIGHT pair. The boxes show plain Courier
// glyphs for the physical key — ESC for exit, ← / → for left/right (the arrow
// keys or A/D both flip through notes). Same Unicode arrows as the theme pair
// (↑ / ↓) so all four read as one family. Pressing the physical key — or
// clicking a box — darkens that box (see `pressedKey` → `keyPressed`).
const DIAL_NAV_ITEMS = [
  { id: 'esc', label: 'EXIT', kind: 'exit', aria: 'Exit view (Esc)' },
  { id: 'left', label: 'LEFT', kind: 'arrow', dir: 'left', glyph: '←', aria: 'Previous note (left arrow)' },
  { id: 'right', label: 'RIGHT', kind: 'arrow', dir: 'right', glyph: '→', aria: 'Next note (right arrow)' },
];

// Optional theme-nav pair for the explore stack: ↑ / ↓ step between themes.
// The left dial is a vertical wheel, so ↑ (up) = previous theme, ↓ (down) =
// next (the arrow keys or W/S both work). Rendered under a single THEME caption
// and only when `showCategoryKeys` is set — the dial page and grid lightbox
// don't wire these keys, so they stay out of those legends.
const DIAL_CATEGORY_ITEMS = [
  { id: 'catPrev', kind: 'cat', glyph: '↑', aria: 'Previous theme (up arrow)' },
  { id: 'catNext', kind: 'cat', glyph: '↓', aria: 'Next theme (down arrow)' },
];

// Animated grain <filter> for the nav-key glyphs — the same feTurbulence +
// feDisplacementMap "boil" as the onboarding scroll-cue arrow (HeroNoiseFilter),
// tuned down for tiny 12px Courier glyphs so the A / D edges shimmer/dissolve
// into noise rather than smearing illegibly. Crawls the seed on a ~30fps rAF
// clock; a static seed under prefers-reduced-motion. Opt-in per DialNavHint
// (see `grainArrows`) so it only rides the note-open stack, never the dial page.
const NAV_GRAIN = {
  baseFrequency: 0.86, // fractalNoise frequency (higher = finer grain)
  octaves: 2,
  seed: 7,
  fps: 12, //    seed hops/sec (lower = chunkier flicker)
  scale: 1.4, // px of edge displacement — subtle at 12px
};

export function NavGrainFilter({ id, reduceMotion = false }) {
  const animate = !reduceMotion;
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
    ? NAV_GRAIN.seed + Math.floor(((now - startRef.current) / 1000) * NAV_GRAIN.fps)
    : NAV_GRAIN.seed;
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      <defs>
        {/* Generous region so displaced edge pixels aren't clipped. */}
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={NAV_GRAIN.baseFrequency}
            numOctaves={NAV_GRAIN.octaves}
            seed={seed}
            stitchTiles="stitch"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={NAV_GRAIN.scale}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

export function DialNavHint({
  pressedKey,
  onPress,
  onRelease,
  style,
  showExit = true,
  grainArrows = false,
  showCategoryKeys = false,
}) {
  // EXIT/ESC is optional — some surfaces (e.g. the dial page) hide it and keep
  // only the LEFT / RIGHT flip keys.
  const items = showExit ? DIAL_NAV_ITEMS : DIAL_NAV_ITEMS.filter((i) => i.kind !== 'exit');
  const reduceMotion = useReducedMotion();
  // Unique id per instance so multiple legends (dial page + note view) don't
  // share/clobber one <filter>.
  const grainId = `nav-grain-${useId().replace(/:/g, '')}`;

  // A single dark key box (its caption lives in the wrapping item). Glyph is the
  // item's own `glyph` — ← / → for the note flippers, ↑ / ↓ for the theme keys
  // — falling back to ESC for exit. Grain rides all four arrow glyphs when opted
  // in; EXIT always stays crisp.
  const keyButton = (item) => {
    const pressed = pressedKey === item.id;
    const grained = grainArrows && (item.kind === 'arrow' || item.kind === 'cat');
    return (
      <button
        key={item.id}
        type="button"
        aria-label={item.aria}
        onPointerDown={(e) => {
          e.preventDefault();
          onPress(item.id);
        }}
        onPointerUp={() => onRelease(item.id)}
        onPointerLeave={() => onRelease(item.id)}
        onPointerCancel={() => onRelease(item.id)}
        style={{
          ...dialNavHintStyles.key,
          ...(item.kind === 'exit' ? dialNavHintStyles.keyExit : dialNavHintStyles.keyArrow),
          ...(pressed ? dialNavHintStyles.keyPressed : null),
        }}
      >
        <span
          style={{
            ...dialNavHintStyles.keyGlyph,
            ...(item.kind === 'exit' ? null : dialNavHintStyles.keyGlyphArrow),
            ...(grained ? { filter: `url(#${grainId})` } : null),
          }}
        >
          {item.glyph ?? (item.kind === 'exit' ? 'ESC' : item.dir === 'left' ? '←' : '→')}
        </span>
      </button>
    );
  };

  return (
    <div style={{ ...dialNavHintStyles.wrap, ...style }} aria-label="Keyboard navigation guide">
      {grainArrows ? <NavGrainFilter id={grainId} reduceMotion={reduceMotion} /> : null}
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            ...dialNavHintStyles.item,
            // EXIT is set apart from the LEFT / RIGHT pair — only add that gap
            // when EXIT is actually shown.
            ...(showExit && item.id === 'left' ? dialNavHintStyles.itemPairStart : null),
          }}
        >
          <span style={dialNavHintStyles.label}>{item.label}</span>
          {keyButton(item)}
        </div>
      ))}
      {/* Theme (category) flip pair — W / S under one THEME caption, set apart
          from the note keys. Explore stack only (see showCategoryKeys). */}
      {showCategoryKeys ? (
        <div style={{ ...dialNavHintStyles.item, ...dialNavHintStyles.itemPairStart }}>
          <span style={dialNavHintStyles.label}>THEME</span>
          <div style={dialNavHintStyles.catRow}>{DIAL_CATEGORY_ITEMS.map(keyButton)}</div>
        </div>
      ) : null}
    </div>
  );
}

const dialNavHintStyles = {
  wrap: {
    position: 'absolute',
    // Sit in the header band just ABOVE the note area (anchored to this box's
    // top edge, so it doesn't depend on the exact header inset) — clear of the
    // DATE / LOCATION frame below and the wordmark / tabs to either side.
    bottom: 'calc(100% + 10px)',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 6,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-end',
    // Gap within the LEFT / RIGHT pair; EXIT gets extra space (itemPairStart).
    gap: 10,
    pointerEvents: 'auto',
    userSelect: 'none',
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 5,
  },
  itemPairStart: {
    // Push the LEFT / RIGHT group away from EXIT so EXIT reads as separate.
    marginLeft: 24,
  },
  catRow: {
    // The W / S theme keys sit as a tight pair beneath the single THEME caption.
    display: 'flex',
    flexDirection: 'row',
    gap: 6,
  },
  label: {
    fontFamily: COURIER,
    fontSize: 8.5,
    letterSpacing: '0.16em',
    lineHeight: 1,
    textTransform: 'uppercase',
    color: 'rgba(255, 255, 255, 0.96)',
    paddingLeft: 1,
  },
  key: {
    height: 26,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    background: 'rgba(210, 206, 190, 0.10)',
    border: '1px solid rgba(207, 202, 183, 0.10)',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    transition:
      `background 120ms ${HOVER_EASE}, transform 120ms ${HOVER_EASE}, border-color 120ms ${HOVER_EASE}, box-shadow 120ms ${HOVER_EASE}`,
  },
  keyExit: { width: 46 },
  keyArrow: { width: 46 },
  keyPressed: {
    // Darken the box toward black on press, with a slight inset + sink.
    background: 'rgba(0, 0, 0, 0.45)',
    borderColor: 'rgba(207, 202, 183, 0.06)',
    boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.55)',
    transform: 'translateY(1px)',
  },
  keyGlyph: {
    // ESC / ← / → / ↑ / ↓ as plain Courier glyphs so the legend reads as
    // monospaced text rather than drawn icons. White rather than the parchment
    // parchment cream used elsewhere, and near-opaque, since the grain filter
    // (see NAV_GRAIN) eats these small edges and costs perceived brightness.
    fontFamily: COURIER,
    fontSize: 12,
    letterSpacing: '0.04em',
    lineHeight: 1,
    color: 'rgba(255, 255, 255, 0.96)',
  },
  keyGlyphArrow: {
    // Stepped up off the ESC size: a lone arrow sitting in the same key box
    // reads much smaller than a three-letter word does, so matching it
    // metrically leaves the arrows looking undersized. Matching it optically
    // means going bigger.
    fontSize: 17,
  },
};

export function HorizontalConfessionStack({
  confessions,
  activeIndex,
  onActiveChange,
  /** Opens the grid-style lightbox (enlarged image + transcription below). */
  onImageClick,
  // Seconds to wait before the wave-from-center stagger begins. Used by the
  // theme-page entrance choreography so the dial can fade in + spin first
  // and the cards cascade in once it's settled.
  entranceDelay = 0,
  // When false, the per-card mount entrance is skipped so an ancestor can own
  // the entrance instead (the theme page slides the whole stack in, synced to
  // the dial's intro spin). Category changes never remount the cards, so this
  // only affects the first paint.
  mountEntrance = true,
  // When false, the "n / total" counter that normally rides under the active
  // note's transcript is suppressed, so a parent can place it elsewhere (the
  // note-open view pins it to the bottom of the screen instead).
  showInlineCounter = true,
  // Desktop dial view: show the NAVIGATION ESC ← → pill inside this stack and
  // wire ←/→ to step notes (Esc exits via onReturnToIntro). Off by default so
  // other consumers (e.g. NoteOpenView) aren't affected.
  showNavHint = false,
  onReturnToIntro,
  // When true, keyboard + chip nav is suppressed (about modal / note drawer).
  navDisabled = false,
  // Opacity of the background (non-active) notes, by ring distance from centre.
  // Defaults to the shared filmstrip values so the dial page is untouched; the
  // note-open view passes a dimmer set so the neighbours recede much further.
  inactiveOpacity = INACTIVE_OPACITY,
  // When true, the entire DATE / LOCATION block (labels, values, and the divider
  // beneath) crossfades out/in on note change. Off by default so the dial page
  // keeps its static scaffold with only the values re-fading.
  metaBlockCrossfade = false,
  // When true, transcript words appear one-by-one at full opacity (no per-word
  // fade). Used by the EXPLORE tab; the dial page keeps staggered fade-in.
  transcriptInstantWords = false,
}) {
  const scrollRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const playNote = useNoteSound();
  // Active card wrapper — anchors the crossfading meta overlay above the note.
  const [metaAnchorEl, setMetaAnchorEl] = useState(null);
  const inactive = useInactiveCardParams();
  // Live-tunable coverflow depth (Z recession on inactive cards). The per-side
  // x-tilt (rotateY turn) was removed — side notes recede but stay flat / facing
  // forward. Reveal with `?dial=1`; ramp range + ease are fixed.
  const warp = useDialKit('Coverflow', {
    depth: [110, 0, 260, 5], // px — translateZ recession at the screen edge
  });
  const noiseEnabled = inactive.noise?.enabled ?? true;
  const inactiveFilter = [
    inactive.blur > 0 ? `blur(${inactive.blur}px)` : '',
    inactive.grayscale > 0 ? `grayscale(${inactive.grayscale})` : '',
    noiseEnabled ? `url(#${CARD_FILTER_ID})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  // Just the grain (no blur/grayscale) — held briefly on the active card so the
  // note is instantly sharp + full-colour on selection but the noise lingers a
  // beat before clearing.
  const grainOnlyFilter = noiseEnabled ? `url(#${CARD_FILTER_ID})` : 'none';

  const n = confessions.length;
  // Active note's slot within its OWN category (for the "n / total" counter
  // under the note) — same source as the dial's NOTES sub-label, so the two
  // agree. Null when the category has a single note, which hides the counter.
  const categoryInfo = getCategoryBreadcrumbInfo(confessions, confessions[activeIndex]);
  // Which category (out of all distinct categories) the active note belongs to —
  // the CATEGORY counter that used to sit on the dial now rides here, above the
  // note-index breadcrumb. Null when there's only one category.
  const categorySlot = getCategorySlotInfo(confessions, confessions[activeIndex]);
  const nRef = useRef(n);
  nRef.current = n;
  // Cursor-following hint over the active card image ("VIEW NOTE" when enlarge
  // is enabled). Inactive cards no longer show a hover hint.
  const [inactiveTipPos, setInactiveTipPos] = useState(null);
  // Width (px) of the active image *as displayed* — its layout width times the
  // active scale transform. The meta/transcription block is pinned to this so
  // its edges line up with the visibly-scaled image instead of the smaller
  // (unscaled) layout box. A ResizeObserver keeps it in sync across image load,
  // viewport resize and note changes.
  const [activeMediaW, setActiveMediaW] = useState(null);
  // Meta rows + transcript are pinned to ~80% of the displayed image width, so
  // the label/value pairs sit closer together and the transcript reads as a
  // narrower centred column (null until the active image is measured).
  const contentW = activeMediaW ? Math.round(activeMediaW * 0.8) : null;
  const mediaRORef = useRef(null);
  const measureActiveImg = useCallback((el) => {
    if (mediaRORef.current) {
      mediaRORef.current.disconnect();
      mediaRORef.current = null;
    }
    if (!el || typeof ResizeObserver === 'undefined') return;
    const sync = () => {
      // offsetWidth is the pre-transform layout width; multiply by the known
      // active scale to get the on-screen width.
      const w = el.offsetWidth * ACTIVE_IMG_SCALE;
      if (w > 0) setActiveMediaW(w);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    mediaRORef.current = ro;
  }, []);
  useEffect(
    () => () => {
      if (mediaRORef.current) mediaRORef.current.disconnect();
    },
    []
  );
  // Widest displayed note width across the whole set (px). The DATE / LOCATION
  // frame above the active note is pinned to *this* (not the active note's own
  // width) so the titles + the divider under them never reflow as you step
  // between notes — the frame is sized once to "the longest a note could be"
  // and only the values inside it change. We measure each image's natural
  // aspect ratio once (cached) and mirror the `cardImageBox`/`cardImg`
  // constraints: a height-capped box (min(46vh, 512px)) with object-fit
  // contain, width capped at min(84vw, 560px), then the active scale + the same
  // 0.8 inset `contentW` uses.
  const [maxContentW, setMaxContentW] = useState(null);
  const noteDimsRef = useRef(new Map());
  useEffect(() => {
    if (typeof window === 'undefined' || !confessions?.length) return undefined;
    let cancelled = false;
    const dims = noteDimsRef.current;
    const recompute = () => {
      if (cancelled) return;
      const boxH = Math.min(
        window.innerHeight * (CARD_HEIGHT_VH / 100),
        CARD_HEIGHT_MAX
      );
      const boxMaxW = Math.min(
        window.innerWidth * (CARD_WIDTH_VW / 100),
        CARD_WIDTH_MAX
      );
      let widest = 0;
      confessions.forEach((c) => {
        const d = c.image && dims.get(c.image);
        if (!d || !d.w || !d.h) return;
        const layoutW = Math.min(boxH * (d.w / d.h), boxMaxW);
        if (layoutW > widest) widest = layoutW;
      });
      if (widest > 0) setMaxContentW(Math.round(widest * ACTIVE_IMG_SCALE * 0.8));
    };
    confessions.forEach((c) => {
      if (!c.image || dims.has(c.image)) return;
      const img = new Image();
      img.onload = () => {
        dims.set(c.image, { w: img.naturalWidth, h: img.naturalHeight });
        recompute();
      };
      img.src = c.image;
    });
    recompute();
    window.addEventListener('resize', recompute);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', recompute);
    };
  }, [confessions]);
  // Grain-hold: whenever the active note changes, keep the newly-active card's
  // grain for GRAIN_HOLD_MS, then clear it. useLayoutEffect (not useEffect) so
  // the "held" flag is set before paint — otherwise the first painted frame of
  // the new active card would already be de-grained and the hold would flash.
  const [grainHeld, setGrainHeld] = useState(true);
  useLayoutEffect(() => {
    setGrainHeld(true);
    const t = setTimeout(() => setGrainHeld(false), GRAIN_HOLD_MS);
    return () => clearTimeout(t);
  }, [activeIndex]);
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
  // Last scrollWidth we saw in handleScroll. When it changes, a scroll event was
  // driven by the strip RESIZING (a late image committing its intrinsic width),
  // not by the user — so we re-center rather than treat it as a drag.
  const lastScrollWidthRef = useRef(0);
  // Scroll-linked micro-rotation (deg) on card images; decays via the tilt loop.
  const lastScrollLeftForRotateRef = useRef(null);
  const scrollRotateDegRef = useRef(0);
  // Coverflow depth smoothing: a single rAF loop eases each card's depth (tz)
  // toward its live geometric target instead of snapping per scroll event, so
  // the recede glides on both drags and note changes. `tiltCurrentRef` holds each
  // card's eased values keyed by its tilt-target node; `warpRef` mirrors the
  // (dial-tunable) params so a loop frame captured on an earlier render still
  // reads the latest targets.
  const tiltRafRef = useRef(null);
  const tiltLastTsRef = useRef(0);
  const tiltCurrentRef = useRef(new WeakMap());
  const warpRef = useRef({ depth: 0 });
  const updateCardTiltsRef = useRef(() => {});
  // Cursor-float hover (see cursorFloat.js): which card's tilt-target the pointer
  // is over and the lean it's asking for. A ref, not state — the tilt loop reads
  // it every frame, so tracking the pointer costs no re-renders.
  const floatRef = useRef({ el: null, yaw: 0, pitch: 0 });

  // Keep ref aligned with props on every render so useLayoutEffect (mount)
  // and timeouts see the latest index — parent may align activeIndex to the
  // dial category after the first paint.
  activeIndexRef.current = activeIndex;

  const setActiveFromUserScroll = (i) => {
    activeIndexSourceRef.current = 'user';
    onActiveChange(i);
  };

  const setActiveFromClick = (i) => {
    // Post-it "peel" when a note is clicked to focus in the coverflow.
    playNote();
    activeIndexSourceRef.current = 'external';
    onActiveChange(i);
  };

  // ── Keyboard navigation (desktop dial view) ─────────────────
  const [pressedNavKey, setPressedNavKey] = useState(null);
  const navRef = useRef({});
  navRef.current = {
    activeIndex,
    count: n,
    navDisabled,
    onActiveChange,
    onReturnToIntro,
  };

  const runNav = useCallback((id) => {
    const {
      activeIndex: i,
      count,
      navDisabled: blocked,
      onActiveChange: setIdx,
      onReturnToIntro: exit,
    } = navRef.current;
    if (blocked) return;
    if (id === 'left') {
      if (i > 0) setIdx(i - 1);
    } else if (id === 'right') {
      if (i < count - 1) setIdx(i + 1);
    } else if (id === 'esc') {
      exit?.();
    }
  }, []);

  useEffect(() => {
    if (!showNavHint) return undefined;
    // ← / → flip through notes alongside A / D (the legend shows the arrow keys).
    const keyToId = {
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
      Escape: 'esc',
    };
    const onKeyDown = (e) => {
      const id = keyToId[e.key];
      if (!id) return;
      // Don't hijack A / D (or arrows) while typing in a field.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (navRef.current.navDisabled) return;
      if (id !== 'esc') e.preventDefault();
      setPressedNavKey(id);
      runNav(id);
    };
    const onKeyUp = (e) => {
      const id = keyToId[e.key];
      if (!id) return;
      setPressedNavKey((cur) => (cur === id ? null : cur));
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [showNavHint, runNav]);

  const handleNavPress = useCallback(
    (id) => {
      setPressedNavKey(id);
      runNav(id);
    },
    [runNav]
  );
  const handleNavRelease = useCallback((id) => {
    setPressedNavKey((cur) => (cur === id ? null : cur));
  }, []);

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
  // the upper arc as they move outward. A subtle scroll-linked `rotate()` is
  // applied on the image wrapper (see applyTiltPass). Done via direct DOM
  // writes (not React state) so the transform tracks the user's scroll exactly
  // without an extra render per frame.
  const ARC_RADIUS = 2400;         // semi-circle radius in px — bigger = gentler arc
  // Hard cap on vertical drop. Set to 0 to keep cards on a flat horizontal
  // baseline as the user scrolls — no arc-drop. Bump back up (e.g. 50) to
  // restore the wheel-like swoop where side cards trace the top of a
  // circle. If you re-enable, ensure cardWrapper has matching headroom
  // (each side ≥ 0.06 × maxCardHeight + ARC_DROP_MAX) so dropped cards
  // don't get clipped by the scroll container's overflow:hidden.
  const ARC_DROP_MAX = 0;
  // 3D coverflow depth: side (inactive) cards recede in Z by distance from the
  // viewport centre, so the flat strip gains a little depth toward the edges.
  // (The per-side x-tilt / rotateY turn was removed — notes stay flat.) Depth is
  // live-tunable via DialKit; ramp range and ease are fixed constants below.
  const WARP_RANGE_FRAC = 0.62; // viewport-width fraction the recede ramps over
  const WARP_EASE = 0.85; // ramp exponent (<1 = flat centre, steep edges)
  // Frame-rate-independent easing time constants (seconds). TILT_TAU sets how
  // quickly a card's depth chases its geometric target as the strip
  // scrolls (smaller = snappier); ROT_TAU decays the scroll-momentum lean.
  const TILT_TAU = 0.075;
  const ROT_TAU = 0.11;
  // Frames per second the stack's transforms are allowed to redraw at, matching
  // the dissolve's DISSOLVE_FPS so the whole archive steps at one film rate
  // rather than the copy being filmic and the notes being smooth video. The
  // easing above is time-constant based, so a coarser sample rate changes how
  // finely the coverflow and lean are drawn, not how fast they settle. See
  // textDissolve.js for the caveat on which rates a given display can hit.
  const STACK_FRAME_MS = 1000 / 24 - 1;
  // Mirror the (dial-tunable) warp params so a running rAF frame — whose closure
  // was captured on an earlier render — always eases toward the current targets.
  warpRef.current = { depth: warp.depth };

  // One tilt pass. `k` is the per-frame lerp fraction (0..1); k >= 1 snaps to
  // target (immediate applies on mount / resize / dial change). Returns the
  // largest remaining tilt delta so the loop can tell when it has settled.
  const applyTiltPass = (k, kFloat = k) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const cards = el.querySelectorAll('[data-card]');
    if (cards.length === 0) return 0;
    const rm = reduceMotion;
    const { depth } = warpRef.current;
    const float = floatRef.current;
    const containerCenter = el.scrollLeft + el.offsetWidth / 2;
    const rot = rm ? 0 : scrollRotateDegRef.current;
    const halfRange = Math.max(1, el.offsetWidth * WARP_RANGE_FRAC);
    const r2 = ARC_RADIUS * ARC_RADIUS;
    const store = tiltCurrentRef.current;
    let maxDelta = 0;
    cards.forEach((card) => {
      const tiltTarget = card.querySelector('[data-tilt-target]');
      if (!tiltTarget) return;
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distPx = cardCenter - containerCenter;

      // Vertical drop along the upper arc of a circle of radius ARC_RADIUS.
      // y = R - sqrt(R² - x²) — the classic "rise over run" of a circle's arc
      // relative to its peak. Capped so far cards don't free-fall.
      const dropRaw = ARC_RADIUS - Math.sqrt(Math.max(0, r2 - distPx * distPx));
      const dropT = Math.min(ARC_DROP_MAX, dropRaw);

      // Coverflow depth: side cards recede in Z by distance from centre (no
      // rotateY turn — tilt-x removed). pow(<1) keeps the centre near-flat and
      // steepens the recession toward the edges.
      const tRaw = Math.max(-1, Math.min(1, distPx / halfRange));
      const tEased = Math.sign(tRaw) * Math.pow(Math.abs(tRaw), WARP_EASE);
      const tzT = rm ? 0 : -Math.abs(tEased) * depth;

      // Cursor float: the hovered card leans toward the pointer and rises; every
      // other card sits at zero. `hov` ramps 0→1 so the lift and rise fade in
      // with the lean instead of snapping on at pointer-enter.
      const hovered = !rm && float.el === tiltTarget;
      const yawT = hovered ? float.yaw : 0;
      const pitchT = hovered ? float.pitch : 0;
      const hovT = hovered ? 1 : 0;

      let cur = store.get(tiltTarget);
      if (!cur) {
        // First sighting of this card: start already on target (no glide-in).
        cur = { tz: tzT, drop: dropT, yaw: yawT, pitch: pitchT, hov: hovT };
        store.set(tiltTarget, cur);
      }
      if (k >= 1) {
        cur.tz = tzT;
        cur.drop = dropT;
      } else {
        const dZ = tzT - cur.tz;
        const dD = dropT - cur.drop;
        cur.tz += dZ * k;
        cur.drop += dD * k;
        // Depth (tz) drives the settle test; it's large-valued so scale its
        // contribution down, drop is tiny so counts as-is.
        const d = Math.max(Math.abs(dZ) * 0.1, Math.abs(dD));
        if (d > maxDelta) maxDelta = d;
      }
      // The float eases on its own (snappier) time constant so the lean stays
      // glued to the pointer while the coverflow depth keeps its slower glide.
      if (kFloat >= 1) {
        cur.yaw = yawT;
        cur.pitch = pitchT;
        cur.hov = hovT;
      } else {
        const dY = yawT - cur.yaw;
        const dP = pitchT - cur.pitch;
        const dH = hovT - cur.hov;
        cur.yaw += dY * kFloat;
        cur.pitch += dP * kFloat;
        cur.hov += dH * kFloat;
        // Angles are degrees and hov is 0..1; scale hov up so a lift still in
        // flight keeps the loop awake.
        const d = Math.max(Math.abs(dY), Math.abs(dP), Math.abs(dH) * 4);
        if (d > maxDelta) maxDelta = d;
      }
      // translateZ (push back) = the coverflow depth plus the hover rise;
      // translateY/rotate carry the arc-drop + scroll-momentum spin; rotateX/
      // rotateY are the cursor lean.
      //
      // A leaning card gets its OWN perspective so the lean matches INDEX exactly.
      // Left to the scroller's shared perspective it would pivot around the
      // viewport centre instead of its own, shearing the note as it tips. This is
      // only safe because the card that can lean is always the active, centred one,
      // whose coverflow depth is ~0 — so the local perspective has no depth of its
      // own to foreshorten and can't disturb the coverflow. Prepended only while
      // actually leaning, to keep every other card's projection untouched.
      const z = cur.tz + cur.hov * CURSOR_FLOAT.rise;
      const leaning = cur.hov > 0.001;
      tiltTarget.style.transform =
        (leaning ? `perspective(${CURSOR_FLOAT.perspective}px) ` : '') +
        `translateY(${cur.drop.toFixed(2)}px) translateZ(${z.toFixed(2)}px) ` +
        `rotate(${rot.toFixed(2)}deg) ` +
        `rotateX(${cur.pitch.toFixed(2)}deg) rotateY(${cur.yaw.toFixed(2)}deg) ` +
        `scale(${(1 + cur.hov * CURSOR_FLOAT.lift).toFixed(4)})`;
    });
    return maxDelta;
  };

  // Immediate (un-eased) apply — mount / resize / dial change want the tilt to
  // be correct on the very next paint, not glide in from wherever it was.
  const applyTiltsImmediate = () => {
    applyTiltPass(1, 1);
  };
  updateCardTiltsRef.current = applyTiltsImmediate;

  // Pointer moved over a card: record the lean it's asking for and wake the loop.
  const trackCardFloat = (e) => {
    if (reduceMotion) return;
    const off = cursorOffset(e.currentTarget, e.clientX, e.clientY);
    if (!off) return;
    const { yaw, pitch } = floatAngles(off.nx, off.ny);
    floatRef.current = { el: e.currentTarget, yaw, pitch };
    ensureTiltLoop();
  };

  const clearCardFloat = () => {
    if (!floatRef.current.el) return;
    floatRef.current = { el: null, yaw: 0, pitch: 0 };
    ensureTiltLoop();
  };

  const tiltLoop = (ts) => {
    const lastTs = tiltLastTsRef.current;
    // Hold the transforms already on screen until the next film frame is due.
    // A woken loop (lastTs 0) always draws immediately, so a pointer landing on
    // a card still leans on the very next paint rather than waiting out a frame.
    if (lastTs && ts - lastTs < STACK_FRAME_MS) {
      tiltRafRef.current = requestAnimationFrame(tiltLoop);
      return;
    }
    let dt = (ts - (lastTs || ts)) / 1000;
    tiltLastTsRef.current = ts;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1; // clamp long gaps (tab away) so nothing lurches
    // Decay the scroll-momentum lean back toward straight.
    if (!reduceMotion && Math.abs(scrollRotateDegRef.current) >= 0.02) {
      scrollRotateDegRef.current *= Math.exp(-dt / ROT_TAU);
      if (Math.abs(scrollRotateDegRef.current) < 0.02) scrollRotateDegRef.current = 0;
    } else {
      scrollRotateDegRef.current = 0;
    }
    const k = 1 - Math.exp(-dt / TILT_TAU);
    const kFloat = 1 - Math.exp(-dt / CURSOR_FLOAT.tau);
    const maxDelta = applyTiltPass(k, kFloat);
    const rotActive = Math.abs(scrollRotateDegRef.current) > 0.02;
    if (maxDelta > 0.02 || rotActive) {
      tiltRafRef.current = requestAnimationFrame(tiltLoop);
    } else {
      applyTiltPass(1, 1); // land exactly on target, then rest
      tiltRafRef.current = null;
      tiltLastTsRef.current = 0;
    }
  };

  // Kick the smoothing loop (idempotent). Called on every scroll event so the
  // tilt keeps easing while the strip moves — user drags AND programmatic
  // smooth-scrolls (card click / arrow keys / dial). Reduced-motion snaps.
  const ensureTiltLoop = () => {
    if (reduceMotion) {
      applyTiltPass(1);
      return;
    }
    if (tiltRafRef.current != null) return;
    tiltLastTsRef.current = 0;
    tiltRafRef.current = requestAnimationFrame(tiltLoop);
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
      const card = cards[MIDDLE_COPY * n + activeIndexRef.current];
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
      updateCardTiltsRef.current();
    };
    tryInit();
    return () => {
      cancelled = true;
    };
    // We deliberately only run on mount — re-running on activeIndex change
    // is handled by the dedicated effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply the coverflow warp the instant a "Coverflow" dial changes. The
  // per-card transforms are otherwise only rewritten on scroll / resize, so
  // without this the panel wouldn't visibly update until the next scroll event.
  useLayoutEffect(() => {
    updateCardTiltsRef.current();
  }, [warp.depth]);

  // Hold the "layout settled" gate closed until image decode/reflow actually
  // stops, keeping the active card pinned to center throughout. A fixed timer
  // was too optimistic on a COLD first open (notably the EXPLORE tab): the ~100
  // card images decode past the timer, each commit grows the strip and shifts
  // the active card, and the browser's scroll-anchoring nudges `scrollLeft`.
  // With the gate already open those reflow scrolls were misread as USER
  // scrolls — handleScroll would latch onto whatever card was momentarily
  // nearest center (a random note) and smooth-snap to it, so the coverflow
  // visibly "scrolled through notes and highlighted a random image" on entry.
  // Instead we watch the strip's scrollWidth: while it's still growing we
  // re-pin the active note under the center; only once it holds still (or a
  // safety ceiling) do we open the user-scroll / snap gate.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let raf = 0;
    let cancelled = false;
    let lastW = -1;
    const start = performance.now();
    // Settle once every card image has resolved (loaded OR errored — both flip
    // `complete`), so a slow connection that streams images in bursts can't trip
    // an early "quiet" window and then shift the strip out from under us. The
    // ceiling is only a safety net for a genuinely stuck request; kept generous
    // so a slow (but working) connection still settles on real image loads.
    const CEILING_MS = 15000;

    // Re-pin the middle copy's active card to the viewport center (instant,
    // flagged programmatic so its scroll event is ignored, not read as a drag).
    // Called every frame while settling so the focal note stays glued to center
    // and neighbours fill in AROUND it rather than shoving it aside.
    const repin = () => {
      const ni = nRef.current;
      if (!hasInitialScrolledRef.current || ni <= 0) return;
      const cards = el.querySelectorAll('[data-card]');
      const card = cards[MIDDLE_COPY * ni + activeIndexRef.current];
      if (!card) return;
      const target = Math.max(0, card.offsetLeft + card.offsetWidth / 2 - el.offsetWidth / 2);
      if (Math.abs(el.scrollLeft - target) > 1) {
        isProgScrollingRef.current = true;
        progScrollTargetRef.current = target;
        el.scrollLeft = target;
      }
    };

    const settle = () => {
      measureCopyWidth();
      repin();
      // Record the final width so the user's first real scroll after load isn't
      // misread as reflow by handleScroll's scrollWidth guard.
      lastScrollWidthRef.current = el.scrollWidth;
      requestAnimationFrame(() => {
        isProgScrollingRef.current = false;
        progScrollTargetRef.current = null;
      });
      layoutSettledRef.current = true;
      updateCardTiltsRef.current();
    };

    const allImagesResolved = () => {
      const imgs = el.querySelectorAll('img');
      if (imgs.length === 0) return false;
      for (let i = 0; i < imgs.length; i++) {
        if (!imgs[i].complete) return false;
      }
      return true;
    };

    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const w = el.scrollWidth;
      if (w !== lastW) {
        // Strip grew (another image committed its width) → refresh copy-width
        // and tilt math so the coverflow warp tracks the new geometry.
        lastW = w;
        measureCopyWidth();
        updateCardTiltsRef.current();
      }
      // Hold the focal note centered against the growing strip.
      repin();
      // Settle when every image has resolved (once we've actually pinned), or
      // unconditionally at the ceiling so the loop can never run forever (e.g.
      // if cards never gain width because every image failed to load).
      const timedOut = now - start >= CEILING_MS;
      if (timedOut || (hasInitialScrolledRef.current && allImagesResolved())) {
        settle();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── External activeIndex changes → scroll to closest copy ──
  useEffect(() => {
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
      if (tiltRafRef.current != null) {
        cancelAnimationFrame(tiltRafRef.current);
        tiltRafRef.current = null;
      }
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

    // Reflow guard: if the strip's scrollWidth changed, this scroll event was
    // caused by a late image committing its intrinsic width (which the browser's
    // scroll anchoring nudges), NOT by the user. Re-pin the focal note under the
    // center instead of latching onto whichever card the reflow slid past — that
    // misread was what made the coverflow "scroll through notes and highlight a
    // random image" on the first (cold) open.
    const sw = el.scrollWidth;
    const swChanged = sw !== lastScrollWidthRef.current;
    lastScrollWidthRef.current = sw;
    if (swChanged && !isProgScrollingRef.current) {
      const ni = nRef.current;
      if (ni > 0 && hasInitialScrolledRef.current) {
        const cards = el.querySelectorAll('[data-card]');
        const card = cards[MIDDLE_COPY * ni + activeIndexRef.current];
        if (card) {
          const maxScroll = el.scrollWidth - el.clientWidth;
          const target = Math.max(
            0,
            Math.min(card.offsetLeft + card.offsetWidth / 2 - el.offsetWidth / 2, maxScroll)
          );
          if (Math.abs(el.scrollLeft - target) > 1) {
            isProgScrollingRef.current = true;
            progScrollTargetRef.current = target;
            el.scrollLeft = target;
          }
        }
      }
      ensureTiltLoop();
      lastScrollLeftForRotateRef.current = el.scrollLeft;
      return;
    }

    const sl = el.scrollLeft;
    const prevSl = lastScrollLeftForRotateRef.current;
    if (!reduceMotion && prevSl !== null && !isProgScrollingRef.current) {
      const delta = sl - prevSl;
      if (Math.abs(delta) > 0.25) {
        // scrollLeft increases → strip moves left → slight counter-rotation reads as "leaning into" the motion
        scrollRotateDegRef.current = Math.max(
          -4.2,
          Math.min(4.2, scrollRotateDegRef.current * 0.93 - delta * 0.0095)
        );
      }
    }
    lastScrollLeftForRotateRef.current = sl;

    // Tilts follow scroll position regardless of source (user or programmatic)
    // — smooth-snaps and dial-driven scrolls rotate the cards too. The loop
    // eases each card's tilt toward its live target and self-stops when settled.
    ensureTiltLoop();

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
        lastScrollLeftForRotateRef.current = el.scrollLeft;
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

    // Until layout has settled, ignore geometry-derived index changes. Early
    // scroll/reflow events otherwise mark the source as 'user' and skip the
    // parent's dial-aligned scroll — leaving no card matching `activeIndex`
    // (everything reads as inactive / blurred).
    if (layoutSettledRef.current && logicalIdx !== activeIndexRef.current) {
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

  const inactiveTipFlipLeft =
    inactiveTipPos != null &&
    inactiveTipPos.x + INACTIVE_TOOLTIP_GAP + INACTIVE_TOOLTIP_EST_WIDTH >
      (typeof window !== 'undefined' ? window.innerWidth : 0) - 8;

  return (
    // Non-scrolling viewport wrapper. The horizontal filmstrip scrolls inside
    // it, but the nav legend is pinned to this box (which never scrolls) so it
    // stays at top-center instead of riding off-screen with the cards.
    <div style={st.stackViewport}>
      {showNavHint ? (
        <DialNavHint
          pressedKey={pressedNavKey}
          onPress={handleNavPress}
          onRelease={handleNavRelease}
          showExit={false}
        />
      ) : null}
      {metaBlockCrossfade ? (
        <MetaCrossfadeSlot
          confession={confessions[activeIndex]}
          reduceMotion={reduceMotion}
          // Track the ACTIVE note's content width (same `contentW` the transcript
          // below uses) so the DATE / LOCATION / THEME block lines up edge-to-edge
          // with the transcript, rather than the widest-note `maxContentW`.
          columnWidth={contentW || maxContentW || '80%'}
          anchorEl={metaAnchorEl}
        />
      ) : null}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseLeave={() => setInactiveTipPos(null)}
        style={st.scrollContainer}
      >
        <CardNoiseFilterDefs params={inactive} />
      {renderItems.map((item, renderIdx) => {
        const isActive = item.logicalIndex === activeIndex;
        // Visual proximity to the centered note using global render position
        // (copy * n + index) so the seam between infinite-scroll copies is
        // handled — the note that wraps around still counts as ring 1.
        const ringDist = Math.abs(
          item.copy * n + item.logicalIndex - (MIDDLE_COPY * n + activeIndex)
        );
        const cardKey = `${item.copy}-${item.confession.id}`;
        // Within-category `n/total notes` is drawn on the dial under the active label.
        // Stagger the entrance as a wave radiating outward from the active
        // card — that's where the user is focused on mount, so the focal
        // card appears first and its neighbours wash in around it. Outer
        // copies (off-screen buffer for infinite scroll) never get
        // staggered since the user can't see them entering. Per-step
        // spacing (seconds between each ring from the active card) capped
        // so very long lists do not wait forever on the far edges.
        const staggerDelay =
          item.copy === MIDDLE_COPY
            ? Math.min(Math.abs(item.logicalIndex - activeIndex) * 0.12, 1.15)
            : 0;
        const canEnlargeImage =
          !!onImageClick && isActive && item.copy === MIDDLE_COPY;
        // The cursor float rides the centred note whether or not clicking it
        // enlarges — it's hover feedback, not an affordance for the click.
        const canFloat = isActive && item.copy === MIDDLE_COPY;
        return (
          <motion.div
            key={cardKey}
            data-card
            // Marks the note the stack is centering on. NoteOpenView's entrance
            // morph reads this to fly the bridge image onto the *right* card
            // (not merely whichever card is momentarily nearest centre mid-scroll).
            data-active={isActive || undefined}
            // Anchors the meta block above this note. Deliberately the WRAPPER
            // and not the image box inside it: the image box is the tilt target,
            // so its box carries the cursor lean, the hover rise and the
            // scroll-momentum spin, and a block measured off it jitters up and
            // down while you hover the note. The wrapper is never transformed
            // and — with the image box as its only in-flow child here — sits at
            // exactly the same place, so the resting position is unchanged.
            ref={
              metaBlockCrossfade && isActive && item.copy === MIDDLE_COPY
                ? (el) => setMetaAnchorEl(el)
                : undefined
            }
            initial={reduceMotion || !mountEntrance ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduceMotion || !mountEntrance
                ? { duration: 0 }
                : {
                    duration: 0.22,
                    ease: EASE_OUT,
                    delay: staggerDelay + entranceDelay,
                  }
            }
            onClick={() => setActiveFromClick(item.logicalIndex)}
            style={{
              ...st.cardWrapper,
              cursor: isActive ? 'default' : 'pointer',
              willChange: 'transform, opacity',
            }}
          >
            {isActive && item.copy === MIDDLE_COPY && !metaBlockCrossfade ? (
              // Anchored OUT OF FLOW just above the image so the metadata never
              // pushes the image down when a note goes active — the image box
              // stays the card's only in-flow element and holds its level.
              <div style={st.metaAboveAnchor}>
                <NoteMeta
                  confession={item.confession}
                  reduceMotion={reduceMotion}
                  columnWidth={maxContentW || contentW || '80%'}
                />
              </div>
            ) : null}
            <div
              data-tilt-target
              style={{
                ...st.cardImageBox,
                ...(canEnlargeImage ? { cursor: 'zoom-in' } : null),
              }}
              onClick={
                canEnlargeImage
                  ? (e) => {
                      e.stopPropagation();
                      onImageClick(item.confession);
                    }
                  : undefined
              }
              // Active card only: float the note toward the cursor, and — when the
              // click actually enlarges — trail a "VIEW NOTE" hint alongside it.
              onMouseEnter={
                canFloat
                  ? (e) => {
                      if (canEnlargeImage) {
                        setInactiveTipPos({ x: e.clientX, y: e.clientY, label: ACTIVE_CARD_TOOLTIP });
                      }
                      trackCardFloat(e);
                    }
                  : undefined
              }
              onMouseMove={
                canFloat
                  ? (e) => {
                      if (canEnlargeImage) {
                        setInactiveTipPos({ x: e.clientX, y: e.clientY, label: ACTIVE_CARD_TOOLTIP });
                      }
                      trackCardFloat(e);
                    }
                  : undefined
              }
              onMouseLeave={
                canFloat
                  ? () => {
                      if (canEnlargeImage) setInactiveTipPos(null);
                      clearCardFloat();
                    }
                  : undefined
              }
            >
              <img
                ref={
                  isActive && item.copy === MIDDLE_COPY
                    ? measureActiveImg
                    : undefined
                }
                src={item.confession.image}
                alt={`Confession ${item.confession.id}`}
                draggable={false}
                // Off the raster path, like the grid's tiles and the vertical
                // stack's cards. The strip carries COPY_COUNT × every note for
                // the infinite scroll, so a synchronous decode here is paid on
                // the frame the view is trying to appear on. (Not `lazy`: the
                // cards take their width from the image's intrinsic size, and
                // `allImagesResolved` gates the coverflow's geometry on every
                // image having loaded — an unloaded neighbour collapses the
                // strip and the stride math with it.)
                decoding="async"
                style={{
                  ...st.cardImg,
                  opacity: isActive
                    ? 1
                    : ringDist <= 1
                      ? inactiveOpacity.near
                      : inactiveOpacity.far,
                  transform: `scale(${isActive ? ACTIVE_IMG_SCALE : inactive.scale})`,
                  // Active card sharpens/brightens immediately but keeps its
                  // grain for GRAIN_HOLD_MS (grainHeld), then clears — a slight
                  // delay before the noise wears off.
                  filter: isActive
                    ? grainHeld
                      ? grainOnlyFilter
                      : 'none'
                    : inactiveFilter || 'none',
                }}
              />
            </div>

            {isActive &&
            item.copy === MIDDLE_COPY &&
            (item.confession.transcription ||
              (showInlineCounter && (categorySlot || categoryInfo))) ? (
              <div
                style={{
                  ...st.metaBlock,
                  // Desktop: drop metaBlock's in-flow top margin so the transcript
                  // (already absolute via belowImageStack) contributes zero flow
                  // height and the image can't shift. The gap below the image now
                  // lives on belowImageStack's offset instead.
                  marginTop: 0,
                  ...(contentW ? { width: contentW, maxWidth: contentW } : null),
                }}
                aria-live="polite"
              >
                {/* Transcript + note-index share one out-of-flow stack anchored
                    below the image, so a long confession never grows the card
                    and the index always sits directly beneath the transcript. */}
                <div style={st.belowImageStack}>
                  {item.confession.transcription ? (
                    <TranscriptReveal
                      key={item.confession.id}
                      text={item.confession.transcription}
                      reduceMotion={reduceMotion}
                      instantWords={transcriptInstantWords}
                    />
                  ) : null}
                  {showInlineCounter && (categorySlot || categoryInfo) ? (
                    // Breadcrumb footer: CATEGORY (which theme out of all themes)
                    // above NOTE (slot within this theme). Labeled + aligned as a
                    // two-column table so the two "n / total" fractions can't be
                    // confused. The CATEGORY row is what moved off the dial.
                    <motion.div
                      style={st.indexTable}
                      initial={reduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{
                        duration: reduceMotion ? 0 : TRANSCRIPT_FADE_S,
                        ease: EASE_OUT,
                        delay: reduceMotion ? 0 : META_TIMING.metaRow / 1000,
                      }}
                    >
                      {categorySlot ? (
                        <div
                          style={st.indexRow}
                          aria-label={`Category ${categorySlot.position + 1} of ${categorySlot.total}`}
                        >
                          <span style={st.indexLabel}>CATEGORY</span>
                          <span style={st.noteIndex}>
                            <span style={st.noteIndexCurrent}>{categorySlot.position + 1}</span>
                            <span style={st.noteIndexTotal}>{` / ${categorySlot.total}`}</span>
                          </span>
                        </div>
                      ) : null}
                      {categoryInfo ? (
                        <div
                          style={st.indexRow}
                          aria-label={`Note ${categoryInfo.position + 1} of ${categoryInfo.total} in this category`}
                        >
                          <span style={st.indexLabel}>NOTE</span>
                          <span style={st.noteIndex}>
                            <span style={st.noteIndexCurrent}>{categoryInfo.position + 1}</span>
                            <span style={st.noteIndexTotal}>{` / ${categoryInfo.total}`}</span>
                          </span>
                        </div>
                      ) : null}
                    </motion.div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </motion.div>
        );
      })}
      {/* Portaled to <body>: the tooltip is `position: fixed` (viewport coords
          from the cursor), but the scroll container sets `perspective`, which —
          like `transform` — makes it the containing block for fixed descendants.
          Rendered here it would resolve against the scrolled strip and fly
          thousands of px off-screen; the portal keeps it anchored to the cursor. */}
      {inactiveTipPos?.label && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              style={{
                ...st.inactiveCardTooltip,
                top: inactiveTipPos.y + INACTIVE_TOOLTIP_GAP,
                ...(inactiveTipFlipLeft
                  ? {
                      left: inactiveTipPos.x - INACTIVE_TOOLTIP_GAP,
                      transform: 'translateX(-100%)',
                    }
                  : { left: inactiveTipPos.x + INACTIVE_TOOLTIP_GAP }),
              }}
            >
              {inactiveTipPos.label}
            </div>,
            document.body
          )
        : null}
      </div>
    </div>
  );
}

/** Gap between the crossfading meta block and the note image top (px). */
const META_CROSSFADE_GAP = 24;

/** How long the block takes to glide to the incoming note's measure. */
const META_SLOT_MOVE_S = 0.42;
/** How long the outgoing value takes to clear before the new one types in. */
const META_VALUE_EXIT_S = 0.14;
/**
 * Offset between the DATE row starting to type and the LOCATION row following.
 * Short enough that they still read as one block arriving — long enough that the
 * block is read top-down instead of both rows switching on at once.
 */
const META_ROW_STAGGER_S = 0.1;

/**
 * Pins the DATE / LOCATION block above the active card's image.
 *
 * The block is a PERSISTENT frame: labels and divider mount once and stay put,
 * and only the values swap as the centred note changes (see NoteMeta's
 * `crossfadeBlock` branch). Its measure still tracks the active note — the
 * column is 80% of that note's width, so the divider and the value column both
 * shift — but it animates there rather than cutting.
 *
 * Position comes from the centred card, with one wrinkle: on the axis the stack
 * scrolls, the centred card is by definition at the scrollport's midpoint, so we
 * read the midpoint instead of the card. Reading the card there would catch the
 * incoming note wherever it currently sits off-screen and throw the block out to
 * meet it, then drag it back as the stack scrolls in.
 */
function MetaCrossfadeSlot({ confession, reduceMotion, columnWidth, anchorEl }) {
  const slotRef = useRef(null);
  const [pos, setPos] = useState(null);
  // Until the first measurement lands the block has no meaningful position, so
  // it snaps there; only later moves are worth animating.
  const placed = useRef(false);

  useLayoutEffect(() => {
    if (!anchorEl) {
      setPos(null);
      return undefined;
    }
    const scrollEl = anchorEl.closest('[data-card], [data-vcard]')?.parentElement;
    const update = () => {
      const parent = slotRef.current?.offsetParent?.getBoundingClientRect();
      if (!parent) return;
      const anchor = anchorEl.getBoundingClientRect();
      const port = scrollEl?.getBoundingClientRect();
      const metaH = slotRef.current?.offsetHeight ?? 0;
      const scrollsX = !!port && scrollEl.scrollWidth > scrollEl.clientWidth + 1;
      const scrollsY = !!port && scrollEl.scrollHeight > scrollEl.clientHeight + 1;
      const midX = scrollsX ? port.left + port.width / 2 : anchor.left + anchor.width / 2;
      const cardTop = scrollsY ? port.top + (port.height - anchor.height) / 2 : anchor.top;
      const next = {
        top: cardTop - parent.top - META_CROSSFADE_GAP - metaH,
        left: midX - parent.left,
      };
      // Scroll fires this every frame; bail on no-ops so a scroll in progress
      // can't keep restarting the glide out from under itself.
      setPos((prev) =>
        prev && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5
          ? prev
          : next
      );
    };
    update();
    const raf = requestAnimationFrame(update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(anchorEl);
    if (slotRef.current) ro?.observe(slotRef.current);
    window.addEventListener('resize', update);
    scrollEl?.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', update);
      scrollEl?.removeEventListener('scroll', update);
    };
  }, [anchorEl, confession?.id, columnWidth]);

  useEffect(() => {
    if (pos) placed.current = true;
  }, [pos]);

  if (!confession) return null;
  const date = confession?.metadata?.date || '';
  const location = confession?.metadata?.location || '';
  if (!date && !location) return null;

  return (
    <motion.div
      ref={slotRef}
      // `x` rather than a `transform` string: motion owns the transform on its
      // own elements, so the centring offset has to go through it.
      style={{ position: 'absolute', x: '-50%', zIndex: 6, pointerEvents: 'none' }}
      initial={false}
      animate={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? 0,
        width: columnWidth,
        opacity: pos ? 1 : 0,
      }}
      transition={
        reduceMotion || !placed.current
          ? { duration: 0 }
          : { duration: META_SLOT_MOVE_S, ease: EASE_OUT }
      }
    >
      <NoteMeta
        confession={confession}
        reduceMotion={reduceMotion}
        columnWidth="100%"
        crossfadeBlock
      />
    </motion.div>
  );
}

/**
 * Reveals a metadata value with the same stagger the transcription uses: tokens
 * appear one at a time on TRANSCRIPT_REVEAL.wordStagger beats, each fading over
 * wordFadeS. Split per CHARACTER rather than per word (TranscriptReveal splits on
 * whitespace) because these values are only a token or two long — a date like
 * "4/22/2026" is a single word and would get no stagger at all.
 *
 * `delay` holds the whole value back, which is how the rows of the block are
 * offset from one another (see META_ROW_STAGGER_S).
 */
function MetaValueReveal({ text, reduceMotion, delay = 0 }) {
  return (
    // A motion root so the outgoing value can clear itself before the incoming
    // one types in (the caller swaps these inside an AnimatePresence).
    <motion.span
      style={st.sideMetaValue}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : META_VALUE_EXIT_S, ease: EASE_OUT }}
    >
      {!text || reduceMotion
        ? text
        : [...text].map((ch, i) => (
            <motion.span
              key={i}
              // `pre` keeps the spaces inside a value from collapsing now that each
              // character is its own span.
              style={{ whiteSpace: 'pre' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{
                duration: TRANSCRIPT_REVEAL.wordFadeS,
                ease: EASE_OUT,
                delay: delay + i * TRANSCRIPT_REVEAL.wordStagger,
              }}
            >
              {ch}
            </motion.span>
          ))}
    </motion.span>
  );
}

/**
 * Date + Location shown above the note image as a two-row labelled key/value
 * block: a DATE row and a LOCATION row, each split 50/50 — the label fills the
 * left half and the value is left-aligned from the horizontal midpoint.
 * Sourced from sheet columns P (Date) and Q (Location). On the EXPLORE tab the
 * frame persists across notes and only the values swap, staggering in per
 * character (see MetaValueReveal); the dial page fades each value in as one
 * piece after META_TIMING.metaRow.
 */
export function NoteMeta({ confession, reduceMotion, columnWidth = '100%', crossfadeBlock = false }) {
  const date = confession?.metadata?.date || '';
  const location = confession?.metadata?.location || '';
  if (!date && !location) return null;

  // Always render BOTH labels (even if a value is blank) so the scaffold's
  // height never changes note-to-note — a missing value must not drop a row and
  // shift the divider up. Only the values differ.
  const rows = [
    ['DATE', date],
    ['LOCATION', location],
  ];

  if (crossfadeBlock) {
    // EXPLORE tab: the label scaffold and divider are a fixed frame that stays
    // mounted across note changes — only the values swap, so the block reads as
    // one continuous object being relabelled rather than something that blinks
    // out and back. Values reveal on the transcript's stagger, which is why the
    // outgoing one clears first (mode="wait") instead of crossfading under it.
    //
    // The rows are offset from each other rather than typing in together, so the
    // block resolves downward the way it's read.
    return (
      <div style={{ ...st.metaAboveRow, width: columnWidth }}>
        {rows.map(([label, value], row) => (
          <div key={label} style={st.metaAboveItem}>
            <span style={st.sideMetaLabel}>{label}</span>
            <AnimatePresence mode="wait" initial={false}>
              <MetaValueReveal
                key={`${confession?.id}-${label}`}
                text={value}
                reduceMotion={reduceMotion}
                delay={row * META_ROW_STAGGER_S}
              />
            </AnimatePresence>
          </div>
        ))}
      </div>
    );
  }

  return (
    // The DATE / LOCATION scaffold — labels + divider — is identical for every
    // note (fixed width via `columnWidth`, fixed row count), so it stays put and
    // reads as a fixed frame anchored over the active card. Only the *values*
    // fade as the active note changes; each value is keyed to its text so
    // switching notes re-fades it in.
    <div style={{ ...st.metaAboveRow, width: columnWidth }}>
      {rows.map(([label, value]) => (
        <div key={label} style={st.metaAboveItem}>
          <span style={st.sideMetaLabel}>{label}</span>
          <motion.span
            key={value || `${label}-empty`}
            style={st.sideMetaValue}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: reduceMotion ? 0 : TRANSCRIPT_FADE_S,
              ease: EASE_OUT,
              delay: reduceMotion ? 0 : META_TIMING.metaRow / 1000,
            }}
          >
            {value}
          </motion.span>
        </div>
      ))}
    </div>
  );
}

/**
 * Transcription for the active card. After META_TIMING.transcriptStart, words
 * stagger-fade in on a TRANSCRIPT_REVEAL.wordStagger cadence. All words are laid
 * out from the first frame (opacity only), so the block's height is stable while
 * they appear. Rendered absolutely below the date row (st.transcriptReveal) so a
 * long confession never changes the card's height.
 */
/** Vertical fade (px) applied to the transcript's top/bottom edge when there's
 *  clipped text in that direction — a scroll affordance that masks the text
 *  itself, so it reads correctly over the category gradient regardless of hue. */
const TRANSCRIPT_FADE_EDGE = 22;

function transcriptFadeMask(fadeTop, fadeBottom) {
  const e = `${TRANSCRIPT_FADE_EDGE}px`;
  if (fadeTop && fadeBottom) {
    return `linear-gradient(to bottom, transparent 0, #000 ${e}, #000 calc(100% - ${e}), transparent 100%)`;
  }
  if (fadeTop) return `linear-gradient(to bottom, transparent 0, #000 ${e})`;
  if (fadeBottom) return `linear-gradient(to bottom, #000 calc(100% - ${e}), transparent 100%)`;
  return 'none';
}

function TranscriptReveal({ text, reduceMotion, instantWords = false }) {
  const words = useMemo(() => text.trim().split(/\s+/), [text]);
  const scrollRef = useRef(null);
  // The dissolve paints into `hostRef` (a positioned wrapper sized to the full
  // transcript, so a scrolled-off tail is rasterized too) from the words laid
  // out inside `textRef`.
  const hostRef = useRef(null);
  const textRef = useRef(null);
  // Whether there's clipped (scrollable) text above / below the current view.
  const [fade, setFade] = useState({ top: false, bottom: false });

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setFade((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom }
    );
  }, []);

  // Re-measure on text change and after layout / word-reveal settles (async
  // font load can change scrollHeight after first paint).
  useEffect(() => {
    updateFade();
    const t1 = setTimeout(updateFade, 80);
    const t2 = setTimeout(updateFade, 450);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [text, updateFade]);

  const maskImage = transcriptFadeMask(fade.top, fade.bottom);

  // Mounted per note (both stacks key this component by confession id), so the
  // dissolve replays from the top every time the active note changes. The delay
  // is the storyboard's own transcript beat, which also puts the raster safely
  // after the card's entrance has settled — measuring a mid-transform host
  // would rasterize at the wrong size.
  const { live, engaged } = useTextDissolve({
    hostRef,
    textRef,
    seedText: text,
    delayS: META_TIMING.transcriptStart / 1000,
    maxBlur: TRANSCRIPT_DISSOLVE.maxBlur,
    stiffness: TRANSCRIPT_DISSOLVE.stiffness,
    chroma: TRANSCRIPT_DISSOLVE.chroma,
    doneAt: TRANSCRIPT_DISSOLVE.doneAt,
    handoffS: TRANSCRIPT_DISSOLVE.handoffS,
    glow: INK, // the site's warm off-white, so the front's flare reads as ink
    disabled: reduceMotion,
  });

  return (
    <>
      <style>{'.transcript-reveal::-webkit-scrollbar{width:0;height:0;display:none}'}</style>
      <div
        ref={scrollRef}
        className="transcript-reveal"
        onScroll={updateFade}
        style={{ ...st.transcriptReveal, WebkitMaskImage: maskImage, maskImage }}
      >
        {reduceMotion ? (
          text
        ) : (
          <div ref={hostRef} style={{ position: 'relative' }}>
            <div ref={textRef}>
              {words.map((word, i) => (
                <motion.span
                  key={i}
                  data-word=""
                  initial={{ opacity: 0 }}
                  // Held at 0 while the canvas has the floor; `live` is the
                  // hand-off (dissolve done) or, with no WebGL, the cue to run
                  // the word stagger that used to be the only reveal.
                  animate={{ opacity: live ? 1 : 0 }}
                  transition={
                    engaged
                      ? // Cross-fade under the canvas fading out, in step with it.
                        { duration: TRANSCRIPT_DISSOLVE.handoffS, ease: 'linear' }
                      : {
                          // EXPLORE: each word pops in at full opacity on its beat
                          // (no per-word fade). Dial page keeps the staggered
                          // fade-in. No transcriptStart delay here — `live` only
                          // flips at that beat.
                          duration: instantWords ? 0 : TRANSCRIPT_REVEAL.wordFadeS,
                          ease: EASE_OUT,
                          delay: i * TRANSCRIPT_REVEAL.wordStagger,
                        }
                  }
                >
                  {word}
                  {/* Reports this line's true baseline to the rasterizer; see
                      BASELINE_PROBE_STYLE. Must sit between the word and its
                      trailing space. */}
                  <i data-baseline="" aria-hidden="true" style={BASELINE_PROBE_STYLE} />
                  {i < words.length - 1 ? ' ' : ''}
                </motion.span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Mobile-only vertical carousel. The horizontal filmstrip's left/right coverflow
 * has no room on a phone, so notes stack vertically here: the active note is
 * centred and full-colour while the previous peeks from the top edge and the
 * next from the bottom, both dimmed + grained (same B&W degradation as the
 * horizontal neighbours). Navigation is native vertical scroll-snap — swipe
 * up/down — and the centred note is detected on scroll and reported upward so
 * the parent's counter tracks the current category.
 *
 * Kept as a separate component (rather than an axis-generalised Horizontal
 * ConfessionStack) so the desktop scroller's intricate infinite-loop / arc /
 * tilt logic is untouched. No infinite loop here — a flat, snappable list is
 * plenty for touch and far more robust.
 */
/** Viewport-space y a note rests at: the scrollport's centre, pushed down by
 *  V_CENTER_OFFSET. The CSS half of this is `scroll-padding-top` on
 *  st.vScrollContainer — the two have to describe the same line, or the browser
 *  parks a note somewhere the detector then reads as off-centre. */
const vCenterY = (top, clientHeight) => top + clientHeight / 2 + V_CENTER_OFFSET;

export function VerticalConfessionStack({
  confessions,
  activeIndex,
  onActiveChange,
  entranceDelay = 0,
  mountEntrance = true,
  metaBlockCrossfade = false,
  transcriptInstantWords = false,
}) {
  const scrollRef = useRef(null);
  const itemRefs = useRef([]);
  const imgRefs = useRef([]);
  const itemStrideRef = useRef(0);
  const reduceMotion = useReducedMotion();
  const [metaAnchorEl, setMetaAnchorEl] = useState(null);
  const [isScrolling, setIsScrolling] = useState(false);
  // Drives the render window during a flick — updated on every scroll frame so
  // notes we're flying past mount before activeIndex catches up from the parent.
  const [scrollFocus, setScrollFocus] = useState(activeIndex);
  const inactive = useInactiveCardParams();
  const noiseEnabled = inactive.noise?.enabled ?? true;
  const inactiveFilter = [
    inactive.blur > 0 ? `blur(${inactive.blur}px)` : '',
    inactive.grayscale > 0 ? `grayscale(${inactive.grayscale})` : '',
    noiseEnabled ? `url(#${CARD_FILTER_ID})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const grainOnlyFilter = noiseEnabled ? `url(#${CARD_FILTER_ID})` : 'none';
  // Vertical carousel is mobile-only — keep the SVG grain static; the 30fps
  // seed animation is pure overhead on a phone and runs during scroll.
  const stackNoiseParams = useMemo(
    () => ({
      ...inactive,
      noise: { ...(inactive.noise ?? {}), animate: false },
    }),
    [inactive]
  );

  const n = confessions.length;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const sourceRef = useRef('external');
  const hasInitialScrolledRef = useRef(false);
  const lastScrolledIndexRef = useRef(activeIndex);
  const progScrollUntilRef = useRef(0);
  const rafRef = useRef(0);
  const scrollEndRef = useRef(0);

  const [grainHeld, setGrainHeld] = useState(true);
  useLayoutEffect(() => {
    setGrainHeld(true);
    const t = setTimeout(() => setGrainHeld(false), GRAIN_HOLD_MS);
    return () => clearTimeout(t);
  }, [activeIndex]);

  useEffect(() => {
    setScrollFocus(activeIndex);
  }, [activeIndex]);

  itemRefs.current.length = n;
  imgRefs.current.length = n;

  const renderLo = Math.max(
    0,
    Math.min(activeIndex, scrollFocus) - V_RENDER_WINDOW
  );
  const renderHi = Math.min(
    n - 1,
    Math.max(activeIndex, scrollFocus) + V_RENDER_WINDOW
  );

  useLayoutEffect(() => {
    const img = imgRefs.current[activeIndex];
    if (!img) return;
    const h = img.getBoundingClientRect().height;
    if (h > 0) itemStrideRef.current = h + V_STACK_GAP;
  }, [activeIndex, n, renderLo, renderHi]);

  const scrollItemToCenter = useCallback((i, behavior) => {
    const el = scrollRef.current;
    if (!el) return;
    const item = itemRefs.current[i];
    if (!item) return;
    const img = imgRefs.current[i] || item.querySelector('img') || item;
    const ir = img.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const delta = ir.top + ir.height / 2 - vCenterY(er.top, el.clientHeight);
    if (Math.abs(delta) < SNAP_EPSILON) return;
    progScrollUntilRef.current =
      performance.now() + (behavior === 'smooth' ? 700 : 260);
    el.scrollBy({ top: delta, behavior: behavior || 'auto' });
  }, []);

  useLayoutEffect(() => {
    if (hasInitialScrolledRef.current) return;
    scrollItemToCenter(activeIndexRef.current, 'auto');
    hasInitialScrolledRef.current = true;
  }, [scrollItemToCenter]);

  useEffect(() => {
    if (sourceRef.current === 'user') {
      sourceRef.current = 'external';
      lastScrolledIndexRef.current = activeIndex;
      return;
    }
    if (!hasInitialScrolledRef.current) return;
    const dist = Math.abs(activeIndex - lastScrolledIndexRef.current);
    lastScrolledIndexRef.current = activeIndex;
    const behavior = reduceMotion || dist > 4 ? 'auto' : 'smooth';
    scrollItemToCenter(activeIndex, behavior);
  }, [activeIndex, reduceMotion, scrollItemToCenter]);

  const detectCenteredIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return -1;
    const er = el.getBoundingClientRect();
    const center = vCenterY(er.top, el.clientHeight);
    const stride = itemStrideRef.current;
    if (stride > 0 && imgRefs.current[0]) {
      const padTop = parseFloat(getComputedStyle(el).paddingTop) || 0;
      const y = el.scrollTop + el.clientHeight / 2 + V_CENTER_OFFSET - padTop;
      const guess = Math.round(y / stride);
      const candidates = [guess - 1, guess, guess + 1, activeIndexRef.current].filter(
        (i) => i >= 0 && i < n
      );
      let best = -1;
      let bestDist = Infinity;
      for (const i of candidates) {
        const img = imgRefs.current[i];
        if (!img) continue;
        const r = img.getBoundingClientRect();
        const c = r.top + r.height / 2;
        const d = Math.abs(c - center);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      if (best >= 0) return best;
    }
    let best = -1;
    let bestDist = Infinity;
    for (let i = renderLo; i <= renderHi; i += 1) {
      const img = imgRefs.current[i];
      if (!img) continue;
      const r = img.getBoundingClientRect();
      const c = r.top + r.height / 2;
      const d = Math.abs(c - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }, [n, renderHi, renderLo]);

  const isScrollingRef = useRef(false);
  const handleScroll = useCallback(() => {
    if (!isScrollingRef.current) {
      isScrollingRef.current = true;
      setIsScrolling(true);
    }
    window.clearTimeout(scrollEndRef.current);
    scrollEndRef.current = window.setTimeout(() => {
      isScrollingRef.current = false;
      setIsScrolling(false);
    }, V_SCROLL_SETTLE_MS);

    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (performance.now() < progScrollUntilRef.current) return;
      const best = detectCenteredIndex();
      if (best < 0) return;
      setScrollFocus((cur) => (cur === best ? cur : best));
      if (best !== activeIndexRef.current) {
        sourceRef.current = 'user';
        onActiveChange(best);
      }
    });
  }, [detectCenteredIndex, onActiveChange]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      window.clearTimeout(scrollEndRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [handleScroll]);

  const useLiteNeighbors = isScrolling || reduceMotion;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {metaBlockCrossfade ? (
        <MetaCrossfadeSlot
          confession={confessions[activeIndex]}
          reduceMotion={reduceMotion}
          columnWidth="min(86vw, 430px)"
          anchorEl={metaAnchorEl}
        />
      ) : null}
      <div ref={scrollRef} style={st.vScrollContainer}>
      <CardNoiseFilterDefs params={stackNoiseParams} />
      {confessions.map((c, i) => {
        const inWindow = i >= renderLo && i <= renderHi;
        if (!inWindow) {
          return (
            <div
              key={c.id}
              data-vcard
              data-vspacer
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              aria-hidden="true"
              style={st.vItem}
            >
              <div
                ref={(el) => {
                  imgRefs.current[i] = el;
                }}
                style={{
                  height: V_IMAGE_HEIGHT,
                  width: '100%',
                  flexShrink: 0,
                  scrollSnapAlign: 'center',
                }}
              />
            </div>
          );
        }

        const isActive = i === activeIndex;
        const staggerDelay =
          !mountEntrance || reduceMotion
            ? 0
            : Math.min(Math.abs(i - activeIndex) * 0.1, 0.9);
        const ring = Math.abs(i - activeIndex);
        const eagerImage = ring <= 1;
        return (
          <motion.div
            key={c.id}
            data-vcard
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            initial={reduceMotion || !mountEntrance ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={
              reduceMotion || !mountEntrance
                ? { duration: 0 }
                : { duration: 0.3, ease: EASE_OUT, delay: staggerDelay + entranceDelay }
            }
            onClick={() => {
              if (i !== activeIndexRef.current) {
                sourceRef.current = 'external';
                onActiveChange(i);
              }
            }}
            style={{
              ...st.vItem,
              cursor: isActive ? 'default' : 'pointer',
            }}
          >
            {isActive && !metaBlockCrossfade ? (
              <NoteMeta confession={c} reduceMotion={reduceMotion} />
            ) : null}
            <div
              ref={metaBlockCrossfade && isActive ? (el) => setMetaAnchorEl(el) : undefined}
              style={{
                ...st.cardImageBox,
                height: V_IMAGE_HEIGHT,
                scrollSnapAlign: 'center',
              }}
            >
              <img
                ref={(el) => {
                  imgRefs.current[i] = el;
                }}
                src={c.image}
                alt={`Confession ${c.id}`}
                draggable={false}
                loading={eagerImage ? 'eager' : 'lazy'}
                decoding="async"
                style={{
                  ...st.cardImg,
                  willChange: isActive && !useLiteNeighbors ? 'transform' : 'auto',
                  opacity: isActive
                    ? 1
                    : ring <= 1
                      ? V_INACTIVE_OPACITY.near
                      : V_INACTIVE_OPACITY.far,
                  transform: `scale(${isActive ? 1 : inactive.scale})`,
                  filter: isActive
                    ? grainHeld && !useLiteNeighbors
                      ? grainOnlyFilter
                      : 'none'
                    : useLiteNeighbors || !inactiveFilter
                      ? 'none'
                      : inactiveFilter,
                }}
              />
            </div>
            {isActive && c.transcription ? (
              <div style={st.vMetaBlock} aria-live="polite">
                <TranscriptReveal
                  key={c.id}
                  text={c.transcription}
                  reduceMotion={reduceMotion}
                  instantWords={transcriptInstantWords}
                />
              </div>
            ) : null}
          </motion.div>
        );
      })}
    </div>
    </div>
  );
}

const st = {
  stackViewport: {
    // Non-scrolling frame that fills the dial's note area. The scrollContainer
    // (horizontal filmstrip) scrolls inside it; the nav legend is a direct
    // child pinned here so `left: 50%` resolves against the viewport, not the
    // scroll content — keeping the legend at top-center as the cards scroll.
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'visible',
    // Courier New for every bit of chrome text rendered inside the stack (catch-
    // all; individual styles still set it explicitly where they need a size).
    fontFamily: COURIER,
  },
  scrollContainer: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'row',
    gap: 24,
    overflowX: 'auto',
    overflowY: 'visible',
    // Shared 3D viewing volume for the coverflow warp. The perspective +
    // origin live on the (fixed) scroll container, so the vanishing point
    // stays pinned to the viewport center while cards scroll past it.
    perspective: '1100px',
    perspectiveOrigin: '50% 50%',
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
    // Transcript scrolls inside st.transcriptReveal; modest pad for descenders.
    paddingBottom: 32,
    alignItems: 'center',
    justifyContent: 'flex-start',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  // ── Mobile vertical carousel ──────────────────────────────
  vScrollContainer: {
    position: 'relative',
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: V_STACK_GAP,
    // Headroom so the first / last note can reach the resting position — the
    // centre shifted down by V_CENTER_OFFSET, hence the ± on each end.
    paddingTop: `calc(${V_STACK_PAD_VH}vh + ${V_CENTER_OFFSET}px)`,
    paddingBottom: `calc(${V_STACK_PAD_VH}vh - ${V_CENTER_OFFSET}px)`,
    overflowY: 'auto',
    overflowX: 'hidden',
    // Native snap: each note settles to centre after a swipe. Mandatory rather
    // than proximity — proximity only engages when the scroll happens to end
    // near a note, so a normal swipe would often just drift and stop wherever it
    // ran out, which read as the snapping not working. Nothing here is taller
    // than the viewport, so mandatory can't strand content between snap points,
    // and the transcript is its own nested scroller so scrolling it doesn't move
    // this container at all.
    scrollSnapType: 'y mandatory',
    // Shifts the snapport's centre down by half of this — i.e. exactly
    // V_CENTER_OFFSET — so CSS parks a note where the JS math expects it.
    scrollPaddingTop: V_CENTER_OFFSET * 2,
    overflowAnchor: 'none',
    WebkitOverflowScrolling: 'touch',
    overscrollBehaviorY: 'contain',
    touchAction: 'pan-y',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  vItem: {
    position: 'relative',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    // No scroll-snap-align here: the snap target is the IMAGE box (see the
    // render), because that's what the JS centres on and what the reader is
    // actually looking at. Aligning the item instead parked the item's box —
    // which is a different point whenever anything else sits inside it — and
    // left the image sitting above centre.
    //
    // No scroll-snap-stop either. Forcing a stop at every note meant one swipe
    // could only ever advance one note, so getting anywhere in a 35-note stack
    // took 35 swipes; that, more than frame rate, is what made this feel slow.
    // Without it a flick carries as far as it's thrown and still settles on a
    // note.
    width: 'min(86vw, 430px)',
  },
  // The active note's transcript, hung BELOW the note rather than sitting in
  // the column with it. In flow it made the active item ~70-130px taller than
  // its neighbours, so every time the active note changed the stack's whole
  // layout shifted under the finger mid-scroll — which moved the snap points
  // during the gesture and is why a swipe so often landed off-centre. Out of
  // flow, every item is exactly the image box, so nothing reflows while
  // scrolling and the snap points hold still.
  vMetaBlock: {
    position: 'absolute',
    top: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginTop: 14,
    width: 'min(max(100%, 320px), 90vw)',
    maxWidth: 520,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    pointerEvents: 'auto',
  },
  cardWrapper: {
    flexShrink: 0,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    maxHeight: '100%',
    // Preserve the container's 3D context through the wrapper so the
    // translateZ depth on the inner tilt-target renders against the shared
    // perspective rather than flattening here.
    transformStyle: 'preserve-3d',
  },
  inactiveCardTooltip: {
    position: 'fixed',
    zIndex: 200,
    pointerEvents: 'none',
    fontFamily: COURIER,
    fontSize: 8,
    fontWeight: 400,
    lineHeight: 1.35,
    letterSpacing: '0.1em',
    color: 'rgba(253, 253, 253, 0.94)',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    padding: '5px 8px',
    background: 'rgba(0, 0, 0, 0.82)',
    border: '1px solid rgba(207, 202, 183, 0.14)',
    borderRadius: 3,
  },
  cardImageBox: {
    position: 'relative',
    height: `min(${CARD_HEIGHT_VH}vh, ${CARD_HEIGHT_MAX}px)`,
    maxHeight: CARD_HEIGHT_MAX,
    // Cap width to the viewport so a wide/landscape note never spills past the
    // screen edges on mobile (the active card is also scaled up ~1.12×, so this
    // leaves a little headroom for that). Falls back to a fixed cap on desktop.
    maxWidth: `min(${CARD_WIDTH_VW}vw, ${CARD_WIDTH_MAX}px)`,
    flexShrink: 0,
    // width: auto — settles to the image's intrinsic width after load
    display: 'block',
    // Rotation pivot at the card's center so cards "tilt away" symmetrically
    // around their own midpoint. The `transform` (coverflow warp) is written
    // from JS every animation frame by the rAF tilt loop (see applyTiltPass),
    // which eases each card toward its live target — so NO CSS transition here
    // (a transition would double-damp the loop and make the warp lag/rubber-band).
    transformOrigin: '50% 50%',
    willChange: 'transform',
  },
  metaBlock: {
    position: 'relative',
    marginTop: 14,
    // At least as wide as the card (or 320px), but never wider than 90vw so the
    // transcription always wraps with a margin before the screen edge.
    width: 'min(max(100%, 320px), 90vw)',
    maxWidth: 520,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    pointerEvents: 'auto',
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
    fontFamily: COURIER,
    fontSize: 10,
    letterSpacing: '0.08em',
    color: 'rgba(207,202,183,0.85)',
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
  metaAboveAnchor: {
    // Desktop only: out-of-flow wrapper that pins NoteMeta just above the image
    // (bottom:100% of the card, i.e. the image's top edge) and centres it, so the
    // metadata never displaces the image. Flex (not block) so NoteMeta's
    // marginBottom can't margin-collapse through the anchor and lose the gap.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  metaAboveRow: {
    // Two stacked label/value rows (DATE, LOCATION) above the note image. The
    // column width is set by the caller (`columnWidth`, ~80% of the image) so
    // the label/value pairs sit closer together; centred within the card.
    display: 'flex',
    flexDirection: 'column',
    rowGap: 4,
    // Subtle grey divider under the block (i.e. below the LOCATION row), with a
    // little breathing room above the line before the note image.
    paddingBottom: 12,
    borderBottom: '1px solid rgba(207, 202, 183, 0.18)',
    marginBottom: 24,
  },
  metaAboveItem: {
    // One metadata row split 50/50: the label fills the left half; the value is
    // left-aligned starting at the horizontal midpoint (rather than pinned to the
    // far-right edge), so the values line up in a column at 50% of the width.
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    alignItems: 'baseline',
    columnGap: 0,
    width: '100%',
  },
  sideMetaLabel: {
    fontFamily: COURIER,
    fontSize: 10,
    letterSpacing: '0.14em',
    lineHeight: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(207,202,183,0.45)',
    whiteSpace: 'nowrap',
  },
  sideMetaValue: {
    fontFamily: COURIER,
    fontSize: 10,
    letterSpacing: '0.04em',
    lineHeight: 1.5,
    color: 'rgba(207,202,183,0.8)',
    whiteSpace: 'nowrap',
  },
  indexTable: {
    // Two-column breadcrumb table (label | "n / total") under the transcript.
    // Rows: CATEGORY (which theme, moved off the dial) then NOTE (slot within
    // the theme). `auto auto` columns keep every label and every fraction in its
    // own aligned column so the two fractions can't be misread as one another.
    display: 'grid',
    gridTemplateColumns: 'auto auto',
    columnGap: 12,
    rowGap: 3,
    alignItems: 'baseline',
    justifyItems: 'start',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  indexRow: {
    // Row groups exist only to carry an aria-label; `display: contents` drops the
    // wrapper box so the label + fraction become direct cells of `indexTable`
    // (and thus align column-to-column with the other row).
    display: 'contents',
  },
  indexLabel: {
    // Dim uppercase tag right-aligned against the gap, e.g. CATEGORY / NOTE.
    justifySelf: 'end',
    fontFamily: COURIER,
    fontSize: 9.5,
    letterSpacing: '0.18em',
    color: 'rgba(207,202,183,0.5)',
    whiteSpace: 'nowrap',
  },
  noteIndex: {
    // "n / total" counter shown directly below the transcript (same out-of-flow
    // stack) — the note's position within its category (mirrors the dial's NOTES
    // sub-label). Spacing from the transcript is owned by `belowImageStack`.
    marginTop: 0,
    fontFamily: COURIER,
    fontSize: 11,
    letterSpacing: '0.12em',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  noteIndexCurrent: {
    color: 'rgba(207,202,183,0.85)',
  },
  noteIndexTotal: {
    color: 'rgba(207,202,183,0.42)',
  },
  belowImageStack: {
    // Transcript + note-index, taken OUT OF FLOW (absolute) so their (variable)
    // height never contributes to the card's measured height — the card is sized
    // by the image alone, so the image holds the exact same vertical level whether
    // the note is active or inactive. Anchored 14px below the image (that gap used
    // to live on metaBlock's now-zeroed marginTop); stacks transcript then index.
    position: 'absolute',
    top: 'calc(100% + 14px)',
    left: 0,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: 12,
  },
  transcriptReveal: {
    ...TRANSCRIPTION_TEXT,
    // Courier New, a touch smaller than the site transcript — keeps this page
    // minimal + typewritten (overrides TRANSCRIPTION_TEXT's shared mono stack).
    fontFamily: COURIER,
    fontSize: 12.5,
    letterSpacing: '0.02em',
    // Scrollable transcript column inside `belowImageStack`. Height is capped so
    // a long confession scrolls (under a top/bottom fade mask) instead of
    // pushing the note-index down / growing the card.
    textAlign: 'center',
    textWrap: 'pretty', // avoid orphan/short last lines in the transcript
    width: '100%',
    maxHeight: 'min(9em, 26vh)',
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
    // Scrollbar hidden (WebKit via .transcript-reveal::-webkit-scrollbar); a
    // top/bottom fade mask signals more text instead.
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  cardImg: {
    height: '100%',
    width: 'auto',
    // Never exceed the (viewport-capped) box; contain keeps the aspect ratio
    // and letterboxes vertically instead of overflowing horizontally.
    maxWidth: '100%',
    objectFit: 'contain',
    display: 'block',
    // Scale leads; opacity follows ~120ms behind. (The grain/noise is an SVG
    // url() filter the browser won't transition, so its timing is handled in
    // JS via GRAIN_HOLD_MS — see the active-image filter below.)
    transition:
      'transform 0.40s cubic-bezier(0.33, 1, 0.68, 1) 0s, ' +
      'opacity 0.30s cubic-bezier(0.4, 0, 0.2, 1) 0.12s',
    pointerEvents: 'none',
  },
};

/**
 * The DATE / LOCATION block's look, exported so surfaces outside the note stack
 * can wear it without restating the numbers. The INDEX preview (App's Lightbox)
 * uses it to present its own rows — it carries an extra THEME row that links out,
 * so it can't just render <NoteMeta/>, but it should still read as the same
 * object. `block` carries the divider under the last row.
 */
export const NOTE_META_STYLE = {
  block: st.metaAboveRow,
  row: st.metaAboveItem,
  label: st.sideMetaLabel,
  value: st.sideMetaValue,
};
