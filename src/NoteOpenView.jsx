import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  useAnimate,
} from 'motion/react';
import { TunableGrainBackground } from './noise';
import { NOISE_GRADIENT } from './NoiseGradient';
import { NoiseDisplaceFilter } from './NoiseDisplaceFilter';
import { HorizontalConfessionStack, VerticalConfessionStack, DialNavHint, NavGrainFilter } from './SideDial';
import { themeStats, sortConfessionsByEmotions, formatCategoryLabel } from './themes';
import { LINK_UNDERLINE } from './linkUnderline';

/* ─────────────────────────────────────────────────────────
 * NOTE-OPEN VIEW
 *
 * Full-screen takeover entered by clicking an UNFILTERED grid note.
 * See docs/note-open-view-handoff.md for the full spec.
 *
 * The note display is the dial page's HorizontalConfessionStack — the same
 * side-scrolling coverflow carousel (centre note emphasised; neighbours tilt
 * away, degraded to grain + B&W; NoteMeta date/location + transcript on the
 * active card). Dark edge gradients fade the far left/right into black as the
 * notes slide, exactly like the dial page.
 *
 * What makes it distinct from the dial page: a near-black gradient backdrop, a
 * left-edge rotary theme dial (a vertical category wheel that pivots off-screen
 * left — active upright and centred with a NN/MM counter, neighbours
 * tilting/receding), and the top-right chrome with ✕ EXIT. Scrolling
 * the stack spins the wheel to the current note's category; clicking a neighbour
 * category spins the wheel and jumps the stack to that category's first note.
 * ───────────────────────────────────────────────────────── */

const EASE_OUT = [0.165, 0.84, 0.44, 1];
const GRADIENT_EASE = [0.22, 1, 0.36, 1];

// Background (non-active) note opacity for THIS view only — much dimmer than the
// dial page's shared filmstrip (0.14 / 0.06) so neighbours sink further into the
// black backdrop and the centred note owns the frame. Still non-zero so there's
// a faint sense of the row continuing on either side.
const STACK_INACTIVE_OPACITY = { near: 0.06, far: 0.025 };

// Shared-element entrance: the clicked grid image flies + scales from its tile
// into the stack's centered active card, then crossfades to the real card.
const MORPH_S = 0.52; // s — bridge image travel/scale
const BRIDGE_FADE_S = 0.3; // s — stack (neighbours + dial + chrome) fades up
// The category context (desktop left wheel / mobile top-left caption) washes in
// a beat AFTER the note and its date/location have landed (cf. META_TIMING in
// SideDial: metaRow 0.4s), so the eye reads the note first and the surrounding
// category settles in second rather than popping in with everything else.
const CATEGORY_REVEAL_DELAY_S = 0.55;
// The dark backdrop no longer slams opaque on frame 0. During a morph it stays
// transparent for a beat — the clicked note lifts off (crisp bridge) while the
// rest of the index dissolves underneath (see GRID EXIT in App.jsx) — then the
// backdrop veils in over the emptied grid. Timed to trail the grid's dissolve.
const BACKDROP_VEIL_DELAY_S = 0.14; // s — let the index start dissolving first
const BACKDROP_VEIL_S = 0.42; //       s — then the backdrop fades to opaque
// s — the bridge's final dissolve into its now-opaque twin card. Runs AFTER the
// stack is fully opaque, so it never darkens the composite (see hand-off below).
const BRIDGE_DISSOLVE_S = 0.2;
// How long the target card's centre must hold still before we lock the FLIP
// target. Must outlast the stack's post-mount scroll-snap correction so the
// bridge lands where the card actually rests (no hand-off jump).
const MORPH_SETTLE_MS = 180;

/* ─────────────────────────────────────────────────────────────────────
 * ANIMATION STORYBOARD — LEAVING THE DIAL (explore → index)
 *
 * The EXPLORE tab doesn't cut back to the index; it clears itself in the
 * order you'd read it. The middle empties, then the wheel walks off the
 * side it pivots on. Times are ms after INDEX is clicked.
 *
 *    0ms   the note stack in the middle fades out             (260ms)
 *  140ms   the dial's words slide left and fade, top of the
 *          arc first, 80ms apart, each spoke riding with its
 *          own word                                           (500ms each)
 *  840ms   what's left — grain, vignette, note counter — goes
 *          with the page                                      (280ms)
 *  960ms   the last word is away
 * 1120ms   explore unmounts. The view switch is an
 *          AnimatePresence mode="wait", so only now does the
 *          index mount — and it arrives playing its first-load
 *          entrance, not cutting in (see gridEntranceDoneRef
 *          in App.jsx).
 *
 * Only the EXPLORE tab leaves this way. The note overlay lifted out of the
 * grid still cuts on exit: the index is already sitting behind it, so
 * anything slower reads as lag rather than choreography.
 * ───────────────────────────────────────────────────────────────────── */
const EXPLORE_EXIT = {
  notes: 0.26, //     s — the centre stack dissolves
  // The page fade multiplies into every row still travelling, so it has to
  // hold until the wheel is nearly away. Start it while the stagger is still
  // running and the last rows are dragged to zero together — the bottom three
  // vanish within a frame or two of each other and the stagger is lost exactly
  // where it should be most visible.
  pageDelay: 0.84, // s — the rest holds until the wheel is nearly away
  page: 0.28, //      s — then grain, vignette and counter follow it out
};
const DIAL_EXIT = {
  travel: 320, //    px — left, on top of however far the row already sits
  slide: 0.5, //     s — one row's journey off the edge
  stagger: 0.08, //  s — between rows, top of the arc first
  delay: 0.14, //    s — after the notes have started to go
  // Everything else in this file leaves on EASE_OUT, which spends nearly all
  // its distance in the first fifth and drifts out the rest. That's right for
  // something arriving and wrong for something this slow leaving: stretched
  // over half a second it reads as the old quick slide followed by a hang
  // rather than as a slower exit. A symmetric curve puts the speed in the
  // middle of the journey, which is the part you actually watch.
  ease: [0.4, 0, 0.6, 1],
};
/* When the last thing anyone can see finishes. The page fade multiplies into
 * every row, so this is the moment the view is blank whatever else is still
 * animating — and AnimatePresence holds the unmount for the slowest exit, which
 * means anything running past here is 250ms of black screen bought with motion
 * nobody can see. The tail rows give up the rest of their journey instead: they
 * cross this line under ~15% opacity, which is already the "dragged to zero
 * together" reading the stagger above is written for. */
const EXPLORE_EXIT_END = EXPLORE_EXIT.pageDelay + EXPLORE_EXIT.page;
/* The staged page fade, as an exit. Shared with anything portaled out of the
 * root: a portal's node is not inside the root, so the root's own fade can't
 * reach it and it has to leave on the same clock under its own steam. */
const pageFadeExit = (staged) =>
  staged
    ? {
        opacity: 0,
        transition: {
          duration: EXPLORE_EXIT.page,
          delay: EXPLORE_EXIT.pageDelay,
          // DIAL_EXIT's symmetric curve rather than EASE_OUT, for the reason
          // given there: ease-out is an arrival curve, and on the way out it
          // spends its last third under 5% opacity — 90ms that looks finished
          // but still counts, since nothing can unmount or take the screen
          // until the animation formally ends.
          ease: DIAL_EXIT.ease,
        },
      }
    : { opacity: 0, transition: { duration: 0 } };
// The grid tile is a square with the note image `objectFit:contain` inside
// this much padding (see GridView) — so the visible pixels sit in a letterboxed
// box this far in from the tile rect. Used to start the morph bridge on the
// real image. EXPORTED as the single source of truth: GridView imports this for
// its tile padding, so shrinking the gap between grid images here keeps the
// note lift-off pixel-aligned automatically.
export const TILE_PADDING = 26;

// The morph bridge wears the SAME paper-warp + grain the grid tiles use, so the
// lifted image is pixel-identical to the note the visitor just clicked (rather
// than a clean copy that "pops" on lift-off). Its own filter id so it can't
// collide with GridView's copy of the same filter.
const BRIDGE_FILTER_ID = 'note-open-bridge-noise';
const BRIDGE_FILTER = `url(#${BRIDGE_FILTER_ID})`;

