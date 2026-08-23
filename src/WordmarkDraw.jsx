import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { WORDMARK_CENTERLINES } from './wordmarkCenterlines';
import { WORDMARK_STROKES, WORDMARK_VIEWBOX } from './wordmarkStrokes';

/* ─────────────────────────────────────────────────────────────────────
 * WORDMARK WRITE-ON STORYBOARD
 *
 * The hero lettering traced on stroke by stroke, left to right along the line —
 * each stroke drawn along the route the pen actually took, so a W goes
 * down-up-down-up in one pass. ms after the hold lifts:
 *
 *    0ms   nothing on screen
 *  120ms   stroke 1 draws, taking longer the further the pen has to travel
 *          …each following stroke starts 62ms after the one before
 * ~2300ms  last stroke lands, hero title reports complete
 * ─────────────────────────────────────────────────────────────────────
 *
 * HOW A TRACE IS POSSIBLE HERE
 * Nothing in this art is a stroked line — it is 31 filled silhouettes, one per
 * pen stroke, with the brush grain baked into ~178 subpaths each. `pathLength`
 * on the artwork would trace the outline of every speck rather than the letter.
 *
 * So the pen's route is recovered separately, by skeletonizing each filled
 * stroke offline (scripts/wordmark-centerlines.mjs). That centerline is never
 * drawn. It is swept as a MASK — a fat round-capped stroke growing along it —
 * and what it uncovers is the real artwork, so every dry brush edge survives.
 *
 * Overspill from the mask is free: each mask applies to one path only, so a
 * stroke wide enough to clear the fattest part of a letter can hang off it
 * anywhere else without touching a neighbour.
 */

const SRC = '/wwtai_2.min.svg';

/* The flat art, shown if the vector can't be fetched. It is the same lockup
   baked to a small transparent PNG, so a failed fetch costs the write-on rather
   than the hero. */
const FALLBACK = '/wordmark-line.png';

const [, , VIEW_W, VIEW_H] = WORDMARK_VIEWBOX.split(' ').map(Number);
const ASPECT = VIEW_W / VIEW_H;

const TIMING = {
  firstStroke: 120, // beat before the pen touches down
};

const DRAW = {
  // A single line this wide is held to a share of the width; the height limit
  // only bites in a letterbox window. On a phone it is allowed more of the
  // screen, or a lockup 5.4 times wider than it is tall lands as a thread.
  maxVw: 64,
  maxVh: 30,
  maxPhoneVw: 88,
  stagger: 62, //   ms between consecutive strokes
  strokeS: 0.24, // seconds for a stroke of average length
  // Pen easing: fast off the mark, settling at the end of the stroke.
  ease: [0.17, 0.84, 0.44, 1],
  // How much a stroke's length sets its duration. At 0 the tiny middle bar of
  // an E takes as long to draw as the whole W, which reads as a machine; at 1
  // the pen holds one constant speed and the short strokes flick past. The
  // routes here run 90 to 1500 units, so some of this is needed.
  lengthBias: 0.7,
  // Seconds the ink waits after the pen starts moving. Long enough for the dash
  // to have real length before anything is uncovered, short enough not to read
  // as a late stroke — a frame and a half at 60fps.
  inkLead: 0.025,
  // Slack around each mask's box, on top of the half stroke-width its round cap
  // already needs, so the grain filter's edge wander isn't cropped by it.
  pad: 5,
  fill: '#e7e5da', // warm off-white, held back from pure white
};

/**
 * Grain on the lettering — the same feTurbulence + feDisplacementMap treatment
 * the nav arrows and the text hero wear, so the wordmark sits in the same world.
 *
 * The numbers are NOT the ones those use, because this filter runs in the
 * wordmark's own 2461×456 user space rather than on screen pixels.
 * baseFrequency is a period in those units: the arrows' 0.86 would put a noise
 * cell inside a single pixel here and read as flat static. 0.23 gives a cell of
 * ~4.3 units against letters ~430 units tall, fine enough that the edge frays
 * like a dry brush rather than wobbling like a wet one.
 *
 * Which is the catch with all of these — the intensity is tied to the
 * wordmark's user space, so the same numbers bite differently the larger the
 * art is drawn. These are scaled up from the ones the older, smaller lockup
 * used, in step with how much taller its letters are.
 *
 * The art already carries real brush grain baked into ~178 subpaths per stroke;
 * this is only meant to make that edge move, not to invent texture.
 *
 * Which is what `scale` is held down to. At 8 units — ~5 screen px at the size
 * the hero draws it — the displacement stopped reading as a brush edge and
 * started throwing spikes off the tops of the letters, with specks detaching
 * into the background: texture invented rather than moved. Half that keeps the
 * crawl and lets the baked grain be the thing you actually see.
 */
