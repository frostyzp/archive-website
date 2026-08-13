import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, cubicBezier, motion, useReducedMotion } from 'motion/react';
import { INK, inkA } from './colors';
import { PAGE_BG, PAGE_GRADIENT } from './NoiseGradient';
import { TunableGrainBackground } from './noise';
import AsciiWall from './AsciiWall';
import BodyKicker from './BodyKicker';
import PrintMargin, { BOOTH_CAPTION } from './PrintMargin';
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

/* How long a beat holds before its line starts writing itself.
 *
 * A beat is a photograph and a sentence about it, and the two used to arrive
 * together: the note was still in the air while its first words were already
 * fading up, so the eye had to choose between watching the paper land and
 * reading. The copy waits out the throw instead — the note is down and looked
 * at, and then the line begins — which is also what gives each beat a moment of
 * stillness at its head rather than running one beat's words into the next
 * beat's arrival.
 *
 * Everything a beat hangs off its own words carries the same wait, so the order
 * inside a beat is unchanged: only the whole thing has moved later.
 *
 * Nothing branches on reduced motion for this. Every reveal downstream already
 * resolves its own delay to zero there, so the hold simply doesn't exist on that
 * path — which is right, because a second of waiting for an animation that isn't
 * going to play is a second of a screen that looks stuck. */
const COPY_HOLD_S = 1;

const DEAL = {
  flyS: 0.62, //   s — offstage → resting place
  fadeS: 0.4, //   s — leaving the stage (stepping backwards)
  dimS: 0.4, //    s — the pile behind shading back
  /* s — how far before the new note lands the pile starts giving way to it.
   *
   * This used to be a gap on the other side of the landing: the note came to
   * rest, everything held still for a beat, and only then did the pile behind
   * shade back. Two events in sequence, and the second one looked like a
   * correction — as if the shading had been forgotten and applied late.
   *
   * Overlapping them makes it one event instead. The pile is already going dark
   * while the note is still coming down, so the arrival is what causes the dim
   * rather than something that follows it, and the note lands into a space that
   * has already been made for it.
   *
   * Worth knowing that the dim is all but over by the time the note is down,
   * even though it is nominally the longer of the two. `dimS` is eased out, so
   * most of the brightness is gone in the first third of it: measured, the pile
   * is 97% shaded at the moment of landing and only trails off afterwards. So
   * this number is really setting how much of the fall the pile reacts during,
   * not how much of the dim is left to see when it stops. */
  dimLeadS: 0.2,
  // A note arrives tilted this much further than it comes to rest at, leaning
  // the way it drifted, and turns square as it lands.
  turnDeg: 14,
  turnS: 0.78, // s — longer than the travel, so the turn outlasts the climb
  /* Stage units of sideways drift in the throw, alternating side by side down
     the pile. The rise is the whole gesture, but a set of prints that all came
     straight up by the same amount moved as one sheet — the pile only reads as
     a handful of separate photographs if each one arrives on its own line. Kept
     to a fraction of the climb (~7% of it on a laptop) so it is a lean in the
     paper's flight and not a slide with a rise attached. */
  driftX: 90,
};

/** Depth shading by how far back a photograph now sits. */
const DEPTH_DIM = [0, 0.28, 0.48, 0.62];

/* How much of that fraction is actually taken out of the card's brightness.
 *
 * At 0.55 the pile bottomed out at two thirds lit, which is not far enough to be
 * read as depth: every card was still plainly lit, so the pile looked like four
 * photographs of slightly different exposures rather than one on top of three
 * others. Light falling off is what says a card is underneath, and it has to
 * fall off hard — the front card is the only one being read, and the ones behind
 * it are there to be counted, not to be read. This puts the pile at 1.0 on top
 * and then 0.62, 0.35 and 0.16 going back: the second card shows its handwriting
 * only as texture, the third is paper without writing, and the fourth is an edge
 * and a shadow.
 *
 * There is a ceiling on this number and it is closer than it looks. The dim is
 * subtracted from full brightness, so the deepest card hits pure black at
 * 1 / 0.62 ≈ 1.61 and any more than that clips a card that has already gone as
 * dark as it can — the pile would keep losing its middle while the back stayed
 * put. Somewhere under that is as far as this ramp goes without being rebuilt as
 * a multiplicative one.
 *
 * Taken out of brightness rather than opacity on purpose. Fading the back cards
 * would let the page's own grain show through them and they would stop being
 * objects; darkening keeps them opaque paper that happens to be out of the
 * light. */
