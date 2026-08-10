import { useEffect, useMemo, useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'motion/react';
import { INK, inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * ONBOARDING STACK LAB  —  /entrance?tab=onboarding
 *
 * Low-fi scroll study for a card-led onboarding. Four notes in a centre
 * stack; each beat cycles the face to the back and lands copy L/R.
 *
 * SWAP VARIANTS (keys 1–5, or the strip under the title)
 *
 *   slide    Everyone eases to their new slot — the baseline hand-off.
 *   toss     Face flies out wide, then drops into the back of the deck.
 *   shuffle  Face arcs under the pile and tucks in at the back.
 *   peel     Face lifts up and fades; the next card is already waiting.
 *   deal     The odd one out: the deck BUILDS. One note to start, and each
 *            beat flies another in on top, ending on all four.
 *   deal v2  Same pile, different copy. Instead of landing L/R, one centred
 *            line under the stack fades out and the next fades in.
 *
 * ← / → step beats without scrolling; R resets to beat 0.
 * ───────────────────────────────────────────────────────────────────── */

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const SERIF = "'Faktory', Georgia, serif";
const COURIER = "'Courier New', Courier, monospace";
const EASE_OUT = [0.165, 0.84, 0.44, 1];
const EASE_IN_OUT = [0.45, 0, 0.55, 1];

const noteSrc = (id) => `/confession_notes_2/${id}.webp`;

/* The intro's own notes, in the order OnboardingReveal walks through them
   (see its NOTES), plus a fourth for the closing beat. Shown as the scans
   themselves — no card stock behind them, nothing cropped. */
const CARDS = [
  { id: 'AC_171', label: '01' },
  { id: 'AC_148', label: '02' },
  { id: 'AC_185', label: '03' },
  { id: 'AC_006', label: '04' },
];

const BEATS = [
  {
    side: 'left',
    kicker: '01',
    text: 'We asked strangers to write a confession about their relationship with AI.',
  },
  {
    side: 'right',
    kicker: '02',
    text: 'AI is entering into the most personal aspects of our lives.',
  },
  {
    side: 'left',
    kicker: '03',
    text: 'And even substituting our human relationships…',
  },
  {
    side: 'right',
    kicker: '04',
    text: 'Every note is a real story from a real person about living with this new technology.',
  },
];

const CARD = {
  w: 220,
  h: 260,
  radius: 2,
};

/* DEAL timings. The note arrives on a plain ease-out — it's a piece of paper
   being set down, so it decelerates and stops rather than springing. The pile
   behind only shades back once that landing is finished, so you never see two
   notes changing at the same time. */
const DEAL = {
  flyS: 0.62, //   s — offstage → resting place
  fadeS: 0.4, //   s — leaving the stage (stepping backwards)
  dimS: 0.4, //    s — the pile behind shading back
  dimGap: 0.04, // s — beat of stillness after the landing before it does
};

/* DEAL V2 copy. One line holds the centre under the stack, so the words can't
   cross-fade in place without turning to mush mid-swap — the outgoing line has
   to be gone before the next one starts. Hence out, pause, in. */
const CENTRE_COPY = {
  outS: 0.26, //   s — current line letting go
  inS: 0.42, //    s — next line arriving
  holdS: 0.12, //  s — empty beat between the two
};

/* PROMPT DRIFT — beat 1 only. The empty-chatbox lines every assistant opens
   with, rising through the copy and gone by the top of it. They're wallpaper,
   not reading material: courier, grey, and never still long enough to finish
   a second look. */
const PROMPTS = [
  'How can I help you today?',
  'Ask anything',
  'What can I help with?',
  'Message ChatGPT…',
  "What's on your mind?",
  'Ask me anything',
  'How can I assist you?',
  'Type a message…',
  'Where should we begin?',
];

const DRIFT = {
  gapS: 1.4, //      between one appearing and the next: three in the air
  gapJitter: 0.5, // ± on that gap, so it never finds a rhythm
  bandPx: 150, //    the run: appears at the foot of this, gone at the head
  centreBandPx: 104, // v2 sits low on the screen; a shorter run stays in frame
  offsetPx: 30, //   clear air between the copy and the head of the run
  centreOffsetPx: 22,
  riseS: 4.2, //     time for that climb
  riseJitter: 0.5, // ± on it — kept small, or a fast line runs into a slow one
  fadeIn: 0.14, //   share of the climb spent arriving
  fadeOut: 0.34, //  share spent leaving, before it can touch the copy
  driftPx: 30, //    sideways wander, so they don't rise in a column
};

/* Deal v2 steps on gestures rather than scroll position, so a hard flick can't
   run through the whole sequence. */
const SWIPE = {
  // Distance a gesture has to cover before it counts — accumulated, not per
  // event, because a trackpad opens a flick with sub-pixel deltas while a
  // mouse wheel arrives at full size on the first notch.
  thresholdPx: 26,
  quietMs: 300, //  silence that separates one flick from the next
  // A mouse wheel rolled steadily never falls quiet, so a full-size notch
  // starts a fresh gesture on its own. Set above anything a trackpad's tail is
  // still producing once the grace period is over, and below one notch (~100px).
  notchPx: 44,
  // Grace period after a step: the wheel is dead, and nothing that arrives in
  // it is banked for later. Long enough to outlast the beat itself (note flight
  // 0.62s, copy swap 0.80s) plus the slack a trackpad's momentum tail needs to
  // fall quiet — otherwise one throw of the fingers walks the whole sequence.
  graceMs: 900,
};

/** Resting places for a 4-deep stack — index 0 is the face. `dim` is the
 *  depth shading every mode uses on the notes behind the one being read. */
const SLOTS = [
  { x: 0, y: 0, scale: 1, rotate: -2.2, z: 4, dim: 0 },
  { x: 14, y: 12, scale: 0.96, rotate: 1.8, z: 3, dim: 0.28 },
  { x: -10, y: 24, scale: 0.92, rotate: -1.2, z: 2, dim: 0.48 },
  { x: 6, y: 36, scale: 0.88, rotate: 2.4, z: 1, dim: 0.62 },
];

/** Paper shadow + depth shading, as one filter so it can be animated whole. */
const cardFilter = (dim) =>
  `drop-shadow(0 16px 34px rgba(0,0,0,0.5)) brightness(${1 - dim * 0.55})`;

/* DEAL — the stack builds instead of cycling. Card i lands on beat i, on top
   of everything before it, so the deck grows to four. Offsets are a loose
   scatter rather than a neat pile: every note underneath keeps an edge showing,
   which is what makes the last beat read as "four confessions" rather than as
   one card with shadows. */
const DEAL_SLOTS = [
  { x: -68, y: -48, rotate: -7.5, scale: 0.94 },
  { x: 54, y: -18, rotate: 5.5, scale: 0.96 },
  { x: -44, y: 26, rotate: -3, scale: 0.98 },
  { x: 48, y: 54, rotate: 7, scale: 1 },
];

/* THE CLUSTER — once the fourth note has landed, five more fly into the middle
   and tuck in behind it. They aren't part of the story; they're the rest of the
   archive arriving, so they sit under the four you've read with only their
   edges showing, and never spread far enough to become their own shape.
   `from` is the side each one enters from. */
const CLUSTER = [
  { id: 'AC_012', x: -92, y: -70, rotate: -12, scale: 0.88, from: -1 },
  { id: 'AC_133', x: 84, y: -54, rotate: 9, scale: 0.9, from: 1 },
  { id: 'AC_057', x: -76, y: 58, rotate: 7, scale: 0.88, from: -1 },
  { id: 'AC_150', x: 80, y: 72, rotate: -8, scale: 0.92, from: 1 },
  { id: 'AC_166', x: 0, y: 88, rotate: 4, scale: 0.86, from: 1 },
];

/**
 * How far to slide the whole pile so it sits on the middle of the screen.
 *
 * The scatter is deliberately lopsided, which means any given beat's notes are
 * off to one side — most obviously the opening beat, a single note sitting well
 * left of the copy under it. Measuring what's actually on screen and nudging the
 * group back keeps every beat centred without flattening the scatter.
 */
function dealCentreOffset(beat) {
  const notes = DEAL_SLOTS.slice(0, beat + 1).map((s) => ({
    x: s.x,
    w: CARD.w * s.scale,
  }));
  if (beat === BEATS.length - 1) {
    CLUSTER.forEach((n) => notes.push({ x: n.x, w: CARD.w * n.scale }));
  }
  const left = Math.min(...notes.map((n) => n.x - n.w / 2));
  const right = Math.max(...notes.map((n) => n.x + n.w / 2));
  return -(left + right) / 2;
}

const CLUSTER_IN = {
  gapS: 0.18, //  s — pause after the fourth note lands
  stepS: 0.09, // s — between each arrival, so they read as a flurry
  flyS: 0.58, //  s — offstage → its place in the ring
  dim: 0.66, //   further back than any note in the pile
};

const SWAP = {
  slide: {
    id: 'slide',
    label: 'Slide',
    hint: 'ease into new slots',
  },
  toss: {
    id: 'toss',
    label: 'Toss',
    hint: 'face flies out, then to the back',
  },
  shuffle: {
    id: 'shuffle',
    label: 'Shuffle',
    hint: 'arcs under the deck',
  },
  peel: {
    id: 'peel',
    label: 'Peel',
    hint: 'lifts off and fades',
  },
  deal: {
    id: 'deal',
    label: 'Deal',
    hint: 'each beat flies a new note onto the pile',
  },
  dealCentre: {
    id: 'dealCentre',
    label: 'Deal v2',
    hint: 'same pile, one centred line fading out then in',
  },
};

const SWAP_ORDER = ['slide', 'toss', 'shuffle', 'peel', 'deal', 'dealCentre'];

/** Both deal variants build the same pile; only the copy differs. */
const isDeal = (variant) => variant === 'deal' || variant === 'dealCentre';

function slotForCard(cardIndex, beat) {
  return (cardIndex - beat + CARDS.length) % CARDS.length;
}

/**
 * DEAL pose. Card `i` is offstage until beat `i`, then flies in and stays.
 *
 * It enters from the side OPPOSITE that beat's copy, so the note crosses the
 * empty half of the screen and never wipes over the words on its way in.
 */
function dealPose({ cardIndex, beat, reduceMotion }) {
  const rest = DEAL_SLOTS[cardIndex];
  const dealt = cardIndex <= beat;
  // How far back in the pile this note now sits. 0 is the one that just landed.
  const depth = Math.max(0, beat - cardIndex);

  if (!dealt) {
    // Waiting offstage, on the side opposite its own beat's copy.
    const from = BEATS[cardIndex]?.side === 'left' ? 1 : -1;
    return {
      dim: 0,
      animate: {
        x: reduceMotion ? rest.x : from * 620,
        y: reduceMotion ? rest.y : -40,
        rotate: reduceMotion ? rest.rotate : from * 16,
        scale: 0.92,
        opacity: 0,
        filter: cardFilter(0),
        zIndex: cardIndex + 1,
      },
      transition: reduceMotion
        ? { duration: 0 }
        : { duration: DEAL.fadeS, ease: EASE_OUT, zIndex: { duration: 0 } },
    };
  }

  // Notes already on the pile stay fully opaque and shade back instead — the
  // same depth ladder the cycling modes use, so the pile reads as paper sitting
  // under paper rather than as notes going transparent.
  const behind = depth > 0;
  const dim = SLOTS[Math.min(depth, SLOTS.length - 1)].dim;

  return {
    dim: 0,
    animate: {
      x: rest.x,
      y: rest.y,
      rotate: rest.rotate,
      scale: rest.scale,
      opacity: 1,
      filter: cardFilter(dim),
      zIndex: cardIndex + 1,
    },
    transition: reduceMotion
      ? { duration: 0 }
      : {
          duration: DEAL.flyS,
          ease: EASE_OUT,
          opacity: { duration: 0.24, ease: EASE_OUT },
          filter: behind
            ? {
                duration: DEAL.dimS,
                ease: EASE_OUT,
                // Held until the incoming note is at rest.
                delay: DEAL.flyS + DEAL.dimGap,
              }
            : { duration: 0.24, ease: EASE_OUT },
          zIndex: { duration: 0 },
        },
  };
}

/**
 * Pose + transition for one card on a beat change.
 *
 * `leaving` — this card was the face and is heading to the back.
 * `swapGen` — bumps on every beat change so keyframed exits re-fire.
 */
function poseForSwap({ slot, leaving, variant, reduceMotion, swapGen, dir }) {
  const rest = SLOTS[slot];
  const instant = reduceMotion
    ? { duration: 0 }
    : undefined;

  if (reduceMotion || !leaving || variant === 'slide' || swapGen === 0) {
    return {
      animate: {
        x: rest.x,
        y: rest.y,
        scale: rest.scale,
        rotate: rest.rotate,
        opacity: 1,
        zIndex: rest.z,
      },
      transition: instant || {
        duration: 0.55,
        ease: EASE_OUT,
        zIndex: { duration: 0 },
      },
    };
  }

  // Direction of the toss / peel follows the incoming copy side a little —
  // forward scroll peels toward the next beat's side.
  const side = dir >= 0 ? 1 : -1;

  if (variant === 'toss') {
    return {
      animate: {
        x: [SLOTS[0].x, side * 210, rest.x],
        y: [SLOTS[0].y, -70, rest.y],
        scale: [1, 1.04, rest.scale],
        rotate: [SLOTS[0].rotate, side * 22, rest.rotate],
        opacity: [1, 0.85, 1],
        zIndex: [6, 6, rest.z],
      },
      transition: {
        duration: 0.72,
        ease: EASE_IN_OUT,
        times: [0, 0.42, 1],
        zIndex: { duration: 0, times: [0, 0.42, 1] },
      },
    };
  }

  if (variant === 'shuffle') {
    // Duck under mid-flight: z drops after the arc apex so the card tucks
    // behind the remaining stack instead of sliding over it.
    return {
      animate: {
        x: [SLOTS[0].x, side * -130, rest.x],
        y: [SLOTS[0].y, 48, rest.y],
        scale: [1, 0.94, rest.scale],
        rotate: [SLOTS[0].rotate, side * -14, rest.rotate],
        opacity: 1,
        zIndex: [5, 0, rest.z],
      },
      transition: {
        duration: 0.68,
        ease: EASE_IN_OUT,
        times: [0, 0.48, 1],
        zIndex: { duration: 0, times: [0, 0.48, 1] },
      },
    };
  }

  // peel — lift up + fade, then settle into the back slot (invisible hop).
  return {
    animate: {
      x: [SLOTS[0].x, SLOTS[0].x, rest.x],
      y: [SLOTS[0].y, -140, rest.y],
      scale: [1, 1.02, rest.scale],
      rotate: [SLOTS[0].rotate, -6, rest.rotate],
      opacity: [1, 0, 0, 1],
      zIndex: [6, 6, rest.z],
    },
    transition: {
      duration: 0.64,
      ease: EASE_OUT,
      times: [0, 0.5, 1],
      opacity: { duration: 0.64, times: [0, 0.42, 0.55, 1], ease: EASE_OUT },
      zIndex: { duration: 0 },
    },
  };
}

function StackCard({
  card,
  cardIndex,
  beat,
  slot,
  leaving,
  variant,
  reduceMotion,
  swapGen,
  dir,
}) {
  const deal = isDeal(variant);
  const dealt = deal ? dealPose({ cardIndex, beat, reduceMotion }) : null;
  const swap = deal
    ? null
    : poseForSwap({ slot, leaving, variant, reduceMotion, swapGen, dir });

  const animate = deal ? dealt.animate : swap.animate;
  const transition = deal ? dealt.transition : swap.transition;
  const dim = deal ? dealt.dim : SLOTS[slot].dim;

  return (
    <motion.div
      layout={false}
      initial={false}
      animate={animate}
      transition={transition}
      style={{
        position: 'absolute',
        // The scan IS the card — no stock behind it, so the note is never
        // cropped to a tile and keeps its own torn edge.
        width: CARD.w,
        // drop-shadow (not box-shadow) so the shadow follows the paper's
        // silhouette instead of a rectangle around it. In deal the shading is
        // animated, so the pose owns the filter and this stays out of its way.
        ...(deal ? null : { filter: cardFilter(dim) }),
        willChange: 'transform, opacity, filter',
      }}
    >
      <img
        src={noteSrc(card.id)}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          userSelect: 'none',
        }}
      />
    </motion.div>
  );
}

