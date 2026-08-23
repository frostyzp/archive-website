import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, cubicBezier, motion, motionValue, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { INK, inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * GRID HAND-OFF LAB  —  /entrance?tab=handoff
 *
 * A bench for the seam between the end of the onboarding and the top of the
 * INDEX. Today that seam is two movements that merely overlap in time: the
 * closing beat's prints disperse radially off the edges of the screen, and a
 * beat later the grid flies its tiles in from whichever edge each one happens
 * to be nearest. The reader is shown paper leaving in every direction and then
 * different paper arriving from every direction, and reads the second as a
 * separate event — the archive announcing itself rather than the story handing
 * over to it.
 *
 * What is being tried instead: the wall arrives from one place, low and in the
 * middle, the way the prints were dealt up from under the screen in the first
 * place; and the prints the reader has actually been looking at do not leave at
 * all — they become the grid cells that hold those same notes.
 *
 * THE SCENE
 *
 *   idle       the closing beat as it stands. The booth, three prints on their
 *      ↓       real resting places, and a line under them. The mock grid is
 *      ↓       laid out full size underneath and drawn at zero opacity, so
 *      ↓       every destination cell can be measured before anything moves.
 *   fired      swipe up · space · the ENTER control
 *      ↓
 *   launch     pre-paint, inside a LAYOUT effect: every participating tile is
 *      ↓       written to its launch transform. For the wall that is a point
 *      ↓       low in the middle of the screen; for a hand-off print it is the
 *      ↓       transform that superimposes the tile on the print it is
 *      ↓       standing in for, measured on the frame the gesture landed.
 *   flying     each tile runs a bowed route back to its own place, staggered
 *      ↓       row by row, the order the archive's own entrance uses today —
 *      ↓       the geometry is what has changed, not the cascade. Ordering by
 *      ↓       distance from the origin instead is on the panel.
 *   settled    the wall at rest
 *
 * THE CANDIDATES  (keys 1–3, or the strip under the title)
 *
 *   fountain  Every tile launches from one point at the bottom middle and fans
 *             out to its cell. The plain reading of the request, and the one
 *             worth having on the bench precisely because it is plain: no FLIP,
 *             no hand-off, the prints still disperse the way they do today. It
 *             answers "do the notes want to come from one place" on its own,
 *             before the harder question of whether they can be the same notes.
 *
 *   handoff   The continuous version, and the one the designer picked. The
 *             three prints are not thrown away: each one's grid cell starts the
 *             flight sitting exactly on top of it, at its size and its tilt, on
 *             the same frame the print is removed — so the paper the reader was
 *             reading travels to its place in the archive. The rest of the wall
 *             rises from the bottom middle behind them. Nothing crossfades,
 *             nothing is cloned, and there is no bridge element to hand over to:
 *             the tile IS the print, from the first frame.
 *
 *   spout     Same single origin, but the tiles hold a narrow column on the way
 *             up and only spread once they are level with the wall. Where the
 *             fountain opens immediately and reads as a fan, this reads as one
 *             source pushing paper up through a slot. Kept on the bench because
 *             the fan's outermost tiles travel almost sideways, and sideways
 *             travel is the thing the current entrance was criticised for.
 *
 * Every number is on the "Grid Hand-off" DialKit panel (append ?dial=1); a dial
 * is read at launch and not while a flight is in the air, so nudge it and press
 * R. ?slow=8 stretches the whole thing so the arc can be read frame by frame.
 * ───────────────────────────────────────────────────────────────────── */

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const SERIF = "'Faktory', Georgia, serif";

/* The curves on offer, named for what they feel like rather than for their
   polynomial. `grid` is the entrance's own ease today and is the default, so a
   candidate is judged on where the tiles come from and not on a curve change
   smuggled in alongside it; `throw` is the beat's paper curve, which spends
   almost all of its distance at once and is worth trying on a wall that is
   supposed to have been thrown; `settle` and `even` are the long-tailed and the
   symmetric readings. */
const EASES = {
  grid: [0.17, 0.84, 0.44, 1],
  throw: [0.08, 0.82, 0.17, 1],
  settle: [0.16, 1, 0.3, 1],
  even: [0.45, 0, 0.55, 1],
};

/* Slow motion: /entrance?tab=handoff&slow=8 stretches every duration, stagger
   and delay by the same factor, so the shape of a flight can be read frame by
   frame without any part of the choreography sliding out of order against the
   rest. Transcribed from the bench's own switch in NoteEntranceLab. */
const SLOW = (() => {
  if (typeof window === 'undefined') return 1;
  const v = Number(new URLSearchParams(window.location.search).get('slow'));
  return Number.isFinite(v) && v > 1 ? Math.min(v, 40) : 1;
})();

const noteSrc = (id) => `/confession_notes_2/${id}.webp`;

/* ── The closing beat, transcribed ──────────────────────────────────────
 *
 * These are copied out of OnboardingBeats rather than imported, because that
 * file exports none of them and this pass is not allowed to touch it. They are
 * copied rather than approximated on purpose: the whole question the lab is
 * asking is whether a print can turn into a grid cell without a seam, and the
 * answer is worthless if the print is not sitting where the real beat leaves
 * it. If the beat's own layout is ever retuned, these go stale — which is the
 * price of a lab that cannot edit the thing it is studying.
 * ─────────────────────────────────────────────────────────────────────── */

const CARD = { w: 520, h: 460 };
const PILE = { w: 700, h: 625, maxFit: 1.15 };
const BODY_TYPE = { minPx: 20, vw: 2.9, maxPx: 33 };
const COPY = { gapPx: 26, perFontPx: 8.4, tailPx: 24, bottomAirPx: 24 };

const bodyFontPx = (vw) =>
  Math.min(BODY_TYPE.maxPx, Math.max(BODY_TYPE.minPx, (vw * BODY_TYPE.vw) / 100));
const copySlotH = (vw) => Math.round(bodyFontPx(vw) * COPY.perFontPx) + COPY.tailPx;

/** Where the four photographs of the closing beat lie. Index 0 is the booth. */
const DEAL_SLOTS = [
  { x: 0, y: 0, rotate: -5, scale: 0.7 },
  { x: -48, y: -14, rotate: 3.5, scale: 0.94 },
  { x: 0, y: 8, rotate: -4.5, scale: 0.97 },
  { x: 48, y: 18, rotate: 7, scale: 1 },
];

/* The pile as the reader reaches the last beat: the establishing photograph of
   the booth in Dolores Park, and the three confessions the story walked
   through. The three are real archive notes, and that is the fact the hand-off
   is built on — a print can only become a grid cell if the archive has a cell
   for it. */
const PRINTS = [
  { key: 'booth', src: '/intro-booth-park.webp', widthMul: 0.98 },
  { key: 'AC_171', noteId: 'AC_171', src: noteSrc('AC_171'), widthMul: 1 },
  { key: 'AC_148', noteId: 'AC_148', src: noteSrc('AC_148'), widthMul: 1 },
  { key: 'AC_185', noteId: 'AC_185', src: noteSrc('AC_185'), widthMul: 1 },
];

/* A stand-in for the closing beat's last line. The words are not the study, but
   the slot they sit in is: the pile is anchored above a reservation the height
   of the longest beat's copy, so a lab with no copy in it would float the
   prints half a slot lower than the real beat does and every measurement taken
   off them would be off by that much. */
const CLOSING_LINE = 'Every note is a real story from a real person. Explore the stories.';

/* ── The mock archive ───────────────────────────────────────────────────
 *
 * Twelve cells at three columns, which is the INDEX's own widest layout. The
 * real GridView renders 165 of these plus a typed lattice and would spend the
 * bench's whole frame budget on the thing that is not being studied; twelve is
 * enough for a wall to have a shape, for the stagger to be legible, and for the
 * three hand-off notes to be far enough apart that each one's flight goes
 * somewhere different.
 * ─────────────────────────────────────────────────────────────────────── */

const GRID = {
  cols: 3,
  rows: 4,
  marginPx: 28, //   air between the wall and the edges of the window
  minCell: 84,
  maxCell: 208, //   past this a twelve-cell wall reads as a poster rather than
  //                 as the top of an archive, and the flights get so long that
  //                 the stagger has to be retuned to say anything
  padFrac: 0.11, //  the cell's own padding, as a share of it — the note is
  //                 contained inside the square, never sized to fill it
  headerPx: 208, //  the bench's title, hint line and variant strip
};

/* The wall. The three pile notes are seeded at 1, 6 and 11 — one near the top,
   one out to the left half way down, one in the far corner — so the hand-off is
   watched travelling three clearly different distances in three clearly
   different directions rather than three variations on "up a bit". */
const WALL = [
  'AC_006',
  'AC_171',
  'AC_063',
  'AC_141',
  'AC_017',
  'AC_092',
  'AC_148',
  'AC_120',
  'AC_012',
  'AC_133',
  'AC_057',
  'AC_185',
];

const HANDOFF_IDS = new Set(PRINTS.filter((p) => p.noteId).map((p) => p.noteId));

/* ── The flight ─────────────────────────────────────────────────────────── */

const LAUNCH = {
  /* Where the wall comes from, as fractions of the window, so the origin can be
     moved off dead centre without being retuned for every screen size.
   *
     y sits below the bottom edge rather than on it. On the edge exactly, a tile
     at launch scale still has half of itself above the line, so the first frame
     of the entrance is a huddle of small notes stacked on the bottom of the
     screen — which reads as a drawer being opened, and worse, reads as a
     SECOND pile appearing moments after the first one left. Eight percent under
     is enough that every tile is already travelling by the time it crosses into
     view, and the origin is inferred from the paths rather than seen. */
  originX: 0.5,
  originY: 1.08,
  /* How far each tile starts along its own route rather than at the shared
     point, 0 being the point exactly.
   *
     Tight, so that the origin stays a point rather than becoming a mouth. Past
     about 0.3 the bottom row leaves from noticeably outside the middle and the
     single source stops being the thing you read. The reason it can be held this
     low is the launch scale below: tiles leaving at print size are far too large
     to be lost in each other, so the spread does not have to buy their
     legibility the way it would for a launch that started small. What it buys
     instead is a heap rather than a stack. */
  spread: 0.1,
  /* The same thing for the horizontal alone, so the sideways distance can be
     cut without shortening the rise — which `spread` cannot do, since it pulls
     both axes back toward the origin together and a wall that starts halfway up
     the screen has stopped coming from under it.
   *
     Read as a floor under `spread` rather than instead of it, so 0 is simply
     off: the horizontal falls back to the shared value and the launch is the
     point it was before. That was 153px of sideways travel against 537px of rise
     for an outer tile at 1440×900 — not far, but it arrives late, because the
     outer tiles are also the ones with the longest route and the ease-out spends
     its last third barely moving. This starts each tile
     halfway out toward its own column, which halves that. It is as far as this
     can sensibly go: past here the tiles leave from visibly under their own
     columns and the low middle stops being a source at all, becoming a line the
     wall rises off. Half is the point where the launch still gathers toward the
     middle while no tile has much sideways left to spend. */
  spreadX: 0.5,
  /* Launch size, × the tile's own — so 1 is a tile leaving at the size it will
     land at, and this is well over three of them.
   *
     Three quarters of the size the prints themselves are. Print size is a
     multiple of 3: measured at 1440×900 the three scans stand 432–463px wide, and
     a settled wall note is 140–150px of rendered image inside its cell — not the
     cell's own 125px, since these scans are not square and each one is fitted
     inside its box. At that full multiple the wall launched as paper the same size
     as the prints, which put nine sheets the size of the thing being handed over
     on the screen at once and left the prints with nothing distinguishing them
     but their z-order. Backing the wall off to three quarters keeps it obviously
     the same stock while letting the three prints stay the largest paper in the
     frame, which is the only thing marking them as the notes the reader was
     actually holding. The
     hand-off cells already leave at their own print's exact ratio, because theirs
     is measured rather than chosen, and the wall now leaves at the same size — so
     what launches is a heap of full-size notes, the pile the reader has been
     looking at all along, and the archive resolves out of it by shrinking rather
     than by arriving. Held as a plain multiple rather than derived from the
     measured prints so that this dial stays the only place the number lives; it
     is worth re-reading if the grid's column count or the beat's print scale
     changes, since the ratio between them is what it is really describing. */
  scale: 2.25,
  /* deg of tilt at launch, leaned toward the side the tile is heading for and
     unwound on the way in. Enough to read as paper being turned rather than
     slid: in single figures the tilt is lost under the travel. It reads as more
     than this now that the tiles launch at print size, since the same angle on a
     bigger sheet throws its corners much further — worth re-reading against the
     launch scale rather than on its own. It has to unwind completely before the
     tile lands: these are square cells in a lattice, and any of it left over
     reads as the grid straightening itself up. */
  rotate: 24,
};

const FLIGHT = {
  durS: 0.82, //     s — one tile's whole journey. A touch longer than the
  //                 current entrance's 0.8, because these tiles cover most of
  //                 the screen instead of stepping in from the nearest edge.
  staggerS: 0.042, //s — between one tile leaving and the next. Today's number
  //                 is 0.075 across a whole screenful of tiles, which at twelve
  //                 tiles would spend 0.9s dealing them out and turn the wall
  //                 into a queue. Roughly half of it keeps the cascade
  //                 countable while letting the wall land as one movement.
  /* How far the route bows off the straight line, as a share of the distance
     the tile is covering. Proportional rather than absolute: a tile going to
     the far corner and a tile going to the middle of the bottom row would
     otherwise take the same sideways detour, and on the short one that detour is
     most of the journey. Positive bows outward, away from the origin's column,
     so the fan opens as it rises; negative bows the other way, in across the
     middle, so a tile leans toward the centre before swinging out to its cell.
   *
     Off, which is where this landed and what shipped in App's GRID_RISE: on this
     geometry the dial does not buy an arc, it buys sideways travel. The bow is
     displaced perpendicular to the route, and since a tile rising out of the
     bottom middle is travelling nearly straight up, "perpendicular" is nearly all
     horizontal. Both ends of the range were tried and both were rejected for the
     same reason. Inward at -0.8 it bulged each route 209px off its own line, 37%
     of that route's length, with the tiles covering 300–420px sideways to net
     16–57px — they traded sides and crossed each other, at print size by more than
     their own width. Outward at 0.18 was milder but doubled tiles back: the ones
     nearest the origin's column went 46–62px sideways to net 11–21px, and because
     the ease-out spends its last third barely moving, the return read as a slide
     into place after the flight had finished. The range is kept wide either side
     because seeing both failures is the argument for zero. */
  bow: 0,
  /* Points the bowed route is sampled into. Each hop between samples is
     travelled at one rate, so too few and the tile is seen to change speed on
     the sample boundaries; 32 is where OnboardingBeats' own exit measured the
     sampling as no longer being the thing you would notice, and this route is
     shorter and slower than that one. */
  samples: 32,
};

const SPOUT = {
  /* How much of the climb is made inside the narrow column before the tile
     peels off toward its cell. At 1 the route leaves the origin dead vertical
     and arrives dead horizontal, which is the strongest reading of "one source"
     and also the one that makes the top row travel a visible right angle. This
     is high enough that the column is unmistakable and low enough that the turn
     is a curve rather than a corner. */
  columnRise: 0.8,
  /* px of sideways lean given to the column itself, alternating with the side
     the tile is bound for. A perfectly straight shared column stacks twelve
     tiles on one line for the first third of the flight and they occlude each
     other into a single flickering shape; this is the least that keeps them
     countable while still reading as one column. */
  lateralPx: 34,
};

const HANDOFF = {
  /* s between one print leaving and the next, in the order they were dealt.
     Wider than the exit's own 0 / 100 / 180ms queue, and wider than it needs to
     be to avoid three prints leaving on the same frame — because the reader has
     been shown these as three separate confessions, and filing them one at a
     time says that, where any tighter pace says the pile is coming apart. The
     price is that the third print does not move until nearly three tenths of a
     second after the gesture, which is about as long as a hand-off can wait and
     still read as answering the hand. */
  printStaggerS: 0.14,
  /* s — a print's own journey to its cell. Longer than the wall's, because the
     print is the thing being followed: it is large, it is the paper that was
     just being read, and it is crossing most of the screen. A print that beats
     the wall home reads as having been flicked away. */
  printDurS: 1.12,
  /* The print's route is bowed less than the wall's. A print starts big and
     ends small, so the same proportional bow that reads as a fan on a small
     tile reads on this one as the paper being swept aside — and the one thing
     the hand-off cannot afford is for the print to look like it is being moved
     BY something rather than travelling. */
  printBow: 0.07,
  /* s — when the wall starts, relative to the first print. Slightly behind, so
     the eye is given the prints first and finds the wall arriving underneath
     them rather than the two competing from the same frame. Negative sends the
     wall first, which is worth being able to try: it makes the prints look like
     they are landing into a wall that was already there. */
  wallLeadS: 0.08,
};

/* ── The exit, for the two candidates that keep one ─────────────────────
 *
 * Transcribed from OnboardingBeats' DISPERSE, in the same spirit as the beat
 * geometry above: fountain and spout are being judged against the exit they
 * would actually ship next to. The bow and the eased sampling of the real thing
 * are left out — the exit is the control here, not the study, and a straight
 * radial throw is within a few pixels of it over the third of the flight that
 * is on screen.
 * ─────────────────────────────────────────────────────────────────────── */

const EXIT = {
  /* Leaving is not throwing: the beat's own paper curve spends nearly all of
     its distance at once, which on the way out reads as the pile being snatched
     away rather than let go of. This is the ordinary ease-out it uses instead,
     so the movement is still decelerating while it is in frame. */
  ease: [0.22, 0.61, 0.36, 1],
  boothFadeS: 0.44, // the booth is put down where it lies, not thrown
  queueS: [0, 0.1, 0.18], // when each note goes, s after the gesture
  flyS: 0.92,
  travel: 1500, //    stage units — clears any viewport once scaled
  lift: 1.7, //       how far the outward fan is tilted up
  spin: 44, //        deg of tumble
  shrink: 0.95, //    × resting scale, so the note recedes rather than slides
  /* s between the gesture and the grid being asked for. The real transition
     computes 0.62 for this — the last note's queue (0.18) plus the point in its
     flight where it is off the screen (0.3) plus the empty beat that follows
     (0.14) — and this sits just inside it, so the wall starts while the outermost
     print is still crossing the edge rather than after it has gone. It is a dial
     at all because it is exactly the number a hand-off makes meaningless: the
     prints stop being a cue to wait on when they are the thing arriving. */
  handOverS: 0.5,
};

/* ── Geometry helpers ───────────────────────────────────────────────────── */

/**
 * A quadratic route from a launch offset back to the tile's own place, sampled
 * into keyframes.
 *
 * Sampled rather than curved because there is no path to hand a transform: x
 * and y animate independently, and any two single values describe a straight
 * line between them however they are eased. Sampling at the EASED progress and
 * then playing the samples back linearly puts the easing in the spacing of the
 * points rather than in the playback, which is what keeps the bend from costing
 * the flight its pacing. The route ends at (0, 0) — the tile's own transform
 * identity — so the final term of the Bezier drops out.
 */
function routeKeyframes({ sx, sy, cx, cy, easeFn }) {
  const xs = [];
  const ys = [];
  const times = [];
  for (let i = 0; i <= FLIGHT.samples; i++) {
    const t = i / FLIGHT.samples;
    const p = easeFn(t);
    const q = 1 - p;
    xs.push(q * q * sx + 2 * q * p * cx);
    ys.push(q * q * sy + 2 * q * p * cy);
    times.push(t);
  }
  return { xs, ys, times };
}

/**
 * Per-row reveal order, transcribed from App's gridColumnOrder so the row-by-row
 * ordering mode on the dial is the ordering the entrance actually ships with
 * rather than a plain left-to-right march standing in for it.
 */
function gridColumnOrder(cols, parity) {
  if (cols === 3) return parity === 0 ? [0, 2, 1] : [1, 0, 2];
  if (cols === 2) return parity === 0 ? [0, 1] : [1, 0];
  return Array.from({ length: cols }, (_, i) => i);
}

/**
 * The order the wall is dealt in, as a rank per tile.
 *
 * `distance` is the ordering the candidates are built around: the wall opens
 * outward from the point it is coming from, so the stagger and the geometry
 * say the same thing. `row` is what ships today — rows top to bottom with the
 * columns alternating — and it is here to be switched to mid-study, because on
 * a wall launched from one point a row-ordered stagger is the clearest possible
 * demonstration that a cascade can fight its own paths: the far corner leaves
 * before the tile directly above the origin does.
 */
function launchRanks({ homes, origin, mode, cols }) {
  const ranks = new Array(homes.length).fill(0);
  if (mode === 'row') {
    let n = 0;
    for (let row = 0; row * cols < homes.length; row++) {
      gridColumnOrder(cols, row % 2).forEach((col) => {
        const i = row * cols + col;
        if (i < homes.length) ranks[i] = n++;
      });
    }
    return ranks;
  }
  homes
    .map((h, i) => ({ i, d: Math.hypot(h.cx - origin.x, h.cy - origin.y) }))
    .sort((a, b) => a.d - b.d)
    .forEach((t, n) => {
      ranks[t.i] = n;
    });
  return ranks;
}

const VARIANTS = ['fountain', 'handoff', 'spout'];
const VARIANT_LABEL = {
  fountain: 'Fountain',
  handoff: 'Hand-off',
  spout: 'Spout',
};
const VARIANT_HINT = {
  fountain: 'every tile fans out from one point at the bottom middle',
  handoff: 'the prints become their own grid cells; the wall rises behind them',
  spout: 'a narrow column first, spreading only near the top',
};

/* ── The wall ───────────────────────────────────────────────────────────── */

/**
 * One cell. The motion values are owned by the lab rather than by the tile,
 * because the hand-off's launch transform is a relationship between two
 * elements — a print and a cell — and only the thing that can see both can
 * compute it. The tile is handed the values and does nothing but wear them.
 *
 * The inner element is padded to the note's own box and centres the scan, so
 * its centre and the scan's centre are the same point. That is what lets the
 * superimposing transform be computed off measured IMAGE boxes while being
 * applied to this element: the note is contained inside a square cell, and a
 * transform derived from the cell would put the flight on empty letterbox.
 */
function GridTile({ id, mv, pad, z, imgRef }) {
  return (
    <motion.div
      style={{
        position: 'absolute',
        inset: pad,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transformOrigin: 'center center',
        willChange: 'transform, opacity',
        zIndex: z,
        x: mv.x,
        y: mv.y,
        scale: mv.scale,
        rotate: mv.rotate,
        opacity: mv.opacity,
      }}
    >
      <img
        ref={imgRef}
        src={noteSrc(id)}
        alt=""
        data-tile={id}
        draggable={false}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          display: 'block',
          userSelect: 'none',
        }}
      />
    </motion.div>
  );
}