// Below this width the horizontal coverflow has no room for left/right
// neighbours, so the stack rotates to a vertical carousel (see mobile branch).
// Matches App.jsx's ARCHIVE_NAV_COMPACT_MQ so chrome + layout switch together.
const MOBILE_MQ = '(max-width: 760px)';

/** Grain filter ids for mobile navigation glyphs (note chevrons + category arrows). */
const MOBILE_NAV_GRAIN_ID = 'explore-mobile-arrow-grain';
const CATEGORY_NAV_GRAIN_ID = 'explore-mobile-category-grain';

/** True on phone-width viewports; live-updates on resize/rotate. */
function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/** Letterbox `aspect` (w/h) inside `box`, centered — the on-screen pixel box of
 *  an `object-fit:contain` image. Returns viewport-space {left,top,width,height}. */
function containBox(box, aspect) {
  let w, h;
  if (box.width / box.height > aspect) {
    h = box.height;
    w = h * aspect;
  } else {
    w = box.width;
    h = w / aspect;
  }
  return {
    left: box.left + (box.width - w) / 2,
    top: box.top + (box.height - h) / 2,
    width: w,
    height: h,
  };
}

/* ── Left rotary dial ──────────────────────────── */

/**
 * Left-pivoting rotary "wheel" of category labels (per the Figma). The active
 * category sits upright at the vertical centre; neighbours curve up/down and
 * recede toward an off-screen pivot on the LEFT, dimming with distance. A note-
 * position counter (NN/MM) rides just above the active wordmark. Clicking a
 * neighbour spins the wheel to that category.
 *
 * The wheel *loops*: each category is placed by its shortest signed distance
 * around the ring (see `wheelOffset`), so it wraps endlessly like the bottom
 * compass dial — past the last category the first swings back into view (and
 * vice-versa), never a dead end. It still mirrors the stack, which clusters
 * notes by category in the same order, so scrolling walks the wheel one notch
 * at a time. Each label springs to a new arc slot when the active category
 * changes, which reads as the wheel rotating.
 */
export const WHEEL = {
  baseX: 128, //     px — active wordmark's horizontal centre (from column left)
  radius: 620, //    px — arc radius; larger = gentler curve (less left drift)
  stepDeg: 17, //    deg between adjacent categories along the arc
  visible: 2, //     neighbours kept visible (opacity > 0) on each side
  labelFont: 22, //  px — wordmark size (sized so long labels clear the note)
  gapEm: 0.16, //    em — space between underlined letters
  opacity: [1, 0.4, 0.18], // by |offset| from active: [active, ±1, ±2]
};

/** Degrees between adjacent categories on the wheel. Exported so a view that
 *  wants to sit its content ON the dial's arc (see CategoryRows, which tilts
 *  each category row to its label's angle) turns by the same amount. */
export const DIAL_STEP_DEG = WHEEL.stepDeg;

// Arc transform for a label `k` steps from the active one (k<0 above, k>0
// below). x is always ≤ 0 so labels drift left toward the pivot as they recede.
// `vis` caps how many neighbours stay lit; past it the label is fully
// transparent — parked off the back of the wheel, which is where the wrap seam
// hides so the loop never flashes a label swinging across the face.
export function wheelSlot(k, vis = WHEEL.visible) {
  const rad = (k * WHEEL.stepDeg * Math.PI) / 180;
  const ak = Math.abs(k);
  return {
    x: WHEEL.radius * (Math.cos(rad) - 1),
    y: WHEEL.radius * Math.sin(rad),
    rotate: k * WHEEL.stepDeg,
    opacity: ak <= vis ? WHEEL.opacity[ak] ?? 0 : 0,
  };
}

// Shortest signed distance from the active category (`idx`) to label `i` around
// a ring of `n` categories. Folding into (-n/2, n/2] means every label rotates
// the *short* way to its next slot and the wheel loops endlessly; the label
// crossing the back seam does so while parked off-wheel (opacity 0), so the
// wrap is invisible.
export function wheelOffset(i, idx, n) {
  let k = (((i - idx) % n) + n) % n; // 0 … n-1
  if (k > n / 2) k -= n; //             fold into (-n/2, n/2]
  return k;
}

// How many neighbours each side stay lit, for a wheel of `n` categories. Kept
// narrow enough that at least the back slot stays hidden — that hidden gap is
// where the wrap seam lives, so looping never flashes a label sweeping across
// the wheel's face. Exported so anything animating INTO the dial (the index
// rail's category flight) lands its words at the same opacities the dial will
// render a frame later.
export function wheelVisible(n) {
  return Math.max(1, Math.min(WHEEL.visible, Math.floor((n - 3) / 2)));
}

// Gap (px) between a spoke's inner end and its wordmark's left edge.
const DIAL_CONNECTOR_GAP = 16;
// Shortest a spoke can get (guards against zero/negative for very wide labels).
const DIAL_CONNECTOR_MIN = 14;

// Normalize a theme label to a lookup key (lower-case, alphanumerics only) so a
// definition matches whatever casing/punctuation the sheet uses for the theme.
const catKey = (label) =>
  String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

// One-line definition per theme, shown as a cursor-following tooltip when the
// visitor hovers a category on the left dial. Keyed by `catKey` so it survives
// label casing/spacing; a theme with no entry simply shows no tooltip.
const CATEGORY_DEFINITIONS = {
  therapist:
    'Sharing emotional and private information to an AI system acting as a listener and advisor.',
  companionship:
    'Treating AI as a relational other, such as a friend, confidant, or romantic partner, where attachment and habit builds over time.',
  harm: "Interactions with AI that reinforce distorted or harmful beliefs, escalate a crisis, or shape the user's thinking in ways they later name as damaging.",
  refusal:
    'Boycotting AI use, partly or entirely, on ethical, environmental, labor, or personal grounds.',
  exes: "One of our most common themes: using AI to process romantic angst — interpreting a partner's behavior, winning arguments, or even cloning your ex's likeness.",
  ghostwriter:
    'Letting AI be your voice or representative by allowing it to draft or fully respond on your behalf in professional and personal contexts.',
};

