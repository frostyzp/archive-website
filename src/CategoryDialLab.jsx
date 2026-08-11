import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { INK, inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * ANIMATION STORYBOARD  —  CATEGORY RAIL → EXPLORE DIAL
 *
 * The index's left filter rail hands its category list to the EXPLORE
 * page's arc dial. Same words, two different pieces of furniture: the
 * transition is the argument that they were always the same list.
 *
 * ACT 1 — the rail            [ click CATEGORY ]
 *      0ms   rail at rest, CATEGORY accordion closed, caret pointing right
 *      0ms   caret turns down, group unfolds to its open height
 *    120ms   rows fade up 6px, staggered 45ms apart, top to bottom
 *
 * ACT 2 — into the dial       [ click EXPLORE ]
 *      0ms   checkboxes fade out (they mean nothing on a dial)
 *    120ms   the rest of the rail goes with them — search, headers, LOCATION
 *    140ms   words lift off the rail and fly to the arc, growing 12 → 22px,
 *            tracking opening 0.10 → 0.16em, each rotating onto its own spoke,
 *            staggered 40ms outward from whichever category was checked
 *            (unchecked → the first one takes the centre)
 *    600ms   brackets [ ] fade in around every word
 *    720ms   dashed spokes draw from each word inward to the pivot
 *    840ms   counter "01 / 07" fades in above the active word
 *
 * Words past the second slot keep flying — out past the left edge and off
 * the bottom — and fade to nothing as they go, so the arc continues to
 * exist where you can't see it rather than the list ending at the frame.
 * ───────────────────────────────────────────────────────────────────── */

const TIMING = {
  rowsIn: 120, //         accordion rows begin their staggered entrance
  checkboxesOut: 0, //    checkboxes start fading the instant EXPLORE is hit
  railOut: 120, //        the rest of the rail follows them out
  wordsFly: 140, //       words leave the rail for the arc
  bracketsIn: 600, //     [ ] fade in around each word
  spokesIn: 720, //       dashed radius lines draw toward the pivot
  counterIn: 840, //      "01 / 07" appears above the active word
};

/* Stages. One integer drives the whole sequence.
   0 rail at rest · 1 accordion open · 2 flying · 3 bracketed · 4 spokes+counter */
const STAGE = { closed: 0, open: 1, flying: 2, bracketed: 3, settled: 4 };

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const EASE_OUT = [0.165, 0.84, 0.44, 1];

/* The index's left filter rail. Values lifted from GridView's `.filter-sidebar`
   in App.jsx so the starting picture is the real one. */
const RAIL = {
  left: 32, //          px — inset from the viewport's left edge
  top: 112, //          px — starts below the wordmark chrome
  width: 200, //        px — rail width
  gap: 18, //           px — between search / CATEGORY / LOCATION
  searchFont: 13, //    px
  headerFont: 13, //    px — "CATEGORY" / "LOCATION"
  headerTrack: '0.12em',
  rowFont: 12, //       px — a category row's label
  rowTrack: '0.1em', // em — rail tracking, opens up on the dial
  rowPadY: 7, //        px — vertical padding per row
  rowGap: 1, //         px — between rows
  boxSize: 13, //       px — the checkbox square
  boxGap: 12, //        px — square → label
  fadeS: 0.28, //       s  — rail furniture fading out under the flight
};

/* Rows unfolding out of the accordion. */
const ROWS = {
  stagger: 0.045, //  s  — between rows, top to bottom
  offsetY: 6, //      px — each row rises this far into place
  unfoldS: 0.34, //   s  — group height 0 → auto
  spring: { type: 'spring', visualDuration: 0.32, bounce: 0 },
};

/* The EXPLORE dial — `LeftThemeDial` / `WHEEL` in NoteOpenView.jsx.
   The pivot sits at baseX − radius = −492px: off-screen left, so only the
   right cheek of a very large wheel is ever visible. */
const DIAL = {
  baseX: 128, //       px — active word's centre, from the viewport's left edge
  radius: 620, //      px — arc radius; the pivot is this far to the left of baseX
  stepDeg: 17, //      deg between adjacent categories along the arc
  visible: 2, //       neighbours kept lit on each side
  labelFont: 22, //    px — wordmark size on the dial
  track: '0.16em', //  em — dial tracking
  opacity: [1, 0.4, 0.18], // by distance from active: [active, ±1, ±2], then 0
  color: '#e2e2e2', // the dial's labels are lighter than rail INK
};

/* The word's flight from rail to arc. */
const FLIGHT = {
  stagger: 0.04, //  s — outward from the active word
  spring: { type: 'spring', visualDuration: 0.72, bounce: 0.16 },
};

/* Dashed radius line, word → pivot. */
const SPOKES = {
  gap: 16, //     px — clearance between the word's edge and the line
  min: 14, //     px — never shorter than this
  fadeS: 0.4, //  s
  color: 'rgba(207, 202, 183, 0.35)',
};

/* Categories in their canonical THEME_META order (themes.js). */
const CANONICAL = [
  { id: 'therapist', label: 'Therapist' },
  { id: 'harm', label: 'Harm' },
  { id: 'refusal', label: 'Refusal' },
  { id: 'in-love', label: 'In Love (w/AI)' },
  { id: 'exes', label: 'Exes' },
  { id: 'family', label: 'Family' },
  { id: 'ghostwriter', label: 'Ghostwriter' },
];

/** The row the dial opens on, and therefore the rail's middle row. */
const DEFAULT_CATEGORY_ID = 'therapist';
const MIDDLE = Math.floor(CANONICAL.length / 2);

/**
 * The rail, rotated so `defaultId` sits in the MIDDLE row.
 *
 * With the default centred, rail order and arc order line up one-to-one: the
 * top row flies to the top of the arc, the middle stays put, the bottom row
 * flies to the bottom. Nothing crosses anything else. Left in canonical order
 * the centre would be the FIRST row, so the back half of the list has to wrap
 * up and over the top — four words swimming through each other.
 *
 * A rotation is the right move rather than a re-sort: the wheel is cyclic, so
 * rotating the list is just turning the wheel, and every category keeps the
 * same neighbours it has on the real dial.
 */
function orderForDefault(defaultId) {
  const n = CANONICAL.length;
  const d = Math.max(0, CANONICAL.findIndex((c) => c.id === defaultId));
  return Array.from({ length: n }, (_, i) => CANONICAL[(i + d - MIDDLE + n) % n]);
}

const LOCATIONS = ['San Francisco', 'New York', 'Los Angeles', 'Austin'];

/** Where slot `k` sits on the arc, `k` being signed steps from the active word.
 *  Ported from `wheelSlot` in NoteOpenView.jsx. */
function wheelSlot(k, dial) {
  const rad = (k * dial.stepDeg * Math.PI) / 180;
  const ak = Math.abs(k);
  return {
    x: dial.radius * (Math.cos(rad) - 1),
    y: dial.radius * Math.sin(rad),
    rotate: k * dial.stepDeg,
    opacity: ak <= DIAL.visible ? DIAL.opacity[ak] ?? 0 : 0,
  };
}

/** Shortest signed distance from active index `idx` to item `i`, so the wheel
 *  wraps instead of running out. Ported from `wheelOffset`. */
function wheelOffset(i, idx, n) {
  let k = (((i - idx) % n) + n) % n;
  if (k > n / 2) k -= n;
  return k;
}

/**
 * One word in flight. Mounted only once EXPLORE is hit, with `from` already
 * measured off the rail — so `initial` is honest at mount and the copy lands
 * exactly on top of the rail label it replaces. The wrapper reproduces the
 * dial's own DOM shape (anchor at `baseX / 50%`, inner translated -50%/-50%)
 * so it inherits the real dial's rotation geometry rather than an approximation.
 */
function FlyingWord({
  label,
  from,
  slot,
  delayS,
  stage,
  dial,
  flight,
  railColor,
  reduceMotion,
  onMeasure,
}) {
  const wordRef = useRef(null);

  useEffect(() => {
    // offsetWidth, not the client rect: the rect is post-transform, so while the
    // word is still shrunk to rail size it would hand the spokes a short radius.
    if (wordRef.current) onMeasure(wordRef.current.offsetWidth);
  }, [onMeasure, dial.labelFont, stage]);

  const scaleFrom = RAIL.rowFont / dial.labelFont;
  const bracketed = stage >= STAGE.bracketed;
  const spring = reduceMotion ? { duration: 0 } : { ...flight.spring, delay: delayS };

  return (
    <motion.div
      initial={{
        x: from.cx - dial.baseX,
        y: from.cy - window.innerHeight / 2,
        rotate: 0,
        opacity: 1,
      }}
      animate={{
        x: slot.x,
        y: slot.y,
        rotate: slot.rotate,
        opacity: slot.opacity,
      }}
      transition={spring}
      style={{
        position: 'absolute',
        left: dial.baseX,
        top: '50%',
        willChange: 'transform, opacity',
      }}
    >
      {/* Scale belongs HERE, not on the anchor above. CSS scales about an
          element's own centre, so scaling the anchor drags the word sideways by
          half its width — the copy would mount ~25px off the rail label it is
          supposed to be replacing and slide into place as it grew. Down here the
          -50%/-50% centring absorbs it and the centre never moves. Rotation
          stays on the anchor, matching the real dial's geometry. */}
      <motion.span
        ref={wordRef}
        initial={{
          x: '-50%',
          y: '-50%',
          scale: scaleFrom,
          letterSpacing: RAIL.rowTrack,
          color: railColor,
        }}
        animate={{
          x: '-50%',
          y: '-50%',
          scale: 1,
          letterSpacing: DIAL.track,
          color: DIAL.color,
        }}
        transition={spring}
        style={{
          display: 'inline-block',
          fontFamily: MONO,
          fontSize: dial.labelFont,
          lineHeight: 1,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          position: 'relative',
        }}
      >
        {/* Brackets are positioned out of flow so they can arrive late without
            changing the word's width mid-flight (production bakes them into the
            string via formatCategoryLabel). */}
        <motion.span
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: bracketed ? 1 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: EASE_OUT }}
          style={{ position: 'absolute', right: '100%', paddingRight: '0.5em' }}
        >
          [
        </motion.span>
        {label}
        <motion.span
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: bracketed ? 1 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: EASE_OUT }}
          style={{ position: 'absolute', left: '100%', paddingLeft: '0.3em' }}
        >
          ]
        </motion.span>
      </motion.span>
    </motion.div>
  );
}