const DEPTH_DIM_FALLOFF = 1.35;

/** Paper shadow + depth shading, as one filter so it can be animated whole. */
const cardFilter = (dim) =>
  `drop-shadow(0 16px 34px rgba(0,0,0,0.5)) brightness(${1 - dim * DEPTH_DIM_FALLOFF})`;

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
  /* After a step: input is dead, and none of it is banked. Set past the head of
     a beat rather than to a round number of its own — at 900ms a reader swiping
     twice in quick succession could land on a beat and leave it again while it
     was still holding, so the note flew in, nothing was said, and the next one
     followed. The window now runs a couple of words into the cascade, which is
     the least that reads as having been shown the line at all. */
  graceMs: COPY_HOLD_S * 1000 + 250,
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
  caption: BOOTH_CAPTION,
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

/* The way out clears the pile before the archive opens, and every part of it
   starts on the frame the gesture is recognised on. Nothing waits: a swipe
   answered by half a second of a pile holding still reads as a swipe that missed,
   and the reader's own hand is what the movement has to look like it came from.

   The booth only fades, where it lies — it is the photograph that opened the
   telling, and the frame the confessions were collected in, so it is put down
   rather than thrown. It goes at the same moment as the rest and not in front of
   them: sending it first and queueing the notes behind it buys an order of
   departure that by this beat is under three other photographs, at the price of
   the half second in which the visible pile does nothing. The notes leave over
   the top of it, up and out along the line from the middle of the pile through
   where each one lies, in the order they arrived, shrinking slightly as they go:
   the story unmakes itself and hands the screen over rather than being cut away
   from.

   They deliberately do not go back down the way they came up. The rise belongs
   to the swipe that deals a note, so running it backwards reads as the story
   being taken back off the reader — which is exactly right for swiping BACK a
   beat, and exactly wrong here, where the pile is clearing to let the archive
   through. Opening outward is the pile getting out of the way. */
