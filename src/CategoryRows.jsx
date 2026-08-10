import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import {
  TunableGrainBackground,
  CARD_FILTER_ID,
  CardNoiseFilterDefs,
  useInactiveCardParams,
} from './noise.jsx';
import { NOISE_GRADIENT } from './NoiseGradient';
import { LeftThemeDial, DIAL_STEP_DEG } from './NoteOpenView';
import {
  NoteMeta,
  ACTIVE_IMG_SCALE,
  CARD_HEIGHT_VH,
  CARD_HEIGHT_MAX,
  CARD_WIDTH_VW,
  CARD_WIDTH_MAX,
} from './SideDial';
import { useConfessions } from './useConfessions';
import { CONFESSIONS as FALLBACK_CONFESSIONS } from './confessions';
import { deriveEmotions, sortConfessionsByEmotions } from './themes';

/* ─────────────────────────────────────────────────────────────────────
 * CATEGORY ROWS — experiment (route: /rows)
 *
 * A fork of the EXPLORE view (NoteOpenView + HorizontalConfessionStack), which
 * browses ONE flat strip of every themed note. Here the archive is a GRID
 * instead: each category owns its own horizontal row, and the rows are stacked
 * vertically. Both axes loop endlessly.
 *
 *      ← … row  n-1 · REFUSAL      … →      (dimmed hard, peeking above)
 *      ← … row  n   · HARM         … →      (active — centred, scaled up,
 *                                            DATE/LOCATION above, transcript below)
 *      ← … row  n+1 · THERAPIST    … →      (dimmed hard, peeking below)
 *
 * The notes are EXPLORE's notes at EXPLORE's size — same height-driven box, same
 * DATE / LOCATION block (imported outright from SideDial, so the two can't
 * drift). Only the category the row belongs to is left unnamed here: the left
 * rotary dial already names every one of them.
 *
 *   ← / →   step notes inside the active row (that row only — every row keeps
 *           its own scroll position, so coming back to a category returns you
 *           to the note you left off on)
 *   ↑ / ↓   step rows, i.e. change category. The left rotary dial does the
 *           same thing: picking a category on it slides the rail up/down.
 *
 * HOW THE INFINITE LOOP WORKS
 * Both axes are driven by an UNBOUNDED integer ("virtual index"): `rowV` for
 * the rail, and one `colV` per row. They just keep counting up or down — they
 * are never wrapped. Content is looked up with `mod()`, and only a window of
 * indices around the current one is mounted, so past the last category the
 * first comes back around with no seam and no copy-boundary re-centring (which
 * is what HorizontalConfessionStack has to do with its 3 back-to-back copies).
 *
 * Layout follows from that: a card's position is `virtualIndex * pitch`, an
 * absolute px offset inside a track whose own transform is
 * `-currentIndex * pitch`. Mounting/unmounting at the window edges therefore
 * never disturbs the cards already on screen. Both pitches are a ratio of the
 * note's height, which is itself a fraction of the viewport — so the grid keeps
 * its proportions at any window size.
 *
 * THE ACTIVE ROW OPENS A LANE
 * Uniform row spacing leaves no room for the note's DATE / LOCATION block and
 * transcript, which belong hard against the image (as they do on the real
 * stack). So the rows above the active one shift further up and the rows below
 * shift further down by `laneExtra` — the active row pushes its neighbours
 * apart to make room, and closes again behind itself when you move on.
 *
 * Every metric is live-tunable in the "Category Rows" DialKit panel (`?dial=1`).
 * ───────────────────────────────────────────────────────────────────── */

const EASE_OUT = [0.165, 0.84, 0.44, 1];
const EASE_OUT_CSS = `cubic-bezier(${EASE_OUT.join(',')})`;
const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

/** True modulo — JS `%` keeps the sign of the dividend, which breaks the loop
 *  the moment a virtual index goes negative (scrolling up past the first row). */
const mod = (a, n) => ((a % n) + n) % n;