export function LeftThemeDial({
  emotions,
  activeId,
  onChange,
  onExplore,
  reduceMotion,
  delay,
  /** Held dark while the index rail's categories are still flying here. The
   *  flight draws its own copy of every wordmark, so showing ours underneath
   *  would double every label. */
  hidden = false,
  /** A flight brought us here — the words on the arc were drawn a moment ago
   *  (or still are). Either way this dial has already been introduced and must
   *  cut in, never fade. Separate from `hidden` because we can mount on either
   *  side of the landing depending on how long the index takes to clear, and
   *  only the early case is ever `hidden`. */
  handoff = false,
  /** `(label) => ref` handing out the zero-size slot anchor each wordmark is
   *  centred on. A flight back to the index reads its start pose off these. */
  registerSlot,
  /** Leave by walking off the left edge, row by row, instead of vanishing with
   *  the view. Only the EXPLORE tab does this — see the storyboard up top. */
  exitLeft = false,
}) {
  const idx = Math.max(0, emotions.findIndex((e) => e.id === activeId));
  const active = emotions[idx];

  // Measure every category wordmark (labels vary a lot: HARM vs COMPANIONSHIP)
  // so each spoke can start just left of its own word. Widths are constant per
  // label, so we cache them by id and only re-measure on font load / resize.
  const wordElsRef = useRef(new Map());
  const [wordWidths, setWordWidths] = useState({});
  // Sticky: once a flight has had anything to do with us, every reveal is a cut
  // rather than a fade, including the one that ends the flight.
  const handedOffRef = useRef(false);
  if (hidden || handoff) handedOffRef.current = true;
  const handedOff = handedOffRef.current;
  // The column cuts in at a handoff so the wordmarks don't ghost up through the
  // copies the flight already drew. The spokes and the counter have no such
  // counterpart — cutting them in snaps a set of hairlines into being out of
  // nowhere — so they draw themselves on afterwards instead.
  const settleIn = handedOff
    ? {
        initial: { opacity: 0 },
        animate: { opacity: hidden ? 0 : 1 },
        transition: { duration: hidden ? 0 : 0.32, ease: EASE_OUT },
      }
    : {};
  // Cursor-following definition tooltip for the category the pointer is over.
  const [tip, setTip] = useState(null);
  const setWordEl = useCallback(
    (id) => (el) => {
      const map = wordElsRef.current;
      if (el) map.set(id, el);
      else map.delete(id);
    },
    []
  );
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const next = {};
      wordElsRef.current.forEach((el, id) => {
        if (el) next[id] = el.getBoundingClientRect().width;
      });
      setWordWidths((prev) => {
        const keys = Object.keys(next);
        const same =
          keys.length === Object.keys(prev).length &&
          keys.every((key) => prev[key] === next[key]);
        return same ? prev : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    wordElsRef.current.forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [emotions]);
  const n = emotions.length;
  // Keep the lit band narrow enough that at least the back slot stays hidden —
  // that hidden gap is where the wrap seam lives, so looping never flashes a
  // label sweeping across the wheel's face. Full `visible` for the real 7-way
  // dial; degrades gracefully if fewer categories are present.
  const vis = wheelVisible(n);
  if (!active) return null;

  // Each label springs to its new slot when `idx` changes → the wheel rotates.
  const spin = reduceMotion
    ? { duration: 0 }
    : { type: 'spring', visualDuration: 0.6, bounce: 0.12 };

  // Leaving for the index: the row carries on the way it was already leaning —
  // further left, out past the pivot — and fades on the way. Rows go top-first
  // so the wheel unwinds downward. The back slots are already invisible, so
  // they leave with the first row rather than holding the tail of the stagger.
  const rowExit = (k) => {
    if (!exitLeft || reduceMotion) return undefined;
    const delay = DIAL_EXIT.delay + (Math.abs(k) <= vis ? k + vis : 0) * DIAL_EXIT.stagger;
    return {
      x: wheelSlot(k, vis).x - DIAL_EXIT.travel,
      opacity: 0,
      transition: {
        // Clipped to the page fade (EXPLORE_EXIT_END) — the bottom rows set off
        // late enough that a full slide would outlast the view.
        duration: Math.max(0, Math.min(DIAL_EXIT.slide, EXPLORE_EXIT_END - delay)),
        delay,
        ease: DIAL_EXIT.ease,
      },
    };
  };

  // Hover handlers for a lit category label: pop its blurb next to the cursor
  // (and track the cursor). Returns null for themes with no definition, leaving
  // that label inert.
  const tipHandlers = (emo) => {
    const text = CATEGORY_DEFINITIONS[catKey(emo.label)];
    if (!text) return null;
    const track = (e) => setTip({ x: e.clientX, y: e.clientY, label: emo.label, text });
    return { onMouseEnter: track, onMouseMove: track, onMouseLeave: () => setTip(null) };
  };

  // Cursor-following tooltip, portaled to <body> so the dial column's transforms
  // (which would otherwise capture position:fixed) can't shift or clip it.
  let tipNode = null;
  if (tip && typeof document !== 'undefined') {
    const GAP = 18;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    // Flip above the cursor in the lower part of the screen so a tall blurb
    // never runs off the bottom; clamp horizontally to stay on-screen.
    const below = tip.y < vh * 0.62;
    const left = Math.max(12, Math.min(tip.x + GAP, vw - 316));
    const vpos = below ? { top: tip.y + GAP } : { bottom: vh - tip.y + GAP };
    tipNode = createPortal(
      <div style={{ ...st.catTip, left, ...vpos }}>
        <div style={st.catTipBody}>{tip.text}</div>
      </div>,
      document.body
    );
  }

  return (
    <motion.div
      // Mounting mid-flight we start dark and cut in when the words land;
      // mounting after one has already landed there is nothing left to wait
      // for, so we're simply here. Only a dial nobody flew to slides in.
      initial={
        reduceMotion || hidden || handoff
          ? { opacity: hidden ? 0 : 1 }
          : { opacity: 0, x: -16 }
      }
      animate={{ opacity: hidden ? 0 : 1, x: 0 }}
      // Coming out of a handoff there is nothing to reveal: the flight has
      // already drawn these exact words at these exact places, so we cut in
      // under them. Fading would ghost the dial up through its own copy.
      transition={
        handedOff
          ? { duration: 0 }
          : { duration: reduceMotion ? 0 : 0.5, ease: EASE_OUT, delay }
      }
      style={st.dialColumn}
    >
      {/* Rotary wheel: every category positioned on the arc by its shortest
          signed distance from the active one, so the wheel wraps endlessly.
          `initial={false}` so labels mount at their slot and only animate on
          subsequent category changes. */}
      {emotions.map((emo, i) => {
        const k = wheelOffset(i, idx, n);
        const slot = wheelSlot(k, vis);
        const isActive = k === 0;
        const clickable = !isActive && Math.abs(k) <= vis;
        // Only the lit labels (active + clickable neighbours) get a tooltip; the
        // hidden back-slot labels stay inert.
        const hover = isActive || clickable ? tipHandlers(emo) : null;
        return (
          <motion.div
            key={emo.id}
            ref={registerSlot?.(emo.label)}
            initial={false}
            animate={{ x: slot.x, y: slot.y, rotate: slot.rotate, opacity: slot.opacity }}
            exit={rowExit(k)}
            transition={spin}
            style={{ ...st.slot, zIndex: isActive ? 3 : 1 }}
          >
            {clickable ? (
              <button
                type="button"
                onClick={() => onChange(emo.id)}
                aria-label={`Show ${emo.label}`}
                style={st.slotButton}
                {...(hover || {})}
              >
                <span ref={setWordEl(emo.id)} style={st.word}>
                  {formatCategoryLabel(emo.label)}
                </span>
              </button>
            ) : isActive && onExplore ? (
              <button
                type="button"
                onClick={() => onExplore(emo.label)}
                title="Explore notes in this category"
                style={{ ...st.slotButton, cursor: 'pointer' }}
                {...(hover || {})}
              >
                <span ref={setWordEl(emo.id)} style={st.word}>
                  {formatCategoryLabel(emo.label)}
                </span>
              </button>
            ) : (
              <span
                style={
                  isActive && hover
                    ? { ...st.slotStatic, pointerEvents: 'auto', cursor: 'help' }
                    : st.slotStatic
                }
                {...(isActive && hover ? hover : {})}
              >
                <span ref={setWordEl(emo.id)} style={st.word}>
                  {formatCategoryLabel(emo.label)}
                </span>
              </span>
            )}
          </motion.div>
        );
      })}
      {tipNode}
      {/* Dashed spokes — ONE per theme. Each hairline runs from just left of its
          wordmark inward to the wheel's (off-screen) pivot, so every line is a
          true radius and they all fan out from the dial's centre. Each rides the
          arc with its label via the same slot transform. No node — just the line. */}
      <motion.div aria-hidden="true" style={st.dialSpokeLayer} {...settleIn}>
        {emotions.map((emo, i) => {
          const k = wheelOffset(i, idx, n);
          const slot = wheelSlot(k, vis);
          const half = (wordWidths[emo.id] ?? 0) / 2;
          // Labels sit `radius` from the pivot, so a line this long from the
          // word's edge lands its far end exactly at the dial's centre.
          const len = Math.max(DIAL_CONNECTOR_MIN, WHEEL.radius - half - DIAL_CONNECTOR_GAP);
          return (
            <motion.div
              key={emo.id}
              initial={false}
              animate={{ x: slot.x, y: slot.y, rotate: slot.rotate, opacity: slot.opacity }}
              exit={rowExit(k)}
              transition={spin}
              style={st.slot}
            >
              <span
                style={{ ...st.dialSpokeLine, right: half + DIAL_CONNECTOR_GAP, width: len }}
              />
            </motion.div>
          );
        })}
      </motion.div>

      {/* Which category you're on ("03 / 06"), set small above the active
          wordmark. Deliberately NOT the note counter pinned bottom-centre — that
          one counts notes inside the current category, this one counts categories.
          Keyed on activeId so the figure crossfades as the wheel turns instead of
          hard-cutting mid-spin. */}
      <motion.div
        style={st.dialCatCount}
        aria-label={`Category ${idx + 1} of ${n}`}
        {...settleIn}
        // Rides out with the row it labels.
        exit={rowExit(0)}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={activeId}
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.4, ease: GRADIENT_EASE }}
          >
            <span style={st.dCounterCurrent}>{String(idx + 1).padStart(2, '0')}</span>
            <span style={st.dCounterTotal}>{` / ${String(n).padStart(2, '0')}`}</span>
          </motion.span>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

/* ── Mobile theme caption ──────────────────────── */

/**
 * The phone's note counter (NN/MM), bottom-centre beneath the category stepper.
 * Crossfades as the centred note's category / position change while the user
 * swipes the vertical carousel — keyed on both, so stepping category re-reads
 * even when the position number happens to be unchanged.
 *
 * EXPLORE tab only. There the number is your place inside the category the
 * stepper is parked on, so it belongs to the stepper it sits under. In the
 * grid overlay it counted the whole tapped list instead — "01/165" against a
 * single note, which reads as the length of the archive rather than as
 * anything about the note you opened. See where this is rendered.
 */
function MobileThemeCaption({ label, position, total, reduceMotion }) {
  const fade = {
    initial: reduceMotion ? { opacity: 1 } : { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: reduceMotion ? 0 : 0.4, ease: GRADIENT_EASE },
  };
  return (
    <div style={st.mCounterWrap}>
      <AnimatePresence mode="wait">
        <motion.div key={`${label}-${position}`} {...fade} style={st.mCounter}>
          {String(position).padStart(2, '0')}/{String(total).padStart(2, '0')}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ── Mobile theme stepper ──────────────────────── */

/** Grain-filtered chevron (‹ or ›) used by the category stepper. */
function StepperArrow({ points, label, grainId, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={st.mStepperArrow}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ position: 'relative', zIndex: 1, filter: `url(#${grainId})` }}
      >
        <polyline points={points} />
      </svg>
    </button>
  );
}

/**
 * Mobile theme navigation — the phone's stand-in for the desktop left rotary
 * dial (and the W/S theme keys). The active category is featured centre-stage
 * with a grain-filtered ‹ / › on either side; tapping an arrow steps to the
 * prev/next theme's first note (via stepCategory — the same wrap-around jump
 * the dial and W/S keys use). The label crossfades as the theme changes.
 * Reveals a beat after the note lands, matching the desktop dial.
 */
function MobileThemeStepper({ label, onStep, reduceMotion, delay = 0 }) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.45, ease: EASE_OUT, delay }}
      style={st.mStepperWrap}
    >
      <NavGrainFilter id={CATEGORY_NAV_GRAIN_ID} reduceMotion={reduceMotion} />
      <StepperArrow
        points="15 18 9 12 15 6"
        label="Previous category"
        grainId={CATEGORY_NAV_GRAIN_ID}
        onClick={() => onStep(-1)}
      />
      <div style={st.mStepperLabelClip}>
        <AnimatePresence mode="wait">
          <motion.div
            key={label}
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: GRADIENT_EASE }}
            style={st.mStepperLabel}
          >
            {label}
          </motion.div>
        </AnimatePresence>
      </div>
      <StepperArrow
        points="9 18 15 12 9 6"
        label="Next category"
        grainId={CATEGORY_NAV_GRAIN_ID}
        onClick={() => onStep(1)}
      />
    </motion.div>
  );
}

