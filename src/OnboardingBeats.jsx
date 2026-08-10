import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, cubicBezier, motion, useReducedMotion } from 'motion/react';
import { INK, inkA } from './colors';
import { PAGE_BG, PAGE_GRADIENT } from './NoiseGradient';
import { TunableGrainBackground } from './noise';
import AsciiWall from './AsciiWall';
import BodyKicker from './BodyKicker';
import WordmarkDraw from './WordmarkDraw';
import {
  BODY_LINE,
  CTA_HOVER_CSS,
  EnterButton,
  FINAL_QUESTION,
  FRAGMENT_LINE,
  HeroOpeningQuestion,
  INTRO_LINE,
  MONO,
  NOTES,
  ONBOARDING_LINK_UNDERLINE,
  OpeningLoader,
  RevealWords,
  SERIF,
  ScrollCue,
  WORD_DISPLAY,
  ease,
  noteSrc,
} from './OnboardingReveal';

/* ─────────────────────────────────────────────────────────────────────
 * ONBOARDING — BEATS
 *
 * The same piece as OnboardingReveal, and the same words in the same order,
 * but held in one screen instead of run down a page. Nothing scrolls: each
 * swipe deals the next photograph onto a pile and swaps the line underneath
 * it, so the reader sets the pace of the story a beat at a time and the
 * confessions accumulate in front of them rather than passing by.
 *
 *   1  HERO      the wordmark writes itself over the ascii confession field,
 *                the opening question, the cue to swipe. No photograph yet.
 *   2  INTRO     the Dolores Park booth lands, and the line that explains it.
 *   3  BODY      AC_171. The statement is left hanging and BodyKicker's three
 *                verbs finish it, ascii creeping in around them.
 *   4  FRAGMENT  AC_148.
 *   5  CLOSING   AC_185, and the way into the archive.
 *
 * The copy, the loader, the hero and the enter button all come from
 * OnboardingReveal; this file owns the pile, the beats, and the gesture.
 * ───────────────────────────────────────────────────────────────────── */

/* Paper being thrown down: nearly all of the distance is covered at once and
   the rest of the move is the note settling. No spring — a note that bounces
   reads as a UI element rather than as a thing. */
const EASE_OUT = [0.08, 0.82, 0.17, 1];

/* The tilt is unwound on a gentler curve than the travel. On the throw's own
   curve a note is square within a couple of frames of leaving the edge — the
   turn is finished before it is even on screen — so the rotation gets an
   ordinary ease-out over a longer beat instead, and you watch the paper come
   round as it lands. */
const EASE_TURN = [0.33, 1, 0.68, 1];

/* Leaving is not throwing. EASE_OUT is right for a note being dealt onto the
   stage, but on the way out that same front-loading reads as the pile being
   snatched away — the note is off the screen before the eye has followed it. The
   exit gets an ordinary ease-out instead, so the movement is still decelerating
   while it's in frame. */
const EASE_EXIT = [0.22, 0.61, 0.36, 1];

/* Base size of a note, set to read at roughly the size the scrolled telling
   gave one — a confession you can actually read, not a thumbnail of one. The
   scans are all different shapes, so `h` is only the box each is CENTRED in: a
   tall note overflows it evenly top and bottom rather than hanging off the
   bottom, which is what keeps the lowest of them off the copy.
 *
 * Note that growing this alone buys nothing. The stage is scaled to fit the
 * screen, so what sets a note's size is how much of the STAGE it takes up —
 * `PILE` and the offsets below have to stay tight around it or the fit just
 * shrinks everything back. The vertical scatter in particular is kept small
 * for that reason: height is the scarce thing on a screen shared with copy. */
const CARD = { w: 520, h: 460 };

/* The stage the pile is dealt on: fixed, so the scatter keeps its proportions
   at every window size, and only just wide enough for the closing beat with its
   tilts — every spare pixel here comes off the size of the notes, since a phone
   sizes everything by how much of this it can fit across. */
const PILE = { w: 700, h: 625, maxFit: 1.15 };

/* The words get a slot of their own, tall enough for the longest beat — three
   lines plus three verbs — and every beat starts at the top of it.
 *
 * The slot is a reservation on purpose. The pile and the copy used to share one
 * centred column, which meant the column re-centred every time a line left and
 * the next arrived, and the photographs drifted up and back down on every beat.
 * Nothing about a beat's own copy is allowed to move the pile, so both are
 * anchored and short copy simply leaves the rest of its slot empty.
 *
 * Its height is derived rather than picked. The tallest beat is the body, and
 * its type is viewport-clamped, so the same paragraph is ~206px tall on a wide
 * desktop and ~130 on a phone; measured against real renders it lands at about
 * 8× its own font size at every width. A single fixed number was right on one
 * screen and over-reserved by 140px on a phone — and that over-reservation was
 * dead air below the copy, which is exactly the room the pile needs to sit
 * centred.
 *
 * So perFontPx tracks BODY_LINE's authored rag: it was 11.6 while that copy set
 * six lines, and re-measuring is the price of re-breaking the sentence. It counts
 * from the first line to the lowest ink rather than to the kicker's box, because
 * the kicker's ascii marks hang a good way past their own block. Rounding up
 * rather than down — an over-reserved slot only costs the pile some of its
 * centring, while an under-reserved one runs the copy into the bottom of the
 * screen. */
