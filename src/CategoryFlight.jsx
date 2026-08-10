import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { WHEEL } from './NoteOpenView';

/* ─────────────────────────────────────────────────────────────────────
 * ANIMATION STORYBOARD  —  INDEX RAIL ⇄ EXPLORE DIAL
 *
 * The index's category checkboxes ARE the explore dial's wordmarks; they
 * just haven't taken their places yet. Switching tabs moves them.
 *
 * OUT (index → explore)
 *      0ms   checkboxes fade out, leaving the labels standing alone
 *              (owned by GridView — see FLIGHT_FADE_MS in App.jsx)
 *    220ms   labels lift off the rail and fan onto the arc, closing their
 *            letter-spacing and warming to the dial's brighter ink. Words
 *            with no lit slot to land on fade out on the way. The index
 *            empties out under them in two beats — sidebar, then grid
 *            (owned by GridView — see DEPARTURE in App.jsx).
 *    340ms   each word starts growing to dial size, just after it has begun
 *            to move — see the note on `scale` below
 *    550ms   brackets fade in around each word — [ THERAPIST ] — the
 *            last thing that makes a filter row read as a dial label
 *    920ms   flight ends; the real dial cuts in beneath the copies and
 *            the overlay unmounts on the same frame
 *
 * BACK (explore → index) — the same gesture played the other way
 *      0ms   the dial's words are copied where they stand and the dial
 *            unmounts underneath them; brackets drop straight away. Words
 *            shrink immediately — early, not late, for the same crowding
 *            reason read in reverse — and fall into the list.
 *     ~1frame  the rail mounts with its rows blank; the flight re-aims off
 *            the real rows the moment they exist (see `to` below)
 *    620ms   flight ends; the rail's real labels cut in and the
 *            checkboxes fade back on around them
 *
 * WHY AN OVERLAY: the view switch is an AnimatePresence with mode="wait",
 * so GridView (which owns the rail) and NoteOpenView (which owns the
 * dial) are never in the DOM together and cannot be transitioned
 * between. This layer sits above that boundary and outlives both.
 *
 * WHY THE TWO DIRECTIONS AREN'T SYMMETRIC IN CODE: going out, the
 * destination is pure geometry — the dial's slots are fixed at
 * WHEEL.baseX and the viewport's vertical centre — so every landing spot
 * is known before the dial exists. Coming back, the destination is a
 * list whose rows depend on text, fonts and scroll, so it can only be
 * measured once the rail has actually mounted. Hence `to` arriving late.
 * ───────────────────────────────────────────────────────────────────── */

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const EASE_OUT = [0.16, 1, 0.3, 1];
/* Matches the dial's own spin so a word arriving and a word already on the
   wheel move with one hand. */
const FLIGHT_SPRING = { type: 'spring', visualDuration: 0.52, bounce: 0.12 };

/* The rail stacks its rows 28px apart and the arc spreads them ~160px apart,
   so a word at full dial size while the fan is closed collides with its
   neighbours. Size therefore lives at the spread-out end of the journey: on
   the way out growth waits for the fan to start opening, on the way back
   shrinking happens first, before the words converge on the list.

   Growth only has to clear the first moments of the flight, not wait for it
   to finish — the rail is rotated to put the arc's centre in its middle row
   (see `centreOn` in App.jsx), so the fan opens straight out from the middle
   with no two words trading places. */
const DIR = {
  toDial: { bracketsAt: 330, land: 700, scaleDelay: 0.12, bracketsEnd: true },
  toRail: { bracketsAt: 0, land: 620, scaleDelay: 0, bracketsEnd: false },
};

/**
 * Copies of the category labels, in flight between the index rail and the
 * explore dial.
 *
 * @param items      [{ id, label, delayS, from, to }] where a pose is
 *                   { cx, cy, rotate, opacity, scale, track, color } in
 *                   viewport coordinates. `to` may be null until the
 *                   destination has been measured; the words park at `from`
 *                   until it lands.
 * @param direction  'toDial' | 'toRail'
 * @param onDone     fired when the words are home and the real thing should
 *                   cut in beneath them
 */
