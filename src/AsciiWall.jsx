import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { CONFESSIONS } from './confessions';
import { inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * ASCII WALL
 *
 * Backdrop for the closing beat: every confession in the archive run together
 * into one unbroken monospace field, then punched through with empty
 * rectangles. The closing copy sits inside the largest of those holes.
 *
 * The field is built as a CHARACTER GRID rather than as wrapping paragraphs.
 * Wrapped text can't be punched — a hole in the middle of a line would reflow
 * everything after it — whereas a grid lets any rectangle be cleared by writing
 * spaces into it, and the mono cell keeps every row in column.
 *
 * A hole may carry `art`: an array of strings stamped into the rect instead of
 * blanks. Nothing uses it yet, which is the point — dropping an ascii shape in
 * later is a change to the hole list, not to the wall.
 *
 * Rows render one DOM node each (~60 of them), not one per cell. A full screen
 * is ~20k characters and 20k animated spans would be unusable.
 * ───────────────────────────────────────────────────────────────────── */

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const EASE_OUT = [0.165, 0.84, 0.44, 1];

const WALL = {
  fontSize: 9, //       px — texture, not reading size
  lineHeight: 1.4,
  letterSpacing: 0.08, // em
  alpha: 0.2, //        dim enough that the closing copy still leads
  holes: 18, //         empty rects punched into the field
  holeMin: 12, //       hole width in cells; below ~10 a hole reads as a
  holeMax: 34, //       paragraph break in the field rather than a punch
  holeJitter: 0.4, //   0 = every hole square, 1 = up to 2:1 either way
  clearW: 0.58, //      centre clearing for the copy, fraction of the grid
  clearH: 0.44,
  seed: 7, //           reroll the layout
  revealS: 0.55,
  rowStaggerS: 0.016, // per row, measured out from the centre
};

/* Deterministic PRNG (mulberry32). The layout has to survive re-renders and
   resizes — with Math.random every measurement would reshuffle the holes. */
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* Every confession as one stream. Uppercased and space-collapsed because at 9px
   the field reads as texture rather than as words, and lowercase turns to mush
   at that size while caps hold an even grain. */
const STREAM = CONFESSIONS.map((c) => c.transcription)
  .join('   ')
  .toUpperCase()
  .replace(/\s+/g, ' ');

/** Cells of clear field kept between neighbouring holes. */
const HOLE_GAP = 3;
const PLACE_TRIES = 40;

const overlaps = (a, b, gap) =>
  a.x < b.x + b.w + gap &&
  b.x < a.x + a.w + gap &&
  a.y < b.y + b.h + gap &&
  b.y < a.y + a.h + gap;

/**
 * Places the centre clearing plus `cfg.holes` random rects.
 *
 * Holes are sized in CELLS, but a cell is much taller than it is wide, so a
 * square hole needs roughly twice as many columns as rows — hence the aspect
 * correction. Without it every "square" comes out as a tall slot.
 *
 * Placement is rejection-sampled against everything already down, the clearing
 * included. Allowed to overlap they merge into one ragged void — the squares
 * only read as squares when there's field between them.
 */
function makeHoles({ cols, rows, cellW, cellH }, cfg) {
  const rand = rng(Math.round(cfg.seed));
  const aspect = cellH / cellW;

  const clearW = Math.round(cols * cfg.clearW);
  const clearH = Math.round(rows * cfg.clearH);
  const holes = [
    {
      x: Math.round((cols - clearW) / 2),
      y: Math.round((rows - clearH) / 2),
      w: clearW,
      h: clearH,
    },
  ];

  for (let n = 0; n < Math.round(cfg.holes); n++) {
    const w = Math.round(cfg.holeMin + rand() * Math.max(0, cfg.holeMax - cfg.holeMin));
    // Square, then stretched either way by up to `holeJitter`.
    const stretch = 1 + (rand() * 2 - 1) * cfg.holeJitter;
    const h = Math.max(2, Math.round((w / aspect) * stretch));
    for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
      const rect = {
        x: Math.floor(rand() * Math.max(1, cols - w)),
        y: Math.floor(rand() * Math.max(1, rows - h)),
        w,
        h,
      };
      if (holes.some((other) => overlaps(rect, other, HOLE_GAP))) continue;
      holes.push(rect);
      break;
    }
    // Out of tries means the field is full at this size; drop the hole rather
    // than force it somewhere it doesn't fit.
  }
  return holes;
}

/** Fills the grid from the stream, then clears (or stamps) each hole. */
function buildRows({ cols, rows }, holes) {
  const grid = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const line = new Array(cols);
    for (let c = 0; c < cols; c++) line[c] = STREAM[i++ % STREAM.length];
    grid.push(line);
  }
  holes.forEach(({ x, y, w, h, art }) => {
    for (let r = Math.max(0, y); r < Math.min(rows, y + h); r++) {
      for (let c = Math.max(0, x); c < Math.min(cols, x + w); c++) {
        grid[r][c] = art?.[r - y]?.[c - x] ?? ' ';
      }
    }
  });
  return grid.map((line) => line.join(''));
}