const GRAIN = {
  baseFrequency: 0.23,
  octaves: 3,
  scale: 4, //  user units of edge displacement
  fps: 5, //    seed hops/sec; 0 holds it still
  seed: 4,
};

/* A transition dial comes back as an easing OR a spring, depending on which mode
   the panel is in. DialKit tags easings `type: 'easing'`, which Motion doesn't
   know — it wants a plain duration + ease — so unwrap those and let springs
   through untouched. */
function toMotionTransition(t) {
  if (!t) return { duration: DRAW.strokeS, ease: DRAW.ease };
  if (t.type === 'easing') return { duration: t.duration, ease: t.ease };
  return t;
}

/** How long one stroke takes, for laying out the stagger. */
function transitionSeconds(t) {
  return t?.duration ?? t?.visualDuration ?? DRAW.strokeS;
}

/** One axis of a CSS cubic-bezier, with the endpoints fixed at 0 and 1. */
function cubicAxis(a1, a2, s) {
  const c = 3 * a1;
  const b = 3 * (a2 - a1) - c;
  const a = 1 - c - b;
  return ((a * s + b) * s + c) * s;
}

/**
 * When a run following `curve` has got `u` of the way through it.
 *
 * The curve is an easing, so it answers the other question: given a moment,
 * how far along are we. What a schedule needs is the reverse — this stroke is
 * the 12th of 31, so when does it land — and an easing has no closed-form
 * inverse, hence the bisection. Thirty-two halvings is far past the precision a
 * millisecond needs.
 *
 * Getting this backwards is the easy mistake, and it is silent: applying an
 * ease-out to the schedule directly spaces the strokes out at the START and
 * bunches them at the end, which is an accelerating hand — the exact opposite of
 * the curve it was named after.
 */
function easeInverse(u, [x1, y1, x2, y2]) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let s = u;
  for (let i = 0; i < 32; i++) {
    s = (lo + hi) / 2;
    if (cubicAxis(y1, y2, s) < u) lo = s;
    else hi = s;
  }
  return cubicAxis(x1, x2, s);
}

/**
 * Where a stroke sits in the run, given how far through the strokes it is.
 *
 * With no curve this is the flat schedule the hero writes on: every stroke a
 * fixed beat after the one before, the pen crossing the line at one speed. Given
 * one, the same strokes are redistributed to follow it, so the run decelerates
 * the way that curve says. It is not made longer by this — the last stroke still
 * lands where it did, and what changes is the spacing on the way there.
 *
 * `headroom` is how much of the curve gets used, and it exists because a curve
 * that arrives at 1 arrives FLAT, which is a vertical inverse: read whole, this
 * one leaves the final stroke hanging 317ms after the one before it, alone,
 * long enough to read as a dropped frame rather than as a finish. Stopping short
 * of that corner and stretching what is left over the whole run keeps the shape
 * — the pen still leaves fast and settles hard — without the last stroke falling
 * off the end of it. At 0.82 the closing gap is ~70ms against ~10ms at the
 * start, which is a settle you can see and not a stall.
 */
function settleShape(u, curve, headroom) {
  if (!curve) return u;
  return easeInverse(u * headroom, curve) / easeInverse(headroom, curve);
}

/** The 31 `d` strings, fetched once and shared. Kept out of the bundle — the
 *  art is ~1.6MB of path data and has no business in a JS chunk. */
let dCache = null;
async function loadPathData() {
  if (dCache) return dCache;
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`wordmark ${res.status}`);
  const text = await res.text();
  const paths = [...text.matchAll(/<path[^>]*\sd="([^"]*)"/g)].map((m) => m[1]);
  if (paths.length < WORDMARK_STROKES.length) {
    throw new Error(`wordmark expected ${WORDMARK_STROKES.length} paths, got ${paths.length}`);
  }
  dCache = paths;
  return dCache;
}

/**
 * The animated <filter> itself, kept in its own component so the 30fps seed
 * crawl re-renders this one node instead of the 31 masks around it — those are
 * mid-animation during the write-on and have no business re-rendering.
 */
function WordmarkGrain({ id, reduceMotion, cfg }) {
  const animate = !reduceMotion && cfg.fps > 0;
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
    ? GRAIN.seed + Math.floor(((now - startRef.current) / 1000) * cfg.fps)
    : GRAIN.seed;

  return (
    // Room around the box so displaced edge pixels aren't clipped off.
    <filter id={id} x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency={cfg.baseFrequency}
        numOctaves={cfg.octaves}
        seed={seed}
        stitchTiles="stitch"
        result="noise"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale={cfg.scale}
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  );
}

