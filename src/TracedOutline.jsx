/* ─────────────────────────────────────────────────────────────────────
 * TRACED OUTLINE
 *
 * A dashed hairline that arrives by being drawn. The line leaves the top-left
 * corner, travels round the box and closes back on that corner; nothing slides
 * and nothing fades, so the thing it outlines is standing where it will stay
 * from the first frame.
 *
 * The dashes are the whole difficulty. `stroke-dasharray` is the property you
 * would animate to draw a line on, and here it is already spoken for by the
 * dash pattern itself. So the pattern is painted in full and a fat solid stroke
 * on the same path sweeps round inside a <mask>, uncovering it: the dashes
 * appear one at a time as the front passes them, which is the reading we want —
 * a pen laying down a broken rule rather than a solid rule that turns dashed at
 * the end. Tracing solid and crossfading to a real CSS border once it closed
 * was the other way round it, and it put two painters on the same hairline:
 * Chrome fits its border dashes to each side separately, the SVG runs one dash
 * pattern round the whole perimeter, and the two never agreed on where the
 * dashes fell — the swap landed as a shimmer.
 *
 * Being the only painter, the outline stays once it is drawn: it IS the border.
 * Give the element it covers a transparent border of the same width so the box
 * keeps its metrics, hang the colour on the positioned parent, and the stroke
 * follows it through `currentColor` — including a :hover or :focus-within
 * change, which transitions in CSS as a border-color would have.
 *
 *     <div style={{ position: 'relative', display: 'flex', color: inkA(0.3) }}>
 *       <input style={{ border: '1px solid transparent' }} />
 *       <TracedOutline play delay={0.6} />
 *     </div>
 *
 * Inert to the pointer and out of the accessibility tree: whatever it outlines
 * is still the thing you click into, focus and type in.
 * ───────────────────────────────────────────────────────────────────── */

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/** px — dash length. What Chrome paints for a 1px CSS `dashed` border, so an
 *  outline can sit in a rail beside borders that are still CSS and match. */
const DASH = 3;
/** px — the dash-to-dash repeat aimed at, before it is fitted to the path. */
const PERIOD = 5;
/**
 * Chrome does not paint the pattern you ask for: it counts the whole repeats
 * that fit the side being drawn and stretches the gaps to take up the
 * remainder, which is how a dash always lands in the corners. Doing the same
 * around the perimeter is what keeps the closing dash from landing half over
 * the first one, on a box of any size.
 */
const fitDash = (perimeter) => {
  const repeats = Math.max(1, Math.round(perimeter / PERIOD));
  return `${DASH} ${perimeter / repeats - DASH}`;
};

/** How much wider than the stroke the revealing sweep is cut. Enough to clear
 *  the antialiasing either side of a hairline, and to cover a corner join. */
const MASK_OVERHANG = 4;

/**
 * Mild ease-out (quad). A pen leaves the corner at speed and only slows as it
 * comes back round to it. The rail's own ease-out-quint spends four fifths of
 * the path in the first third of the time, which left the last two dashes
 * crawling into the corner long after the trace had visually finished.
 */
const TRACE_EASE = [0.25, 0.46, 0.45, 0.94];

/** Clockwise from the top-left corner — where the eye starts, and the corner a
 *  field's glyph and text already hang off. */
const outlinePath = (w, h, r, inset) => {
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const rad = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (!rad) return `M${x0} ${y0} H${x1} V${y1} H${x0} Z`;
  return [
    `M${x0 + rad} ${y0}`,
    `H${x1 - rad}`,
    `A${rad} ${rad} 0 0 1 ${x1} ${y0 + rad}`,
    `V${y1 - rad}`,
    `A${rad} ${rad} 0 0 1 ${x1 - rad} ${y1}`,
    `H${x0 + rad}`,
    `A${rad} ${rad} 0 0 1 ${x0} ${y1 - rad}`,
    `V${y0 + rad}`,
    `A${rad} ${rad} 0 0 1 ${x0 + rad} ${y0}`,
    'Z',
  ].join(' ');
};

/** Four sides less the corners they lose, plus the circle those corners make. */
const outlineLength = (w, h, r, inset) => {
  const iw = w - 2 * inset;
  const ih = h - 2 * inset;
  const rad = Math.max(0, Math.min(r, iw / 2, ih / 2));
  return 2 * (iw + ih) - 8 * rad + 2 * Math.PI * rad;
};

export function TracedOutline({
  // Whether to draw it. Pass false wherever the surrounding entrance is being
  // skipped (a returning view, an already-settled page) and the outline simply
  // stands there — which is also what a visitor who prefers reduced motion
  // gets, decided here so no caller has to remember it.
  play = false,
  duration = 0.6,
  delay = 0,
  ease = TRACE_EASE,
  // Match the corner of the box being outlined, in px.
  radius = 0,
  strokeWidth = 1,
  className,
  style,
}) {
  const reduceMotion = useReducedMotion();
  const maskId = `traced-outline${useId().replace(/:/g, '')}`;
  const svgRef = useRef(null);
  const [box, setBox] = useState(null);

  // Measured rather than scaled to fit: an SVG stretched over the box with
  // preserveAspectRatio="none" would run the dash pattern at one length along
  // the top and another down the side. Without a viewBox one user unit is one
  // px, so the path only needs the numbers. useLayoutEffect so they are in
  // hand before the first paint — the outline is the border, and a frame
  // without it is a frame with no border at all.
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((prev) => (prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const drawing = play && !reduceMotion;
  // Half a stroke in, so a hairline lands on the box's own edge pixels instead
  // of straddling them.
  const inset = strokeWidth / 2;
  const d = box ? outlinePath(box.w, box.h, radius, inset) : null;

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        ...style,
      }}
    >
      {d ? (
        <>
          <defs>
            {/* The sweep. Sized in user space rather than left on the default
                bounding-box region, which is measured off the path and would
                crop a stroke this much fatter than it. */}
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x={-MASK_OVERHANG}
              y={-MASK_OVERHANG}
              width={box.w + 2 * MASK_OVERHANG}
              height={box.h + 2 * MASK_OVERHANG}
            >
              <motion.path
                d={d}
                fill="none"
                stroke="#fff"
                strokeWidth={strokeWidth + MASK_OVERHANG}
                // Butt, so the front of the sweep is a clean perpendicular
                // edge: a round cap bulges half a stroke past the dash it is
                // uncovering and lets the next one bleed in early.
                strokeLinecap="butt"
                initial={drawing ? { pathLength: 0 } : false}
                animate={{ pathLength: 1 }}
                transition={drawing ? { duration, delay, ease } : { duration: 0 }}
              />
            </mask>
          </defs>
          <path
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray={fitDash(outlineLength(box.w, box.h, radius, inset))}
            mask={`url(#${maskId})`}
          />
        </>
      ) : null}
    </svg>
  );
}

export default TracedOutline;
