import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * BODY KICKER STORYBOARD
 *
 * Closes the body statement. The sentence above ("…changing how we")
 * dissolves in first and is left hanging; these three verbs finish it on
 * one line — "communicate, work, think…" — then the machine noise creeps
 * in around them.
 *
 * Read top-to-bottom. Each value is ms after the beat scrolls into view.
 *
 *    0ms   nothing — the body line above is still dissolving in
 *  900ms   "communicate"  fades in, untilting from a steeper angle
 * 1160ms   "work"         same, tilted harder the other way
 * 1420ms   "think"        same, nearly upright
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

/* The three verbs that finish the sentence, as one list: commas and an
   ellipsis are part of the copy, not decoration around three stacked words.
   `tilt` is a rest angle in degrees — shallow on purpose, so the line still
   reads as a line. */
const VERBS = {
  entryTiltMul: 2.1, // entrance angle as a multiple of the resting tilt
  spring: { type: 'spring', stiffness: 180, damping: 18, mass: 1 },
  items: [
    { text: 'communicate,', tilt: -1.4 },
    { text: 'work,', tilt: 2.2 },
    { text: 'think…', tilt: -0.8 },
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

   They RING the verbs rather than sitting under them. The verbs are bundled about
   the block's centre (see VERBS), so the ring is the two side columns, the strip
   above the first line, and the space under the last. Positions are set against the
   three word boxes, measured off a real render: at 1440 the type holds x 23–51% /
   61–72% / 37–48%, and at 390 it spreads to 18–55% / 59–74% / 36–49%, since the
   verbs' type is clamped while the block keeps shrinking. Marks therefore clear the type in x
   rather than in y — a verb is ~40px tall against marks of up to 51px, so a mark
   can't clear one vertically without climbing into the body line above.

   The noise is deliberately NOT bundled with the type. It is the thing creeping in
   AROUND the words, so it keeps the whole block and a little past it — the outer
   marks reach ~-4% and ~112%, and that overhang is bounded by the page rather than
   by taste: the copy column is 74vw, so even on a 320px screen there is ~40px of
   page either side of the block and the outermost mark still lands ~12px inside
   the viewport. The page has no overflow-x guard, so a mark reaching further than
   that would pull a horizontal scrollbar on a phone.

   The two-row motifs are scaled down here for the same reason as ever: at full
   size a side column only has the height for two of them, and the third ended up
   either sitting on the type or trailing off the bottom of the screen.

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
    /* ── the two wires strung above "communicate" ──
       Both of them cross the first verb's own column, which only works because
       they are ABOVE its ink rather than beside it; the top-left corner is the one
       place a mark can do that, and it is why the mark there is a one-line motif.
       A two-row one had to hang out to -13% to clear the verb's start on a phone,
       which put it 55px adrift of the block on a desktop and clipped its left
       glyph off the screen at 390. */
    { id: 'l-spark', motif: SPARK, top: '-16%', left: '-4%', tilt: 4, scale: 0.85, dim: 0.75, phase: 540, delay: 0.24 },
    { id: 'c-spark', motif: SPARK, top: '-16%', left: '31%', tilt: -5, phase: 0, delay: 0 },
    // ── off "communicate"'s right shoulder, then on down the right column ──
    { id: 'c-cells', motif: NEURONS, top: '-14%', left: '62%', tilt: 3, scale: 0.8, dim: 0.8, phase: 380, delay: 0.18 },
    { id: 'w-blocks', motif: BLOCKS, top: '36%', left: '80%', tilt: 0, scale: 0.7, phase: 0, delay: 0.06 },
    // ── the left column, level with "work" and then below "think" ──
    { id: 'l-cells', motif: NEURONS, top: '36%', left: '-2%', tilt: 0, scale: 0.65, phase: 0, delay: 0.1 },
    { id: 't-blocks', motif: BLOCKS, top: '74%', left: '-4%', tilt: -3, scale: 0.8, dim: 0.75, phase: 300, delay: 0.3 },
    // ── and along the bottom, closing the ring under "think" and "work" ──
    { id: 't-spark', motif: SPARK, top: '92%', left: '53%', tilt: -6, scale: 0.9, dim: 0.85, phase: 220, delay: 0.14 },
    { id: 'b-cells', motif: NEURONS, top: '84%', left: '84%', tilt: 2, scale: 0.7, dim: 0.7, phase: 660, delay: 0.36 },
  ],
};