/* ── Note-open view ────────────────────────────── */

export default function NoteOpenView({
  confession,
  confessions,
  emotions,
  originRect,
  onExit,
  onIndex,
  onExplore,
  // When true, this renders as a persistent top-level view (the EXPLORE tab)
  // rather than a grid-click overlay: no shared-element morph, it opens on the
  // first note, sits BELOW the app's nav chrome (so the tab bar shows through),
  // hides its own BACK (that nav bar's INDEX already leads out), and an
  // empty-space click no longer dismisses it. Esc still steps out via onExit.
  standalone = false,
  /** True while the index rail's categories are still flying to the dial. */
  dialHidden = false,
  /** True when a flight brought us here at all, whether or not it has already
   *  landed. See `handoff` on LeftThemeDial. */
  dialHandoff = false,
  /** `(label) => ref` for the dial's slot anchors, so a flight back to the
   *  index can read where each wordmark currently sits. */
  registerDialSlot,
}) {
  const reduceMotion = useReducedMotion();
  const isMobile = useIsMobile();

  // What the stack browses, and in what order.
  //
  // The EXPLORE tab clusters by category (dial order): its dial steps categories
  // and expects each one's notes to be contiguous, and only categorised notes
  // belong on a view whose whole frame is the category you're in.
  //
  // The grid overlay takes the list exactly as handed to it — the notes the index
  // was showing, in the order it was showing them — so tapping a note enlarges
  // THAT note and scrolling carries on through its neighbours. Clustering here
  // would both reshuffle the order out from under the tap and drop the
  // uncategorised majority of the archive, which is how a tap on one of them
  // used to open a different note entirely.
  const themed = useMemo(
    () =>
      standalone
        ? sortConfessionsByEmotions(confessions.filter((c) => c.category), emotions)
        : confessions,
    [confessions, emotions, standalone]
  );

  // Index of the clicked note within the stack (this view remounts per open,
  // keyed by note id). -1 if the note has no theme (so it isn't in the stack).
  const seedIndex = useMemo(
    () => themed.findIndex((c) => c.id === confession?.id),
    [themed, confession]
  );
  const [activeIndex, setActiveIndex] = useState(seedIndex >= 0 ? seedIndex : 0);

  const activeNote = themed[activeIndex] || themed[0] || confession;
  const activeLabel = activeNote?.category || emotions[0]?.label || '';
  const activeEmotion = useMemo(
    () => emotions.find((e) => e.label === activeLabel) || null,
    [emotions, activeLabel]
  );
  const activeId = activeEmotion?.id ?? null;

  // Active note's position within its own category (0-based). `themed` clusters
  // categories in dial order, so the run of same-category notes is contiguous;
  // the left dial's counter shows `indexInCategory + 1 / total` above the wordmark.
  const indexInCategory = useMemo(() => {
    const within = themed.filter((c) => c.category === activeLabel);
    const i = within.findIndex((c) => c.id === activeNote?.id);
    return i < 0 ? 0 : i;
  }, [themed, activeLabel, activeNote]);

  // What the NN/MM counter counts. On EXPLORE it's your place in the category
  // the dial is parked on — the category is the frame there. In the grid overlay
  // it's your place in the list you tapped into, which is the only count that
  // means anything when most of those notes carry no category at all.
  const position = standalone ? indexInCategory + 1 : activeIndex + 1;
  const total = standalone ? themeStats(confessions, activeLabel).count : themed.length;

  // ── Shared-element entrance ──────────────────────────────
  // The clicked grid image itself flies + scales from its tile into the stack's
  // centered active card, then crossfades to the real card. Gated on having an
  // origin rect + the note actually living in the stack (so the bridge lands on
  // the same note the stack centers on). Skipped on mobile: the vertical
  // carousel's cards aren't `[data-card]`, and a phone entrance reads better as
  // a straight reveal than a cross-axis flight.
  const wantMorph =
    !reduceMotion && !isMobile && !!originRect && !!confession?.image && seedIndex >= 0;
  const [phase, setPhase] = useState(wantMorph ? 'morph' : 'done'); // 'morph' | 'done'
  const [showBridge, setShowBridge] = useState(wantMorph);
  const overlayRef = useRef(null);
  const [bridgeScope, bridgeAnimate] = useAnimate();
  const revealed = phase === 'done';
  // Whether this instance clears itself in beats on the way out (EXPLORE tab)
  // or cuts (a note lifted out of the grid). See the storyboard at the top.
  const stagedExit = standalone && !reduceMotion;

  useEffect(() => {
    if (phase !== 'morph') return undefined;
    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    let shown = false; // has the bridge been parked over the clicked tile yet?
    let prevCenter = null; // last target-card center, to detect it settling
    let stableSince = null; // timestamp the centre last started holding still

    // On-screen box of the stack's centered active-card image: the card image
    // whose center is closest to the viewport center once the stack's initial
    // (instant) scroll has landed. Measured live so it survives the coverflow
    // scale + any layout settle.
    const measureTarget = () => {
      const root = overlayRef.current;
      if (!root) return null;
      const cx = window.innerWidth / 2;
      let best = null;
      let bestDist = Infinity;
      // Track the card the stack marks active (`data-active` = the note being
      // opened) so the bridge follows the *correct* note instead of whichever
      // neighbour is momentarily nearest centre while the stack is still
      // scrolling into place. Fall back to any card until the marker mounts.
      let cards = root.querySelectorAll('[data-card][data-active] img');
      if (cards.length === 0) cards = root.querySelectorAll('[data-card] img');
      cards.forEach((img) => {
        const r = img.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        const d = Math.abs(r.left + r.width / 2 - cx);
        if (d < bestDist) {
          bestDist = d;
          best = r;
        }
      });
      // Bail if nothing is near center yet (initial scroll hasn't landed).
      if (!best || bestDist > window.innerWidth * 0.35) return null;
      return best;
    };

    // Start box = the clicked grid image's visible pixels: the tile rect, inset
    // by its padding, letterboxed to the image's aspect ratio. Needs the image
    // decoded (naturalWidth) — it's the same file the grid just showed, so it's
    // warm in cache and ready within a frame or two.
    const computeFrom = () => {
      const el = bridgeScope.current;
      if (!el || !el.naturalWidth) return null;
      const aspect = el.naturalWidth / el.naturalHeight;
      return containBox(
        {
          left: originRect.left + TILE_PADDING,
          top: originRect.top + TILE_PADDING,
          width: Math.max(1, originRect.width - TILE_PADDING * 2),
          height: Math.max(1, originRect.height - TILE_PADDING * 2),
        },
        aspect
      );
    };

    const run = () => {
      if (cancelled) return;
      attempts += 1;
      const el = bridgeScope.current;
      const from = computeFrom();

      // Park the bridge exactly over the clicked tile's pixels the instant the
      // image is ready — even before the stack's target card can be measured.
      // The backdrop is already opaque (grid hidden), so this reads as the note
      // lifting off the grid with no black gap or first-frame pop.
      if (el && from && !shown) {
        el.style.left = `${from.left}px`;
        el.style.top = `${from.top}px`;
        el.style.width = `${from.width}px`;
        el.style.height = `${from.height}px`;
        el.style.transform = 'none';
        el.style.transformOrigin = '0 0';
        el.style.opacity = '1';
        shown = true;
      }

      const target = measureTarget();
      if (!el || !from || !target) {
        if (attempts > 120) {
          // ~2s of retries failed → skip the morph, just reveal the stack.
          setPhase('done');
          setShowBridge(false);
          return;
        }
        raf = requestAnimationFrame(run);
        return;
      }

      // Wait for the stack's active card to actually COME TO REST before
      // locking the FLIP target. The stack keeps moving for a beat after mount:
      // its instant initial scroll lands, then a scroll-snap nudges it the last
      // few px, then the coverflow ~1.12 scale + image-load widths settle.
      // Locking on the first "near centre" frame sends the bridge to a stale
      // box, so it visibly jumps onto the real card at hand-off (the note reads
      // as animating "up" twice). Instead we require the active card's centre to
      // hold still for MORPH_SETTLE_MS — long enough to outlast the snap — so
      // the bridge lands exactly where the card comes to rest. The bridge stays
      // parked over the tile until then, reading as a beat of focus.
      const center = {
        x: target.left + target.width / 2,
        y: target.top + target.height / 2,
      };
      const held =
        prevCenter &&
        Math.abs(center.x - prevCenter.x) < 1.5 &&
        Math.abs(center.y - prevCenter.y) < 1.5;
      prevCenter = center;
      if (held) {
        if (stableSince == null) stableSince = performance.now();
      } else {
        stableSince = null;
      }
      const settled =
        stableSince != null && performance.now() - stableSince >= MORPH_SETTLE_MS;
      if (!settled && attempts < 150) {
        raf = requestAnimationFrame(run);
        return;
      }

      // FLIP: pin to the centered-card box, then start it back at the parked
      // origin box via transform (identical on-screen position — no jump), and
      // animate home. Top-left transform-origin so translate + scale map
      // corner → corner.
      el.style.left = `${target.left}px`;
      el.style.top = `${target.top}px`;
      el.style.width = `${target.width}px`;
      el.style.height = `${target.height}px`;
      el.style.transformOrigin = '0 0';
      el.style.opacity = '1';

      bridgeAnimate(
        el,
        {
          x: [from.left - target.left, 0],
          y: [from.top - target.top, 0],
          scaleX: [from.width / target.width, 1],
          scaleY: [from.height / target.height, 1],
        },
        { duration: MORPH_S, ease: EASE_OUT }
      ).then(() => {
        if (cancelled) return;
        // Reveal the real stack (+ dial + chrome) BEHIND the still-opaque bridge.
        // The bridge's dissolve into the now-revealing card is handled by a
        // separate effect (keyed on phase==='done') so that THIS effect's
        // cleanup — which fires the instant `setPhase` re-renders — can't cancel
        // the hand-off mid-flight.
        setPhase('done');
      });
    };

    raf = requestAnimationFrame(run);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [phase, originRect, bridgeScope, bridgeAnimate]);

  // Bridge hand-off. Once the fly has landed and the stack begins revealing
  // (phase → 'done'), we must dissolve the bridge into the real card WITHOUT a
  // crossfade: the bridge is pixel-identical to, and pinned exactly over, the
  // centred card, and crossfading two identical images over a black backdrop
  // collapses the composite to ~0.44–0.75 mid-transition — the visible dark
  // "flash" as the note lands. Instead we hold the bridge fully opaque while the
  // stack fades up (neighbours + dial + chrome) behind it, then — once the twin
  // card underneath is fully opaque — dissolve the bridge into it. With an opaque
  // identical card behind, the bridge's fade keeps the composite at 1.0 the whole
  // way, so the note simply settles. This lives in its own effect (not the morph
  // rAF loop) because `setPhase('done')` re-renders and tears the morph effect
  // down; a timer scheduled there would be cleared before it could fire.
  useEffect(() => {
    if (phase !== 'done' || !showBridge) return undefined;
    const el = bridgeScope.current;
    if (!el) {
      setShowBridge(false);
      return undefined;
    }
    let cancelled = false;
    const hold = setTimeout(() => {
      if (cancelled) return;
      bridgeAnimate(el, { opacity: 0 }, { duration: BRIDGE_DISSOLVE_S, ease: 'linear' }).then(
        () => {
          if (!cancelled) setShowBridge(false);
        }
      );
    }, BRIDGE_FADE_S * 1000);
    return () => {
      cancelled = true;
      clearTimeout(hold);
    };
  }, [phase, showBridge, bridgeScope, bridgeAnimate]);

  // Dial click → jump to the first note of that category (stack smooth-scrolls).
  const handleCategoryChange = useCallback(
    (emotionId) => {
      const emo = emotions.find((e) => e.id === emotionId);
      if (!emo) return;
      const i = themed.findIndex((c) => c.category === emo.label);
      if (i >= 0) setActiveIndex(i);
    },
    [emotions, themed]
  );

  const step = useCallback(
    (dir) =>
      setActiveIndex((i) => (themed.length ? (i + dir + themed.length) % themed.length : 0)),
    [themed.length]
  );

  // W / S step between themes (categories). The left theme dial is a vertical
  // wheel, so W = up = previous theme, S = down = next theme. Wraps around and
  // lands on the first note of the target theme (mirrors handleCategoryChange).
  // Uses a functional update — like `step` — so it reads the live position and
  // rapid presses don't miss on a stale index.
  const stepCategory = useCallback(
    (dir) =>
      setActiveIndex((i) => {
        if (!emotions.length || !themed.length) return i;
        const curLabel = themed[i]?.category;
        const curIdx = Math.max(0, emotions.findIndex((e) => e.label === curLabel));
        const nextEmo = emotions[(curIdx + dir + emotions.length) % emotions.length];
        const target = themed.findIndex((c) => c.category === nextEmo?.label);
        return target >= 0 ? target : i;
      }),
    [emotions, themed]
  );

  // Drives the top nav legend's pressed-key highlight (see DialNavHint). Set on
  // keydown / button press, cleared on keyup / release.
  const [pressedNavKey, setPressedNavKey] = useState(null);
  const runNav = useCallback(
    (id) => {
      if (id === 'esc') onExit?.();
      else if (id === 'left') step(-1);
      else if (id === 'right') step(1);
      else if (id === 'catPrev') stepCategory(-1);
      else if (id === 'catNext') stepCategory(1);
    },
    [onExit, step, stepCategory]
  );
  const handleNavPress = useCallback(
    (id) => {
      setPressedNavKey(id);
      runNav(id);
    },
    [runNav]
  );
  const handleNavRelease = useCallback((id) => {
    setPressedNavKey((cur) => (cur === id ? null : cur));
  }, []);

  // Click empty space to go back: any click that doesn't land on a note card
  // or an interactive control (dial label, nav link, EXIT) dismisses the view.
  // The stack's card taps still navigate and the chrome buttons keep their own
  // handlers — both carry a matching selector so they're excluded here. Gated
  // on `revealed` so a stray click during the entrance morph doesn't bounce the
  // visitor straight back out.
  const handleBackdropClick = useCallback(
    (e) => {
      // As a persistent tab, empty-space clicks must NOT navigate away — the
      // visitor leaves via the nav bar. Only the overlay dismisses on click-out.
      if (standalone || !revealed) return;
      if (e.target.closest('[data-card],[data-vcard],button,a')) return;
      onExit?.();
    },
    [standalone, revealed, onExit]
  );

  useEffect(() => {
    // ← / → (or A / D) flip through notes; ↑ / ↓ (or W / S) step between
    // themes/categories (the vertical theme dial — up = prev, down = next).
    // Both pairs sit in the top legend (see DialNavHint showCategoryKeys).
    const keyToId = {
      Escape: 'esc',
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
      ArrowUp: 'catPrev', w: 'catPrev', W: 'catPrev',
      ArrowDown: 'catNext', s: 'catNext', S: 'catNext',
    };
    const onKeyDown = (e) => {
      const id = keyToId[e.key];
      if (!id) return;
      // Don't hijack the nav keys (or arrows) while typing in a field.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Arrow keys otherwise scroll the page — claim them for note/theme nav.
      if (e.key.startsWith('Arrow')) e.preventDefault();
      setPressedNavKey(id);
      runNav(id);
    };
    const onKeyUp = (e) => {
      const id = keyToId[e.key];
      if (id) setPressedNavKey((cur) => (cur === id ? null : cur));
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [runNav]);

  return (
    <motion.div
      ref={overlayRef}
      onClick={handleBackdropClick}
      // The root itself stays fully opaque during a morph (so the lifting bridge
      // image renders crisp — root opacity would dim it and re-expose the grid as
      // a ghost). It's the *backdrop layer* below that veils in; the root holds no
      // fill of its own. Without a morph the whole overlay still fades in gently.
      //
      // Arriving on a flight it holds too, for the same reason one layer down:
      // the index takes long enough to clear that we mount barely a frame before
      // the words land, and anything still fading here dims the dial they hand
      // off to — the wordmarks and their brackets come up at ~70% and climb,
      // which reads as a blink on the [ ] that were solid a frame earlier.
      // Nothing is lost by cutting: the notes and the counter each own their
      // entrance, and all this layer carries is a near-black gradient.
      initial={reduceMotion || wantMorph || dialHandoff ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      // Lifted out of the grid, the note image is CUT on exit (click-out / Esc
      // / INDEX) — no fade-out. The overlay unmounts on the same frame,
      // revealing the index underneath, whose tiles fade back in on their own
      // (see GRID EXIT in App.jsx). Overriding just the exit transition keeps
      // the gentle entrance fade intact.
      //
      // As the EXPLORE tab there is nothing behind it to reveal, so it clears
      // itself instead: the notes and the dial leave first (each owns its own
      // exit) and this last fade takes the backdrop, vignette and counter with
      // it once they're gone. See the storyboard at the top of the file.
      exit={pageFadeExit(stagedExit)}
      transition={{ duration: reduceMotion ? 0 : 0.3, ease: EASE_OUT }}
      // As a tab, sit beneath the app's fixed nav chrome (z 200) so the
      // INDEX · EXPLORE · DIAL · ABOUT bar stays visible + clickable on top; as
      // an overlay it covers everything (z 800).
      style={standalone ? { ...st.root, zIndex: 1 } : st.root}
    >
      {/* The dark gradient + grain backdrop. During a morph it starts transparent
          and veils in a beat later, so the clicked note lifts off while the index
          dissolves in view behind it; otherwise it's opaque from the start (the
          root's own fade carries the entrance). */}
      <motion.div
        aria-hidden="true"
        style={st.backdrop}
        initial={wantMorph && !reduceMotion ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={
          wantMorph && !reduceMotion
            ? { duration: BACKDROP_VEIL_S, ease: EASE_OUT, delay: BACKDROP_VEIL_DELAY_S }
            : { duration: 0 }
        }
      >
        <TunableGrainBackground opacityScale={isMobile ? 0.28 : undefined} />
      </motion.div>

      {/* Horizontal side-scrolling note stack — the dial page's coverflow
          carousel over all themed notes. Hidden (opacity 0) during the morph so
          only the flying bridge image shows, then fades up to full opacity behind
          the still-opaque bridge; the bridge dissolves into it only once it's fully
          opaque (no crossfade dip — see the hand-off logic above). */}
      <motion.div
        initial={{ opacity: wantMorph ? 0 : 1 }}
        animate={{ opacity: revealed ? 1 : 0 }}
        // First thing to go on the way back to the index — the frame empties
        // from the middle out.
        exit={
          stagedExit
            ? { opacity: 0, transition: { duration: EXPLORE_EXIT.notes, ease: EASE_OUT } }
            : undefined
        }
        transition={{ duration: BRIDGE_FADE_S, ease: EASE_OUT }}
        style={{ ...st.stageArea, pointerEvents: revealed ? 'auto' : 'none' }}
      >
        {isMobile ? (
          <VerticalConfessionStack
            confessions={themed}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            mountEntrance={!reduceMotion}
            entranceDelay={reduceMotion ? 0 : 0.08}
            metaBlockCrossfade
            transcriptInstantWords
          />
        ) : (
          <HorizontalConfessionStack
            confessions={themed}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            mountEntrance={!reduceMotion && !wantMorph}
            entranceDelay={reduceMotion ? 0 : 0.08}
            showInlineCounter={false}
            // The full-screen note view leans harder on the centred note — drop
            // the neighbours much further than the dial page's filmstrip so the
            // background reads as a faint whisper, not a competing row of images.
            inactiveOpacity={STACK_INACTIVE_OPACITY}
            metaBlockCrossfade
            transcriptInstantWords
          />
        )}
      </motion.div>

      {/* Dark edge gradients so notes dissolve into black at the edges they
          slide toward: left/right on desktop's horizontal strip, top/bottom on
          the mobile vertical carousel (matching where prev/next peek). */}
      <div aria-hidden="true" style={isMobile ? st.edgeVignetteV : st.edgeVignette} />

      {/* Theme context washes in once the entrance has landed. Desktop shows the
          left rotary wheel; mobile hides it (no room beside the full-width note)
          and keeps just the note counter (bottom-centre). */}
      {revealed && (
        <>
          {isMobile ? (
            /* Explore tab (standalone): a centered category stepper is the
               phone's stand-in for the desktop rotary dial, with the note
               counter reading the position inside that category directly
               below it.

               The grid-tap overlay gets neither. It has no category frame to
               count within — you tapped a tile in a list that is mostly
               uncategorised — so the counter could only report your place in
               the whole archive, which tells you nothing about the note you
               are reading and puts a second number under one already busy
               bottom edge. The overlay is a reader: BACK, the note, and the
               two chevrons. Desktop is unaffected either way; its counter is
               rendered separately below. */
            standalone ? (
              <>
                {emotions.length > 1 ? (
                  <MobileThemeStepper
                    label={activeLabel}
                    onStep={stepCategory}
                    reduceMotion={reduceMotion}
                    delay={reduceMotion ? 0 : CATEGORY_REVEAL_DELAY_S}
                  />
                ) : null}
                <MobileThemeCaption
                  label={activeLabel}
                  position={position}
                  total={total}
                  reduceMotion={reduceMotion}
                />
              </>
            ) : null
          ) : (
            <LeftThemeDial
              emotions={emotions}
              activeId={activeId}
              onChange={handleCategoryChange}
              onExplore={standalone ? undefined : onExplore}
              reduceMotion={reduceMotion}
              delay={reduceMotion ? 0 : CATEGORY_REVEAL_DELAY_S}
              hidden={dialHidden}
              handoff={dialHandoff}
              registerSlot={registerDialSlot}
              exitLeft={stagedExit}
            />
          )}

          {/* Desktop: the active note's "n / total" position, pinned to the
              bottom-centre of the screen (mobile already has its own counter in
              MobileThemeCaption). Updates live as you scroll between notes.

              Portaled to <body> as the EXPLORE tab, because the archive pins a
              black edge wash across the bottom of the screen at z 150 and this
              tab's root sits at z 1 — inside that stacking context no z-index
              can climb over the wash, so the counter was reading through it.
              At <body> it stacks against the wash directly (D_COUNTER_Z), and
              carries the page fade itself since the root's exit can no longer
              reach it. As the grid-click overlay the root is already above the
              wash, so that path stays exactly where it was. */}
          {!isMobile && total > 1
            ? (() => {
                const counter = (
                  <motion.div
                    key="explore-note-counter"
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={standalone ? pageFadeExit(stagedExit) : undefined}
                    transition={{
                      duration: reduceMotion ? 0 : 0.4,
                      ease: EASE_OUT,
                      delay: reduceMotion ? 0 : 0.12,
                    }}
                    style={st.dCounterWrap}
                  >
                    <div
                      style={st.dCounter}
                      aria-label={`Note ${position} of ${total} in this category`}
                    >
                      <span style={st.dCounterCurrent}>{String(position).padStart(2, '0')}</span>
                      <span style={st.dCounterTotal}>{` / ${String(total).padStart(2, '0')}`}</span>
                    </div>
                  </motion.div>
                );
                return standalone ? createPortal(counter, document.body) : counter;
              })()
            : null}

          {/* Mobile up/down chevrons (vertical carousel — up = previous note,
              down = next). Overlay only: on the standalone EXPLORE tab the top
              strip belongs to the theme chips, and note-stepping is by vertical
              swipe / tapping the dimmed prev-next peeks, so the chevrons would
              only crowd the chips + meta.

              The up chevron rides the BACK line rather than sitting on a row of
              its own underneath it — see M_NAV_ROW_TOP. Both chevrons stay
              centred on the screen's vertical axis, which is what makes them
              read as one pair pointing through the note rather than as two
              unrelated buttons. */}
          {isMobile && !standalone && total > 1 ? (
            <>
              <NavGrainFilter id={MOBILE_NAV_GRAIN_ID} reduceMotion={reduceMotion} />
              <button
                type="button"
                aria-label="Previous note"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                style={st.mobileNavBtnUp}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ position: 'relative', zIndex: 1, filter: `url(#${MOBILE_NAV_GRAIN_ID})` }}
                >
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Next note"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                style={st.mobileNavBtnDown}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ position: 'relative', zIndex: 1, filter: `url(#${MOBILE_NAV_GRAIN_ID})` }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </>
          ) : null}

          {/* Top-centre keyboard legend (desktop) — EXIT (Esc) apart from the
              LEFT / RIGHT (← / →) note-step pair. Same guide the dial page shows;
              here EXIT returns to the index. Pinned to the top of the view (the
              dial-page variant sits above its note area, which would be off-screen
              over this full-screen stage — so it's flowed into a top-centred wrap). */}
          {!isMobile && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.4, ease: EASE_OUT, delay: reduceMotion ? 0 : 0.04 }}
              style={st.navHintWrap}
            >
              <DialNavHint
                pressedKey={pressedNavKey}
                onPress={handleNavPress}
                onRelease={handleNavRelease}
                style={st.navHintInner}
                grainArrows
                showExit={false}
                showCategoryKeys={emotions.length > 1}
              />
            </motion.div>
          )}

          {/* BACK to the index — only for the grid-click OVERLAY, which the index
              only ever opens on a phone (a pointer gets the Lightbox instead), and
              which covers the site's own nav bar. So this is the whole of the
              chrome: the one thing being asked for here is the way back to the
              tile you tapped. As the EXPLORE tab the nav bar shows through
              instead, and its INDEX does the same job. */}
          {!standalone && (
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: st.mobileBack.opacity }}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: reduceMotion ? 0 : 0.04 }}
              aria-label="Back to index"
              onClick={(e) => {
                e.stopPropagation();
                onIndex?.();
              }}
              style={st.mobileBack}
            >
              BACK
            </motion.button>
          )}
        </>
      )}

      {/* Shared-element bridge: the clicked grid image, flown + scaled from its
          tile onto the centered card, then faded out as the real card fades in.
          Starts pinned exactly over the grid image so it reads as one element. */}
      {showBridge && (
        <>
          {/* Same paper-warp + grain the grid tiles wear, so the lifted image is
              identical to the clicked note (own id → no collision with the grid's). */}
          <NoiseDisplaceFilter id={BRIDGE_FILTER_ID} animate={!reduceMotion} />
          <img
            ref={bridgeScope}
            src={confession.image}
            alt=""
            draggable={false}
            style={{ ...st.bridge, filter: BRIDGE_FILTER }}
          />
        </>
      )}
    </motion.div>
  );
}

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