/* The same clamp the intro and fragment beats set, rather than a smaller one of
   its own. This beat is the longest — three lines and three verbs against their
   one line — and it had been shrunk to buy the pile room, but a beat that sets
   its type two sizes down reads as a caption next to the ones either side of it.
   The slot below derives its height from this, so the room comes out of the
   pile's centring instead. */
const BODY_TYPE = { minPx: 20, vw: 2.9, maxPx: 33 };
const COPY = {
  gapPx: 26, //        between the pile and the first line
  perFontPx: 8.4, //   the body beat's height, in multiples of its own type
  tailPx: 24, //       air under its last line
  bottomAirPx: 24, //  and under the slot, off the bottom of the screen
};

/** The body beat's rendered type size at this width — the clamp, in numbers. */
const bodyFontPx = (vw) =>
  Math.min(BODY_TYPE.maxPx, Math.max(BODY_TYPE.minPx, (vw * BODY_TYPE.vw) / 100));

/** How much room the copy has to be given below the pile at this width. */
const copySlotH = (vw) => Math.round(bodyFontPx(vw) * COPY.perFontPx) + COPY.tailPx;

const DEAL = {
  flyS: 0.62, //   s — offstage → resting place
  fadeS: 0.4, //   s — leaving the stage (stepping backwards)
  dimS: 0.4, //    s — the pile behind shading back
  dimGap: 0.04, // s — beat of stillness after the landing before it does
  // A note arrives tilted this much further than it comes to rest at, in the
  // direction it flew in from, and turns square as it lands.
  turnDeg: 14,
  turnS: 0.78, // s — longer than the travel, so the turn outlasts the slide
};

/** Depth shading by how far back a photograph now sits. */
const DEPTH_DIM = [0, 0.28, 0.48, 0.62];

/** Paper shadow + depth shading, as one filter so it can be animated whole. */
const cardFilter = (dim) =>
  `drop-shadow(0 16px 34px rgba(0,0,0,0.5)) brightness(${1 - dim * 0.55})`;

/* Resting places: notes landing on top of one another, a little askew each time
 * — a pile on a table, not a hand fanned out. The tilts are hand-set and the
 * steps are uneven so it reads as paper that was tossed down rather than laid.
 *
 * Two things are being held at once here, and they pull against each other.
 *
 * The pile has to sit in the middle of the screen at EVERY beat, not just at the
 * end. Nothing that has landed is ever allowed to move again — a beat arriving
 * must not slide the notes already on screen — so each place is fixed once,
 * here, and the arrangement has to be centred while it is one card as well as
 * when it is four. That is what keeps the x values small and roughly balanced
 * around nothing: the widest any beat sits off the middle is ~48 units, about
 * 2% of a laptop's width.
 *
 * And the notes have to stay countable. A card is ~520 units wide, so a later
 * card sitting on both sides of an earlier one covers it whole. The three notes
 * therefore drift one way, in steps just wide enough to leave ~40 units of the
 * edge below showing — enough to read as three confessions stacked, tight
 * enough to still read as a stack.
 *
 * The booth is the exception, and knowingly so. It is the establishing shot, it
 * gets a beat alone in the dead centre of the screen, and at three-quarters the
 * notes' size it cannot both stay centred and keep an edge out from under them —
 * anything smaller and concentric is covered whole, whatever its tilt. So it is
 * centred for the beat that is about it, and buried by the notes that came out
 * of it. */
const DEAL_SLOTS = [
  { x: 0, y: 0, rotate: -5, scale: 0.7 },
  { x: -48, y: -14, rotate: 3.5, scale: 0.94 },
  { x: 0, y: 8, rotate: -4.5, scale: 0.97 },
  { x: 48, y: 18, rotate: 7, scale: 1 },
];

/* The hero fades off the screen the story is already standing on — short, and
   on the page's front-loaded curve, because the first swipe should be answered
   by the booth arriving rather than by waiting out a transition.
 *
 * Coming back is a different move and gets its own timing. On the shared curve
 * a returning hero is 70% opaque within 100ms of a 400ms fade, which reads as
 * the landing page snapping back rather than fading in; this is longer and
 * ramps from both ends, so the wordmark and the ascii field come up out of the
 * page instead of appearing on it. */
const HERO_FADE = {
  outS: 0.4,
  outEase: ease,
  inS: 0.75,
  inEase: [0.4, 0, 0.6, 1],
};

