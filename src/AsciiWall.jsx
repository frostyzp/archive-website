import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { CONFESSIONS as BUNDLED_CONFESSIONS } from './confessions';
import { loadConfessionsOnce } from './loadConfessions';
import { inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * ASCII WALL
 *
 * Backdrop for the top of the page: every confession in the archive run
 * together into one unbroken monospace field, punched through with small empty
 * rectangles, holding for most of the first screen and then fading out from
 * under the hero.
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
 * Words are dimmed individually (see WORD_ALPHA) so the field reads as
 * fragments surfacing out of a murmur rather than as one even grain.
 *
 * Rows render one DOM node per word (spaces stay bare text) rather than one
 * per cell — a full screen is ~20k characters and that many animated spans
 * would be unusable. The reveal fades those word nodes in on shuffled delays,
 * so the field fills as scattered murmurs rather than a left→right sweep.
 * ───────────────────────────────────────────────────────────────────── */

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

const WALL = {
  fontSize: 9, //       px — texture, not reading size
  lineHeight: 1.4,
  letterSpacing: 0.08, // em
  alpha: 0.32, //       dim enough that the hero still leads
  // How far down the page the field reaches, and where inside that it starts
  // fading out — so it holds through the hero and is gone by the first scroll.
  heightVh: 85,
  fadeFrom: 0.72, //    fraction of the height where the fade-out begins
  holes: 40, //         empty rects punched into the field
  holeMin: 4, //        hole width in cells — a scatter of small punches rather
  holeMax: 16, //       than a few big voids, which left the field in slabs
  holeJitter: 0.4, //   0 = every hole square, 1 = up to 2:1 either way
  seed: 7, //           reroll the layout
  // Word reveal. Each word fades in on its own clock with a shuffled delay, so
  // the field blooms as scattered fragments rather than typing left→right.
  wordFadeS: 0.85, //    per-word fade-in duration
  wordSpreadS: 2.4, //   window over which word delays are scattered
  fadeSpeedJitter: 0.35, // ± fraction on each word's duration
  /* Leaving, the field empties the same way it filled — word by word on
     shuffled delays — rather than dropping out as one sheet. It had been going
     with the hero on a single opacity, which made a wall built out of hundreds
     of separate murmurs vanish like a lid closing over them.
   *
     Quicker than the way in, and deliberately so. Arriving, the field is the
     thing being watched and can take its time; leaving, it is getting out of the
     way of a beat that has already started, and the same 2.4s spread would still
     be clearing while the notes were landing. Roughly half the entrance is
     enough to read as scattered without holding the page. */
  outFadeS: 0.45, //     per-word fade-out duration
  outSpreadS: 0.9, //    window over which the exits are scattered
  // Beat between the hero title starting to reveal and the field behind it
  // starting to write, so the two read as one gesture that begins at the title.
  startDelayS: 0.4,
};

/**
 * Opacity a word can take, as a fraction of the field's `alpha`, with the share
 * of words landing on each. Half stay at full strength so the wall still reads
 * as one field; the rest drop back in three steps, which is what gives it the
 * depth of a crowd talking at once. Shares must sum to 1.
 */
const WORD_ALPHA = [
  { level: 1, share: 0.5 },
  { level: 0.75, share: 0.2 },
  { level: 0.5, share: 0.18 },
  { level: 0.25, share: 0.12 },
];

const pickWordAlpha = (r) => {
  let acc = 0;
  for (const { level, share } of WORD_ALPHA) {
    acc += share;
    if (r < acc) return level;
  }
  return 1;
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
   at that size while caps hold an even grain.

   The text is the real corpus — the same transcriptions of the scanned notes
   that the archive itself shows. It's a texture, but it's a texture you can stop
   and read, so it has to be true. */
const toStream = (confessions) =>
  confessions
    .map((c) => c.transcription)
    .filter(Boolean)
    .join('   ')
    .toUpperCase()
    .replace(/\s+/g, ' ');

/* Only until the sheet answers (and if it never does). The bundled set is
   placeholder copy, so it's a stand-in for the grain, not for the content. */
const BUNDLED_STREAM = toStream(BUNDLED_CONFESSIONS);

/** Cells of clear field kept between neighbouring holes. */
const HOLE_GAP = 3;
const PLACE_TRIES = 40;

const overlaps = (a, b, gap) =>
  a.x < b.x + b.w + gap &&
  b.x < a.x + a.w + gap &&
  a.y < b.y + b.h + gap &&
  b.y < a.y + a.h + gap;

/**
 * Places `cfg.holes` random rects.
 *
 * Holes are sized in CELLS, but a cell is much taller than it is wide, so a
 * square hole needs roughly twice as many columns as rows — hence the aspect
 * correction. Without it every "square" comes out as a tall slot.
 *
 * Placement is rejection-sampled against everything already down. Allowed to
 * overlap they merge into one ragged void — the squares only read as squares
 * when there's field between them.
 */
function makeHoles({ cols, rows, cellW, cellH }, cfg) {
  const rand = rng(Math.round(cfg.seed));
  const aspect = cellH / cellW;
  const holes = [];

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
function buildRows({ cols, rows }, holes, stream) {
  const grid = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const line = new Array(cols);
    for (let c = 0; c < cols; c++) line[c] = stream[i++ % stream.length];
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

/**
 * Splits a row into runs of spaces and runs of glyphs, giving each glyph run its
 * own opacity level. A "word" here is whatever sits between two blanks, so the
 * corpus's own words plus the fragments the row edges and the holes cut out of
 * them — which is the right unit either way: it is what the eye groups.
 */
const toWords = (line, rand) =>
  (line.match(/ +|[^ ]+/g) ?? []).map((t) =>
    t[0] === ' ' ? { t, level: 1 } : { t, level: pickWordAlpha(rand()) }
  );

const PROBE = 'X'.repeat(50);

/* The field starts at the very top of the page, so it wants no fade there — but
   it has to stop somewhere, and without this it would end on a ruler-straight
   horizontal cut. Holds full strength through the hero, then fades the last rows
   out into the beat below. */
const EDGE_FADE = `linear-gradient(to bottom, #000 ${WALL.fadeFrom * 100}%, transparent)`;

/**
 * Full-bleed confession field behind the top of the page.
 *
 * Breaks out of the 660px reading column with a 100vw box, and sits at z-index
 * -1 so the beat's own copy paints over it — a positioned child at z 0 would
 * cover the in-flow text instead.
 *
 * `start` is the hero title beginning its own reveal: the field holds unwritten
 * until then. It can't key off scrolling into view the way a mid-page beat would
 * — it opens the page already in view, and the loader means "in view" and "the
 * hero has started" are seconds apart.
 *
 * `leaving` is the hero being left behind. The field empties on its own clock
 * rather than inside the hero's fade, which is why it is no longer a child of
 * it — see the HERO block in OnboardingBeats.
 */
export default function AsciiWall({ start = true, leaving = false }) {
  const hostRef = useRef(null);
  const probeRef = useRef(null);
  const reduce = useReducedMotion();

  const config = useDialKit('Confession Wall', {
    type: {
      fontSize: [WALL.fontSize, 5, 20, 0.5],
      // Top of the range is literal full-strength ink: the per-word levels are
      // fractions of this, so it sets how loud the whole field is.
      alpha: [WALL.alpha, 0.02, 1, 0.01],
    },
    holes: {
      count: [WALL.holes, 0, 120, 1],
      min: [WALL.holeMin, 2, 40, 1],
      max: [WALL.holeMax, 2, 80, 1],
      jitter: [WALL.holeJitter, 0, 1, 0.05],
      seed: [WALL.seed, 1, 200, 1],
    },
    reveal: {
      delay: [WALL.startDelayS, 0, 3, 0.05],
      fade: [WALL.wordFadeS, 0.1, 3, 0.05],
      spread: [WALL.wordSpreadS, 0, 6, 0.1],
      outFade: [WALL.outFadeS, 0.05, 2, 0.05],
      outSpread: [WALL.outSpreadS, 0, 4, 0.05],
    },
  });
  const { type: typeCfg, holes: holeCfg, reveal } = config;

  /* Whether the field has been left at least once, which decides how it comes
     BACK. On the way in the first time it has the page to itself and can bloom
     over the full spread; returning to the hero it is answering a swipe, and
     replaying that same slow scatter reads as the page rebuilding itself rather
     than as the hero coming back. So a return runs on the exit's quicker clock. */
  const [everLeft, setEverLeft] = useState(false);
  useEffect(() => {
    if (leaving) setEverLeft(true);
  }, [leaving]);

  // Pull the corpus on mount rather than when the beat comes into view: the
  // reader has the whole intro to scroll through first, so the sheet has landed
  // long before the field is needed. On the archive route this is the same
  // request `useConfessions` makes (see `loadConfessionsOnce`); on /onboarding,
  // where nothing else loads the corpus, it's the only one.
  const [sheetStream, setSheetStream] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadConfessionsOnce()
      .then((confessions) => {
        if (cancelled) return;
        setSheetStream(toStream(confessions) || null);
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.warn('[ascii wall] sheet load failed, using bundled text', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Swapping the text while words are fading in would reshuffle mid-reveal, so
  // the stream is only allowed to change up to the moment the reveal starts —
  // after that the field is whatever was in hand.
  const streamRef = useRef(BUNDLED_STREAM);
  if (!start) streamRef.current = sheetStream || BUNDLED_STREAM;
  const stream = streamRef.current;

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
    const rows = buildRows(
      box,
      makeHoles(box, {
        holes: holeCfg.count,
        holeMin: Math.min(holeCfg.min, holeCfg.max),
        holeMax: Math.max(holeCfg.min, holeCfg.max),
        holeJitter: holeCfg.jitter,
        seed: holeCfg.seed,
      }),
      stream
    );
    // One walk of the PRNG across the whole field, so the shares in WORD_ALPHA
    // hold over the wall rather than per row. Seeded off the layout so a resize
    // doesn't re-roll which words are bright.
    const rand = rng(Math.round(holeCfg.seed) * 31 + 7);
    return rows.map((line) => toWords(line, rand));
  }, [box, holeCfg, stream]);

  const type = {
    fontFamily: MONO,
    fontSize: typeCfg.fontSize,
    lineHeight: WALL.lineHeight,
    letterSpacing: `${WALL.letterSpacing}em`,
    whiteSpace: 'pre',
  };

  // Per-word fade delay + duration. Seeded off the layout seed so a resize
  // (which rebuilds the grid) doesn't re-roll the timing mid-reveal. Delays are
  // shuffled across the whole field — no left→right or centre-out bias.
  const wordTiming = useMemo(() => {
    const rand = rng(Math.round(holeCfg.seed) * 977 + 13);
    let first = Infinity;
    const rows = lines.map((row) =>
      row.map(({ t }) => {
        if (t[0] === ' ') return null;
        const offset = rand() * reveal.spread;
        const dur = Math.max(
          0.05,
          reveal.fade * (1 + (rand() * 2 - 1) * WALL.fadeSpeedJitter)
        );
        if (offset < first) first = offset;
        return { offset, dur };
      })
    );
    if (!Number.isFinite(first)) first = 0;
    // Slide the whole spread so the first word lands exactly on `delay`.
    return rows.map((row) =>
      row.map((t) => (t ? { delay: reveal.delay + t.offset - first, dur: t.dur } : null))
    );
  }, [lines, holeCfg.seed, reveal.delay, reveal.spread, reveal.fade]);

  /* The same idea on the way out, but rolled separately so the field does not
     empty in the order it filled. Reusing the entrance's delays would have the
     first words in be the first words out, which over a whole wall reads as a
     wave crossing it — and the wall's whole character is that it has no
     direction. A fresh shuffle keeps it scattered both ways. */
  const outTiming = useMemo(() => {
    const rand = rng(Math.round(holeCfg.seed) * 419 + 29);
    let first = Infinity;
    const rows = lines.map((row) =>
      row.map(({ t }) => {
        if (t[0] === ' ') return null;
        const offset = rand() * reveal.outSpread;
        const dur = Math.max(
          0.05,
          reveal.outFade * (1 + (rand() * 2 - 1) * WALL.fadeSpeedJitter)
        );
        if (offset < first) first = offset;
        return { offset, dur };
      })
    );
    if (!Number.isFinite(first)) first = 0;
    return rows.map((row) =>
      row.map((t) => (t ? { delay: t.offset - first, dur: t.dur } : null))
    );
  }, [lines, holeCfg.seed, reveal.outSpread, reveal.outFade]);

  // Spaces stay bare text; every glyph-run is a span so it can fade on its own
  // clock. Dimmed words keep their softer ink via colour (opacity animates
  // between 0 and 1 either way).
  const renderRow = (row, inTimings, outTimings) =>
    row.map(({ t, level }, i) => {
      if (t[0] === ' ') return t;
      // Returning rides the exit's clock rather than the entrance's — see
      // `everLeft`.
      const timing = leaving || everLeft ? outTimings?.[i] : inTimings?.[i];
      const style = {
        ...(level < 1 ? { color: inkA(typeCfg.alpha * level) } : null),
      };
      if (reduce) {
        // No animation to hide behind, and the field is no longer inside the
        // hero's own fade, so leaving has to actually take it off the screen.
        return (
          <span key={i} style={{ ...style, opacity: leaving ? 0 : 1 }}>
            {t}
          </span>
        );
      }
      if ((!start && !leaving) || !timing) {
        return (
          <span key={i} style={{ ...style, opacity: 0 }}>
            {t}
          </span>
        );
      }
      return (
        <span
          key={i}
          style={{
            ...style,
            animation: leaving
              ? `ascii-wall-word-out ${timing.dur}s ease-in ${timing.delay}s both`
              : `ascii-wall-word ${timing.dur}s ease-out ${timing.delay}s both`,
          }}
        >
          {t}
        </span>
      );
    });

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        height: `${WALL.heightVh}vh`,
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
      <style>
        {'@keyframes ascii-wall-word{from{opacity:0}to{opacity:1}}' +
          '@keyframes ascii-wall-word-out{from{opacity:1}to{opacity:0}}'}
      </style>
      <span ref={probeRef} style={{ ...type, position: 'absolute', visibility: 'hidden' }}>
        {PROBE}
      </span>
      {lines.map((line, i) => (
        <div key={i}>{renderRow(line, wordTiming[i], outTiming[i])}</div>
      ))}
    </div>
  );
}