function VariantPicker({ variant, onPick }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        justifyContent: 'center',
        marginTop: 14,
        pointerEvents: 'auto',
        border: `1px dashed ${inkA(0.2)}`,
      }}
    >
      {VARIANTS.map((id, i) => {
        const on = id === variant;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            title={VARIANT_HINT[id]}
            style={{
              padding: '7px 12px',
              background: on ? inkA(0.12) : 'none',
              border: 'none',
              color: inkA(on ? 0.92 : 0.42),
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {i + 1} {VARIANT_LABEL[id]}
          </button>
        );
      })}
    </div>
  );
}

export default function GridHandoffLab() {
  const reduceMotion = useReducedMotion();
  const [fired, setFired] = useState(false);
  // Bumped on every launch so a replay re-runs the layout effect even though
  // `fired` has been true both times.
  const [run, setRun] = useState(0);

  const dials = useDialKit(
    'Grid Hand-off',
    {
      variant: {
        type: 'select',
        options: VARIANTS.map((v) => ({ value: v, label: VARIANT_LABEL[v] })),
        default: 'handoff',
      },
      origin: {
        x: [LAUNCH.originX, 0, 1, 0.01],
        y: [LAUNCH.originY, 0.5, 1.6, 0.01],
      },
      launch: {
        spread: [LAUNCH.spread, 0, 0.6, 0.01],
        spreadX: [LAUNCH.spreadX, 0, 0.8, 0.01],
        /* Up to five tiles' worth, because the interesting values are now the
           ones above 1: the wall launches at the prints' own size and the
           question is how much bigger than its cell a note starts, not how much
           smaller. */
        scale: [LAUNCH.scale, 0.2, 5, 0.05],
        rotate: [LAUNCH.rotate, 0, 40, 0.5],
      },
      flight: {
        durS: [FLIGHT.durS, 0.2, 2.5, 0.02],
        staggerS: [FLIGHT.staggerS, 0, 0.25, 0.002],
        bow: [FLIGHT.bow, -0.8, 0.8, 0.01],
        ease: { type: 'select', options: Object.keys(EASES), default: 'grid' },
        order: {
          type: 'select',
          options: [
            { value: 'distance', label: 'Distance from origin' },
            { value: 'row', label: 'Row by row (today)' },
          ],
          default: 'row',
        },
      },
      spout: {
        columnRise: [SPOUT.columnRise, 0, 1, 0.02],
        lateralPx: [SPOUT.lateralPx, 0, 240, 2],
      },
      handoff: {
        printStaggerS: [HANDOFF.printStaggerS, 0, 0.4, 0.01],
        printDurS: [HANDOFF.printDurS, 0.2, 2.5, 0.02],
        printBow: [HANDOFF.printBow, -0.6, 0.6, 0.01],
        wallLeadS: [HANDOFF.wallLeadS, -0.4, 0.8, 0.01],
      },
      exit: {
        handOverS: [EXIT.handOverS, 0, 1.6, 0.02],
      },
      replay: { type: 'action', label: '⟳ Replay' },
    },
    {
      onAction: (action) => {
        if (action === 'replay') replayRef.current();
      },
    }
  );

  /* The dial owns the selection and the number keys have to be able to drive it
     too, since the panel is hidden unless the page was loaded with ?dial=1. */
  const [variant, setVariant] = useState(dials.variant);
  useEffect(() => {
    setVariant(dials.variant);
  }, [dials.variant]);

  /* Dials are read at launch, out of a ref, rather than depended on by the
     effect that flies the wall. A slider nudged mid-flight would otherwise
     relaunch every tile from wherever it had got to, which is both ugly and a
     lie about the value being tried. Change a dial and press R. */
  const dialsRef = useRef(dials);
  dialsRef.current = dials;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  /* One set of motion values per cell, made once and kept for the life of the
     bench. They are the whole animation surface: the layout effect writes the
     launch transform into them before the browser paints and then animates them
     home, which is the only way a first painted frame can already have a tile
     sitting on top of the print it is replacing (see NoteEntranceLab's
     FlightNote for the same problem stated at one element). */
  const [tileMV] = useState(() =>
    WALL.map(() => ({
      x: motionValue(0),
      y: motionValue(0),
      scale: motionValue(1),
      rotate: motionValue(0),
      opacity: motionValue(0),
    }))
  );

  const tileImgs = useRef([]);
  const printImgs = useRef(new Map());
  const playing = useRef([]);
  // The prints as they stood on the frame the gesture landed. Measured in the
  // handler, before any state changes, because by the time a layout effect runs
  // the hand-off has already taken them out of the DOM.
  const sourceRef = useRef(new Map());

  const [box, setBox] = useState(() => layout(1440, 900));
  const boxRef = useRef(box);
  boxRef.current = box;

  useEffect(() => {
    const measure = () => setBox(layout(window.innerWidth, window.innerHeight));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const stopAll = useCallback(() => {
    playing.current.forEach((p) => p.stop?.());
    playing.current = [];
  }, []);

  /** Every tile back to its own place, invisible, with nothing in the air. */
  const rest = useCallback(() => {
    stopAll();
    tileMV.forEach((mv) => {
      mv.x.set(0);
      mv.y.set(0);
      mv.scale.set(1);
      mv.rotate.set(0);
      mv.opacity.set(0);
    });
  }, [stopAll, tileMV]);

  /**
   * The print `id` as it sits on screen right now: the centre of its scan, the
   * width that scan would have if it were square to the page, and the angle it
   * is lying at.
   *
   * The width is computed rather than measured because a rotated element's
   * bounding box is wider than the element — measuring it would hand the flight
   * a scale a few percent too large, which is exactly the kind of error that
   * shows up as the print flinching on the first frame. The centre IS taken
   * from the box, because rotation is about the element's own centre and so the
   * two coincide however far it is turned.
   */
  const printPose = useCallback((id) => {
    const el = printImgs.current.get(id);
    if (!el) return null;
    const i = PRINTS.findIndex((p) => p.noteId === id);
    const slot = DEAL_SLOTS[i];
    const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    return {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      w: CARD.w * boxRef.current.fit * slot.scale,
      rotate: slot.rotate,
      order: i - 1, // the booth is not in the queue
    };
  }, []);

  // A gesture can only fire once, and on a ref rather than on `fired`, which is
  // a render behind: on this bench the space bar both activates the focused
  // control and reads as a step forward, so two calls can land in one tick.
  const firedRef = useRef(false);
  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const src = new Map();
    PRINTS.forEach((p) => {
      if (!p.noteId) return;
      const pose = printPose(p.noteId);
      if (pose) src.set(p.noteId, pose);
    });
    sourceRef.current = src;
    setFired(true);
    setRun((n) => n + 1);
  }, [printPose]);

  const replay = useCallback(() => {
    firedRef.current = false;
    setFired(false);
    rest();
    // Two frames: one for React to put the prints back, one for the browser to
    // lay them out, so the re-measure sees the pile at rest rather than a print
    // still on its way back to its slot.
    requestAnimationFrame(() => requestAnimationFrame(() => fire()));
  }, [fire, rest]);
  const replayRef = useRef(replay);
  replayRef.current = replay;

  // A candidate change puts the bench back to the top of the piece: the point
  // of the strip is to watch the same scene answered three ways, and comparing
  // them from a settled wall would show only the last frame of each.
  useEffect(() => {
    firedRef.current = false;
    setFired(false);
    rest();
  }, [variant, rest]);

  /* THE LAUNCH. Everything happens inside a layout effect, before the browser
     paints the frame on which the prints were removed — so the first frame the
     reader sees already has each hand-off tile sitting exactly where its print
     was, at its size and at its angle. Doing this in an ordinary effect, or by
     declaring the start transform on a later render, paints one frame of the
     tiles at rest first, and that frame is the seam. */
  useLayoutEffect(() => {
    if (!fired) return undefined;
    const d = dialsRef.current;
    const mode = variantRef.current;
    const { vw, vh } = boxRef.current;

    if (reduceMotion) {
      tileMV.forEach((mv) => mv.opacity.set(1));
      return undefined;
    }

    const easeFn = cubicBezier(...(EASES[d.flight.ease] ?? EASES.grid));
    const origin = { x: d.origin.x * vw, y: d.origin.y * vh };

    // Measured while every value is at identity, so these are the true resting
    // boxes of the scans rather than of the square cells that hold them.
    const homes = tileImgs.current.map((el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width };
    });

    const ranks = launchRanks({
      homes: homes.map((h, i) => h ?? { cx: origin.x, cy: origin.y, i }),
      origin,
      mode: d.flight.order,
      cols: GRID.cols,
    });

    // The wall's own stagger counts only the tiles that are IN the wall, so a
    // hand-off doesn't leave three gaps in the cascade where the prints were.
    const wallRanks = [];
    let n = 0;
    [...ranks.keys()]
      .sort((a, b) => ranks[a] - ranks[b])
      .forEach((i) => {
        const handedOver = mode === 'handoff' && sourceRef.current.has(WALL[i]);
        wallRanks[i] = handedOver ? -1 : n++;
      });

    /* Which of the two goes first. Fountain and spout keep today's gating —
       the archive is not asked for at all until the prints are off the screen,
       so the whole wall is held by that one number rather than being paused
       once it is already flying. The hand-off has no such moment to wait for
       and starts on the frame of the gesture, with the wall a hair behind the
       prints; a negative lead sends the wall first instead, which is worth
       being able to try, and is why the two offsets are derived from one dial
       rather than clamped to zero. */
    const wallHold =
      mode === 'handoff' ? Math.max(0, d.handoff.wallLeadS) : Math.max(0, d.exit.handOverS);
    const printHold = mode === 'handoff' ? Math.max(0, -d.handoff.wallLeadS) : 0;

    const started = [];
    WALL.forEach((id, i) => {
      const mv = tileMV[i];
      const home = homes[i];
      if (!home || !(home.w > 0)) {
        mv.opacity.set(1);
        return;
      }

      const source = mode === 'handoff' ? sourceRef.current.get(id) : null;

      let sx;
      let sy;
      let scale;
      let rotate;
      let delay;
      let durS;
      let bow;

      if (source) {
        // A hand-off: the transform that superimposes this cell on the print it
        // is standing in for. One element, no bridge, no crossfade.
        sx = source.cx - home.cx;
        sy = source.cy - home.cy;
        scale = source.w / home.w;
        rotate = source.rotate;
        delay = printHold + source.order * d.handoff.printStaggerS;
        durS = d.handoff.printDurS;
        bow = d.handoff.printBow;
      } else {
        /* A wall tile: part of the way along its own route from the shared
           origin, shrunk and leaned toward the side it is bound for. The two
           axes are let out separately so the sideways distance can be taken
           down without the tile starting its rise further up the screen — see
           LAUNCH.spreadX. */
        const lx = origin.x + (home.cx - origin.x) * Math.max(d.launch.spread, d.launch.spreadX);
        const ly = origin.y + (home.cy - origin.y) * d.launch.spread;
        sx = lx - home.cx;
        sy = ly - home.cy;
        scale = d.launch.scale;
        rotate = Math.sign(home.cx - origin.x || 1) * d.launch.rotate;
        delay = wallHold + wallRanks[i] * d.flight.staggerS;
        durS = d.flight.durS;
        bow = d.flight.bow;
      }

      // The route's control point, which is where the three candidates actually
      // differ. Everything else about them is the same flight.
      const len = Math.hypot(sx, sy) || 1;
      const side = Math.sign(home.cx - origin.x || 1);
      let cx;
      let cy;
      if (mode === 'spout' && !source) {
        /* Straight up out of the origin and horizontal into the cell: a control
           point directly above the launch point, at the height of the cell. The
           dial pulls it back toward the midpoint, which straightens the column
           into the fountain's own line, so the two candidates meet at 0. */
        const midX = sx / 2;
        const midY = sy / 2;
        cx =
          midX +
          (sx - midX) * d.spout.columnRise +
          side * d.spout.lateralPx * d.spout.columnRise;
        cy = midY + (0 - midY) * d.spout.columnRise;
      } else {
        // Bowed off the straight line, perpendicular to it, opening outward.
        const ux = -sx / len;
        const uy = -sy / len;
        cx = sx / 2 - uy * len * bow * side;
        cy = sy / 2 + ux * len * bow * side;
      }

      const { xs, ys, times } = routeKeyframes({ sx, sy, cx, cy, easeFn });
      const dur = durS * SLOW;
      const at = delay * SLOW;

      mv.x.set(sx);
      mv.y.set(sy);
      mv.scale.set(scale);
      mv.rotate.set(rotate);
      /* A print stands in for paper that is already on the screen, so its cell
         is opaque from the first frame — anything else is the seam. The wall is
         waiting off the bottom edge and would be nothing to look at anyway, but
         the spread can put a tile back inside the frame, so it is held until
         its own moment and then simply there. Never faded up: these are prints,
         and a print that arrives by fading reads as a ghost of one. */
      if (source) mv.opacity.set(1);
      else {
        mv.opacity.set(0);
        started.push(animate(mv.opacity, [0, 1], { duration: 0.0001, delay: at }));
      }

      started.push(
        animate(mv.x, xs, { duration: dur, delay: at, ease: 'linear', times }),
        animate(mv.y, ys, { duration: dur, delay: at, ease: 'linear', times }),
        animate(mv.scale, 1, { duration: dur, delay: at, ease: easeFn }),
        animate(mv.rotate, 0, { duration: dur, delay: at, ease: easeFn })
      );
    });

    playing.current = started;
    return () => {
      started.forEach((p) => p.stop?.());
    };
  }, [fired, run, reduceMotion, tileMV]);

  useEffect(() => {
    const onKey = (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= VARIANTS.length) {
        setVariant(VARIANTS[n - 1]);
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        replayRef.current();
        return;
      }
      if (
        e.key === ' ' ||
        e.key === 'Enter' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        e.preventDefault();
        fire();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fire]);

  /* The gesture, kept as simple as a bench can afford: the study is what the
     wall does afterwards, and the real piece's accumulate-and-arm wheel logic
     would only add a way for a swipe to be swallowed. */
  useEffect(() => {
    const onWheel = (e) => {
      if (e.ctrlKey) return;
      if (Math.abs(e.deltaY) > 8) fire();
    };
    let y0 = null;
    const onStart = (e) => {
      y0 = e.touches[0]?.clientY ?? null;
    };
    const onEnd = (e) => {
      const y1 = e.changedTouches[0]?.clientY;
      if (y0 != null && y1 != null && y0 - y1 > 46) fire();
      y0 = null;
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [fire]);

  const { vw, vh, fit, stageTop, cell, pad, gridLeft, gridTop, copyTop, slotH } = box;
  const gridW = cell * GRID.cols;
  const gridH = cell * GRID.rows;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {/* Title, hints, candidate strip. */}
      <div
        style={{
          position: 'absolute',
          top: 88,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          textAlign: 'center',
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: inkA(0.4),
          }}
        >
          Grid hand-off · {VARIANT_LABEL[variant]}
        </p>
        <p
          style={{
            margin: '6px 0 0',
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: inkA(0.3),
          }}
        >
          {`swipe up / space to fire · 1–3 candidate · R replay · ?dial=1 controls${
            SLOW > 1 ? ` · ${SLOW}× slow` : ' · ?slow=8 slow-mo'
          }`}
        </p>
        <VariantPicker variant={variant} onPick={setVariant} />
      </div>

      {/* THE WALL. Laid out at full size from the first frame and drawn at zero
          opacity, because a cell that has never been laid out cannot be
          measured — and the hand-off is nothing but the difference between two
          measurements. */}
      <div
        style={{
          position: 'absolute',
          left: gridLeft,
          top: gridTop,
          width: gridW,
          height: gridH,
          zIndex: 2,
        }}
      >
        {/* Register marks on the cell corners, echoing the INDEX's own lattice.
            Held faint and left up from the first frame rather than arriving with
            the wall: on a bench the destinations are worth being able to see
            before anything is fired, and at this weight they read as the grain
            of the page rather than as a grid waiting behind the story. */}
        {Array.from({ length: (GRID.cols + 1) * (GRID.rows + 1) }).map((_, i) => {
          const col = i % (GRID.cols + 1);
          const row = Math.floor(i / (GRID.cols + 1));
          return (
            <span
              key={`x${i}`}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: col * cell,
                top: row * cell,
                transform: 'translate(-50%, -50%)',
                fontFamily: MONO,
                fontSize: 9,
                lineHeight: 1,
                color: inkA(0.16),
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              +
            </span>
          );
        })}

        {WALL.map((id, i) => (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: (i % GRID.cols) * cell,
              top: Math.floor(i / GRID.cols) * cell,
              width: cell,
              height: cell,
            }}
          >
            <GridTile
              id={id}
              mv={tileMV[i]}
              pad={pad}
              // The three hand-off cells travel over the wall rather than
              // through it: they are the paper the reader was already holding,
              // and paper does not pass behind the sheet it was lying on.
              z={HANDOFF_IDS.has(id) ? 3 : 1}
              imgRef={(el) => {
                tileImgs.current[i] = el;
              }}
            />
          </div>
        ))}
      </div>

      {/* THE CLOSING BEAT. The booth sits under the wall, because in the real
          beat it is the bottom of the pile and the notes leave over the top of
          it; the three prints sit above everything, because they are what the
          reader is looking at when the gesture lands. */}
      <BeatStage
        layer="booth"
        fired={fired}
        variant={variant}
        reduceMotion={reduceMotion}
        fit={fit}
        stageTop={stageTop}
        printImgs={printImgs}
      />
      <BeatStage
        layer="prints"
        fired={fired}
        variant={variant}
        reduceMotion={reduceMotion}
        fit={fit}
        stageTop={stageTop}
        printImgs={printImgs}
      />

      {/* The closing beat's line, in the slot the pile is anchored above. */}
      <motion.p
        initial={false}
        animate={{ opacity: fired ? 0 : 0.5 }}
        transition={{ duration: reduceMotion ? 0 : 0.32 * SLOW, ease: EASES.grid }}
        style={{
          position: 'absolute',
          top: copyTop,
          left: '50%',
          transform: 'translateX(-50%)',
          width: Math.min(vw - 48, 560),
          height: slotH,
          margin: 0,
          zIndex: 4,
          textAlign: 'center',
          fontFamily: SERIF,
          fontSize: bodyFontPx(vw) * 0.86,
          lineHeight: 1.3,
          color: INK,
          pointerEvents: 'none',
        }}
      >
        {CLOSING_LINE}
      </motion.p>

      {/* The way on, in the place the real piece puts it. */}
      <button
        type="button"
        onClick={fire}
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 26,
          transform: 'translateX(-50%)',
          zIndex: 20,
          padding: '9px 20px',
          background: 'none',
          border: `1px dashed ${inkA(fired ? 0.14 : 0.3)}`,
          color: inkA(fired ? 0.28 : 0.72),
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          pointerEvents: 'auto',
        }}
      >
        {fired ? 'R to replay' : 'Enter the archive ↑'}
      </button>

      {/* A lab affordance and nothing else: the probe needs a machine-readable
          statement of which candidate is up and whether it has been fired. */}
      <span
        data-lab-state={`${variant}:${fired ? 'fired' : 'idle'}:${run}`}
        style={{ display: 'none' }}
      />
      <span data-lab-viewport={`${vw}x${vh}`} style={{ display: 'none' }} />
    </div>
  );
}