/* The beat marks in the corner. Every rule is the same weight — the lit one is
   longer and brighter, which is enough to find at a glance without thickening
   into a different object from the ones it is counting alongside.
 *
 * They are also not there at the start: the hero is one image, one question and
 * a cue to swipe, and a progress count next to it answers a question nobody has
 * asked yet. The marks arrive with the first photograph, once there is a story
 * to be somewhere in. */
const TAB = {
  idleW: 14,
  activeW: 24,
  h: 2, //            held at 2 while the rules shrink: at 1 they render soft on
  //                  a 1x screen, and thinning is the one change that would make
  //                  the lit rule a different weight from the ones beside it
  padY: 5, //         the hit area around each rule
  active: '#DDDDAE', // the hero's yellow, the site's one accent
  idle: inkA(0.24),
  fadeInS: 0.55, //   arriving behind the booth, unhurried
};

/* One swipe is one beat, however hard it's thrown. See the wheel handler. */
const SWIPE = {
  thresholdPx: 26, // accumulated travel before a gesture counts
  quietMs: 300, //   silence that separates one flick from the next
  notchPx: 44, //    a full mouse notch starts a gesture on its own
  graceMs: 900, //   after a step: input is dead, and none of it is banked
  touchPx: 46, //    finger travel that counts as a swipe
};

/* The photographs, in the order they're dealt. The booth is landscape and
   everything after it is a note scan, so it's given its own width — at the
   notes' width the sign in it stops being legible. */
const BOOTH = {
  key: 'booth',
  src: '/intro-booth-park.png',
  alt: 'A hand-painted "Confession Box — everyone has an AI secret" sign staked in Dolores Park.',
  // Held at the size it always was while the notes grew past it.
  widthMul: 0.98,
};

const PHOTOS = [
  BOOTH,
  ...NOTES.map((n) => ({
    key: n.id,
    src: noteSrc(n.id),
    alt: 'Handwritten confession',
    widthMul: 1,
  })),
];

/* Pressing ENTER clears the pile before the archive opens, in two movements.
   The booth goes first and only fades, where it lies — it is the photograph that
   opened the telling, and the frame the confessions were collected in, so it is
   put down rather than thrown. Then the confessions leave, each along the line it
   was dealt on and in the order it arrived, shrinking slightly as they go: the
   story unmakes itself and hands the screen over rather than being cut away
   from. */
const DISPERSE = {
  firstFadeS: 0.44, // s — the booth, fading in place
  firstGapS: 0.12, //  s — a beat of stillness before the notes follow
  /* When each note goes, in s after the booth has cleared — 560ms, 660ms and
     740ms after the click. Written out rather than a single interval because the
     interval tightens: 100ms, then 80ms. An even step made three departures read
     as a metronome; closing the gap makes them read as one movement gathering
     pace, which is also what stops the last note holding the screen on its own. */
  queueS: [0, 0.1, 0.18],
  flyS: 0.92, //       s — a note's own way off the stage
  travel: 1500, //     stage units — clears any viewport once scaled
  /* deg of tumble on the way out. A note is off the screen inside the first
     third of its flight, so only that much of this is ever seen — which is why
     it takes a number this big to read as a hand having thrown the note rather
     than a slide. */
  spin: 44,
  /* How far the flight bows off the straight line out, in stage units at
     mid-flight. Sideways first and outward after, on the same side the note
     tumbles, so the spin and the route agree — a note leaves the pile the way a
     thrown card does. Kept small: past ~200 the notes start to read as being
     swept by something rather than let go of. */
  arc: 130,
  /* Points the curve is sampled into. Each hop between samples is travelled at
     one rate, so too few of them and the note is seen to change speed on the
     sample boundaries. Measured over the part of the flight that is actually on
     screen, the worst speed change from one frame to the next is 1.39× at 8
     samples and 1.12× at 32, against 1.07× for the smooth curve itself — so this
     is where the sampling stops being the thing you'd notice. It costs a couple
     of dozen numbers, once per note. */
  arcSamples: 32,
  shrink: 0.95, //     × its resting scale, as it goes: the note reads as
  //                   receding rather than only sliding
  holdS: 0.14, //      s — the empty screen, before the archive
};

/* The exit's own easing, as a function — the route is sampled at eased progress
   so the bend costs the flight none of its pacing (see dispersePose). */
const easeExitAt = cubicBezier(...EASE_EXIT);

/** When note `n` of the queue leaves, s after the click. */
const disperseDelay = (n) =>
  DISPERSE.firstFadeS +
  DISPERSE.firstGapS +
  DISPERSE.queueS[Math.min(n, DISPERSE.queueS.length - 1)];

/** The whole exit, click to last note gone. */
const DISPERSE_MS =
  (disperseDelay(PHOTOS.length - 2) + DISPERSE.flyS + DISPERSE.holdS) * 1000;