/* Phone explore chrome, measured up from the screen edge: the note counter, with
   the category stepper directly above it. Held well clear of the bottom so
   neither sits under the scroll indicator or a phone's home bar. */
const M_COUNTER_BOTTOM = 76;
const M_STEPPER_GAP = 30; // counter line → stepper

/* Phone overlay chrome, top row. BACK and the ˄ (previous note) chevron share
   one line. The chevron used to sit on its own row below BACK, which spent a
   whole band of the screen on a single glyph and pushed the note down for it;
   there is nothing else on that line, so the two can share it without either
   crowding the other (BACK ends around x=70, the chevron is centred).

   The chevron stays a full 44px target and stays CENTRED rather than tucking in
   beside BACK: it is one of a pair with the ˅ at the bottom, and the two only
   read as prev/next through the note while they sit on the same vertical axis.
   Pulled left against BACK it would read as part of the back control instead. */
const M_CHROME_INSET = 24; // px — matches the index nav's own edge inset
const M_BACK_LINE = 28; //    px — NAV_LINK: 16px text at 1.5, plus 2px padding
const M_NAV_BTN = 44; //      px — chevron hit area (thumb-sized floor)
/* Chevron top that lands its 44px box's centre on the BACK line's centre, so
   the glyph is optically on the row however the two boxes differ in height. */