/**
 * The pile, in two passes over the same arrangement.
 *
 * The booth and the notes are drawn in separate layers with the wall between
 * them, so a note that has become a grid cell flies OVER the photograph it came
 * out of while the booth fades away underneath — which is the stacking the real
 * beat has, where the booth is the bottom of the pile.
 */
function BeatStage({ layer, fired, variant, reduceMotion, fit, stageTop, printImgs }) {
  const handoff = variant === 'handoff';
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: '50%',
        top: stageTop,
        width: PILE.w * fit,
        height: PILE.h * fit,
        marginLeft: (-PILE.w * fit) / 2,
        zIndex: layer === 'booth' ? 1 : 3,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: PILE.w,
          height: PILE.h,
          transform: `scale(${fit})`,
          transformOrigin: 'top left',
        }}
      >
        {PRINTS.map((photo, i) => {
          const isBooth = i === 0;
          if (isBooth !== (layer === 'booth')) return null;
          // Handed over rather than thrown: the cell holding this note is about
          // to be sitting exactly here, so the print itself is simply gone on
          // the same frame. Removing it is what makes the hand-off one element
          // and not a crossfade between two.
          if (fired && handoff && photo.noteId && !reduceMotion) return null;
          return (
            <PilePrint
              key={photo.key}
              photo={photo}
              index={i}
              fired={fired}
              reduceMotion={reduceMotion}
              imgRef={(el) => {
                if (!photo.noteId) return;
                if (el) printImgs.current.set(photo.noteId, el);
                else printImgs.current.delete(photo.noteId);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One photograph on the pile, and the way it leaves when the pile is thrown.
 *
 * The exit is the radial fan the beat ships: up and out along the line from the
 * middle of the stage through where the print lies, tilted upward so nothing
 * falls back into the edge the prints were dealt up from, tumbling and
 * shrinking as it goes.
 */
function PilePrint({ photo, index, fired, reduceMotion, imgRef }) {
  const rest = DEAL_SLOTS[index];
  const width = CARD.w * photo.widthMul;

  let animatePose = { x: rest.x, y: rest.y, rotate: rest.rotate, scale: rest.scale, opacity: 1 };
  let transition = { duration: 0 };

  if (fired && !reduceMotion) {
    if (index === 0) {
      // The photograph that opened the telling is put down where it lies, not
      // thrown: it is the frame the confessions were collected in, and it has
      // no cell in the archive to travel to.
      animatePose = { ...animatePose, opacity: 0 };
      transition = { duration: EXIT.boothFadeS * SLOW, ease: EXIT.ease };
    } else {
      const len = Math.hypot(rest.x, rest.y) || 1;
      const tiltX = rest.x / len;
      const tiltY = rest.y / len - EXIT.lift;
      const tilt = Math.hypot(tiltX, tiltY) || 1;
      const side = Math.sign(rest.x || 1);
      const delay = EXIT.queueS[Math.min(index - 1, EXIT.queueS.length - 1)] * SLOW;
      animatePose = {
        x: rest.x + (tiltX / tilt) * EXIT.travel,
        y: rest.y + (tiltY / tilt) * EXIT.travel,
        rotate: rest.rotate + side * EXIT.spin,
        scale: rest.scale * EXIT.shrink,
        opacity: 0,
      };
      transition = {
        duration: EXIT.flyS * SLOW,
        ease: EXIT.ease,
        delay,
        // The fade trails the movement, so a print is seen to leave rather than
        // to vanish on its way out.
        opacity: {
          duration: EXIT.flyS * 0.7 * SLOW,
          ease: EXIT.ease,
          delay: delay + EXIT.flyS * 0.3 * SLOW,
        },
      };
    }
  } else if (fired && reduceMotion) {
    animatePose = { ...animatePose, opacity: 0 };
  }

  return (
    <motion.div
      initial={false}
      animate={animatePose}
      transition={transition}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width,
        height: CARD.h,
        marginLeft: -width / 2,
        marginTop: -CARD.h / 2,
        display: 'flex',
        alignItems: 'center',
        transformOrigin: 'center center',
        // drop-shadow rather than box-shadow, so the shadow follows the torn
        // paper's silhouette instead of a rectangle around it.
        filter: 'drop-shadow(0 16px 34px rgba(0,0,0,0.5))',
        willChange: 'transform, opacity',
      }}
    >
      <img
        ref={imgRef}
        src={photo.src}
        alt=""
        data-print={photo.noteId ?? 'booth'}
        draggable={false}
        style={{ width: '100%', height: 'auto', display: 'block', userSelect: 'none' }}
      />
    </motion.div>
  );
}

/**
 * The composition, measured once per window size.
 *
 * The pile half of this is the beat's own arithmetic, transcribed: a fixed
 * stage scaled to fit, anchored above a reservation the height of the longest
 * beat's copy. The wall half is the lab's: the cells take what is left under
 * the bench's title block, capped so a twelve-cell wall on a big monitor does
 * not turn into a poster.
 */
function layout(vw, vh) {
  const slotH = copySlotH(vw);
  const margin = vw < 520 ? 52 : 40;
  const fit = Math.min(
    PILE.maxFit,
    (vw - margin) / PILE.w,
    Math.max(0.4, (vh - slotH - COPY.gapPx - 68) / PILE.h)
  );
  const pileH = PILE.h * fit;
  const centred = (vh - pileH) / 2;
  const lowest = vh - (pileH + COPY.gapPx + slotH) - COPY.bottomAirPx;
  const stageTop = Math.max(24, Math.min(centred, lowest));

  const cell = Math.max(
    GRID.minCell,
    Math.min(
      GRID.maxCell,
      (vw - GRID.marginPx * 2) / GRID.cols,
      (vh - GRID.headerPx - GRID.marginPx * 2) / GRID.rows
    )
  );
  const gridH = cell * GRID.rows;

  return {
    vw,
    vh,
    fit,
    stageTop,
    slotH,
    copyTop: stageTop + pileH + COPY.gapPx,
    cell,
    pad: Math.round(cell * GRID.padFrac),
    gridLeft: Math.round((vw - cell * GRID.cols) / 2),
    gridTop: Math.round(GRID.headerPx + Math.max(0, (vh - GRID.headerPx - gridH) / 2)),
  };
}
