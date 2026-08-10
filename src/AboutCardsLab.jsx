import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * ANIMATION STORYBOARD  —  ABOUT CARD STACK
 *
 * The About page as a hand of three cards rather than a scrolling column.
 * They arrive from below as one bundle, then split into a fan; tapping a
 * card behind trades it with the one in front.
 *
 * ENTRANCE
 *      0ms   all three waiting below the fold, squared up in a tight stack
 *    120ms   the bundle rises and centres — back cards lead by 70ms each,
 *            so the front card lands last and lands on top
 *    520ms   the fan opens: the two behind rotate out to ±5° and settle
 *            left and right, dimming as they go
 *
 * SWAP        [ click a card behind ]
 *      0ms   the clicked card takes the front slot's z-index immediately,
 *            so it crosses OVER the deck rather than sliding under it
 *      0ms   clicked card → centre, un-dims, straightens to 0°
 *            front card → the slot just vacated, dims, takes on its angle
 *    420ms   settled
 *
 * Everything is ease-out: these are pieces of card being dealt, and a
 * dealt card decelerates into place rather than springing back.
 * ───────────────────────────────────────────────────────────────────── */

const TIMING = {
  rise: 120, //     bundle starts up from below the fold
  riseLead: 70, //  each card behind leaves this much earlier than the one in front
  fan: 520, //      the two behind rotate out to their angles
};

/* 0 offstage · 1 risen and centred · 2 fanned open */
const STAGE = { offstage: 0, risen: 1, fanned: 2 };

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const BODY = "'Faktory', Georgia, serif";
/* A dealt card decelerates; it doesn't overshoot. Same curve the rest of the
   archive uses for entrances. */
const EASE_OUT = [0.165, 0.84, 0.44, 1];

const CARD = {
  w: 560, //          px
  h: 700, //          px
  radius: 2, //       px — barely rounded; this is paper stock, not a UI card
  pad: 38, //         px
  bg: '#3f3f3f', //   the front card's stock
  riseFrom: 620, //   px below its resting place at the start
  riseS: 0.72, //     s  — the climb
  // Opening the fan and trading places are the same move — a card travelling
  // between two slots — so they share one duration.
  swapS: 0.42, //     s
};

/* Resting places, in stacking order: front, then the two behind. The pair
   behind sit a touch lower and smaller so the fan reads as depth rather than
   as three cards side by side. */
const SLOTS = [
  { x: 0, y: 0, rotate: 0, scale: 1, z: 3, dim: 0 },
  { x: -88, y: 34, rotate: -5, scale: 0.97, z: 2, dim: 0.42 },
  { x: 88, y: 34, rotate: 5, scale: 0.97, z: 1, dim: 0.42 },
];

/* Real copy from the About panel in App.jsx, trimmed to a card's worth. */
const CARDS = [
  {
    id: 'about',
    kicker: '01 — About',
    title: 'What We Tell AI',
    body: 'A project exploring our secrets about our complex relationship with A.I. Last September we set up a box in Dolores Park, San Francisco and asked strangers to write down a confession. Since then we’ve collected more than 350 handwritten notes, gathered in parks, shopping malls, and even AI conferences.',
  },
  {
    id: 'why',
    kicker: '02 — Why we care',
    title: 'Faster than we can understand',
    body: 'AI is occupying roles once reserved for the people we surround ourselves with: lovers, therapists, oracles. The attention economy is evolving into an intimacy economy. This social change is happening too fast for individual sense-making.',
    quote: '“There is absolutely no inevitability as long as there is a willingness to contemplate what is happening”',
    cite: '— Marshall McLuhan',
  },
  {
    id: 'process',
    kicker: '03 — Our process',
    title: 'A makeshift confession booth',
    body: 'We install the booth across more than twenty sites in California, Massachusetts, Colorado, and New York — from ordinary public space to gatherings where AI is already the explicit subject. Most often we’d sit about 6ft away: close enough to reset it when the wind knocked it over, far enough to keep the writing private.',
  },
];