/**
 * One beat's words. Two placements:
 *
 *   side    (default) lands on this beat's own left/right margin, drifting in
 *           from its outer edge.
 *   centre  (deal v2) every beat shares one slot under the stack, so it can
 *           only fade — and the outgoing line clears before the next arrives.
 */
/** One of the five notes that ring the pile on the closing beat. */
function ClusterNote({ note, index, active, reduceMotion }) {
  const settled = {
    x: note.x,
    y: note.y,
    rotate: note.rotate,
    scale: note.scale,
    opacity: 1,
  };

  return (
    <motion.div
      initial={false}
      animate={
        active
          ? settled
          : {
              x: reduceMotion ? note.x : note.from * 640,
              y: reduceMotion ? note.y : -60,
              rotate: reduceMotion ? note.rotate : note.from * 18,
              scale: 0.9,
              opacity: 0,
            }
      }
      transition={
        reduceMotion
          ? { duration: 0 }
          : active
            ? {
                duration: CLUSTER_IN.flyS,
                ease: EASE_OUT,
                // Held until the last of the four is down.
                delay: DEAL.flyS + CLUSTER_IN.gapS + index * CLUSTER_IN.stepS,
              }
            : { duration: 0.3, ease: EASE_OUT }
      }
      style={{
        position: 'absolute',
        width: CARD.w,
        zIndex: 0, // always under the four being read
        filter: cardFilter(CLUSTER_IN.dim),
        willChange: 'transform, opacity',
      }}
    >
      <img
        src={noteSrc(note.id)}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          userSelect: 'none',
        }}
      />
    </motion.div>
  );
}