// How many rows / cards are mounted on each side of the active one. Kept tight
// on purpose, for two reasons. Every mounted card is a full-size webp carrying a
// CSS filter, so the window size is the single biggest lever on how heavy this
// page feels — and the rail is one transformed element, so the window also sets
// how large a layer the compositor has to rasterize. Notes are EXPLORE-sized
// here (a card is most of the viewport), so a couple either side already
// overshoots the visible span; going wider buys nothing and risks a layer too
// big to raster, which fails silently as rows that lay out but never paint.
// Rows past the immediate neighbour are dimmed to well under 1% — there is
// nothing to see there, so there is no reason to carry them.
// One either side. At EXPLORE's note size the second note out lands a clear
// viewport-width off the edge — it costs a full filtered, rotated layer and
// shows nothing. Each note now carries its row's tilt on its own layer rather
// than inheriting one rotation from the row, so the raster cost per note went
// up and the ones that can't be seen are the first thing to give up.
const ROW_WINDOW = 1;
const CARD_WINDOW = 1;

// Wheel accumulation: a trackpad fires a burst of small deltas, so we sum them
// and step once per threshold rather than per event. The accumulator resets if
// the gesture pauses, and a step locks out further steps for a beat so one
// flick doesn't fly through the archive.
const WHEEL_STEP = 90; //     px of accumulated delta per step
const WHEEL_COOLDOWN = 110; // ms after a step before another can fire
const WHEEL_IDLE_RESET = 220; // ms of stillness that clears the accumulator

/** Static twin of the shared `card-noise` filter, for the inactive rows. */
const ROW_GRAIN_ID = 'category-rows-grain';

/**
 * The archive's card grain, frozen.
 *
 * `CardNoiseFilterDefs` crawls its turbulence seed on a ~30fps clock so the
 * grain is alive — which means every element referencing it re-rasterizes its
 * whole filter chain each tick. That's fine for the handful of cards in the
 * flat stack and ruinous here, where dozens of cards are on screen at once.
 *
 * So the inactive rows reference this instead: the same feTurbulence →
 * feDisplacementMap pipeline at the same dialled-in settings, but on a fixed
 * seed. The browser rasterizes each card once and then only moves it around,
 * so the rows still wear the real treatment at a fraction of the cost. The
 * active row keeps the live, crawling filter.
 */
function StaticRowGrain({ params }) {
  const n = params?.noise ?? {};
  if ((n.enabled ?? true) === false) return null;
  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        <filter id={ROW_GRAIN_ID} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={n.baseFrequency ?? 0.9}
            numOctaves={Math.round(n.numOctaves ?? 2)}
            seed={Math.round(n.seed ?? 3)}
            stitchTiles="stitch"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={n.displacement ?? 0}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * Natural aspect ratio (w/h) of a note image, loaded once and cached by src.
 * The card is a fixed box with `object-fit: contain`, so the element's own
 * width tells us nothing about where the note's pixels actually end — the
 * metadata block and transcript are pinned to the PAINTED width, which only
 * the aspect ratio can give us.
 */
const aspectCache = new Map();

/**
 * EXPLORE's note box, in numbers.
 *
 * Over there the box is pure CSS — `height: min(46vh, 512px)` with the width
 * left to settle on the image's own aspect under a cap — and the browser is the
 * only thing that ever needs to know what that resolves to. Here the row layout
 * is built from the number: the pitch between rows and between cards, and where
 * the metadata sits relative to the note, are all derived from it. So we
 * evaluate the same expression ourselves off the shared constants.
 */
function useNoteBox(scale) {
  const read = useCallback(
    () => ({
      h: Math.min(window.innerHeight * (CARD_HEIGHT_VH / 100), CARD_HEIGHT_MAX) * scale,
      maxW: Math.min(window.innerWidth * (CARD_WIDTH_VW / 100), CARD_WIDTH_MAX) * scale,
    }),
    [scale]
  );
  const [box, setBox] = useState(read);
  useEffect(() => {
    const sync = () => setBox(read());
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [read]);
  return box;
}

function useNoteAspect(src) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!src || aspectCache.has(src)) return undefined;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled || !img.naturalHeight) return;
      aspectCache.set(src, img.naturalWidth / img.naturalHeight);
      bump((v) => v + 1);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return src ? aspectCache.get(src) ?? null : null;
}

