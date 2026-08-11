/* ─────────────────────────────────────────────────────────────────────
 * PRINT MARGIN
 *
 * A caption's margin, for a photograph that came without one.
 *
 * The Dolores Park booth's white border is part of the scan rather than a frame
 * around it: it is barely 1% of the file on every side, and the paper sits a few
 * degrees off square inside its own transparent box. So there is no margin to
 * write in.
 *
 * Nor is there room to write on the picture. The bottom of that photograph is
 * the CONFESSION BOX sign on one side and sunlit dirt on the other — luminance
 * runs from about 55 to 200 across the band — so a line laid over it collides
 * with the sign at one end and dissolves into the ground at the other, and at
 * the size the rest of the site's metadata sets it reads as a watermark left on
 * by mistake.
 *
 * The print is given the deeper bottom margin it would have been mounted with
 * instead, hung off the paper's own bottom edge and turned onto the paper's own
 * angle, so what the caption sits on is more of the same photograph rather than
 * a panel underneath it. Everything here is measured off the paper, not off the
 * file: the corners of the paper are at 0,62 / 902,0 / 974,950 / 66,1022 of a
 * 977×1024 png, and the bottom edge those last two describe is what the margin
 * is squared to. That tilt is baked into the file, so it holds wherever the
 * photograph is shown and whatever the surface it is shown on is doing — the
 * onboarding pile turns its prints another five degrees and the scrolled telling
 * hangs the same photograph square, and both get the same strip.
 *
 * The margin is laid in behind the photograph and tucked a little way under it,
 * so the join is covered by the scan's own soft edge instead of meeting it as a
 * seam — the two whites are close but the scan's is grained and this one cannot
 * be.
 *
 * Sized as a fraction of the photograph rather than in px, so writing on a
 * photograph gets smaller with the photograph. At the widths the piece is read
 * at, that lands the line at ~11px — which is where the About drawer's credits
 * and the archive's DATE / LOCATION rows set.
 *
 *     <div style={{ position: 'relative', width: frameW }}>
 *       <PrintMargin frameWidth={frameW}>San Francisco, April 2026</PrintMargin>
 *       <img src="/intro-booth-park.png" style={{ width: '100%' }} />
 *     </div>
 *
 * It costs the photograph no layout — it hangs out of the bottom of the box on
 * its own. A column that has something under the print should reserve
 * `printMarginDepth(frameWidth)` below it; the pile, which has nothing under
 * anything, does not.
 * ───────────────────────────────────────────────────────────────────── */

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

/** Where and when the box stood. One string, because both tellings caption the
 *  same photograph. Sentence case here and set in the caps the rest of the
 *  site's metadata wears below, so the copy stays a place and a date rather than
 *  a shouted string. */
export const BOOTH_CAPTION = 'San Francisco, April 2026';

export const PRINT_MARGIN = {
  leftPct: 6.76, //     % of the frame — the paper's bottom-left corner
  topPct: 99.8, //      % of the frame — ditto
  widthPct: 93.2, //    % of the frame — the length of the paper's bottom edge
  edgeDeg: -4.53, //    the angle of that edge
  fileAspect: 1024 / 977, // the png's proportions, so depths can be read off it
  depthPct: 11, //      % of the frame's height
  overlapPct: 1.4, //   % of the frame's height, tucked back under the print
  sizePct: 3.8, //      % of the frame's width — the caption's type size
  /* The scan's own border, sampled off the file at (500, 990). Photographic
     paper rather than page white: it has to sit next to the real thing. */
  paper: 'rgb(224, 229, 223)',
  /* And graphite on it, rather than the site's ink — every other piece of
     metadata on the site is light type on a dark page, and this one is the only
     thing in the piece written on paper. */
  ink: 'rgba(46, 44, 38, 0.72)',
};

/** px the margin hangs below a print this wide, for a column to reserve. */
export const printMarginDepth = (frameWidth) =>
  (frameWidth * PRINT_MARGIN.fileAspect * PRINT_MARGIN.depthPct) / 100;

/**
 * Goes inside a `position: relative` box that is exactly the photograph's, and
 * before the photograph, so the scan's own edge paints over the tuck.
 *
 * Out of the reading order: the picture is already described by its alt text.
 */
export default function PrintMargin({ frameWidth, children }) {
  // A percentage padding would resolve against the strip's WIDTH, which is six
  // times the depth being corrected for.
  const tuckPx = (frameWidth * PRINT_MARGIN.fileAspect * PRINT_MARGIN.overlapPct) / 100;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        zIndex: -1,
        left: `${PRINT_MARGIN.leftPct}%`,
        top: `${PRINT_MARGIN.topPct - PRINT_MARGIN.overlapPct}%`,
        width: `${PRINT_MARGIN.widthPct}%`,
        height: `${PRINT_MARGIN.depthPct + PRINT_MARGIN.overlapPct}%`,
        transform: `rotate(${PRINT_MARGIN.edgeDeg}deg)`,
        transformOrigin: 'top left',
        background: PRINT_MARGIN.paper,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // The strip tucked under the print is hidden; the line centres in what's
        // left rather than in the whole margin.
        paddingTop: tuckPx,
        userSelect: 'none',
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: (frameWidth * PRINT_MARGIN.sizePct) / 100,
          letterSpacing: '0.1em',
          lineHeight: 1,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          color: PRINT_MARGIN.ink,
        }}
      >
        {children}
      </span>
    </div>
  );
}