function PromptDrift({ active, align, reduceMotion, band, offset }) {
  const [lines, setLines] = useState([]);
  const seq = useRef(0);
  const lastPick = useRef(-1);

  useEffect(() => {
    if (!active || reduceMotion) {
      setLines([]);
      return undefined;
    }

    let timer;
    const spawn = () => {
      let pick = Math.floor(Math.random() * PROMPTS.length);
      if (pick === lastPick.current) pick = (pick + 1) % PROMPTS.length;
      lastPick.current = pick;

      seq.current += 1;
      setLines((cur) => [
        ...cur,
        {
          key: seq.current,
          text: PROMPTS[pick],
          riseS: DRIFT.riseS + (Math.random() * 2 - 1) * DRIFT.riseJitter,
          drift: (Math.random() * 2 - 1) * DRIFT.driftPx,
        },
      ]);

      const gap = DRIFT.gapS + (Math.random() * 2 - 1) * DRIFT.gapJitter;
      timer = setTimeout(spawn, gap * 1000);
    };

    spawn();
    return () => clearTimeout(timer);
  }, [active, reduceMotion]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {lines.map((line) => (
        <motion.p
          key={line.key}
          initial={{ y: band, x: 0, opacity: 0 }}
          animate={{ y: 0, x: line.drift, opacity: [0, 1, 1, 0] }}
          transition={{
            duration: line.riseS,
            ease: 'linear', // a steady rise; any easing reads as a swipe
            opacity: {
              duration: line.riseS,
              ease: 'linear',
              times: [0, DRIFT.fadeIn, 1 - DRIFT.fadeOut, 1],
            },
          }}
          // Gone by the head of the run, and out of the array with it.
          onAnimationComplete={() =>
            setLines((cur) => cur.filter((l) => l.key !== line.key))
          }
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            margin: `${offset}px 0 0`,
            fontFamily: COURIER,
            fontSize: 13,
            letterSpacing: '0.02em',
            color: inkA(0.3),
            textAlign: align,
            whiteSpace: 'nowrap',
            willChange: 'transform, opacity',
          }}
        >
          {line.text}
        </motion.p>
      ))}
    </div>
  );
}