export default function CategoryFlight({ items, direction, reduceMotion, onDone }) {
  const spec = DIR[direction];
  // A flight with no destination yet hasn't started, so neither has its clock.
  const launched = items.some((it) => it.to != null);
  const [bracketed, setBracketed] = useState(!spec.bracketsEnd);

  useEffect(() => {
    if (reduceMotion) {
      onDone();
      return undefined;
    }
    if (!launched) return undefined;
    const timers = [
      setTimeout(() => setBracketed(spec.bracketsEnd), spec.bracketsAt),
      // The real thing takes over here, so this must outlast the last word's
      // journey — the longest stagger plus the resize that trails it. Cut early
      // and the words visibly jump as they are redrawn where they were still
      // heading.
      setTimeout(onDone, spec.land),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduceMotion, launched, spec, onDone]);

  if (reduceMotion || !items.length) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        // Over both views, under the nav chrome (200) — the words pass beneath
        // the wordmark exactly as the dial's own labels do.
        zIndex: 190,
        pointerEvents: 'none',
      }}
    >
      {items.map((item) => (
        <FlyingWord key={item.id} item={item} spec={spec} bracketed={bracketed} />
      ))}
    </div>
  );
}

function FlyingWord({ item, spec, bracketed }) {
  const { from, to, delayS } = item;
  const pose = to ?? from;
  const spring = { ...FLIGHT_SPRING, delay: delayS };

  return (
    <motion.div
      initial={{ x: from.cx, y: from.cy, rotate: from.rotate, opacity: from.opacity }}
      animate={{ x: pose.cx, y: pose.cy, rotate: pose.rotate, opacity: pose.opacity }}
      transition={spring}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        willChange: 'transform, opacity',
      }}
    >
      {/* Scale belongs here, not on the anchor. CSS scales about an element's
          own centre, so scaling the anchor drags the word sideways by half its
          width — each copy would mount offset from the label it is meant to be
          replacing, and slide as it resized. Down here the -50%/-50% centring
          absorbs it and the centre never moves. Rotation stays on the anchor,
          which is the dial's own geometry. */}
      <motion.span
        initial={{
          x: '-50%',
          y: '-50%',
          scale: from.scale,
          letterSpacing: from.track,
          color: from.color,
        }}
        animate={{
          x: '-50%',
          y: '-50%',
          scale: pose.scale,
          letterSpacing: pose.track,
          color: pose.color,
        }}
        transition={{
          ...spring,
          scale: { duration: 0.34, delay: delayS + spec.scaleDelay, ease: EASE_OUT },
        }}
        style={{
          // Absolutely positioned, exactly like the dial's own slotButton. An
          // in-flow inline-block would sit in the anchor's line box instead of
          // on its origin, and the resulting offset gets rotated with the slot
          // — the further round the arc, the further the word lands from where
          // the dial draws it.
          position: 'absolute',
          left: 0,
          top: 0,
          fontFamily: MONO,
          fontSize: WHEEL.labelFont,
          lineHeight: 1,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {/* Out of flow so they can come and go without changing the word's
            width mid-flight, which would drag its centre off target. */}
        <Bracket side="left" on={bracketed} />
        {item.label}
        <Bracket side="right" on={bracketed} />
      </motion.span>
    </motion.div>
  );
}

function Bracket({ side, on }) {
  // The gap is a non-breaking space rather than a padding because the dial
  // draws its own brackets as part of the string — `[ THERAPIST ]` — where the
  // gap is a literal space. Anything else and the brackets shift outward by the
  // difference at the hand-off, a two-pixel twitch on the only two glyphs the
  // eye is holding still. A space matches whatever the mono face advances by,
  // at any size, so the copy and the real thing draw identically.
  const edge = side === 'left' ? { right: '100%' } : { left: '100%' };
  return (
    <motion.span
      initial={{ opacity: on ? 1 : 0 }}
      animate={{ opacity: on ? 1 : 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      style={{ position: 'absolute', top: 0, ...edge }}
    >
      {side === 'left' ? '[\u00a0' : '\u00a0]'}
    </motion.span>
  );
}