/* ── The ripple ────────────────────────────────────────────────────── */

/**
 * Timing for a move, as a function of where a note sits relative to the centre
 * of the grid.
 *
 * Switching rows used to move everything on one spring: the rail carried every
 * row's vertical travel and each row's track carried every card's horizontal
 * travel, so the archive slid as two rigid planks. Now the travel lives on the
 * individual notes, and this hands each of them a start time — the centre note
 * goes first and the rest leave in rings spreading out from it, so a row
 * arrives as a wave running along its length rather than as a solid bar.
 *
 * Distance is measured in grid steps from the centre, which is wherever you're
 * heading — the note you clicked, or the one an arrow key just moved you onto.
 * Rows and cards are pitched close enough to each other that straight-line
 * distance across the two reads as a circle rather than a diamond.
 *
 * Only a change of row ripples. Switching rows sends every note the length of
 * the rail, and letting them leave in turn is what reads as the row bending.
 * Stepping left or right along a row moves every note the same short distance
 * in the same direction, and a stagger on that doesn't read as one movement at
 * all — just the row losing formation. So `staggered` is off for those and the
 * whole grid takes the same flat spring.
 */
function useRipple({ stepMs, staggered, reduceMotion }) {
  return useMemo(() => {
    const delay = (rowD, colD) =>
      staggered && !reduceMotion ? (Math.hypot(rowD, colD) * stepMs) / 1000 : 0;
    return {
      delay,
      // A fresh object per call, never a shared one. Motion treats a transition
      // as belonging to the animation it was handed to, and passing the same
      // instance to every row and card leaves them fighting over it — they stop
      // dead a frame in and never reach their targets.
      spring: (rowD, colD) => {
        if (reduceMotion) return { duration: 0 };
        const ring = Math.hypot(rowD, colD);
        return {
          type: 'spring',
          // The wave loses a little energy as it spreads: further cards take
          // marginally longer to settle, so the outside of the ring trails
          // instead of snapping into place in lockstep with the middle.
          visualDuration: 0.55 + (delay(rowD, colD) ? ring * 0.045 : 0),
          bounce: 0.14,
          delay: delay(rowD, colD),
        };
      },
    };
  }, [stepMs, staggered, reduceMotion]);
}

/* ── One horizontal category row ───────────────────────────────────── */

/**
 * One category's notes as an endlessly looping horizontal strip. `colV` is the
 * unbounded virtual index of the centred card (see the loop note above);
 * `rowDist` is how many rows this sits from the active one, which drives the
 * dimming/shrinking so the rail reads as depth rather than a flat list.
 */