function BeatCopy({ beat, active, reduceMotion, centre = false, drift = false }) {
  const left = beat.side === 'left';
  const align = centre ? 'center' : left ? 'left' : 'right';

  const placement = centre
    ? {
        // Clear of the pile, and of the cluster tucked behind it on the last
        // beat, which reaches a little lower than the four notes do.
        top: 'calc(50% + 158px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(62vw, 560px)',
      }
    : {
        top: '50%',
        [left ? 'left' : 'right']: 'clamp(24px, 8vw, 120px)',
        [left ? 'right' : 'left']: 'auto',
        transform: 'translateY(-50%)',
        width: 'min(34vw, 340px)',
      };

  const motionState = centre
    ? { opacity: active ? 1 : 0, x: 0, y: 0 }
    : {
        opacity: active ? 1 : 0,
        y: active ? 0 : reduceMotion ? 0 : 14,
        x: active ? 0 : reduceMotion ? 0 : left ? -18 : 18,
      };

  let transition;
  if (reduceMotion) {
    transition = { duration: 0 };
  } else if (centre) {
    // The incoming line waits out the outgoing one, so the slot is briefly
    // empty instead of two lines overlapping.
    transition = active
      ? {
          duration: CENTRE_COPY.inS,
          ease: EASE_OUT,
          delay: CENTRE_COPY.outS + CENTRE_COPY.holdS,
        }
      : { duration: CENTRE_COPY.outS, ease: EASE_OUT };
  } else {
    transition = { duration: 0.45, ease: EASE_OUT };
  }

  return (
    <div
      style={{ position: 'absolute', pointerEvents: 'none', ...placement }}
      aria-hidden={!active}
    >
      <motion.div
        initial={false}
        animate={motionState}
        transition={transition}
        style={{ position: 'relative' }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: SERIF,
            fontWeight: 400,
            fontSize: 'clamp(22px, 2.6vw, 34px)',
            lineHeight: 1.25,
            letterSpacing: '-0.01em',
            color: INK,
            textAlign: align,
          }}
        >
          {beat.text}
        </p>
        {drift && (
          <PromptDrift
            active={active}
            align={align}
            reduceMotion={reduceMotion}
            band={centre ? DRIFT.centreBandPx : DRIFT.bandPx}
            offset={centre ? DRIFT.centreOffsetPx : DRIFT.offsetPx}
          />
        )}
      </motion.div>
    </div>
  );
}