const PROBE = 'X'.repeat(50);
const IN_VIEW = { once: true, margin: '0px 0px -20% 0px' };

/* The field is scoped to one beat, so without this it would begin and end on a
   ruler-straight horizontal cut as you scroll into it. Fades the top and bottom
   rows out instead, so it surfaces out of the beats either side. */
const EDGE_FADE = 'linear-gradient(to bottom, transparent, #000 15%, #000 85%, transparent)';

/**
 * Full-bleed confession field behind the closing beat.
 *
 * Breaks out of the 660px reading column with a 100vw box, and sits at z-index
 * -1 so the beat's own copy paints over it — a positioned child at z 0 would
 * cover the in-flow text instead.
 */
export default function AsciiWall() {
  const hostRef = useRef(null);
  const probeRef = useRef(null);
  const inView = useInView(hostRef, IN_VIEW);
  const reduce = useReducedMotion();

  const config = useDialKit('Closing Wall', {
    type: {
      fontSize: [WALL.fontSize, 5, 20, 0.5],
      alpha: [WALL.alpha, 0.02, 0.6, 0.01],
    },
    holes: {
      count: [WALL.holes, 0, 60, 1],
      min: [WALL.holeMin, 2, 40, 1],
      max: [WALL.holeMax, 2, 80, 1],
      jitter: [WALL.holeJitter, 0, 1, 0.05],
      seed: [WALL.seed, 1, 200, 1],
    },
    clearing: {
      w: [WALL.clearW, 0.2, 0.95, 0.01],
      h: [WALL.clearH, 0.1, 0.9, 0.01],
    },
    reveal: {
      fade: [WALL.revealS, 0.05, 2, 0.05],
      rowStagger: [WALL.rowStaggerS, 0, 0.12, 0.002],
    },
  });
  const { type: typeCfg, holes: holeCfg, clearing, reveal } = config;

  // Measure the host and one character, then derive the grid. Cell width has to
  // be measured rather than computed — it depends on the resolved mono face and
  // on letter-spacing, neither of which is knowable up front.
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    const probe = probeRef.current;
    if (!host || !probe) return undefined;
    const measure = () => {
      const cellW = probe.getBoundingClientRect().width / PROBE.length;
      const cellH = typeCfg.fontSize * WALL.lineHeight;
      // clientWidth, not 100vw: vw units count the scrollbar, so on a platform
      // with classic scrollbars a 100vw breakout hangs off both edges and gives
      // the page a horizontal scroll.
      const vw = document.documentElement.clientWidth;
      const height = host.getBoundingClientRect().height;
      if (!(cellW > 0) || !(vw > 0)) return;
      // One extra of each so the field runs past the edges rather than
      // leaving a sliver of background at the right or bottom.
      const cols = Math.ceil(vw / cellW) + 1;
      const rows = Math.ceil(height / cellH) + 1;
      setBox((prev) =>
        prev && prev.cols === cols && prev.rows === rows && prev.cellW === cellW && prev.vw === vw
          ? prev
          : { cols, rows, cellW, cellH, vw }
      );
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [typeCfg.fontSize]);

  const lines = useMemo(() => {
    if (!box) return [];
    return buildRows(
      box,
      makeHoles(box, {
        holes: holeCfg.count,
        holeMin: Math.min(holeCfg.min, holeCfg.max),
        holeMax: Math.max(holeCfg.min, holeCfg.max),
        holeJitter: holeCfg.jitter,
        clearW: clearing.w,
        clearH: clearing.h,
        seed: holeCfg.seed,
      })
    );
  }, [box, holeCfg, clearing]);

  const type = {
    fontFamily: MONO,
    fontSize: typeCfg.fontSize,
    lineHeight: WALL.lineHeight,
    letterSpacing: `${WALL.letterSpacing}em`,
    whiteSpace: 'pre',
  };
  const mid = (lines.length - 1) / 2;

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '50%',
        width: box ? box.vw : '100vw',
        transform: 'translateX(-50%)',
        overflow: 'hidden',
        zIndex: -1,
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitMaskImage: EDGE_FADE,
        maskImage: EDGE_FADE,
        color: inkA(typeCfg.alpha),
        ...type,
      }}
    >
      <span ref={probeRef} style={{ ...type, position: 'absolute', visibility: 'hidden' }}>
        {PROBE}
      </span>
      {lines.map((line, i) => (
        <motion.div
          key={i}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: inView ? 1 : 0 }}
          transition={{
            duration: reduce ? 0 : reveal.fade,
            ease: EASE_OUT,
            // Out from the middle, so the field grows around the copy.
            delay: reduce ? 0 : Math.abs(i - mid) * reveal.rowStagger,
          }}
        >
          {line}
        </motion.div>
      ))}
    </div>
  );
}
