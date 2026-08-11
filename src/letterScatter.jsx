/* ─────────────────────────────────────────────────────────────────────
 * LETTER SCATTER
 *
 * The hover the site gives its typographic controls: every letter of a label
 * steps a little way out along its own line and tilts, and settles back when
 * the pointer leaves. The word comes loose rather than lighting up — a
 * disturbed archive label, not a button animating.
 *
 * Worn by the onboarding's closing ENTER THE ARCHIVE and by the archive's
 * INDEX / EXPLORE view tabs. The two want different amplitudes — the cta is a
 * one-time flourish at the end of a sequence, the tabs are chrome a cursor
 * crosses all day — so the surfaces set a `strength` against the reach and
 * tilt here rather than each keeping its own copy of the derivation.
 * ───────────────────────────────────────────────────────────────────── */
import { Fragment, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/** The page's shared ease-out, repeated rather than imported so this module
 *  stays free of the pages that use it. */
const EASE = [0.22, 1, 0.36, 1];

/**
 * Full-strength scatter, as worn by the onboarding cta.
 *
 * Small on purpose. That label is 12.5px mono tracked out to 0.24em, so there
 * is room between the caps to move into, but at 6px and 14° the letters crossed
 * into each other's gaps and the line read as a ransom note instead of a
 * disturbed archive label. Going back is slower than going out: the scatter
 * should answer the cursor promptly and then relax, not snap shut.
 */
export const LETTER_SCATTER = {
  reachPx: 2.6, //     px the furthest-travelling glyph covers at strength 1
  nearestFrac: 0.5, // shortest travel as a fraction of reachPx (see below)
  tiltDeg: 5, //       max ± rotation at strength 1
  outS: 0.32,
  backS: 0.46,
};

/** rad — the golden angle, the turn per index in the direction walk below. */
const GOLDEN_ANGLE = 2.39996;

/**
 * Where letter `i` goes while its label is hovered: a direction, a distance
 * along it, and a tilt, scaled by `strength`.
 *
 * Derived from the index rather than drawn from Math.random, because a draw
 * taken during render is a different draw on the next one — and these labels
 * re-render under a held cursor (a beat lands, a view switches), which sent a
 * letter up-left on the way out and back down-right halfway through the move.
 * The letters twitched instead of holding their scatter.
 *
 * Turning by the golden angle each index is what keeps neighbours from pointing
 * the same way, but it is too orderly alone: the directions sweep round in
 * order, and the word reads as one slow rotation rather than as a scatter. So
 * a multiplicative hash of the index — the same cheap integer hash that seeds a
 * dissolving block in textDissolve — bends each angle off the walk and gives
 * each letter its own reach and tilt. Distances span nearestFrac..1 of the
 * reach so no two neighbours are pushed out equally far either.
 *
 * `strength` scales reach and tilt together and leaves the directions alone, so
 * a quieter surface is recognisably the same move rather than a different one.
 */
export function letterScatter(i, strength = 1) {
  const h = ((i + 1) * 2654435761) >>> 0;
  const bend = ((h >>> 7) % 1024) / 1024;
  const reach = ((h >>> 17) % 1024) / 1024;
  const tilt = ((h >>> 2) % 1024) / 1024;
  const angle = i * GOLDEN_ANGLE + (bend - 0.5) * 1.3;
  const { reachPx, nearestFrac, tiltDeg } = LETTER_SCATTER;
  const dist = reachPx * strength * (nearestFrac + (1 - nearestFrac) * reach);
  return {
    x: +(Math.cos(angle) * dist).toFixed(2),
    y: +(Math.sin(angle) * dist).toFixed(2),
    rotate: +((tilt - 0.5) * 2 * tiltDeg * strength).toFixed(2),
  };
}

/**
 * `text` rendered a glyph at a time, scattered while `scattered` is true.
 *
 * The wrapper is where any underline belongs — pass the site's dotted rule in
 * `style` and it is drawn across the whole phrase while only the glyphs move
 * above it. Per-letter the rule is a different treatment entirely: the 3px dash
 * period restarts inside every span, so the dashes fall out of step with each
 * other, and the line breaks at every letter gap and word space into a row of
 * little underscores.
 *
 * The whole wrapper is hidden from assistive tech, since a span per glyph is
 * read out a letter at a time with the word breaks gone. Callers own the
 * accessible name — give the control an aria-label.
 */
export function ScatterLabel({ text, scattered, strength = 1, style }) {
  const reduce = useReducedMotion();
  // One draw for the life of the label, so nothing about the scatter can change
  // between the cursor arriving and leaving — see letterScatter.
  const letters = useMemo(
    () => [...text].map((ch, i) => ({ ch, ...letterScatter(i, strength) })),
    [text, strength]
  );
  const out = scattered && !reduce;
  return (
    <span aria-hidden="true" style={style}>
      {letters.map(({ ch, x, y, rotate }, i) =>
        ch === ' ' ? (
          // Word gaps are left as text. A space is collapsible whitespace, so
          // inside an inline-block of its own it comes out zero-wide and the
          // words closed up into one.
          <Fragment key={i}>{' '}</Fragment>
        ) : (
          <motion.span
            key={i}
            // Reduced motion keeps the label still: the point of the move is
            // the small shock of the letters coming loose, which is exactly
            // what someone asking for less motion is asking not to be given.
            animate={out ? { x, y, rotate } : { x: 0, y: 0, rotate: 0 }}
            transition={{ duration: out ? LETTER_SCATTER.outS : LETTER_SCATTER.backS, ease: EASE }}
            // A transform doesn't apply to a non-replaced inline box, and
            // inline-block takes its baseline from the glyph inside it — so the
            // line box is the one the unsplit label sat in.
            style={{ display: 'inline-block' }}
          >
            {ch}
          </motion.span>
        )
      )}
    </span>
  );
}