function SwapPicker({ variant, onPick }) {
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
      {SWAP_ORDER.map((id, i) => {
        const on = id === variant;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            title={SWAP[id].hint}
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
            {i + 1} {SWAP[id].label}
          </button>
        );
      })}
    </div>
  );
}

export default function OnboardingStackLab() {
  const reduceMotion = useReducedMotion();
  const trackRef = useRef(null);
  const [beat, setBeat] = useState(0);
  const [variant, setVariant] = useState('slide');
  // Manual stepping disconnects from scroll until the user scrolls again.
  const [manual, setManual] = useState(false);
  const prevBeatRef = useRef(0);
  const [swapGen, setSwapGen] = useState(0);
  const [dir, setDir] = useState(1);
  const [leavingIndex, setLeavingIndex] = useState(null);
  const swipeDriven = variant === 'dealCentre';
  const lastWheelRef = useRef(0);
  const lastStepRef = useRef(-Infinity); // no grace owed on the first swipe
  const travelRef = useRef(0);
  const armedRef = useRef(true);

  // Document progress, not a target range. The lab shell sets
  // `overflow-x: hidden`, which computes overflow-y to `auto` and makes that
  // wrapper look scrollable to `useScroll({ target })` — but it is auto-height,
  // so it never actually scrolls and progress stays pinned at 0. The window is
  // what moves, and the track below is the whole page, so the range is the same.
  const { scrollYProgress } = useScroll();

  const applyBeat = (next, source = 'scroll') => {
    const n = BEATS.length;
    const clamped = Math.min(n - 1, Math.max(0, next));
    if (clamped === beat) return;
    const d = clamped > beat ? 1 : -1;
    setDir(d);
    setLeavingIndex(beat);
    setSwapGen((g) => g + 1);
    prevBeatRef.current = beat;
    if (source === 'manual') setManual(true);
    setBeat(clamped);
  };

  // The wheel listener is bound once, so it reads the current beat through refs
  // rather than whichever render it happened to be created in.
  const beatRef = useRef(beat);
  beatRef.current = beat;
  const applyBeatRef = useRef(applyBeat);
  applyBeatRef.current = applyBeat;

  /* One value feeds the progress bar in both modes. It has to stay a motion
     value throughout: hand `width` a plain string after a motion value has
     owned it and Motion keeps the old value on the element. */
  const progress = useMotionValue(0);
  const progressW = useTransform(progress, [0, 1], ['0%', '100%']);

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    if (swipeDriven) return;
    progress.set(v);
    if (manual) return;
    const n = BEATS.length;
    applyBeat(Math.min(n - 1, Math.max(0, Math.floor(v * n))), 'scroll');
  });

  // Stepping has no scroll to read, so the bar counts beats instead.
  useEffect(() => {
    if (swipeDriven) progress.set((beat + 1) / BEATS.length);
  }, [swipeDriven, beat, progress]);

  /* Deal v2 is stepped, not scrubbed: one swipe is one beat, however hard you
     flick. The page itself doesn't move — the gesture is swallowed and turned
     into a single step.
     A gesture begins after the wheel has been quiet for a moment, and it steps
     once its accumulated travel crosses the threshold. Everything after that
     step belongs to the same flick and is ignored, which is what keeps a
     trackpad's long momentum tail from running the whole sequence. */
  useEffect(() => {
    if (!swipeDriven) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey) return; // pinch-zoom is not a swipe
      e.preventDefault();

      const now = performance.now();
      const quiet = now - lastWheelRef.current > SWIPE.quietMs;
      lastWheelRef.current = now;

      /* The grace period swallows everything, and banks none of it. A momentum
         tail can go quiet for longer than `quietMs` and pick back up, so
         re-arming has to be blocked here as well as gated on silence — the
         next step needs a gesture the hand actually made. */
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

      // One step per gesture: the rest of this flick is spent, and the wheel
      // has to fall quiet before another one can begin.
      armedRef.current = false;
      lastStepRef.current = now;
      applyBeatRef.current(
        beatRef.current + (travelRef.current > 0 ? 1 : -1),
        'swipe'
      );
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [swipeDriven]);

  // Re-arm scroll driving once the user scrolls again after a manual step.
  useEffect(() => {
    if (!manual) return undefined;
    const onWheel = () => setManual(false);
    window.addEventListener('wheel', onWheel, { passive: true, once: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, [manual]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= '1' && e.key <= String(SWAP_ORDER.length)) {
        setVariant(SWAP_ORDER[Number(e.key) - 1]);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        applyBeat(beat + 1, 'manual');
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        applyBeat(beat - 1, 'manual');
      } else if (e.key === 'r' || e.key === 'R') {
        applyBeat(0, 'manual');
        window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [beat]);


  const slots = useMemo(
    () => CARDS.map((_, i) => slotForCard(i, beat)),
    [beat]
  );

  // Clear "leaving" after the longest swap finishes so later resizes don't
  // re-trigger a toss from a stale flag.
  useEffect(() => {
    if (leavingIndex == null) return undefined;
    const t = window.setTimeout(() => setLeavingIndex(null), 800);
    return () => window.clearTimeout(t);
  }, [leavingIndex, swapGen]);

  return (
    <>
      {/* Scrub modes need a tall track to scroll through; the stepped one has
          nowhere to scroll, so the page stays put and the swipe does the work. */}
      <div
        ref={trackRef}
        style={{ height: swipeDriven ? '100vh' : `${BEATS.length * 100}vh` }}
        aria-hidden="true"
      />

      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
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
            Onboarding stack · {SWAP[variant].label}
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
            {`1–${SWAP_ORDER.length} swap · ←/→ step · R reset · ${
              swipeDriven ? 'one swipe = one beat' : 'scroll'
            }`}
          </p>
          <SwapPicker variant={variant} onPick={setVariant} />
        </div>

        <motion.div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: 1,
            width: progressW,
            background: inkA(0.55),
            zIndex: 30,
          }}
        />

        {BEATS.map((b, i) => (
          <BeatCopy
            key={b.kicker}
            beat={b}
            active={i === beat}
            reduceMotion={reduceMotion}
            centre={variant === 'dealCentre'}
            drift={i === 0}
          />
        ))}

        <motion.div
          initial={false}
          // Glides with the arriving note, so the group settling onto the middle
          // reads as part of the same move rather than a separate correction.
          animate={{ x: isDeal(variant) ? dealCentreOffset(beat) : 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: DEAL.flyS, ease: EASE_OUT }
          }
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: CARD.w,
            height: CARD.h,
            marginLeft: -CARD.w / 2,
            // Centred copy sits under the pile, so the pile rides higher to
            // leave it room; the side variants keep the stack on the midline.
            marginTop:
              variant === 'dealCentre' ? -CARD.h / 2 - 78 : -CARD.h / 2 - 10,
            transition: 'margin-top 0.4s cubic-bezier(0.165,0.84,0.44,1)',
          }}
        >
          {isDeal(variant) &&
            CLUSTER.map((note, i) => (
              <ClusterNote
                key={note.id}
                note={note}
                index={i}
                active={beat === BEATS.length - 1}
                reduceMotion={reduceMotion}
              />
            ))}

          {CARDS.map((card, i) => (
            <StackCard
              key={card.id}
              card={card}
              cardIndex={i}
              beat={beat}
              slot={slots[i]}
              leaving={leavingIndex === i}
              variant={variant}
              reduceMotion={reduceMotion}
              swapGen={swapGen}
              dir={dir}
            />
          ))}
        </motion.div>
      </div>
    </>
  );
}