const IN_VIEW = { once: true, margin: '0px 0px -24% 0px' };

/* The same hand, writing at the pace of something arriving in the corner of a
   page rather than of a hero being introduced. Only the clock changes: stroke
   order, routes, easing and grain are the hero's, so the two read as one mark
   written twice rather than as two different marks.
 *
   `speed` scales every part of the timeline together — the beat before the pen
   lands, the gap between strokes, and how long a stroke takes. Scaling only the
   stagger would run the pen faster across the line while each stroke still took
   its full time, which stops reading as handwriting and starts reading as the
   strokes being dealt out. At this factor the ~2.3s hero run lands in ~0.85s:
   fast enough to be over before the eye leaves the top-left corner, slow enough
   that you can still see it being written.
 *
   The grain stops crawling. At hero size its 5fps seed hop is a brush edge
   breathing; at 26px it is a logo that will not sit still, and it would go on
   repainting the top chrome for as long as the archive is open. Held at one
   frame it is still the same texture, just no longer animated. */
const NAV_WRITE = {
  speed: 0.37,
  grainFps: 0,
  /* The shape of the whole run, and of each stroke inside it: the mark is
     written along this curve rather than at one steady rate, so the hand leaves
     fast and settles into the last letters. The hero stays flat — this is the
     nav's own finish. */
  ease: [0.08, 0.82, 0.17, 1],
  /* How much of that curve the schedule reads before it is rescaled to fill the
     run — see `settleShape`. */
  settleHeadroom: 0.82,
};

export default function WordmarkDraw({ hold = false, onRevealComplete, reduceMotion = false }) {
  const [replay, setReplay] = useState(0);
  const dials = useDialKit(
    'Hero Wordmark',
    {
      size: {
        maxVw: [DRAW.maxVw, 20, 100, 1],
        maxVh: [DRAW.maxVh, 8, 60, 1],
      },
      write: {
        firstStroke: [TIMING.firstStroke, 0, 1500, 20],
        stagger: [DRAW.stagger, 0, 260, 2],
        // Duration + curve for a stroke of average length, with a live bezier
        // editor. Each stroke's own duration scales off this by `lengthBias`.
        stroke: { type: 'easing', duration: DRAW.strokeS, ease: DRAW.ease },
        lengthBias: [DRAW.lengthBias, 0, 1, 0.05],
      },
      look: {
        fill: { type: 'color', default: DRAW.fill },
        pad: [DRAW.pad, 0, 30, 0.5],
      },
      grain: {
        on: true,
        baseFrequency: [GRAIN.baseFrequency, 0.02, 1.2, 0.01],
        octaves: [GRAIN.octaves, 1, 4, 1],
        scale: [GRAIN.scale, 0, 20, 0.1],
        fps: [GRAIN.fps, 0, 30, 1],
      },
      // Freeze the write-on and drag through it by hand. The only practical way
      // to judge stroke order and coverage — the whole sequence is over in a
      // little over two seconds.
      scrub: {
        hold: false,
        at: [0, 0, 1, 0.005],
      },
      replayWordmark: { type: 'action', label: '⟳ Replay' },
    },
    { onAction: (a) => a === 'replayWordmark' && setReplay((n) => n + 1) }
  );

  return (
    <WordmarkDrawRun
      key={replay}
      hold={hold}
      onRevealComplete={onRevealComplete}
      reduceMotion={reduceMotion}
      config={dials}
    />
  );
}

/**
 * The write-on at a fixed pixel height, for the nav's wordmark — no DialKit
 * panel, since this is not the hero and should not claim the hero's controls.
 *
 * `startDelayS` is spent before the first stroke rather than by holding the
 * component: the run gates on `hold`, and a hold released by a timer would have
 * to be threaded through state. The existing `firstStroke` beat is already
 * exactly this, so the wait is just added to it.
 *
 * The path data is the same 1.6MB fetch the hero makes, and the same
 * module-level cache — which is the reason this is only ever asked for on the
 * way in from the intro, where the hero has already paid for it. Reaching the
 * archive any other way shows the baked PNG and fetches nothing.
 */
