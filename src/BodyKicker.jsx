import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * BODY KICKER STORYBOARD
 *
 * Closes the body statement. The sentence above ("…changing how we")
 * dissolves in first and is left hanging; these three verbs finish it,
 * each landing off-axis, and then the machine noise creeps in around them.
 *
 * Read top-to-bottom. Each value is ms after the beat scrolls into view.
 *
 *    0ms   nothing — the body line above is still dissolving in
 *  900ms   "communicate"  rises + untilts from a steeper angle
 * 1160ms   "work"         same, tilted harder the other way
 * 1420ms   "think…"       same, nearly upright
 *
 * The marks belong to the words, so each group trails ITS OWN verb rather than
 * the whole set arriving at one time. Measured from the moment that verb lands:
 *
 *  +330ms   its marks type on, one glyph at a time (38ms apart), the two or
 *           three of them scattered across ~0.4s
 *  +240ms   once a mark has finished typing it starts its own loop — a pulse
 *           crossing a wire, blocks assembling, cells firing (see MARKS)
 * ─────────────────────────────────────────────────────────────────────
 *
 * The verbs settle INTO their tilt rather than out of it: each starts at
 * `entryTiltMul`× its resting angle and unwinds, so the type looks like it
 * was set down by hand and allowed to rock back, not like it was rotated.
 */

const TIMING = {
  firstVerb: 900, //   "communicate" starts (after the body line has landed)
  verbStagger: 260, // gap between consecutive verbs
  asciiType: 1750, //  marks begin typing on
  asciiIdle: 2400, //  marks start their own loops
};

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

/* The three verbs that finish the sentence. `tilt` is the resting angle in
   degrees; `align` places the line in the column and `nudgeX` shifts it off
   center so the block reads as scattered rather than stacked. */
const VERBS = {
  riseY: 20, //        px each verb rises from
  entryTiltMul: 2.1, // entrance angle as a multiple of the resting tilt
  spring: { type: 'spring', stiffness: 180, damping: 18, mass: 1 },
  items: [
    { text: 'communicate', tilt: -3.4, align: 'flex-start', nudgeX: '1%' },
    { text: 'work', tilt: -11, align: 'flex-end', nudgeX: '-9%' },
    { text: 'think…', tilt: 1.6, align: 'center', nudgeX: '-6%' },
  ],
};

/* ─── ASCII MOTIFS ─────────────────────────────────────────────────────
 * One per verb, each a small loop that acts out what its verb means rather
 * than reading as generic noise.
 *
 * Every motif takes elapsed ms and returns FIXED-WIDTH lines — same character
 * count on every frame — so a running mark never reflows or nudges the type
 * beside it. At ms = 0 each returns its resting frame, which is what types on.
 */

/** communicate — a pulse running down the wire, with the node it reaches
 *  flaring as it arrives. */
const SPARK = {
  gap: 7, //      dashes between the two nodes
  stepMs: 110, // ms per position
  lines(ms) {
    const i = Math.floor(ms / SPARK.stepMs) % (SPARK.gap + 2);
    const wire = Array.from({ length: SPARK.gap }, (_, k) => (k === i - 1 ? '=' : '-'));
    return [(i === 0 ? 'O' : 'o') + wire.join('') + (i === SPARK.gap + 1 ? 'O' : 'o')];
  },
};

/** work — three little blocks drawn from dashes and dots, assembling one after
 *  the next, holding, then starting over. */
const BLOCKS = {
  count: 3,
  stepMs: 190,
  build: ['   ', '.  ', '.- ', '.-.'], // corner, edge, closed
  lines(ms) {
    const t = Math.floor(ms / BLOCKS.stepMs);
    // Each block is two steps behind the one to its left; the lower edge trails
    // the upper by one, so a block reads as being drawn rather than switched on.
    const cell = (k, lag) => BLOCKS.build[Math.min(3, (((t - k * 2 - lag) % 8) + 8) % 8)];
    const row = (lag) => Array.from({ length: BLOCKS.count }, (_, k) => cell(k, lag)).join(' ');
    return [row(0), row(1)];
  },
};