export default function CategoryDialLab() {
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState(STAGE.closed);
  const [checked, setChecked] = useState(() => new Set());
  const [locOpen, setLocOpen] = useState(false);
  // Rail-space rect of each category label, captured the instant EXPLORE is hit.
  const [origins, setOrigins] = useState(null);
  const [wordWidths, setWordWidths] = useState({});
  const labelRefs = useRef({});
  // Bumped once per EXPLORE. The timed part of ACT 2 keys off THIS rather than
  // off `stage` — an effect watching `stage` tears its own pending timers down
  // the moment the first one fires, and the sequence dies half-finished.
  const [run, setRun] = useState(0);

  const dials = useDialKit(
    'Category → Dial',
    {
      dial: {
        baseX: [DIAL.baseX, 0, 400, 1],
        radius: [DIAL.radius, 200, 1600, 10],
        stepDeg: [DIAL.stepDeg, 4, 40, 0.5],
        labelFont: [DIAL.labelFont, 10, 44, 1],
      },
      flight: {
        spring: FLIGHT.spring,
        staggerMs: [FLIGHT.stagger * 1000, 0, 200, 5],
      },
      timing: {
        checkboxesOutMs: [TIMING.checkboxesOut, 0, 800, 20],
        wordsFlyMs: [TIMING.wordsFly, 0, 1200, 20],
        bracketsInMs: [TIMING.bracketsIn, 0, 2000, 20],
        spokesInMs: [TIMING.spokesIn, 0, 2500, 20],
      },
      defaultCategory: {
        type: 'select',
        options: CANONICAL.map((c) => ({ value: c.id, label: c.label })),
        default: DEFAULT_CATEGORY_ID,
      },
      showSpokes: true,
      openAccordion: { type: 'action', label: 'Open accordion' },
      explore: { type: 'action', label: 'Explore →' },
      reset: { type: 'action', label: '⟳ Reset' },
    },
    {
      onAction: (action) => {
        if (action === 'openAccordion') setStage(STAGE.open);
        if (action === 'explore') runExplore();
        if (action === 'reset') reset();
      },
    }
  );

  const dial = {
    baseX: dials.dial.baseX,
    radius: dials.dial.radius,
    stepDeg: dials.dial.stepDeg,
    labelFont: dials.dial.labelFont,
  };

  const categories = useMemo(() => orderForDefault(dials.defaultCategory), [dials.defaultCategory]);

  const reset = useCallback(() => {
    setStage(STAGE.closed);
    setOrigins(null);
  }, []);

  // ACT 2. Measure first, in the click itself, so the flying copies can mount
  // already sitting on the rail labels they take over from.
  const runExplore = useCallback(() => {
    const rects = {};
    categories.forEach((c) => {
      const el = labelRefs.current[c.id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      rects[c.id] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    if (Object.keys(rects).length !== categories.length) return;
    setOrigins(rects);
    setStage(STAGE.flying);
    setRun((r) => r + 1);
  }, [categories]);

  // The timed part of ACT 2.
  useEffect(() => {
    if (!run) return undefined;
    const timers = [
      setTimeout(() => setStage(STAGE.bracketed), dials.timing.bracketsInMs),
      setTimeout(() => setStage(STAGE.settled), dials.timing.spokesInMs),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') reset();
      if (e.key === 'Enter' && stage === STAGE.open) runExplore();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reset, runExplore, stage]);

  const toggleCat = (id) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Whichever category is checked takes the dial's centre — the rail's
  // selection decides where the wheel lands, which is the whole point of
  // carrying the list across rather than dissolving one into the other.
  // Nothing checked falls back to the MIDDLE row, which is the default: that
  // case fans out without a single word crossing another.
  const checkedIdx = categories.findIndex((c) => checked.has(c.id));
  const activeIdx = checkedIdx >= 0 ? checkedIdx : MIDDLE;

  const flying = stage >= STAGE.flying;
  const railOpacity = flying ? 0 : 1;
  const n = categories.length;

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* ── The rail ─────────────────────────────────────────────── */}
      <motion.aside
        animate={{ opacity: railOpacity }}
        transition={{
          duration: reduceMotion ? 0 : RAIL.fadeS,
          ease: EASE_OUT,
          delay: flying ? TIMING.railOut / 1000 : 0,
        }}
        style={{
          position: 'absolute',
          top: RAIL.top,
          left: RAIL.left,
          width: RAIL.width,
          display: 'flex',
          flexDirection: 'column',
          gap: RAIL.gap,
          zIndex: 2,
          pointerEvents: flying ? 'none' : 'auto',
        }}
      >
        <input
          type="search"
          placeholder="Search confessions..."
          aria-label="Search note transcripts"
          style={{
            width: '100%',
            background: 'transparent',
            border: `1px dashed ${inkA(0.3)}`,
            borderRadius: 0,
            padding: '9px 16px',
            color: INK,
            fontFamily: MONO,
            fontSize: RAIL.searchFont,
            letterSpacing: '0.04em',
            outline: 'none',
          }}
        />

        {/* CATEGORY accordion */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <button
            type="button"
            aria-expanded={stage >= STAGE.open}
            onClick={() => setStage(stage >= STAGE.open ? STAGE.closed : STAGE.open)}
            style={accordionHeader}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Category
              {checked.size > 0 ? (
                <span style={{ fontSize: 10, color: inkA(0.5) }}>({checked.size})</span>
              ) : null}
            </span>
            <span
              aria-hidden="true"
              style={{
                fontSize: 12,
                lineHeight: 1,
                opacity: 0.85,
                transform: stage >= STAGE.open ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.18s ease',
              }}
            >
              {'>'}
            </span>
          </button>

          <motion.div
            initial={false}
            animate={{ height: stage >= STAGE.open ? 'auto' : 0 }}
            transition={{ duration: reduceMotion ? 0 : ROWS.unfoldS, ease: EASE_OUT }}
            style={{ overflow: 'hidden' }}
          >
            <div
              role="group"
              aria-label="Category"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: RAIL.rowGap,
                marginTop: 6,
              }}
            >
              {categories.map((c, i) => {
                const on = checked.has(c.id);
                return (
                  <motion.button
                    key={c.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => toggleCat(c.id)}
                    initial={{ opacity: 0, y: ROWS.offsetY }}
                    animate={{
                      opacity: stage >= STAGE.open ? 1 : 0,
                      y: stage >= STAGE.open ? 0 : ROWS.offsetY,
                    }}
                    transition={{
                      ...ROWS.spring,
                      delay:
                        stage >= STAGE.open && !reduceMotion
                          ? TIMING.rowsIn / 1000 + i * ROWS.stagger
                          : 0,
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: RAIL.boxGap,
                      width: '100%',
                      padding: `${RAIL.rowPadY}px 2px`,
                      background: 'none',
                      border: 'none',
                      color: on ? INK : inkA(0.7),
                      fontFamily: MONO,
                      fontSize: RAIL.rowFont,
                      letterSpacing: RAIL.rowTrack,
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {/* The checkbox goes first and alone — a dial has no notion
                        of "checked", so the square has to be gone before the
                        word arrives on the arc. */}
                    <motion.span
                      aria-hidden="true"
                      animate={{ opacity: flying ? 0 : 1 }}
                      transition={{
                        duration: reduceMotion ? 0 : 0.16,
                        ease: EASE_OUT,
                        delay: flying ? dials.timing.checkboxesOutMs / 1000 : 0,
                      }}
                      style={{
                        width: RAIL.boxSize,
                        height: RAIL.boxSize,
                        flex: '0 0 auto',
                        borderRadius: 2,
                        border: `1px solid ${on ? inkA(0.9) : inkA(0.4)}`,
                        background: on ? INK : 'transparent',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        // Handed over to the flying copy, which mounts exactly
                        // on top of this — hidden, not removed, so nothing shifts.
                        visibility: flying ? 'hidden' : 'visible',
                      }}
                    >
                      {/* The measured element has to shrink to the TEXT. The
                          row's label cell is `flex: 1`, so its box runs the full
                          width of the rail and its centre sits ~50px right of
                          the words — the copy would jump on the handoff frame. */}
                      <span
                        ref={(el) => {
                          labelRefs.current[c.id] = el;
                        }}
                        style={{ display: 'inline-block' }}
                      >
                        {c.label}
                      </span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </div>

        {/* LOCATION accordion — present so the rail reads as the real one */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <button
            type="button"
            aria-expanded={locOpen}
            onClick={() => setLocOpen((v) => !v)}
            style={accordionHeader}
          >
            <span>Location</span>
            <span
              aria-hidden="true"
              style={{
                fontSize: 12,
                lineHeight: 1,
                opacity: 0.85,
                transform: locOpen ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.18s ease',
              }}
            >
              {'>'}
            </span>
          </button>
          <motion.div
            initial={false}
            animate={{ height: locOpen ? 'auto' : 0 }}
            transition={{ duration: reduceMotion ? 0 : ROWS.unfoldS, ease: EASE_OUT }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: RAIL.rowGap, marginTop: 6 }}>
              {LOCATIONS.map((loc) => (
                <span
                  key={loc}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: RAIL.boxGap,
                    padding: `${RAIL.rowPadY}px 2px`,
                    color: inkA(0.7),
                    fontFamily: MONO,
                    fontSize: RAIL.rowFont,
                    letterSpacing: RAIL.rowTrack,
                    textTransform: 'uppercase',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: RAIL.boxSize,
                      height: RAIL.boxSize,
                      borderRadius: 2,
                      border: `1px solid ${inkA(0.4)}`,
                    }}
                  />
                  {loc}
                </span>
              ))}
            </div>
          </motion.div>
        </div>

        <button
          type="button"
          onClick={runExplore}
          disabled={stage < STAGE.open}
          style={{
            marginTop: 4,
            padding: '9px 14px',
            background: 'none',
            border: `1px dashed ${inkA(stage < STAGE.open ? 0.18 : 0.45)}`,
            color: inkA(stage < STAGE.open ? 0.3 : 0.9),
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            cursor: stage < STAGE.open ? 'default' : 'pointer',
          }}
        >
          Explore →
        </button>
      </motion.aside>

      {/* ── The arc ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {flying && origins ? (
          <div
            key="wheel"
            style={{ position: 'fixed', inset: 0, zIndex: 3, pointerEvents: 'none' }}
          >
            {/* Spokes ride the same slots as their words, one true radius each. */}
            {dials.showSpokes
              ? categories.map((c, i) => {
                  const k = wheelOffset(i, activeIdx, n);
                  const slot = wheelSlot(k, dial);
                  const half = (wordWidths[c.id] ?? 0) / 2;
                  const len = Math.max(SPOKES.min, dial.radius - half - SPOKES.gap);
                  return (
                    <motion.div
                      key={`spoke-${c.id}`}
                      initial={{ x: slot.x, y: slot.y, rotate: slot.rotate, opacity: 0 }}
                      animate={{
                        x: slot.x,
                        y: slot.y,
                        rotate: slot.rotate,
                        opacity: stage >= STAGE.settled ? slot.opacity : 0,
                      }}
                      transition={{ duration: reduceMotion ? 0 : SPOKES.fadeS, ease: EASE_OUT }}
                      style={{ position: 'absolute', left: dial.baseX, top: '50%' }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: half + SPOKES.gap,
                          width: len,
                          borderTop: `1px dashed ${SPOKES.color}`,
                        }}
                      />
                    </motion.div>
                  );
                })
              : null}

            {categories.map((c, i) => {
              const k = wheelOffset(i, activeIdx, n);
              return (
                <FlyingWord
                  key={c.id}
                  label={c.label}
                  from={origins[c.id]}
                  railColor={checked.has(c.id) ? INK : inkA(0.7)}
                  slot={wheelSlot(k, dial)}
                  // Nearest words go first, so the arc assembles outward from
                  // the one you chose rather than in list order.
                  delayS={
                    dials.timing.wordsFlyMs / 1000 +
                    Math.abs(k) * (dials.flight.staggerMs / 1000)
                  }
                  stage={stage}
                  dial={dial}
                  flight={dials.flight}
                  reduceMotion={reduceMotion}
                  onMeasure={(w) =>
                    setWordWidths((prev) => (prev[c.id] === w ? prev : { ...prev, [c.id]: w }))
                  }
                />
              );
            })}

            {/* "01 / 07" above the active word */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: stage >= STAGE.settled ? 1 : 0 }}
              transition={{
                duration: reduceMotion ? 0 : 0.4,
                ease: EASE_OUT,
                delay:
                  stage >= STAGE.settled
                    ? (TIMING.counterIn - dials.timing.spokesInMs) / 1000
                    : 0,
              }}
              style={{
                position: 'absolute',
                left: dial.baseX,
                top: '50%',
                transform: `translate(-50%, calc(-50% - ${dial.labelFont + 10}px))`,
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: '0.14em',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: inkA(0.85) }}>
                {String(activeIdx + 1).padStart(2, '0')}
              </span>
              <span style={{ color: inkA(0.42) }}> / {String(n).padStart(2, '0')}</span>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      {/* ── Bench chrome ─────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: RAIL.top,
          right: 40,
          textAlign: 'right',
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: inkA(0.38),
          lineHeight: 1.9,
          zIndex: 2,
        }}
      >
        <div style={{ color: inkA(0.8) }}>Category rail → explore dial</div>
        <div>1 · open the category accordion</div>
        <div>2 · check one to choose where the dial lands</div>
        <div>3 · explore (or ⏎) · esc resets · ?dial=1 controls</div>
        <div style={{ marginTop: 10, color: inkA(0.55) }}>
          stage {stage} / {STAGE.settled}
        </div>
      </div>

      <button
        type="button"
        onClick={reset}
        style={{
          position: 'absolute',
          bottom: 32,
          right: 40,
          padding: '8px 14px',
          background: 'none',
          border: `1px dashed ${inkA(0.3)}`,
          color: inkA(0.7),
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          zIndex: 4,
        }}
      >
        ⟳ Reset
      </button>
    </div>
  );
}

const accordionHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: '100%',
  padding: '6px 2px 8px',
  background: 'none',
  border: 'none',
  borderBottom: `1px solid ${inkA(0.14)}`,
  color: INK,
  fontFamily: MONO,
  fontSize: RAIL.headerFont,
  fontWeight: 400,
  letterSpacing: RAIL.headerTrack,
  textTransform: 'uppercase',
  cursor: 'pointer',
};