function CategoryRow({
  notes,
  colV,
  rowDist,
  rowY,
  tiltDeg,
  isActiveRow,
  metrics,
  grainFilter,
  reduceMotion,
  ripple,
  onPick,
}) {
  const n = notes.length;
  if (n === 0) return null;

  const {
    cardPitch,
    cardMaxW,
    cardH,
    activeScale,
    inactiveScale,
    rowScaleFalloff,
    rowOpacityFalloff,
    cardOpacityFalloff,
  } = metrics;

  // Where a note `slot` steps from the row's centre ends up, once the row has
  // been tilted to its category's angle on the left dial AND carried to its
  // place on the rail. The tilt used to live on the row's own wrapper, which
  // rotated every note around the row's centre for free. Now that each note
  // moves independently it has to be worked out per note: swing the note's
  // slot around the row centre by the tilt, then add the row's travel. `y` is
  // the part that matters here — it's what each note now staggers.
  const rad = (tiltDeg * Math.PI) / 180;
  const seat = (slot) => {
    const reach = slot * cardPitch;
    return {
      x: reach * Math.cos(rad),
      y: reach * Math.sin(rad) + rowY,
      rotate: tiltDeg,
    };
  };

  const away = Math.abs(rowDist);
  const rowScale = Math.pow(rowScaleFalloff, away);
  const rowOpacity = away === 0 ? 1 : Math.pow(rowOpacityFalloff, away);

  const cards = [];
  for (let i = colV - CARD_WINDOW; i <= colV + CARD_WINDOW; i += 1) cards.push(i);

  return (
    // Only the row's dimming and shrinking live on the track. Its notes carry
    // their own travel, across and up the rail both (see below), which is what
    // lets them arrive one after another instead of moving as one rigid strip.
    <motion.div
      initial={false}
      animate={{ scale: rowScale, opacity: rowOpacity }}
      transition={ripple.spring(rowDist, 0)}
      style={st.rowTrack}
    >
      {cards.map((i) => {
        const note = notes[mod(i, n)];
        const colDist = i - colV;
        const isActiveCard = isActiveRow && colDist === 0;
        // Cards dim with distance from their row's centre on top of whatever
        // the row itself is already dimmed to, so the focus reads as a single
        // point (centre of the centre row) rather than a bright centre column.
        const cardOpacity =
          colDist === 0 ? 1 : Math.pow(cardOpacityFalloff, Math.abs(colDist));
        return (
          // A definite box — EXPLORE's height with its width cap — that the note
          // is centred inside. EXPLORE instead lets the box shrink to the note's
          // own width, which can't work here: that width isn't known until the
          // image loads, and a card that resizes after the fact both shifts its
          // neighbours and leaves a stale raster behind in the row's composited
          // layer (the note lays out in the right place and never paints). The
          // slack around a portrait note is transparent, so it looks the same;
          // it only means boxes may overlap where the painted notes don't.
          //
          // The box is pinned to the row's centre and offset by its slot with a
          // transform, so each card owns its travel and can be timed on its own.
          // Centring is margins rather than `translate(-50%, -50%)` because the
          // transform belongs to Motion now.
          <motion.div
            key={i}
            initial={false}
            animate={seat(colDist)}
            transition={ripple.spring(rowDist, colDist)}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: cardMaxW,
              height: cardH,
              marginLeft: -cardMaxW / 2,
              marginTop: -cardH / 2,
            }}
          >
            <button
              type="button"
              onClick={() => onPick(i)}
              // A note in a neighbouring row is only ever half on screen, and
              // the browser's reflex when focusing a partly-hidden control is
              // to scroll it into view. The stage is `overflow: hidden`, but
              // the rows are laid out well past its bottom edge, so it really
              // is scrollable — and that scroll drags the whole stage off its
              // centre-line for good, with nothing to scroll it back. Take the
              // focus ourselves and leave the scroll position alone.
              onMouseDown={(e) => {
                e.preventDefault();
                e.currentTarget.focus({ preventScroll: true });
              }}
              title={note.transcription}
              style={{
                ...st.card,
                opacity: cardOpacity,
                // Focused note enlarged, everything else shrunk — both ends of
                // EXPLORE's treatment, not just the enlargement.
                transform: `scale(${isActiveCard ? activeScale : inactiveScale})`,
                // The note's own scale-up and brightening ride the same wave as
                // its travel, so a card arrives and resolves as one gesture.
                transition: reduceMotion
                  ? 'none'
                  : `transform 0.42s ${EASE_OUT_CSS} ${ripple.delay(rowDist, colDist)}s,` +
                    ` opacity 0.42s ${EASE_OUT_CSS} ${ripple.delay(rowDist, colDist)}s`,
              }}
            >
              <img
                src={note.image}
                alt=""
                draggable={false}
                decoding="async"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                  // Only the one focused note is clean; everything else wears
                  // the archive's inactive treatment. The active row's grain
                  // is the live crawling one, the other rows' is the frozen
                  // twin (see StaticRowGrain) — same look, rasterized once.
                  filter: isActiveCard ? 'none' : grainFilter,
                }}
              />
            </button>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────── */

export default function CategoryRows() {
  const reduceMotion = useReducedMotion();
  const { confessions: liveConfessions, emotions: liveEmotions, loading, error } =
    useConfessions();

  const usingFallback = !loading && (error || liveConfessions.length === 0);
  const fallbackEmotions = useMemo(() => deriveEmotions(FALLBACK_CONFESSIONS), []);
  const fallbackConfessions = useMemo(
    () => sortConfessionsByEmotions(FALLBACK_CONFESSIONS, fallbackEmotions),
    [fallbackEmotions]
  );
  const confessions = usingFallback ? fallbackConfessions : liveConfessions;
  const emotionsAll = usingFallback ? fallbackEmotions : liveEmotions;

  // One row per category that actually has notes with images — an empty row
  // would be a dead stop in the vertical loop.
  const rows = useMemo(() => {
    const byLabel = new Map();
    confessions.forEach((c) => {
      if (!c.category || !c.image) return;
      if (!byLabel.has(c.category)) byLabel.set(c.category, []);
      byLabel.get(c.category).push(c);
    });
    return emotionsAll
      .map((emo) => ({ emotion: emo, notes: byLabel.get(emo.label) || [] }))
      .filter((r) => r.notes.length > 0);
  }, [confessions, emotionsAll]);

  const rowCount = rows.length;

  const inactive = useInactiveCardParams();
  const noiseEnabled = inactive.noise?.enabled ?? true;
  // The archive's inactive-card treatment, in two flavours: the active row's
  // neighbours get the live crawling grain, every other row the frozen twin.
  const cardTreatment = (grainId) =>
    [
      inactive.blur > 0 ? `blur(${inactive.blur}px)` : '',
      inactive.grayscale > 0 ? `grayscale(${inactive.grayscale})` : '',
      noiseEnabled && grainId ? `url(#${grainId})` : '',
    ]
      .filter(Boolean)
      .join(' ') || 'none';
  const liveGrainFilter = cardTreatment(CARD_FILTER_ID);
  const staticGrainFilter = cardTreatment(ROW_GRAIN_ID);

  const dial = useDialKit('Category Rows', {
    // Multiplier on EXPLORE's note box (min(46vh, 512px) tall). 1 = the same
    // size the note is over there; drop it if the rows start feeling cramped.
    noteScale: [1, 0.4, 1.4, 0.02],
    // Row and card spacing are RATIOS of the note's height rather than fixed px,
    // so the grid keeps its proportions when the note resizes with the viewport.
    rowGap: [1.2, 0.6, 2.6, 0.02], //  × note height, between row centre-lines
    cardGap: [1.15, 0.5, 2.6, 0.02], // × note height, between card centres
    activeScale: [ACTIVE_IMG_SCALE, 1, 2, 0.01], // focused note's scale-up
    // Extra gap the active row pushes its neighbours away by, so the metadata
    // and transcript have somewhere to sit against the image. Stays in px —
    // it's making room for fixed-size text, which doesn't scale with the note.
    laneExtra: [120, 0, 400, 4],
    // ms of delay per step out from the centre note. 0 moves the whole grid at
    // once; past ~70 the outer notes read as arriving late rather than trailing.
    rippleStep: [45, 0, 120, 1],
    // The rail is nudged right of centre so the left rotary dial's wordmarks
    // sit in empty space rather than on top of the row's left-hand notes.
    railOffsetX: [80, -200, 300, 5],
    // Degrees each row is tilted per step away from the active one, so the
    // rows sit on the same arc as the left dial's labels. Defaults to the
    // dial's own spacing; 0 lays every row flat again.
    rowTiltDeg: [DIAL_STEP_DEG, 0, 30, 0.5],
    rowScaleFalloff: [0.88, 0.4, 1, 0.01], //  per row away from centre
    rowOpacityFalloff: [0.085, 0.02, 1, 0.01], // ditto — the outer rows are ghosts
    // Per note away from its row's centre. EXPLORE holds its neighbours at 0.14
    // — faint enough that the centred note is unambiguously the subject and the
    // ones either side are only a hint of what's there. Same number here so a
    // row reads like that page's filmstrip.
    cardOpacityFalloff: [0.14, 0.05, 1, 0.01],
  });

  // Unbounded virtual index of the centred row. Never wrapped — `mod` maps it
  // onto `rows`, which is what makes the vertical loop seamless.
  const [rowV, setRowV] = useState(0);
  // Each row's own centred-card virtual index, keyed by category id, so
  // switching away and back returns to the note you left off on.
  const [colByRow, setColByRow] = useState({});
  // Whether the move in flight crossed rows, which is the only kind that
  // ripples (see useRipple). Clicking a note settles it either way, so the
  // current row has to be readable from a callback that never re-binds.
  const [rowMove, setRowMove] = useState(false);
  const rowVRef = useRef(rowV);
  rowVRef.current = rowV;

  const activeRow = rowCount > 0 ? rows[mod(rowV, rowCount)] : null;
  const activeRowId = activeRow?.emotion.id ?? null;
  const colOf = useCallback((id) => colByRow[id] ?? 0, [colByRow]);
  const activeNote = activeRow
    ? activeRow.notes[mod(colOf(activeRowId), activeRow.notes.length)]
    : null;

  const stepRow = useCallback((dir) => {
    setRowMove(true);
    setRowV((v) => v + dir);
  }, []);
  const stepCol = useCallback(
    (dir) => {
      if (!activeRowId) return;
      setRowMove(false);
      setColByRow((prev) => ({ ...prev, [activeRowId]: (prev[activeRowId] ?? 0) + dir }));
    },
    [activeRowId]
  );

  // Dial click → slide the rail to that category the SHORT way around the loop
  // (rather than counting up from 0), so picking the row above never spins the
  // whole rail through every category in between.
  const goToCategory = useCallback(
    (emotionId) => {
      if (rowCount === 0) return;
      const target = rows.findIndex((r) => r.emotion.id === emotionId);
      if (target < 0) return;
      setRowMove(true);
      setRowV((v) => {
        let k = mod(target - mod(v, rowCount), rowCount);
        if (k > rowCount / 2) k -= rowCount;
        return v + k;
      });
    },
    [rows, rowCount]
  );

  // ── Keyboard ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepCol(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepCol(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); stepRow(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); stepRow(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepRow, stepCol]);

  // ── Wheel / trackpad ────────────────────────────────────────
  // Whichever axis crosses the threshold first wins the gesture; both
  // accumulators reset on a step so a diagonal swipe can't fire twice.
  const wheelRef = useRef({ x: 0, y: 0, at: 0, lockUntil: 0 });
  useEffect(() => {
    const el = document.documentElement;
    const onWheel = (e) => {
      e.preventDefault();
      const w = wheelRef.current;
      const now = performance.now();
      if (now - w.at > WHEEL_IDLE_RESET) { w.x = 0; w.y = 0; }
      w.at = now;
      if (now < w.lockUntil) return;
      w.x += e.deltaX;
      w.y += e.deltaY;
      if (Math.abs(w.y) >= WHEEL_STEP && Math.abs(w.y) >= Math.abs(w.x)) {
        stepRow(Math.sign(w.y));
      } else if (Math.abs(w.x) >= WHEEL_STEP) {
        stepCol(Math.sign(w.x));
      } else {
        return;
      }
      w.x = 0;
      w.y = 0;
      w.lockUntil = now + WHEEL_COOLDOWN;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stepRow, stepCol]);

  // Clicking a card centres it: the row it belongs to becomes active and that
  // card slides to the middle.
  const pickCard = useCallback((rowVirtual, cardVirtual, emotionId) => {
    // Clicking a note in another row is a row move and rings out from it;
    // clicking one further along the row you're on is just a step sideways.
    setRowMove(rowVirtual !== rowVRef.current);
    setRowV(rowVirtual);
    setColByRow((prev) => ({ ...prev, [emotionId]: cardVirtual }));
  }, []);

  const ripple = useRipple({ stepMs: dial.rippleStep, staggered: rowMove, reduceMotion });

  const rowIdxs = [];
  for (let r = rowV - ROW_WINDOW; r <= rowV + ROW_WINDOW; r += 1) rowIdxs.push(r);

  const noteBox = useNoteBox(dial.noteScale);
  const rowPitch = noteBox.h * dial.rowGap;
  const cardPitch = noteBox.h * dial.cardGap;

  const metrics = {
    cardPitch,
    cardMaxW: noteBox.maxW,
    cardH: noteBox.h,
    activeScale: dial.activeScale,
    // EXPLORE shrinks every note that isn't the focused one, on the same dial
    // as the blur and grain it wears. Taken from there rather than restated, so
    // tuning the archive's inactive treatment moves both pages together.
    inactiveScale: inactive.scale,
    rowScaleFalloff: dial.rowScaleFalloff,
    rowOpacityFalloff: dial.rowOpacityFalloff,
    cardOpacityFalloff: dial.cardOpacityFalloff,
  };

  // Where the metadata block sits above the image and the transcript below it,
  // and how wide both should be. The note box is height-driven, so its height is
  // known outright and its width follows the note's own aspect ratio (up to the
  // cap) — which is what the divider has to match to sit flush with the edges.
  const activeAspect = useNoteAspect(activeNote?.image);
  const activeHalfH = (noteBox.h * dial.activeScale) / 2;
  const paintedW = activeAspect
    ? Math.min(noteBox.maxW, noteBox.h * activeAspect)
    : noteBox.maxW;
  const activeW = paintedW * dial.activeScale;

  return (
    // Nothing on this page is meant to scroll — the rows are placed by
    // transform, not by scroll position. Anything that manages to scroll the
    // stage anyway (a stray focus, a trackpad gesture over a child) is put
    // back, so the centre-line stays where the layout assumes it is.
    <div
      style={st.root}
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
    >
      <div aria-hidden="true" style={st.backdrop}>
        <TunableGrainBackground />
      </div>
      <CardNoiseFilterDefs params={inactive} />
      <StaticRowGrain params={inactive} />

      {/* The rail: every row absolutely placed at `virtualIndex * rowPitch`.
          It only holds the horizontal nudge — the travel that brings the active
          row onto the viewport's centre-line is applied by each row to itself,
          so the rows can leave at different times rather than as one plank. */}
      <motion.div
        animate={{ x: dial.railOffsetX }}
        transition={ripple.spring(0, 0)}
        style={st.rail}
      >
        {rowIdxs.map((r) => {
          if (rowCount === 0) return null;
          const row = rows[mod(r, rowCount)];
          const dist = r - rowV;
          const colV = colOf(row.emotion.id);
          const isActive = dist === 0;
          // How far this row sits from the centre-line, plus the lane —
          // neighbours sliding clear so the active row's metadata and
          // transcript have somewhere to sit, closing back up as it moves on.
          // The band itself no longer moves; each note applies this for itself,
          // on its own clock, which is what lets the row bend as it travels
          // instead of sliding as one rigid plank.
          //
          // Measured from the CENTRE, not from the rail's origin. Rows used to
          // be laid out at `virtualIndex * rowPitch` and hauled back onto the
          // centre-line by an equal and opposite transform, which was fine
          // while one wrapper per row carried that transform. Now that every
          // note carries it, all fifteen of them would be dragged thousands of
          // pixels from where they're laid out — and it climbs the further you
          // travel, since the virtual index never wraps. Past a certain offset
          // the compositor stops rasterizing them and the notes go invisible.
          // Distances from the centre are bounded by the row window instead.
          const rowY = dist * rowPitch + Math.sign(dist) * dial.laneExtra;
          return (
            <div key={r} style={{ ...st.rowBand, top: 0 }}>
              <CategoryRow
                notes={row.notes}
                colV={colV}
                rowDist={dist}
                rowY={rowY}
                tiltDeg={dist * dial.rowTiltDeg}
                isActiveRow={isActive}
                metrics={metrics}
                grainFilter={isActive ? liveGrainFilter : staticGrainFilter}
                reduceMotion={reduceMotion}
                ripple={ripple}
                onPick={(cardVirtual) => pickCard(r, cardVirtual, row.emotion.id)}
              />

              {isActive && activeNote ? (
                // The metadata and transcript ride the row's travel too, with
                // no stagger — they belong to the centre note, which is the one
                // note that never waits.
                <motion.div
                  initial={false}
                  animate={{ y: rowY }}
                  transition={ripple.spring(dist, 0)}
                  style={st.rowBand}
                >
                  {/* DATE / LOCATION hugging the top edge of the image — the
                      EXPLORE tab's own block (persistent label scaffold and
                      divider, values typing in per character as the note
                      changes), pinned to the same 80% of the note's width it
                      uses there. `metaAbove` is offset by the block's built-in
                      24px bottom margin so the divider lands the same distance
                      off the image on both pages. */}
                  <div style={{ ...st.metaAbove, bottom: activeHalfH - 24 }}>
                    <NoteMeta
                      confession={activeNote}
                      columnWidth={Math.round(activeW * 0.8)}
                      reduceMotion={reduceMotion}
                      crossfadeBlock
                    />
                  </div>
                  {/* …and the transcript hugging the bottom edge. */}
                  <div style={{ ...st.transcriptBelow, top: activeHalfH + 20 }}>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.p
                        key={activeNote.id}
                        initial={reduceMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.28, ease: EASE_OUT }}
                        style={{ ...st.transcript, width: Math.round(activeW * 1.3) }}
                      >
                        {activeNote.transcription}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </motion.div>
              ) : null}
            </div>
          );
        })}
      </motion.div>

      {/* Left/right edges fade to black so notes dissolve out of the row rather
          than being cut off by the viewport. */}
      <div aria-hidden="true" style={st.edgeVignette} />

      {rowCount > 0 ? (
        <LeftThemeDial
          emotions={rows.map((r) => r.emotion)}
          activeId={activeRowId}
          onChange={goToCategory}
          reduceMotion={reduceMotion}
          delay={0}
        />
      ) : null}

      <div style={st.hud}>
        <span style={st.hudLabel}>ROWS EXPERIMENT</span>
        <span style={st.hudHint}>↑ ↓ CATEGORY · ← → NOTES</span>
        <a href="/" style={st.hudLink}>EXIT</a>
      </div>

      {loading && rowCount === 0 ? <div style={st.loading}>LOADING ARCHIVE…</div> : null}
    </div>
  );
}

const st = {
  root: {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    background: '#010000',
  },
  backdrop: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
    background: '#010000',
    backgroundImage: NOISE_GRADIENT,
  },
  // Anchored on the viewport's vertical centre-line; rows hang off it at
  // `virtualIndex * rowPitch` and the whole rail slides to bring one to 0.
  // No `willChange: transform` on the rail or the row tracks. Motion applies it
  // for the duration of an animation and drops it again once the spring settles,
  // which is what we want: pinning it on holds a permanent composited layer as
  // tall/wide as every mounted row, and at this note size that layer is big
  // enough for the compositor to give up on rasterizing it.
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    zIndex: 1,
  },
  rowBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
  },
  // Zero-size anchor at the row's centre; cards hang off it by virtual index.
  rowTrack: {
    position: 'absolute',
    left: '50%',
    top: 0,
    height: 0,
    width: 0,
  },
  card: {
    width: '100%',
    height: '100%',
    padding: 0,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    display: 'block',
  },

  // Metadata furniture, pinned to the active image's top / bottom edges. The
  // block itself is EXPLORE's NoteMeta, so only its placement lives here.
  metaAbove: {
    position: 'absolute',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  transcriptBelow: {
    position: 'absolute',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  transcript: {
    margin: 0,
    textAlign: 'center',
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 1.6,
    letterSpacing: '0.04em',
    color: 'rgba(207,202,183,0.8)',
  },

  edgeVignette: {
    position: 'absolute',
    inset: 0,
    zIndex: 5,
    pointerEvents: 'none',
    background:
      'linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 7%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 78%, rgba(0,0,0,0.6) 93%, rgba(0,0,0,0.92) 100%)',
  },
  hud: {
    position: 'absolute',
    top: 22,
    right: 26,
    zIndex: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: '0.18em',
  },
  hudLabel: { color: 'rgba(207,202,183,0.75)' },
  hudHint: { color: 'rgba(207,202,183,0.35)' },
  hudLink: { color: 'rgba(207,202,183,0.75)', textDecoration: 'none' },
  loading: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: '0.2em',
    color: 'rgba(207,202,183,0.4)',
  },
};