/**
 * Where a note goes when the pile clears: out along the line from the middle of
 * the stage through where it was dealt, so the group opens up rather than sliding
 * off as a block — bowed off that line as it goes (see arcKeyframes) and
 * tumbling the same way it bends. `order` is its place in the deal.
 *
 * Order 0 is the booth, and it doesn't travel — see DISPERSE.
 */
function dispersePose({ x, y, rotate, scale, order }) {
  if (order === 0) {
    return {
      animate: { x, y, rotate, scale, opacity: 0 },
      transition: { duration: DISPERSE.firstFadeS, ease: EASE_EXIT },
    };
  }

  // The notes count their own queue, starting once the booth has gone.
  const delay = disperseDelay(order - 1);
  const len = Math.hypot(x, y) || 1;
  // Outward (radial) direction, and the side the note tumbles toward.
  const ux = x / len;
  const uy = y / len;
  const side = Math.sign(x || 1);
  const endX = x + ux * DISPERSE.travel;
  const endY = y + uy * DISPERSE.travel;
  const { xs, ys, times } = arcKeyframes({ x, y, endX, endY, ux, uy, side });

  return {
    animate: {
      x: xs,
      y: ys,
      rotate: rotate + side * DISPERSE.spin,
      scale: scale * DISPERSE.shrink,
      opacity: 0,
    },
    transition: {
      duration: DISPERSE.flyS,
      ease: EASE_EXIT,
      delay,
      /* The route is a list of points already spaced by EASE_EXIT, so these two
         run through it at an even rate — the easing is in the spacing, not in
         the playback. Handing the keyframes the curve as well would ease each
         hop in and out of every point and the flight would stutter. */
      x: { duration: DISPERSE.flyS, delay, ease: 'linear', times },
      y: { duration: DISPERSE.flyS, delay, ease: 'linear', times },
      // The fade trails the movement so a note is seen to leave rather than to
      // vanish on its way.
      opacity: {
        duration: DISPERSE.flyS * 0.7,
        ease: EASE_EXIT,
        delay: delay + DISPERSE.flyS * 0.3,
      },
    },
  };
}

/**
 * The flight as a bowed route rather than a straight line: a quadratic curve
 * from where the note lies to where it leaves, its control point pushed
 * sideways off the middle of that line (DISPERSE.arc).
 *
 * Sampled into keyframes because there is no curved path to hand a transform —
 * x and y are animated independently, and any pair of single values can only
 * ever describe a straight line between them however they're eased. Sampling at
 * EASE_EXIT's own progress keeps the pacing the straight version had, so this
 * changes the route and nothing else.
 */
function arcKeyframes({ x, y, endX, endY, ux, uy, side }) {
  // Perpendicular to the flight, on the side the note is tumbling toward.
  const bowX = -uy * DISPERSE.arc * side;
  const bowY = ux * DISPERSE.arc * side;
  const ctrlX = (x + endX) / 2 + bowX;
  const ctrlY = (y + endY) / 2 + bowY;

  const xs = [];
  const ys = [];
  const times = [];
  for (let i = 0; i <= DISPERSE.arcSamples; i++) {
    const t = i / DISPERSE.arcSamples;
    const p = easeExitAt(t);
    const q = 1 - p;
    xs.push(q * q * x + 2 * q * p * ctrlX + p * p * endX);
    ys.push(q * q * y + 2 * q * p * ctrlY + p * p * endY);
    times.push(t);
  }
  return { xs, ys, times };
}

/* Type sizes are per beat because the blocks are wildly different lengths —
   one line against the body's three plus three verbs — and they all have to sit
   in the same slot under the pile without pushing it off the screen. */
const BEATS = [
  { id: 'hero' },
  {
    id: 'intro',
    text: INTRO_LINE,
    fontSize: 'clamp(20px, 2.9vw, 33px)',
  },
  {
    id: 'body',
    text: BODY_LINE,
    // The one beat whose type the layout also reads — see COPY.
    fontSize: `clamp(${BODY_TYPE.minPx}px, ${BODY_TYPE.vw}vw, ${BODY_TYPE.maxPx}px)`,
    kicker: true,
  },
  {
    id: 'fragment',
    text: FRAGMENT_LINE,
    fontSize: 'clamp(20px, 2.9vw, 33px)',
  },
  {
    id: 'closing',
    text: FINAL_QUESTION,
    fontSize: 'clamp(18px, 2.5vw, 29px)',
    // The last beat is the one the reader is asked to act on, so it arrives
    // slower than the ones before it: a wider gap between the words and a
    // longer fade on each, which lets the sentence land rather than appear.
    word: { staggerS: 0.16, durS: 1.15 },
    enter: true,
  },
];

const LAST = BEATS.length - 1;

/** Beat 0 carries no photograph, so the pile runs a beat behind. */
const dealtCount = (beat) => Math.min(PHOTOS.length, beat);