const DISPERSE = {
  /* s — the booth, fading in place rather than travelling.
   *
   * Short, and shorter than it looks like it needs to be, because it is the only
   * thing in the exit that does not move. The notes are gone from the eye long
   * before their flights end — each one is across the screen edge inside the
   * first third of its 0.92s — so a booth still fading on its own clock is left
   * sitting in the middle of an emptying screen, and what had been the bottom of
   * a pile reads as a photograph that was forgotten. At 0.44 it was still faintly
   * there while the last note was clearing.
   *
   * It also has an ease-out on it, which front-loads the fade and then trails:
   * most of the opacity goes in the first third of whatever this is set to, and
   * the rest is a tail at low alpha. That tail is the part that was being seen,
   * so the number that matters is not when this ends but when it stops being
   * legible — which is now well inside the first note's departure. */
  firstFadeS: 0.22,
  /* When each note goes, in s after the gesture: at once, then 100ms and 180ms.
     Written out rather than as a single interval because the interval tightens:
     100ms, then 80ms. An even step made three departures read as a metronome;
     closing the gap makes them read as one movement gathering pace, which is also
     what stops the last note holding the screen on its own. The first entry is
     zero and has to stay zero — it is the thing that makes the pile answer the
     hand rather than answer a timer. */
  queueS: [0, 0.1, 0.18],
  flyS: 0.92, //       s — a note's own way off the stage
  /* s — the point in that flight where the note is off the screen. It is over the
     top edge inside the first third of the flight and spends the rest of the
     duration travelling where nobody can see it, so anything that is meant to
     follow the exit hangs off this rather than off flyS — the same way
     DEAL.landedS stands in front of the entrance's own travel. Off flyS the
     archive arrived to most of a second of a screen that was already empty.
   *
     Measured at 1440×900, each note is across the edge 283–339ms into its own
     flight, so this stands where it did when the fan pointed outward — but it now
     stands there accurately. Radially, the widest note left sideways and took
     ~488ms of its flight to do it, and this constant was reading the hand-off
     nearly 200ms early. Tilting the fan up sends all three at the nearest edge
     instead, which is the one it was always describing. */
  clearedS: 0.3,
  travel: 1500, //     stage units — clears any viewport once scaled
  /* How far the outward fan is tilted up, in units of the outward direction
     itself. Purely radial, two of the three notes leave downwards: they lie below
     the middle of the pile, so "away from the centre" points at the bottom of the
     screen, and the one lying dead centre and 8 units under it goes straight down.
     A print that falls while its neighbours climb reads as dropped rather than
     let go of, and it falls back into the edge the reader has just watched all
     three of them come up out of.
   *
   * Added to the direction, which is then renormalised, rather than every note
   * being given one shared upward path. The spread is what makes the pile come
   * apart into separate photographs instead of leaving as a single sheet, and it
   * survives this as three different climbing angles drawn from the same resting
   * places — the fan is tilted, not collapsed.
   *
   * Anything past 1 clears the steepest downward line there is, which is a note
   * lying directly below the centre; the margin above 1 is what turns "not
   * falling" into "climbing". At this setting the three leave at roughly 26° left
   * of vertical, straight up, and 35° right of it. */
  lift: 1.7,
  /* The front print's fade, and how long after its flight starts it begins.
     Everything behind it keeps the trailing fade below: 70% of the flight,
     starting 30% in.
   *
     That trailing fade was written for prints that spend most of their flight on
     screen, and the front one doesn't. It goes last, at 180ms, and is over the top
     edge 270–340ms into its own flight — which is where the trailing fade has only
     just started, so the card left the frame at full strength and did all of its
     fading where nobody could see it. It read as the top card being slid off
     rather than let go of.
   *
     So it starts almost at once and takes about a third of the flight, reaching
     nothing at ~290ms — inside the window where it crosses the edge, so the whole
     dissolve happens on screen and the sliver of travel left afterwards is
     already invisible. Not shorter than this: under ~200ms the card stops reading
     as dissolving and starts reading as switched off, and a print that blinks out
     while the two behind it are still coasting looks deleted rather than dealt
     away. Not zero delay either — a print has to be seen to move before it is
     seen to go, or the fade reads as the thing the gesture did. */
  frontFadeS: 0.26,
  frontFadeLeadS: 0.03,
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

/** When note `n` of the queue leaves, s after the gesture. */
const disperseDelay = (n) => DISPERSE.queueS[Math.min(n, DISPERSE.queueS.length - 1)];

/** The exit as the reader sees it: gesture to the last note off the screen. */
const DISPERSE_MS =
  (disperseDelay(PHOTOS.length - 2) + DISPERSE.clearedS + DISPERSE.holdS) * 1000;

/**
 * Where a note goes when the pile clears: up and out along the line from the
 * middle of the stage through where it was dealt, so the group opens up rather
 * than sliding off as a block — bowed off that line as it goes (see arcKeyframes)
 * and tumbling the same way it bends. `order` is its place in the deal.
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

  // The notes count their own queue, the booth going alongside them rather than
  // ahead of them.
  const delay = disperseDelay(order - 1);
  // The print on top of the pile — dealt last, leaving last, and the one the
  // reader is actually looking at. It fades on its own schedule.
  const front = order === PHOTOS.length - 1;
  // Outward (radial) from the middle of the pile, tilted up (see DISPERSE.lift),
  // and the side the note tumbles toward — which stays with where the note lies
  // rather than with where it is now headed, so the tumble and the arc still read
  // off the arrangement the reader is looking at.
  const len = Math.hypot(x, y) || 1;
  const tiltX = x / len;
  const tiltY = y / len - DISPERSE.lift;
  const tilt = Math.hypot(tiltX, tiltY) || 1;
  const ux = tiltX / tilt;
  const uy = tiltY / tilt;
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
      // vanish on its way — except on the front print, which goes sooner.
      opacity: front
        ? {
            duration: DISPERSE.frontFadeS,
            ease: EASE_EXIT,
            delay: delay + DISPERSE.frontFadeLeadS,
          }
        : {
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
    // Cut back with the others (was 0.16 / 1.15, a 3.5s sentence) but still held
    // a step behind them, since the relationship is what carries the emphasis,
    // not the absolute pace.
    word: { staggerS: 0.1, durS: 0.7 },
    enter: true,
  },
];

const LAST = BEATS.length - 1;

/** Beat 0 carries no photograph, so the pile runs a beat behind. */
const dealtCount = (beat) => Math.min(PHOTOS.length, beat);

/**
 * How far BELOW its resting place a note waits, in stage units: past the bottom
 * of the window by a whole card, so it is entirely off the page whatever the
 * window size and reads as coming from outside the site rather than from just
 * past the frame.
 *
 * The prints come up from under the screen because that is the way the reader's
 * own hand moves: a swipe up is what deals the next one, so the paper travels
 * with the thumb that threw it. Notes used to fly in from the left and right
 * edges, which was a handsome throw but a throw from nowhere in particular —
 * the gesture and the picture were moving on different axes.
 *
 * Measured against the WINDOW's height and against where the stage actually
 * sits, not against the card's own height: the pile is anchored high enough on
 * the screen to leave the copy its slot, so half of a card below a low-sitting
 * note is still well inside the frame and the note would be seen waiting in the
 * bottom of the page for its beat. Measured rather than fixed for the same
 * reason the horizontal one was — the stage is scaled to fit, so a constant
 * clears a phone and sits on screen on a wide desktop.
 */
const offstageY = (vh, stageTop, fit) => (vh - stageTop) / fit - PILE.h / 2 + CARD.h;

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
  // The side this one leans in from, and the way its tilt unwinds with it.
  const from = index % 2 === 0 ? -1 : 1;

  if (!dealt) {
    return {
      animate: {
        // Waiting under the screen, a little to one side of the place it is
        // going, so the climb is what carries it and the drift only shapes the
        // line it climbs on. Offset from its resting place rather than from the
        // middle of the stage, so every note has the same distance to cover and
        // the pile's own scatter isn't paid for twice.
        x: reduceMotion ? rest.x : rest.x + from * DEAL.driftX,
        y: reduceMotion ? rest.y : rest.y + offstage,
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
            ? {
                duration: DEAL.dimS,
                ease: EASE_OUT,
                delay: Math.max(0, DEAL.flyS - DEAL.dimLeadS),
              }
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
      <div style={{ position: 'relative', width: '100%', flex: 'none' }}>
        {/* Inside the card rather than under it, so the margin takes the pile's
            tilt, its flight and its place in the stack without being given any
            of them separately — and so it cannot outlive the print it belongs to
            when the pile scatters. Nothing sits under the pile, so its depth is
            left unreserved and it simply hangs. */}
        {photo.caption ? <PrintMargin frameWidth={width}>{photo.caption}</PrintMargin> : null}
        <img
          src={photo.src}
          alt={photo.alt}
          draggable={false}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            userSelect: 'none',
          }}
        />
      </div>
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
  /* Whether the way out is open yet — see the effect that arms it, down by
     enterDelayS, where the reason it isn't open from the first frame lives. */
  const [exitArmed, setExitArmed] = useState(false);

  /* The way out scatters the pile first and opens the archive after — the piece
     clears its own screen rather than being cut off mid-sentence. Reduced
     motion has nothing to watch, so it goes straight through, on the same frame
     as the gesture: a reader who has asked for less movement should not be held
     on the last beat waiting out an animation that isn't going to play.
   *
   * Every way out arrives here — the swipe, the wheel, the forward keys, the
   * click — and on the closing beat two of them can land in the same tick, since
   * the space bar both activates the focused control and reads as a step
   * forward. The pile can only be scattered once and the archive can only be
   * opened once, so the first caller wins and the rest are dropped. On a ref
   * rather than on `leaving`, which is a render behind and would let a pair of
   * events in one tick both through. */
  const leftRef = useRef(false);
  const leave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    if (reduce) {
      onEnter();
      return;
    }
    setLeaving(true);
  }, [onEnter, reduce]);

  /* The archive is asked for once the prints are off the screen rather than once
     their flights have finished — see DISPERSE.clearedS. The two overlap on
     purpose: the notes are still formally in the air, out past the edges, while
     the grid begins to fly in, so the hand-off is one movement instead of an exit
     followed by a wait followed by an entrance. Waiting for the flights to end
     spent most of a second on an empty screen, and cutting before the notes have
     cleared takes the pile away mid-throw. */
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

  /* Forward off the end of the story is the way into the archive, not a beat
     that isn't there. The piece is already listening for the gesture on three
     inputs, so the exit is that same listener reaching its end rather than a
     second set of handlers bolted on beside them — which is also why a swipe, a
     trackpad flick, a forward key and the ENTER control all leave by one path
     and get the archive's entrance choreography identically.
   *
   * The last beat still holds its ground until `exitArmed`. The grace window is
   * shorter than the closing beat's own cascade, so a reader arriving on two
   * quick swipes would otherwise be thrown out of the piece before its final
   * sentence had finished writing itself — a forward gesture there does nothing,
   * exactly as it did when there was nowhere further to go. */
  const step = useCallback(
    (dir) => {
      if (dir > 0 && beat === LAST) {
        if (exitArmed) leave();
        return;
      }
      setBeat((b) => Math.min(LAST, Math.max(0, b + dir)));
    },
    [beat, exitArmed, leave]
  );

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
    // A laptop's worth of screen, until the first measurement lands: the notes
    // are only ever asked to be off the bottom of it, and being too far under
    // one costs a frame of a beat nobody has swiped to yet.
    offstage: offstageY(900, 0, 1),
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
      const stageTop = Math.max(24, Math.min(centred, lowest));
      setBox({
        fit,
        slotH,
        stageTop,
        // Where the notes wait is a consequence of where the pile ends up, so
        // it is taken from the same measurement rather than guessed alongside it.
        offstage: offstageY(vh, stageTop, fit),
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
     word starts its own fade — counted from where the words actually begin, so
     the beat's own hold is in front of it too. */
  const word = current.word ?? WORD_DISPLAY;
  const enterDelayS = useMemo(() => {
    if (!current.text) return undefined;
    const words = current.text.split(/\s+/).filter(Boolean).length;
    return COPY_HOLD_S + Math.max(0.5, (words - 1) * word.staggerS);
  }, [current.text, word.staggerS]);

  /* The gesture out and the arrow that offers it open at the same instant, off
     the one number, because they are the same thing said twice: a swipe that
     works before there is an arrow to take it from is a hidden exit, and an
     arrow that is there before the swipe answers is a promise the page breaks.
   *
   * Disarmed again on the way back, so returning to the closing beat re-earns
   * the exit rather than inheriting it. Reduced motion has no cascade to wait
   * out — every reveal downstream resolves its delay to zero there, and holding
   * the way out shut for two seconds of an animation that isn't going to play is
   * a screen that looks stuck — so it is open from the first frame. */
  useEffect(() => {
    if (beat !== LAST) {
      setExitArmed(false);
      return undefined;
    }
    if (reduce || !enterDelayS) {
      setExitArmed(true);
      return undefined;
    }
    const id = setTimeout(() => setExitArmed(true), enterDelayS * 1000);
    return () => clearTimeout(id);
  }, [beat, enterDelayS, reduce]);

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
            its place while the hero fades off it.
         *
            The field is a sibling of the fading group rather than inside it. A
            parent's opacity takes everything under it at one rate, so while the
            wall lived in there it could only ever leave as a single sheet — the
            per-word exit it now runs would have been flattened by the group's
            own fade on top of it. `zIndex: 0` is what keeps this box a stacking
            context now that it is not always mid-fade, so the field's `-1` still
            resolves against the hero rather than against the whole page. */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          {/* The same gate the title takes, so the field starts writing a beat
              after the title starts revealing rather than on its own clock. */}
          <AsciiWall start={!loading && titleGate} leaving={beat !== 0} />
        </div>
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
                    can never report — and then wait out the throw (COPY_HOLD_S)
                    before the line starts writing itself. */}
                <RevealWords
                  text={current.text}
                  as="h2"
                  cfg={word}
                  start
                  delayStart={COPY_HOLD_S}
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
                    delayS={COPY_HOLD_S}
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
                    {/* The hero's scroll cue, come back for the last beat, and
                        standing where the words used to. The page opens by asking
                        for this gesture and closes by asking for it again — the
                        same arrow, so the second ask is recognised rather than
                        learned, and the last thing the reader is asked to do is
                        the first thing they were taught. It rides inside the
                        control, so the arrow is also what a pointer or a keyboard
                        presses and every way out lands in one place.
                      *
                      * Shown off `exitArmed` rather than a delay of its own: the
                      * arrow is the visible half of the exit being open. */}
                    <EnterButton
                      onClick={leave}
                      start
                      delayS={enterDelayS}
                      // Riding up rather than down: the swipe this beat waits
                      // for goes up, and so does every photograph on the pile
                      // behind it. An arrow falling under a stack of prints
                      // that just climbed asks for the opposite of what the
                      // page answers.
                      cue={<ScrollCue show={exitArmed} rise />}
                    />
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