const M_NAV_ROW_TOP = M_CHROME_INSET + M_BACK_LINE / 2 - M_NAV_BTN / 2;

/* Text-link chrome, mirroring the index nav's ABOUT button: ARCHIVE_NAV_TEXT
   (mono, bodySmall 16px, no letter-spacing, white) under the site's dotted
   underline. Callers set their own resting opacity. */
const NAV_LINK = {
  background: 'none',
  border: 'none',
  padding: '2px 4px',
  fontFamily: MONO,
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: '0',
  color: '#CFCAB7',
  cursor: 'pointer',
  transition: 'opacity 0.2s ease',
  WebkitTapHighlightColor: 'transparent',
  ...LINK_UNDERLINE,
};

const st = {
  root: {
    position: 'fixed',
    inset: 0,
    zIndex: 800,
    overflow: 'hidden',
    // No fill of its own — the veil-in backdrop layer below owns the black
    // gradient, so during the entrance morph the dissolving index shows through
    // the (still fully opaque) root until the backdrop covers it.
  },
  backdrop: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
    // The design's black gradient: charcoal centre → pure black at the edges
    // (shared `NOISE_GRADIENT`). `#010000` fallback keeps it black if the
    // gradient can't paint.
    background: '#010000',
    backgroundImage: NOISE_GRADIENT,
  },
  stageArea: {
    // The scrolling stack fills the viewport; its own paddingLeft/Right centre
    // the active card at 50%, so the note sits dead-centre with the left dial
    // overlaid on top and the neighbours sliding out toward the edges.
    position: 'absolute',
    inset: 0,
    zIndex: 1,
  },
  edgeVignette: {
    position: 'absolute',
    inset: 0,
    zIndex: 5,
    pointerEvents: 'none',
    background:
      'linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 7%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 78%, rgba(0,0,0,0.6) 93%, rgba(0,0,0,0.92) 100%)',
  },
  // Mobile: fade top/bottom into black so the peeking prev/next notes dissolve
  // at the edges they slide toward (the vertical analogue of edgeVignette).
  edgeVignetteV: {
    position: 'absolute',
    inset: 0,
    zIndex: 5,
    pointerEvents: 'none',
    // Very short fade (outer ~5%): darkens only the extreme top/bottom lip so
    // the peeking prev/next notes stay legible — a longer fade swallows the
    // whole peek on shorter viewports.
    background:
      'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 5%, rgba(0,0,0,0) 95%, rgba(0,0,0,0.9) 100%)',
  },

  // Shared-element bridge image. Fixed to the viewport; box + transform written
  // from JS (starts pinned over the clicked grid image, animates to the centered
  // card). Hidden until positioned so there's no first-frame flash.
  bridge: {
    position: 'fixed',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    opacity: 0,
    objectFit: 'contain',
    zIndex: 950,
    pointerEvents: 'none',
    willChange: 'transform, opacity',
  },

  // Top-centre keyboard legend wrap. Full-width flex row so the legend centres
  // over the note; pointer-events none so it never eats a backdrop click (the
  // legend's own buttons re-enable pointer events for themselves).
  navHintWrap: {
    position: 'absolute',
    top: 24,
    left: 0,
    right: 0,
    zIndex: 40,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  // Override DialNavHint's dial-page positioning (absolute, pinned above the note
  // area): flow it statically inside the centred wrap so it sits at the top here.
  navHintInner: {
    position: 'static',
    bottom: 'auto',
    left: 'auto',
    transform: 'none',
  },

  // Mobile: fixed up/down chevrons (grain-filtered) for the vertical carousel.
  // Up sits top-centre ON the BACK line (M_NAV_ROW_TOP); down sits
  // bottom-centre, now the only thing on that edge since the overlay dropped
  // its note counter. No top A/D legend.
  mobileNavBtnUp: {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    top: M_NAV_ROW_TOP,
    zIndex: 45,
    width: M_NAV_BTN,
    height: M_NAV_BTN,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    borderRadius: '50%',
    background: 'transparent',
    color: '#CFCAB7',
    opacity: 0.85,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  mobileNavBtnDown: {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: 'max(72px, 9vh)',
    zIndex: 45,
    width: M_NAV_BTN,
    height: M_NAV_BTN,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    borderRadius: '50%',
    background: 'transparent',
    color: '#CFCAB7',
    opacity: 0.85,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },

  // The overlay's only chrome, at the same inset the index nav keeps. Sits a
  // little stronger than a resting nav link: it covers the site's nav bar, so
  // this is the only way out that isn't a gesture, and a phone has no hover to
  // find it with.
  mobileBack: {
    ...NAV_LINK,
    position: 'absolute',
    top: M_CHROME_INSET,
    left: M_CHROME_INSET,
    zIndex: 40,
    opacity: 0.72,
  },

  // Left rotary dial — a full-height positioning context on the left edge; the
  // wheel's slots + counter are absolutely placed relative to it.
  dialColumn: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 420,
    zIndex: 20,
    pointerEvents: 'none',
  },
  // Dashed spokes — one per theme, fanning out from the wheel's pivot. A
  // full-height layer holds them; each spoke reuses the label's `slot` anchor
  // (same left/top + motion transform) so it tracks its wordmark on the arc.
  dialSpokeLayer: {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
    pointerEvents: 'none',
  },
  // The hairline itself: pinned to the slot anchor's vertical centre, its right
  // edge held `right` px left of the anchor (just past the word) and running
  // `width` px further inward toward the pivot. Rotates with the parent slot.
  dialSpokeLine: {
    position: 'absolute',
    top: 0,
    borderTop: '1px dashed rgba(207, 202, 183, 0.35)',
  },
  // One wheel label. A 0-size anchor at (baseX, vertical centre); motion writes
  // the arc translate + rotate. The inner word centres itself on the anchor.
  slot: {
    position: 'absolute',
    left: WHEEL.baseX,
    top: '50%',
    willChange: 'transform, opacity',
  },
  slotButton: {
    position: 'absolute',
    left: 0,
    top: 0,
    transform: 'translate(-50%, -50%)',
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    cursor: 'pointer',
    pointerEvents: 'auto',
    whiteSpace: 'nowrap',
  },
  slotStatic: {
    position: 'absolute',
    left: 0,
    top: 0,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
  // Wordmark: letter-spaced Courier — one <span> per glyph so the gap between
  // glyphs is even and real spaces widen (matches the Figma wordmark spacing).
  word: {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: `${WHEEL.gapEm}em`,
    fontFamily: MONO,
    fontSize: WHEEL.labelFont,
    lineHeight: 1,
    color: '#e2e2e2',
    whiteSpace: 'nowrap',
    // Categories render all-caps to match the dial + wordmark style elsewhere.
    textTransform: 'uppercase',
  },

  // "03 / 06" category position, sat above the active wordmark. Shares the
  // wheel's baseX so it stays centred over the active label (which parks at the
  // slot anchor, since wheelSlot(0) is a zero translate), then lifts clear of the
  // labelFont-tall word plus a little breathing room. Smaller than the bottom note
  // counter — it's an orienting detail, not the headline.
  dialCatCount: {
    position: 'absolute',
    left: WHEEL.baseX,
    top: '50%',
    transform: `translate(-50%, calc(-50% - ${WHEEL.labelFont + 10}px))`,
    zIndex: 3,
    pointerEvents: 'none',
    fontFamily: '"Courier New", Courier, var(--font-mono, ui-monospace, monospace)',
    fontSize: 11,
    letterSpacing: '0.14em',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },

  // Cursor-following category definition tooltip (portaled to <body>).
  catTip: {
    position: 'fixed',
    zIndex: 3000,
    maxWidth: 300,
    pointerEvents: 'none',
    padding: '10px 12px',
    background: 'rgba(10, 10, 12, 0.94)',
    border: '1px solid rgba(207, 202, 183, 0.18)',
    borderRadius: 4,
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
  },
  catTipBody: {
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 1.5,
    letterSpacing: '0.01em',
    color: 'rgba(207, 202, 183, 0.85)',
  },

  // ── Mobile theme caption ──────────────────────────────────
  // Bottom-centre: the NN/MM note counter.
  mCounterWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: M_COUNTER_BOTTOM,
    zIndex: 20,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  mCounter: {
    fontFamily: MONO,
    fontStyle: 'italic',
    fontSize: 16,
    letterSpacing: '-0.02em',
    color: 'rgba(207,202,183,0.58)',
  },

  // ── Mobile theme stepper ──────────────────────────────────
  // Centered category feature flanked by grain-filtered ‹ / › arrows, docked
  // directly above the note counter: which category you're in and how far
  // through it you are read as one block, and the top of the screen is left to
  // the note itself. The wrap ignores pointer events so only the arrows are
  // tappable — the empty gutter around the note stays swipeable.
  mStepperWrap: {
    position: 'fixed',
    bottom: M_COUNTER_BOTTOM + M_STEPPER_GAP,
    left: 0,
    right: 0,
    zIndex: 46,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    pointerEvents: 'none',
  },
  mStepperArrow: {
    pointerEvents: 'auto',
    flex: '0 0 auto',
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    borderRadius: '50%',
    background: 'transparent',
    color: '#CFCAB7',
    opacity: 0.85,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  // Fixed measure + clip so the flanking arrows hold position while the
  // category name crossfades between labels of different lengths.
  mStepperLabelClip: {
    position: 'relative',
    width: 'min(60vw, 260px)',
    height: 22,
    overflow: 'hidden',
  },
  mStepperLabel: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: MONO,
    fontSize: 13,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'rgba(207,202,183,0.92)',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  },

  // ── Desktop bottom-centre note counter ────────────────────
  // The active note's "n / total" position within its category, pinned to the
  // bottom of the screen (relocated out from under the transcript). Above both
  // things that darken that strip: this view's edge vignette (z 5) and the
  // archive's bottom edge wash (z 150), which it clears by being portaled to
  // <body> on the EXPLORE tab — see where it's rendered. Under the nav chrome
  // (z 200), which still owns anything it overlaps.
  // `fixed` rather than `absolute` so the geometry is the same either side of
  // that portal: the root it used to sit in is itself a fixed inset-0 box.
  dCounterWrap: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 'clamp(18px, 3.6vh, 34px)',
    zIndex: 160,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  dCounter: {
    fontFamily: '"Courier New", Courier, var(--font-mono, ui-monospace, monospace)',
    fontSize: 14,
    letterSpacing: '0.12em',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  dCounterCurrent: { color: 'rgba(207,202,183,0.85)' },
  dCounterTotal: { color: 'rgba(207,202,183,0.42)' },
};