/** think — blobs swelling and settling on their own rhythms, like cells firing.
 *  The ramp runs light to heavy, so a cell reads as growing rather than just
 *  changing character. */
const NEURONS = {
  ramp: '.oO0@#%$',
  width: 9,
  cells: [
    [0, 1],
    [0, 4],
    [0, 7],
    [1, 2],
    [1, 5],
  ],
  periodMs: 720,
  lines(ms) {
    const t = (ms / NEURONS.periodMs) * Math.PI * 2;
    const rows = [Array(NEURONS.width).fill(' '), Array(NEURONS.width).fill(' ')];
    NEURONS.cells.forEach(([r, c], i) => {
      // Each cell drifts at a slightly different rate, so they never pulse in
      // unison — that's what keeps it reading as thinking and not as a loader.
      const v = (Math.sin(t * (1 + i * 0.18) + i * 1.7) + 1) / 2;
      rows[r][c] = NEURONS.ramp[Math.min(NEURONS.ramp.length - 1, Math.floor(v * NEURONS.ramp.length))];
    });
    return rows.map((r) => r.join(''));
  },
};

/* Where the motifs sit. Positions are percentages of the kicker block, so the
   marks track the type at any viewport width.

   They RING the verbs rather than sitting under them, which is possible because
   each verb is pushed to one side: "communicate" runs left, so the noise gathers
   to its right; "work" runs right, so the noise gathers to its left; "think…" is
   centred and short, leaving both gutters open. Nothing reaches past ~86% or
   below ~-4% — the page has no overflow-x guard, so a mark hanging further would
   pull a horizontal scrollbar on a phone.

   Motifs repeat, so each instance carries a `phase` (ms into the loop it starts
   at) — without it two SPARKs would be the same deterministic function of the
   same clock and pulse in lockstep. `delay` scatters the type-on so eight marks
   don't arrive at once, and `dim`/`scale` push the smaller ones back a little. */
const MARKS = {
  typeS: 0.038, // seconds between glyphs as a mark types on
  fadeS: 0.16, //  per-glyph fade
  frameMs: 70, //  how often running motifs are re-evaluated
  alpha: 0.45, //  dim enough to read as marginalia, not as copy
  size: 'clamp(12px, 2vw, 17px)',
  items: [
    // ── around "communicate" ──
    { id: 'c-spark', motif: SPARK, top: '-13%', left: '3%', tilt: -5, phase: 0, delay: 0 },
    { id: 'c-cells', motif: NEURONS, top: '-6%', left: '62%', tilt: 3, scale: 0.9, dim: 0.8, phase: 380, delay: 0.18 },
    // ── around "work" ──
    { id: 'w-blocks', motif: BLOCKS, top: '18%', left: '74%', tilt: 0, phase: 0, delay: 0.06 },
    { id: 'w-spark', motif: SPARK, top: '40%', left: '-3%', tilt: 4, scale: 0.85, dim: 0.75, phase: 540, delay: 0.24 },
    // ── around "think…" ──
    { id: 't-blocks', motif: BLOCKS, top: '60%', left: '1%', tilt: -3, scale: 0.85, dim: 0.75, phase: 300, delay: 0.3 },
    { id: 't-spark', motif: SPARK, top: '70%', left: '72%', tilt: -6, scale: 0.9, dim: 0.85, phase: 220, delay: 0.14 },
    { id: 't-cells', motif: NEURONS, top: '88%', left: '28%', tilt: 0, phase: 0, delay: 0.1 },
    { id: 'b-cells', motif: NEURONS, top: '104%', left: '70%', tilt: 2, scale: 0.8, dim: 0.7, phase: 660, delay: 0.36 },
  ],
};

const IN_VIEW = { once: true, margin: '0px 0px -24% 0px' };

/**
 * The tail of the body statement: three tilted verbs, then ascii noise.
 *
 * Stage-driven — one integer walks the whole sequence, so the storyboard above
 * is the only place the order lives. Under reduced motion every stage resolves
 * at once with no tilt animation and no running motifs.
 */