/**
 * How far out a note waits, in stage units: past the edge of the window by a
 * whole card, so it is entirely off the page whatever the window size and reads
 * as coming from outside the site rather than from just past the frame.
 *
 * Measured rather than fixed because the stage is scaled to fit — a constant
 * would sit outside a phone and inside a wide desktop, where the note would
 * simply be waiting on screen for its beat.
 */
const offstageX = (vw, fit) => vw / 2 / fit + CARD.w;

/**
 * Photograph `i` waits offstage until beat `i + 1`, flies in, and stays.
 *
 * Once it's down it doesn't fade — it shades back, so the pile reads as paper
 * sitting under paper rather than as notes going transparent. That shading is
 * held until the incoming one has landed, so only one thing changes at a time.
 */
function dealPose({ index, beat, reduceMotion, offstage }) {
  const rest = DEAL_SLOTS[index];
  const dealt = index < dealtCount(beat);
  const depth = Math.max(0, dealtCount(beat) - 1 - index);
  const from = index % 2 === 0 ? -1 : 1;

  if (!dealt) {
    return {
      animate: {
        x: reduceMotion ? rest.x : from * offstage,
        y: reduceMotion ? rest.y : -40,
        rotate: reduceMotion ? rest.rotate : rest.rotate + from * DEAL.turnDeg,
        scale: 0.92,
        opacity: 0,
        filter: cardFilter(0),
        zIndex: index + 1,
      },
      transition: reduceMotion
        ? { duration: 0 }
        : { duration: DEAL.fadeS, ease: EASE_OUT, zIndex: { duration: 0 } },
    };
  }

  const behind = depth > 0;
  const dim = DEPTH_DIM[Math.min(depth, DEPTH_DIM.length - 1)];

  return {
    animate: {
      x: rest.x,
      y: rest.y,
      rotate: rest.rotate,
      scale: rest.scale,
      opacity: 1,
      filter: cardFilter(dim),
      zIndex: index + 1,
    },
    transition: reduceMotion
      ? { duration: 0 }
      : {
          duration: DEAL.flyS,
          ease: EASE_OUT,
          rotate: { duration: DEAL.turnS, ease: EASE_TURN },
          opacity: { duration: 0.24, ease: EASE_OUT },
          filter: behind
            ? { duration: DEAL.dimS, ease: EASE_OUT, delay: DEAL.flyS + DEAL.dimGap }
            : { duration: 0.24, ease: EASE_OUT },
          zIndex: { duration: 0 },
        },
  };
}

function PilePhoto({ photo, index, beat, leaving, reduceMotion, offstage }) {
  const rest = DEAL_SLOTS[index];
  const pose = leaving
    ? dispersePose({ ...rest, order: index })
    : dealPose({ index, beat, reduceMotion, offstage });
  const width = CARD.w * photo.widthMul;
  return (
    <motion.div
      initial={false}
      animate={pose.animate}
      transition={pose.transition}
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
        // drop-shadow rather than box-shadow, so the shadow follows the torn
        // paper's silhouette instead of a rectangle around it.
        willChange: 'transform, opacity, filter',
      }}
    >
      <img
        src={photo.src}
        alt={photo.alt}
        draggable={false}
        style={{
          width: '100%',
          height: 'auto',
          flex: 'none',
          display: 'block',
          userSelect: 'none',
        }}
      />
    </motion.div>
  );
}