export default function AboutCardsLab() {
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState(STAGE.offstage);
  // Card ids by slot: order[0] is whatever is currently in front.
  const [order, setOrder] = useState(() => CARDS.map((c) => c.id));
  const [runId, setRunId] = useState(0);

  const dials = useDialKit(
    'About Cards',
    {
      card: {
        w: [CARD.w, 240, 720, 10],
        h: [CARD.h, 300, 900, 10],
        riseFrom: [CARD.riseFrom, 100, 1400, 20],
      },
      fan: {
        spread: [SLOTS[1].x * -1, 0, 260, 2],
        drop: [SLOTS[1].y, 0, 160, 2],
        tilt: [SLOTS[1].rotate * -1, 0, 20, 0.5],
        scale: [SLOTS[1].scale, 0.8, 1, 0.005],
        dim: [SLOTS[1].dim, 0, 0.9, 0.02],
      },
      timing: {
        riseS: [CARD.riseS, 0.1, 2, 0.02],
        riseLeadMs: [TIMING.riseLead, 0, 400, 10],
        fanMs: [TIMING.fan, 0, 1600, 20],
        swapS: [CARD.swapS, 0.1, 2, 0.02],
      },
      replay: { type: 'action', label: '⟳ Replay' },
    },
    {
      onAction: (action) => {
        if (action === 'replay') replay();
      },
    }
  );

  // Slots rebuilt from the dial so the fan can be opened and closed live.
  const slots = [
    SLOTS[0],
    {
      ...SLOTS[1],
      x: -dials.fan.spread,
      y: dials.fan.drop,
      rotate: -dials.fan.tilt,
      scale: dials.fan.scale,
      dim: dials.fan.dim,
    },
    {
      ...SLOTS[2],
      x: dials.fan.spread,
      y: dials.fan.drop,
      rotate: dials.fan.tilt,
      scale: dials.fan.scale,
      dim: dials.fan.dim,
    },
  ];

  const replay = useCallback(() => {
    setStage(STAGE.offstage);
    setOrder(CARDS.map((c) => c.id));
    setRunId((r) => r + 1);
  }, []);

  // ENTRANCE. Keyed on the run counter, never on `stage`: an effect that
  // watches the value its own timers set tears down the pending ones as soon
  // as the first fires, and the fan never opens.
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(STAGE.risen), TIMING.rise),
      setTimeout(() => setStage(STAGE.fanned), dials.timing.fanMs),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'r' || e.key === 'R') replay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [replay]);

  /** Trade the clicked card with whatever is in front. */
  const bringForward = (id) => {
    setOrder((prev) => {
      const slot = prev.indexOf(id);
      if (slot <= 0) return prev;
      const next = [...prev];
      next[0] = id;
      next[slot] = prev[0];
      return next;
    });
  };

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // The stack arrives from below, so nothing may spill into a scrollbar.
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: dials.card.w,
          height: dials.card.h,
        }}
      >
        {CARDS.map((card) => {
          const slot = order.indexOf(card.id);
          const rest = slots[slot];
          const front = slot === 0;
          const offstage = stage < STAGE.risen;
          const fanned = stage >= STAGE.fanned;

          // Before the fan opens every card is squared up on the front slot —
          // one tight bundle. Only after it opens do the two behind take their
          // own angle, so the arrival reads as a single gesture that splits.
          const target = fanned ? rest : { ...SLOTS[0], z: rest.z, dim: 0 };

          return (
            <motion.button
              key={card.id}
              type="button"
              onClick={() => bringForward(card.id)}
              aria-label={front ? `${card.title} (in front)` : `Bring ${card.title} forward`}
              initial={{
                x: SLOTS[0].x,
                y: SLOTS[0].y + dials.card.riseFrom,
                rotate: 0,
                scale: 1,
                opacity: 0,
              }}
              animate={{
                x: target.x,
                y: offstage ? target.y + dials.card.riseFrom : target.y,
                rotate: target.rotate,
                scale: target.scale,
                opacity: offstage ? 0 : 1,
              }}
              transition={
                reduceMotion || offstage
                  ? // Snapping offstage rather than animating down keeps a
                    // replay crisp — the deck is simply back below the fold.
                    { duration: 0 }
                  : {
                      duration: fanned ? dials.timing.swapS : dials.timing.riseS,
                      ease: EASE_OUT,
                      // Cards behind leave earlier so the front one lands last,
                      // on top. Once the deck is up, swaps run without delay.
                      delay: offstage ? 0 : fanned ? 0 : (2 - slot) * (dials.timing.riseLeadMs / 1000),
                    }
              }
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: rest.z,
                padding: CARD.pad,
                textAlign: 'left',
                background: CARD.bg,
                border: 'none',
                borderRadius: CARD.radius,
                boxShadow: '0 30px 60px rgba(0,0,0,0.55)',
                cursor: front ? 'default' : 'pointer',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                willChange: 'transform, opacity',
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: inkA(0.5),
                }}
              >
                {card.kicker}
              </span>
              <span
                style={{
                  fontFamily: BODY,
                  fontSize: 27,
                  lineHeight: 1.18,
                  color: inkA(0.95),
                }}
              >
                {card.title}
              </span>
              {card.quote ? (
                <span
                  style={{
                    fontFamily: BODY,
                    fontSize: 16,
                    lineHeight: 1.4,
                    color: inkA(0.8),
                    borderLeft: `1px solid ${inkA(0.25)}`,
                    paddingLeft: 14,
                  }}
                >
                  {card.quote}
                  <span
                    style={{
                      display: 'block',
                      marginTop: 8,
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      color: inkA(0.5),
                    }}
                  >
                    {card.cite}
                  </span>
                </span>
              ) : null}
              <span
                style={{
                  fontFamily: BODY,
                  fontSize: 15,
                  lineHeight: 1.55,
                  color: inkA(0.7),
                }}
              >
                {card.body}
              </span>

              <span
                style={{
                  marginTop: 'auto',
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingTop: 18,
                  borderTop: `1px solid ${inkA(0.14)}`,
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: inkA(0.34),
                }}
              >
                <span>What We Tell AI</span>
                <span>{card.id}</span>
              </span>

              {/* Cards behind sit in their own shade rather than being made
                  transparent — paper in shadow, not paper turning to glass. */}
              <motion.span
                aria-hidden="true"
                animate={{ opacity: target.dim }}
                transition={{
                  duration: reduceMotion ? 0 : dials.timing.swapS,
                  ease: EASE_OUT,
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: '#0b0b0c',
                  pointerEvents: 'none',
                }}
              />
            </motion.button>
          );
        })}
      </div>

      {/* ── Bench chrome ─────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 112,
          right: 40,
          textAlign: 'right',
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: inkA(0.38),
          lineHeight: 1.9,
        }}
      >
        <div style={{ color: inkA(0.8) }}>About — card stack</div>
        <div>click a card behind to bring it forward</div>
        <div>R replays · ?dial=1 controls</div>
        <div style={{ marginTop: 10, color: inkA(0.55) }}>
          front · {CARDS.find((c) => c.id === order[0])?.kicker}
        </div>
      </div>

      <button
        type="button"
        onClick={replay}
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
          zIndex: 10,
        }}
      >
        ⟳ Replay
      </button>
    </div>
  );
}