export default function BodyKicker({ style }) {
  const ref = useRef(null);
  const inView = useInView(ref, IN_VIEW);
  const reduce = useReducedMotion();

  const [replay, setReplay] = useState(0);
  const dials = useDialKit(
    'Body Kicker',
    {
      firstVerb: [TIMING.firstVerb, 0, 2500, 50],
      verbStagger: [TIMING.verbStagger, 0, 900, 20],
      asciiType: [TIMING.asciiType, 0, 4000, 50],
      asciiIdle: [TIMING.asciiIdle, 0, 6000, 50],
      riseY: [VERBS.riseY, 0, 80, 1],
      entryTiltMul: [VERBS.entryTiltMul, 0, 5, 0.1],
      tiltScale: [1, 0, 3, 0.05],
      typeS: [MARKS.typeS, 0, 0.2, 0.002],
      frameMs: [MARKS.frameMs, 30, 400, 10],
      markAlpha: [MARKS.alpha, 0.1, 1, 0.05],
      markScale: [1, 0.6, 2, 0.05],
      replayKicker: { type: 'action', label: '⟳ Replay' },
    },
    { onAction: (a) => a === 'replayKicker' && setReplay((n) => n + 1) }
  );

  // 0 nothing · 1-3 verbs · 4 marks type on · 5 marks idle.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!inView) {
      setStage(0);
      return undefined;
    }
    if (reduce) {
      setStage(4);
      return undefined;
    }
    setStage(0);
    const at = [
      dials.firstVerb,
      dials.firstVerb + dials.verbStagger,
      dials.firstVerb + dials.verbStagger * 2,
      dials.asciiType,
      dials.asciiIdle,
    ];
    const timers = at.map((ms, i) => window.setTimeout(() => setStage(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [inView, reduce, replay, dials.firstVerb, dials.verbStagger, dials.asciiType, dials.asciiIdle]);

  // One clock drives all three motifs. Deliberately coarse — ascii should step,
  // not glide, and re-rendering the marks at display rate buys nothing.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (stage < 5 || reduce || !dials.frameMs) return undefined;
    const started = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - started), dials.frameMs);
    return () => clearInterval(id);
  }, [stage, reduce, dials.frameMs]);

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 620,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {VERBS.items.map((verb, i) => {
        const on = stage >= i + 1;
        const tilt = verb.tilt * dials.tiltScale;
        return (
          <motion.div
            key={verb.text}
            style={{ alignSelf: verb.align, transformOrigin: '50% 60%' }}
            initial={{
              opacity: 0,
              y: dials.riseY,
              rotate: tilt * dials.entryTiltMul,
              x: verb.nudgeX,
            }}
            animate={{
              opacity: on ? 1 : 0,
              y: on ? 0 : dials.riseY,
              rotate: on ? tilt : tilt * dials.entryTiltMul,
              x: verb.nudgeX,
            }}
            transition={reduce ? { duration: 0.3 } : VERBS.spring}
          >
            {verb.text}
          </motion.div>
        );
      })}

      {/* Marks sit outside the flow so they can hang off the block's edges. */}
      {MARKS.items.map((mark) => {
        const on = stage >= 4;
        // Glyphs type on in one continuous run across the mark's lines.
        let n = 0;
        // The phase applies before the loop starts too, so the frame a mark
        // types on IS the frame it then runs from — no jump at the hand-off.
        const ms = (stage >= 5 ? elapsed : 0) + (mark.phase || 0);
        return (
          <div
            key={mark.id}
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: mark.top,
              left: mark.left,
              transform: `rotate(${mark.tilt}deg) scale(${mark.scale ?? 1})`,
              fontFamily: MONO,
              fontSize: `calc(${MARKS.size} * ${dials.markScale})`,
              letterSpacing: '0.08em',
              lineHeight: 1.5,
              color: inkA(dials.markAlpha * (mark.dim ?? 1)),
              whiteSpace: 'pre',
              pointerEvents: 'none',
            }}
          >
            {mark.motif.lines(ms).map((line, li) => {
              return (
                <div key={li}>
                  {[...line].map((ch, ci) => (
                    <motion.span
                      key={ci}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: on ? 1 : 0 }}
                      transition={{
                        duration: MARKS.fadeS,
                        delay: on ? (mark.delay || 0) + n++ * dials.typeS : 0,
                      }}
                    >
                      {ch}
                    </motion.span>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