export default function OnboardingBeats({
  onEnter = () => window.location.assign('/?view=grid'),
  skipEntrance = false,
} = {}) {
  const reduce = useReducedMotion();
  const [loading, setLoading] = useState(!skipEntrance && !reduce);
  const [titleGate, setTitleGate] = useState(reduce);
  const [heroTitleRevealed, setHeroTitleRevealed] = useState(reduce);
  const [heroQuestionRevealed, setHeroQuestionRevealed] = useState(reduce);
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState(false);

  /* ENTER scatters the pile first and opens the archive after — the piece
     clears its own screen rather than being cut off mid-sentence. Reduced
     motion has nothing to watch, so it goes straight through. */
  const leave = useCallback(() => {
    if (reduce) {
      onEnter();
      return;
    }
    setLeaving(true);
  }, [onEnter, reduce]);

  useEffect(() => {
    if (!leaving) return undefined;
    const id = setTimeout(onEnter, DISPERSE_MS);
    return () => clearTimeout(id);
  }, [leaving, onEnter]);

  /* Nothing on this page scrolls — the gesture is spent on beats instead — so
     the document is pinned for as long as it's up. */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.scrollTo(0, 0);
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Hero title starts a beat after the loader lifts, or a shorter beat after
  // mount when there's no loader. Reduced motion is already at rest.
  useEffect(() => {
    if (reduce) return undefined;
    if (loading) {
      setTitleGate(false);
      return undefined;
    }
    const id = setTimeout(() => setTitleGate(true), skipEntrance ? 200 : 1000);
    return () => clearTimeout(id);
  }, [loading, reduce, skipEntrance]);

  const step = useCallback((dir) => {
    setBeat((b) => Math.min(LAST, Math.max(0, b + dir)));
  }, []);

  // The listeners below are bound once and read through refs, so they act on
  // the current beat rather than whichever render created them.
  const stepRef = useRef(step);
  stepRef.current = step;
  const lockedRef = useRef(loading);
  lockedRef.current = loading || leaving;

  const lastWheelRef = useRef(0);
  const lastStepRef = useRef(-Infinity); // no grace owed on the first swipe
  const travelRef = useRef(0);
  const armedRef = useRef(true);

  /* ONE SWIPE, ONE BEAT.
     A gesture begins once the wheel has been quiet for a moment, and steps as
     soon as its accumulated travel crosses the threshold — accumulated, since
     a trackpad opens a flick with sub-pixel deltas where a mouse arrives at
     full size on the first notch. Everything after that step belongs to the
     same flick and is dropped, which is what stops a trackpad's momentum tail
     from running the whole story. The grace period then swallows whatever
     arrives next and banks none of it, so a tail can't fire the instant the
     beat ends. A full notch re-arms on its own, because a wheel rolled
     steadily never falls quiet. */
  useEffect(() => {
    const onWheel = (e) => {
      if (e.ctrlKey) return; // pinch-zoom is not a swipe
      e.preventDefault();
      if (lockedRef.current) return;

      const now = performance.now();
      const quiet = now - lastWheelRef.current > SWIPE.quietMs;
      lastWheelRef.current = now;

      if (now - lastStepRef.current < SWIPE.graceMs) {
        travelRef.current = 0;
        armedRef.current = false;
        return;
      }

      // Firefox reports lines, and page mode exists too; normalise to pixels.
      const px =
        e.deltaMode === 1
          ? e.deltaY * 16
          : e.deltaMode === 2
            ? e.deltaY * window.innerHeight
            : e.deltaY;

      if (quiet || Math.abs(px) >= SWIPE.notchPx) {
        travelRef.current = 0;
        armedRef.current = true;
      }
      if (!armedRef.current) return;

      travelRef.current += px;
      if (Math.abs(travelRef.current) < SWIPE.thresholdPx) return;

      armedRef.current = false;
      lastStepRef.current = now;
      stepRef.current(travelRef.current > 0 ? 1 : -1);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  // Touch gets the same one-gesture-one-beat rule, measured on the finger.
  useEffect(() => {
    let from = null;
    const onStart = (e) => {
      from = e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const onMove = (e) => {
      if (e.cancelable) e.preventDefault(); // no rubber-banding a fixed page
    };
    const onEnd = (e) => {
      const start = from;
      from = null;
      if (start == null || lockedRef.current) return;
      const dy = e.changedTouches[0].clientY - start;
      if (Math.abs(dy) < SWIPE.touchPx) return;
      const now = performance.now();
      if (now - lastStepRef.current < SWIPE.graceMs) return;
      lastStepRef.current = now;
      stepRef.current(dy < 0 ? 1 : -1); // dragging up moves forward
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (lockedRef.current) return;
      const forward = ['ArrowDown', 'ArrowRight', 'PageDown', ' '];
      const back = ['ArrowUp', 'ArrowLeft', 'PageUp'];
      if (forward.includes(e.key)) {
        e.preventDefault();
        stepRef.current(1);
      } else if (back.includes(e.key)) {
        e.preventDefault();
        stepRef.current(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* The composition is measured once per window size and then holds: the pile
     is laid out at a fixed size and scaled to fit — so the scatter keeps its
     proportions on a laptop and a phone alike rather than overlapping
     differently at every width — and the stage and the copy slot are anchored
     there for the whole piece. */
  const [box, setBox] = useState({
    fit: 1,
    stageTop: 0,
    slotH: copySlotH(1200),
    offstage: offstageX(1200, 1),
  });
  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const slotH = copySlotH(vw);
      // The ceiling is where a note reaches the size the scrolled telling gave
      // it (~560px wide); past that a big screen would just be enlarging a
      // scan. The floor keeps a short window legible rather than exact — but
      // it is allowed to argue with the height only. Width is absolute: a phone
      // is narrower than the fan is wide, and a floor that outvoted it ran the
      // outermost notes off both edges of the screen.
      // The wider phone margin pays for the tilt: a fanned note's bounding box
      // is a little broader than the stage it is laid out on.
      const margin = vw < 520 ? 52 : 40;
      const fit = Math.min(
        PILE.maxFit,
        (vw - margin) / PILE.w,
        Math.max(0.4, (vh - slotH - COPY.gapPx - 68) / PILE.h)
      );
      const pileH = PILE.h * fit;
      const total = pileH + COPY.gapPx + slotH;
      /* The photographs want the middle of the screen, and give up only as much
         of it as the copy underneath needs to stay on it. On a phone that is the
         whole way — the type is small there, so the slot is short and the slack
         is all the pile's. On a short laptop window the pile has already grown
         to fill the height the copy leaves it, so there is little to give and
         this settles a few px below where the block used to be centred. Either
         way the worst-case copy still fits, so no beat can run off the bottom. */
      const centred = (vh - pileH) / 2;
      const lowest = vh - total - COPY.bottomAirPx;
      setBox({
        fit,
        slotH,
        stageTop: Math.max(24, Math.min(centred, lowest)),
        offstage: offstageX(vw, fit),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const { fit, stageTop, offstage } = box;
  const copyTop = stageTop + PILE.h * fit + COPY.gapPx;

  const current = BEATS[beat];
  const atClosing = beat === LAST;

  /* The way out is hung off the end of the words rather than a fixed wait, so
     slowing a beat's cascade carries the button with it instead of leaving it to
     arrive over the top of a sentence still being written. It lands as the last
     word starts its own fade. */
  const word = current.word ?? WORD_DISPLAY;
  const enterDelayS = useMemo(() => {
    if (!current.text) return undefined;
    const words = current.text.split(/\s+/).filter(Boolean).length;
    return Math.max(0.5, (words - 1) * word.staggerS);
  }, [current.text, word.staggerS]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        color: '#CFCAB7',
        background: PAGE_BG,
      }}
    >
      <AnimatePresence>
        {loading && <OpeningLoader onDone={() => setLoading(false)} />}
      </AnimatePresence>

      {/* Full-page film grain — the shared archive/landing texture, isolated
          over a copy of the page gradient so the overlay blend has something
          to bite into instead of washing out on flat black. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          isolation: 'isolate',
          pointerEvents: 'none',
          background: PAGE_BG,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: PAGE_GRADIENT }} />
        <TunableGrainBackground />
      </div>

      <style>{CTA_HOVER_CSS}</style>

      {/* THE BEATS — one rule per beat, opposite the skip link. The one you're
          on is lit and longer; the rest sit back far enough to be a count
          rather than a menu. They're real buttons, so the story can also be
          walked with a pointer or a keyboard, not only a swipe. */}
      <motion.nav
        aria-label="Beats"
        aria-hidden={beat === 0}
        initial={false}
        animate={{ opacity: leaving || beat === 0 ? 0 : 1 }}
        transition={{
          duration: reduce ? 0 : leaving ? 0.32 : beat === 0 ? 0.3 : TAB.fadeInS,
          ease,
        }}
        style={{
          position: 'absolute',
          top: 'clamp(16px, 3.4vh, 30px)',
          left: 'clamp(16px, 3.4vw, 34px)',
          zIndex: 70,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          // The skip link's own vertical centre, so the two read as one row.
          paddingTop: 11,
          // Nothing to aim at while the marks are away on the hero.
          pointerEvents: beat === 0 ? 'none' : 'auto',
        }}
      >
        {BEATS.map((b, i) => {
          const on = i === beat;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setBeat(i)}
              aria-label={`Beat ${i + 1} of ${BEATS.length}`}
              aria-current={on ? 'step' : undefined}
              tabIndex={beat === 0 ? -1 : 0}
              style={{
                appearance: 'none',
                background: 'none',
                border: 0,
                // Padding is the hit area; the rule inside is what you see.
                padding: `${TAB.padY}px 14px ${TAB.padY}px 0`,
                cursor: 'pointer',
                display: 'block',
                lineHeight: 0,
              }}
            >
              <motion.span
                initial={false}
                animate={{
                  width: on ? TAB.activeW : TAB.idleW,
                  backgroundColor: on ? TAB.active : TAB.idle,
                }}
                transition={{ duration: reduce ? 0 : 0.28, ease }}
                style={{ display: 'block', height: TAB.h, borderRadius: 1 }}
              />
            </button>
          );
        })}
      </motion.nav>

      {/* STICKY SKIP — a real link to the archive, which steps aside on the
          closing beat: that beat carries the archive's own way in, and two
          entrances at once makes the reader choose at the moment the piece is
          trying to land. Faded rather than unmounted so it returns if you
          swipe back, and hidden from the pointer and tab order while gone. */}
      <motion.a
        className="onboarding-cta"
        href="/?view=grid"
        onClick={(e) => {
          e.preventDefault();
          onEnter();
        }}
        aria-hidden={atClosing}
        tabIndex={atClosing ? -1 : 0}
        initial={false}
        animate={{ opacity: atClosing ? 0 : 1 }}
        transition={{ duration: reduce ? 0 : 0.4, ease }}
        style={{
          position: 'absolute',
          top: 'clamp(16px, 3.4vh, 30px)',
          right: 'clamp(16px, 3.4vw, 34px)',
          zIndex: 70,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5em',
          padding: '11px 20px',
          background: 'transparent',
          borderRadius: 999,
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: 12.5,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          lineHeight: 1,
          textDecoration: 'none',
          pointerEvents: atClosing ? 'none' : 'auto',
        }}
      >
        <span style={ONBOARDING_LINK_UNDERLINE}>Skip Intro</span>
      </motion.a>

      <main
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          textAlign: 'center',
        }}
      >
        {/* HERO — the wordmark over the ascii confession field. Laid over the
            whole screen rather than in the column, so the pile below can hold
            its place while the hero fades off it. */}
        <motion.div
          initial={false}
          animate={{ opacity: beat === 0 ? 1 : 0 }}
          transition={{
            duration: reduce ? 0 : beat === 0 ? HERO_FADE.inS : HERO_FADE.outS,
            ease: beat === 0 ? HERO_FADE.inEase : HERO_FADE.outEase,
          }}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'clamp(26px, 5vh, 52px)',
            pointerEvents: 'none',
          }}
          aria-hidden={beat !== 0}
        >
          {/* The same gate the title takes, so the field starts writing a beat
              after the title starts revealing rather than on its own clock. */}
          <AsciiWall start={!loading && titleGate} />
          <WordmarkDraw
            hold={loading || !titleGate}
            reduceMotion={reduce}
            onRevealComplete={() => setHeroTitleRevealed(true)}
          />
          <HeroOpeningQuestion
            hold={loading || !heroTitleRevealed}
            instant={reduce}
            onRevealComplete={() => setHeroQuestionRevealed(true)}
            style={{
              maxWidth: 400,
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 'clamp(14px, 2vw, 18px)',
              lineHeight: 1.45,
              letterSpacing: '0.01em',
              textTransform: 'uppercase',
              color: 'rgba(207,202,183,0.82)',
            }}
          />
          <ScrollCue show={!loading && heroQuestionRevealed && beat === 0} />
        </motion.div>

        {/* THE STORY — the pile and the line it sits over. Both are here from
            the first frame, under the hero, holding the places they keep for
            the whole piece; the hero fading is what reveals them. */}
        <div aria-hidden={beat === 0} style={{ position: 'absolute', inset: 0 }}>
          {/* THE PILE — a fixed-size stage, scaled to the viewport, holding
              its space in the column so the copy underneath never shifts as
              notes land. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '50%',
              top: stageTop,
              width: PILE.w * fit,
              height: PILE.h * fit,
              marginLeft: (-PILE.w * fit) / 2,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: PILE.w,
                height: PILE.h,
                transform: `scale(${fit})`,
                transformOrigin: 'top left',
              }}
            >
              {/* Every photograph's place is fixed for the whole piece. The
                  pile used to be re-centred as it grew, which meant a beat
                  arriving slid everything already on screen a little to the
                  left — the arrangement is dealt off-centre by design, so the
                  answer is the deal order in DEAL_SLOTS rather than a
                  correction applied on top of it. */}
              {PHOTOS.map((photo, i) => (
                <PilePhoto
                  key={photo.key}
                  photo={photo}
                  index={i}
                  beat={beat}
                  leaving={leaving}
                  reduceMotion={reduce}
                  offstage={offstage}
                />
              ))}
            </div>
          </div>

          {/* THE LINE — one slot every beat shares. Plain block flow, keyed by
              beat: the outgoing line simply leaves and the new one cascades in
              word by word. Anchored under the stage, and every beat hangs from
              the top of it, so a short line and a long one start in the same
              place. The whole slot goes with the scatter, so the words and the
              button are gone before the last note is. */}
          <motion.div
            initial={false}
            animate={{ opacity: leaving ? 0 : 1 }}
            transition={{ duration: leaving ? 0.32 : 0, ease }}
            style={{
              position: 'absolute',
              left: '50%',
              x: '-50%',
              top: copyTop,
              width: 'min(74vw, 660px)',
            }}
          >
            {current.text && (
              <div key={current.id}>
                {/* Nothing here scrolls, so the reveals take the beat's arrival
                    as their cue rather than an intersection that a fixed screen
                    can never report. */}
                <RevealWords
                  text={current.text}
                  as="h2"
                  cfg={word}
                  start
                  style={{
                    maxWidth: 620,
                    fontFamily: SERIF,
                    fontWeight: 400,
                    fontSize: current.fontSize,
                    lineHeight: 1.18,
                    letterSpacing: '-0.01em',
                    color: INK,
                  }}
                />
                {current.kicker && (
                  <BodyKicker
                    start
                    style={{
                      marginTop: 'clamp(10px, 2vh, 22px)',
                      maxWidth: 620,
                      fontFamily: SERIF,
                      fontWeight: 400,
                      fontSize: current.fontSize,
                      lineHeight: 1.18,
                      letterSpacing: '-0.01em',
                      color: INK,
                    }}
                  />
                )}
                {current.enter && (
                  <div style={{ marginTop: 'clamp(10px, 2vh, 22px)' }}>
                    <EnterButton onClick={leave} start delayS={enterDelayS} />
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