/* The marks are off while the verbs are being looked at on their own.
 *
 * A switch rather than a deletion, and deliberately the only thing that moves:
 * the motifs, their ring of positions and the schedule that types them on are
 * all still live below, so turning this back to `true` restores the sequence
 * exactly as it was tuned. Stages 4 and 5 still fire on the clock — nothing
 * reads them while this is false, and leaving them alone keeps the storyboard
 * above honest about the order rather than describing a schedule that has been
 * quietly cut short. */
const SHOW_MARKS = false;

const IN_VIEW = { once: true, margin: '0px 0px -24% 0px' };

/**
 * The tail of the body statement: three verbs on one line, then ascii noise.
 *
 * Stage-driven — one integer walks the whole sequence, so the storyboard above
 * is the only place the order lives. Under reduced motion every stage resolves
 * at once with no tilt animation and no running motifs.
 */
/* `start` overrides the scroll trigger for pages that don't scroll: on the beat
   telling of the onboarding, the whole thing sits in one fixed screen, where
   nothing ever "comes into view" and the arriving beat is the cue instead.

   Every time in the storyboard above is measured from the body line beginning to
   dissolve in, so a caller whose line is held back has to hold these back with
   it — `delayS` shifts the whole schedule rather than only the first verb, since
   what matters is the shape of the sequence and not where it starts. Without it
   the verbs finished a sentence that hadn't been written yet. */
export default function BodyKicker({ style, start, delayS = 0 }) {
  const ref = useRef(null);
  const scrolledInto = useInView(ref, IN_VIEW);
  const inView = start === undefined ? scrolledInto : start;
  const reduce = useReducedMotion();

  const [replay, setReplay] = useState(0);
  const dials = useDialKit(
    'Body Kicker',
    {
      firstVerb: [TIMING.firstVerb, 0, 2500, 50],
      verbStagger: [TIMING.verbStagger, 0, 900, 20],
      asciiType: [TIMING.asciiType, 0, 4000, 50],
      asciiIdle: [TIMING.asciiIdle, 0, 6000, 50],
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
    ].map((ms) => ms + delayS * 1000);
    const timers = at.map((ms, i) => window.setTimeout(() => setStage(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [inView, reduce, replay, delayS, dials.firstVerb, dials.verbStagger, dials.asciiType, dials.asciiIdle]);

  // One clock drives all three motifs. Deliberately coarse — ascii should step,
  // not glide, and re-rendering the marks at display rate buys nothing.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!SHOW_MARKS || stage < 5 || reduce || !dials.frameMs) return undefined;
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
        flexDirection: 'row',
        flexWrap: 'nowrap',
        justifyContent: 'center',
        alignItems: 'baseline',
        gap: '0.33em',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {VERBS.items.map((verb, i) => {
        const on = stage >= i + 1;
        const tilt = verb.tilt * dials.tiltScale;
        return (
          <motion.div
            key={verb.text}
            style={{
              flex: '0 0 auto',
              transformOrigin: '50% 60%',
            }}
            initial={{
              opacity: 0,
              rotate: tilt * dials.entryTiltMul,
            }}
            animate={{
              opacity: on ? 1 : 0,
              rotate: on ? tilt : tilt * dials.entryTiltMul,
            }}
            transition={reduce ? { duration: 0.3 } : VERBS.spring}
          >
            {verb.text}
          </motion.div>
        );
      })}

      {/* Marks sit outside the flow so they can hang off the block's edges. */}
      {SHOW_MARKS && MARKS.items.map((mark) => {
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