export function WordmarkDrawInline({
  heightPx,
  startDelayS = 0,
  speed = NAV_WRITE.speed,
  onRevealComplete,
}) {
  const config = useMemo(
    () => ({
      size: { maxVw: DRAW.maxVw, maxVh: DRAW.maxVh },
      write: {
        firstStroke: startDelayS * 1000 + TIMING.firstStroke * speed,
        stagger: DRAW.stagger * speed,
        stroke: { type: 'easing', duration: DRAW.strokeS * speed, ease: NAV_WRITE.ease },
        lengthBias: DRAW.lengthBias,
        settleEase: NAV_WRITE.ease,
        settleHeadroom: NAV_WRITE.settleHeadroom,
      },
      look: { fill: DRAW.fill, pad: DRAW.pad },
      scrub: { hold: false, at: 0 },
      grain: { ...GRAIN, on: true, fps: NAV_WRITE.grainFps },
    }),
    [startDelayS, speed]
  );

  return (
    <WordmarkDrawRun
      hold={false}
      onRevealComplete={onRevealComplete}
      reduceMotion={false}
      config={config}
      heightPx={heightPx}
    />
  );
}

/** One write-on. Remounted to replay. */
function WordmarkDrawRun({ hold, onRevealComplete, reduceMotion, config, heightPx }) {
  const hostRef = useRef(null);
  const inView = useInView(hostRef, IN_VIEW);
  const prefersReduce = useReducedMotion();
  const reduce = reduceMotion || prefersReduce;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const [paths, setPaths] = useState(dCache);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (paths || !inView) return undefined;
    let alive = true;
    loadPathData().then(
      (d) => alive && setPaths(d),
      () => alive && setFailed(true)
    );
    return () => {
      alive = false;
    };
  }, [paths, inView]);

  const run = inView && !hold && !!paths;

  // Strokes in writing order, paired with the artwork they mask and the route
  // the pen takes across it.
  const strokes = useMemo(() => {
    if (!paths) return [];
    return WORDMARK_STROKES.map((s) => ({
      ...s,
      d: paths[s.i],
      line: WORDMARK_CENTERLINES[s.i],
    })).filter((s) => s.d && s.line);
  }, [paths]);

  const { size, write, look, scrub, grain } = config;
  const grainId = `wm-grain-${uid}`;
  const baseMs = transitionSeconds(write.stroke) * 1000;

  // When each stroke starts and how long it draws for, in ms after the hold
  // lifts.
  const { startsAt, durations, totalMs } = useMemo(() => {
    if (!strokes.length) return { startsAt: [], durations: [], totalMs: 0 };
    const mean = strokes.reduce((sum, s) => sum + s.line.len, 0) / strokes.length;
    const last = Math.max(1, strokes.length - 1);
    const span = last * write.stagger;
    const starts = strokes.map((s, n) =>
      Math.round(
        write.firstStroke +
          span * settleShape(n / last, write.settleEase, write.settleHeadroom ?? 1)
      )
    );
    const spans = strokes.map(
      (s) => baseMs * (1 - write.lengthBias + write.lengthBias * (s.line.len / mean))
    );
    return {
      startsAt: starts,
      durations: spans,
      // Not the last stroke to start — with length-scaled durations an earlier
      // long stroke can still be drawing after a later short one has landed.
      totalMs: Math.max(...starts.map((t, n) => t + spans[n])),
    };
  }, [
    strokes,
    write.firstStroke,
    write.stagger,
    write.lengthBias,
    write.settleEase,
    write.settleHeadroom,
    baseMs,
  ]);

  const doneRef = useRef(onRevealComplete);
  doneRef.current = onRevealComplete;
  useEffect(() => {
    // Scrubbing parks the wordmark mid-write, so release the gate immediately —
    // otherwise everything below the hero waits on an animation that isn't running.
    if (!run && !scrub.hold) return undefined;
    const t = window.setTimeout(() => doneRef.current?.(), reduce || scrub.hold ? 0 : totalMs);
    return () => clearTimeout(t);
  }, [run, reduce, totalMs, scrub.hold]);

  /* Given a height, the lockup is that tall and as wide as its own aspect makes
     it — which is what lets this stand in for the baked PNG in the nav without
     moving anything: the art and the PNG are the same 5.40 shape, so at a shared
     height they occupy the same box to the pixel. */
  const wrapStyle = heightPx
    ? {
        position: 'relative',
        display: 'block',
        height: heightPx,
        width: heightPx * ASPECT,
      }
    : {
        position: 'relative',
        display: 'block',
        // Bounded on every axis so the lockup can't overflow a short viewport or
        // reach the bezels of a narrow one. Not `margin: auto` — an over-wide
        // block resolves that to zero and hangs off the right; the beat's
        // `align-items: center` already centers it.
        width: `min(${DRAW.maxPhoneVw}vw, max(${size.maxVw}vw, 300px), calc(${size.maxVh}vh * ${ASPECT}))`,
      };

  // Nothing to draw with — show the flat art rather than an empty hero.
  if (failed) {
    return (
      <div ref={hostRef} style={wrapStyle}>
        <img
          src={FALLBACK}
          alt="What We Tell AI"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
      </div>
    );
  }

  return (
    <div ref={hostRef} style={wrapStyle}>
      <svg
        viewBox={WORDMARK_VIEWBOX}
        role="img"
        aria-label="What We Tell AI"
        style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
      >
        <defs>
          {grain.on && <WordmarkGrain id={grainId} reduceMotion={reduce} cfg={grain} />}
          {strokes.map((s, n) => {
            // The mask's box has to clear the round cap at every tip, which
            // reaches half a stroke-width past the end of the route.
            const margin = s.line.width / 2 + look.pad;

            // Where the waiting dash is parked, in path-lengths. One clears the
            // path; the cap radius on top of it clears the cap as well, so the
            // ink can't be seen before the pen touches down. Capped because the
            // shortest routes here (the middle bar of an E) are barely longer
            // than the brush is wide, and their radius alone is most of a path.
            const capFrac = Math.min(1, s.line.width / 2 / s.line.len);
            const restOffset = 1 + capFrac + 0.01;

            // Where this stroke sits in a hand-driven scrub of the whole run.
            const scrubbed = Math.max(
              0,
              Math.min(1, (scrub.at * totalMs - startsAt[n]) / durations[n])
            );
            const target = scrub.hold ? scrubbed : run || reduce ? 1 : 0;

            return (
              <mask
                key={s.i}
                id={`wm-${uid}-${s.i}`}
                maskUnits="userSpaceOnUse"
                x={s.x - margin}
                y={s.y - margin}
                width={s.w + margin * 2}
                height={s.h + margin * 2}
              >
                {/* Drawn by sliding one full-length dash onto the path rather
                    than by growing `pathLength`. Growing it means a dash of
                    length zero at rest, and a zero-length dash under a round
                    cap is spec'd to render as a dot — so every stroke would sit
                    on screen as a blob of ink before its turn came.
                    Parking the dash at exactly one path-length is not far enough
                    to be rid of that, though. It leaves the dash ENDING on the
                    path's first point, and WebKit draws that end's round cap:
                    on iOS every one of the 31 strokes showed as a dot of ink
                    before the write-on had begun. Hence both guards below. */}
                <motion.path
                  d={s.line.d}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={s.line.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength="1"
                  strokeDasharray="1 1"
                  initial={{
                    strokeDashoffset: reduce ? 0 : restOffset,
                    opacity: reduce ? 1 : 0,
                  }}
                  animate={{
                    // Held clear of the path by more than a cap radius while
                    // waiting, so there is no dash end for a cap to be drawn on.
                    // Written as keyframes so the draw still runs the full
                    // 1 → 0 at the pace it always did: the park is a resting
                    // place, not part of the route. Rolled into the range
                    // instead, it would eat up to a third of the timeline of the
                    // stubbiest strokes — the bar of an E is barely longer than
                    // the brush is wide — before any ink appeared.
                    strokeDashoffset: target > 0 ? [1, 1 - target] : restOffset,
                    // And masked out entirely until the pen touches down, which
                    // no amount of dash arithmetic can be got wrong. A cut
                    // rather than a fade: this path is a luminance mask, so a
                    // ramp would uncover the artwork as a ghost of itself.
                    opacity: target > 0 ? 1 : 0,
                  }}
                  transition={
                    reduce || scrub.hold
                      ? { duration: 0 }
                      : {
                          strokeDashoffset: {
                            ...toMotionTransition(write.stroke),
                            duration: durations[n] / 1000,
                            delay: startsAt[n] / 1000,
                          },
                          // A frame behind the dash, so the first thing
                          // uncovered is a stroke with some length to it rather
                          // than a round cap standing on its own.
                          opacity: {
                            duration: 0,
                            delay: startsAt[n] / 1000 + DRAW.inkLead,
                          },
                        }
                  }
                />
              </mask>
            );
          })}
        </defs>
        {/* Filtered as one group, so the grain reads across the whole lockup
            rather than restarting per stroke — and it rides on the masked
            result, so only ink that has actually been written gets it. */}
        <g filter={grain.on ? `url(#${grainId})` : undefined}>
          {strokes.map((s) => (
            <path key={s.i} d={s.d} fill={look.fill} mask={`url(#wm-${uid}-${s.i})`} />
          ))}
        </g>
      </svg>
    </div>
  );
}
