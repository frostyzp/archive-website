import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimate, useMotionValue, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { INK, inkA } from './colors';
import { PAGE_BG, PAGE_GRADIENT } from './NoiseGradient';
import { TunableGrainBackground } from './noise';
import CategoryDialLab from './CategoryDialLab';
import AboutCardsLab from './AboutCardsLab';
import { AboutDrawerNavLab, AboutDrawerPeekLab } from './AboutDrawerLab';
import OnboardingStackLab from './OnboardingStackLab';

/* ─────────────────────────────────────────────────────────────────────
 * NOTE ENTRANCE LAB  —  /entrance
 *
 * A bench for the INDEX preview's opening move. Nine notes in a contact
 * sheet; clicking one opens the preview with whichever entrance is selected,
 * so the candidates can be watched back to back against the same note instead
 * of described.
 *
 * The four on the bench:
 *
 *   flight    The note lifts off its own tile and flies to the centre. The only
 *             one that reads as CAUSED by the thing you clicked — you watch that
 *             note travel — which is what the current fade is missing. Done as a
 *             FLIP on one element: measure the tile's image box and the settled
 *             target box, start the target at the transform that superimposes it
 *             on the tile, animate to identity. No cloned "bridge" to hand off
 *             to, so there's no crossfade seam.
 *
 *   lift      Arrives from below with a little overshoot and a degree of tilt —
 *             the bottom-sheet idea with the sheet taken away. A print being laid
 *             on a light table rather than a panel of UI sliding up.
 *
 *   tray      The literal reading of "a tray comes up with the note": a lit plate
 *             rises from the bottom edge carrying the note on it. Apparatus.
 *
 *   develop   No geometry at all — the note resolves out of grain at final size,
 *             borrowing the opening loader's language. Nothing can shift,
 *             because nothing moves.
 *
 * Register marks (+) settle onto the note's corners after it lands, echoing the
 * crossings in the grid's own lattice, so the preview is visibly cut from the
 * same sheet.
 *
 * Every timing is on the "Note Entrance" DialKit panel (append ?dial=1). Keys:
 * 1–4 pick an entrance, R replays the last one, Esc closes.
 * ───────────────────────────────────────────────────────────────────── */

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const EASE_OUT = [0.165, 0.84, 0.44, 1];
/** How long the reversed flight is given to reach the tile before it unmounts. */
const FLIGHT_CLOSE_MS = 320;

/* Slow motion: /entrance?slow=8 stretches every entrance so the arc can be read
   frame by frame. Springs are swapped for a tween, since a spring's character
   comes from its rate and can't be honestly slowed. */
const SLOW = (() => {
  if (typeof window === 'undefined') return 1;
  const v = Number(new URLSearchParams(window.location.search).get('slow'));
  return Number.isFinite(v) && v > 1 ? Math.min(v, 40) : 1;
})();
const stretched = (transition) =>
  SLOW > 1 ? { duration: 0.55 * SLOW, ease: EASE_OUT } : transition;

/** Real scans, mock words — enough to judge the motion against a real note. */
const NOTES = [
  { id: 'AC_006', text: 'I ask AI about every life decision now.' },
  { id: 'AC_063', text: 'My boss thinks I write like this. I do not.' },
  { id: 'AC_141', text: "I told it something I've never said out loud." },
  { id: 'AC_148', text: 'I asked it to read my writing & praise it... smh' },
  { id: 'AC_171', text: 'ChatGPT writes 99.9% of all my emails now too =)' },
  { id: 'AC_185', text: 'Forgive my sin: I talk to AI more than to people :(' },
  { id: 'AC_017', text: "I don't trust anything I read anymore." },
  { id: 'AC_092', text: 'It remembers more about me than my family does.' },
  { id: 'AC_120', text: 'I deleted the app. I reinstalled it that night.' },
];

const noteSrc = (id) => `/confession_notes_2/${id}.webp`;

/** Matches the INDEX grid: a square cell with the note contained inside it. */
const TILE = 190;
const TILE_PAD = 22;
const GRID_COLS = 3;

/** The preview's constant frame — the note is contained, never sized to fit. */
const FRAME = { w: 'min(84vw, 620px)', h: 'min(56vh, 470px)' };

const VARIANTS = ['flight', 'lift', 'tray', 'develop'];
const VARIANT_LABEL = {
  flight: 'Flight from tile',
  lift: 'Paper lift',
  tray: 'Specimen tray',
  develop: 'Develop in place',
};

/* Glyphs a register mark riffles through before it lands on '+'. The grid's
   lattice churns the same way, so the marks arrive as though the sheet typed
   them rather than as though the preview faded them up. */
const MARK_SCRAMBLE = '+-=x*:.#';
const MARK_TICK_MS = 55;

/**
 * One corner mark. Holds a random glyph for a few ticks, then settles on '+'.
 * Each corner is handed its own delay so they land around the note in turn.
 */
function RegisterMark({ corner, inset, delayS, scramble, reduceMotion }) {
  const [glyph, setGlyph] = useState(scramble && !reduceMotion ? MARK_SCRAMBLE[0] : '+');

  useEffect(() => {
    if (!scramble || reduceMotion) {
      setGlyph('+');
      return undefined;
    }
    let ticks = 0;
    let timer = 0;
    const start = window.setTimeout(() => {
      timer = window.setInterval(() => {
        ticks += 1;
        if (ticks > 4) {
          window.clearInterval(timer);
          setGlyph('+');
          return;
        }
        setGlyph(MARK_SCRAMBLE[Math.floor(Math.random() * MARK_SCRAMBLE.length)]);
      }, MARK_TICK_MS);
    }, delayS * 1000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [scramble, reduceMotion, delayS]);

  const [vy, vx] = corner; // 'top' | 'bottom', 'left' | 'right'
  return (
    <motion.span
      aria-hidden="true"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.18, ease: EASE_OUT, delay: reduceMotion ? 0 : delayS }}
      style={{
        position: 'absolute',
        [vy]: -inset,
        [vx]: -inset,
        fontFamily: MONO,
        fontSize: 11,
        lineHeight: 1,
        color: inkA(0.55),
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {glyph}
    </motion.span>
  );
}

/** The note itself plus anything that rides on it — shared by every variant. */
function NoteBody({ note, variant, develop, marks, markStart, reduceMotion }) {
  return (
    <>
      <img
        src={noteSrc(note.id)}
        alt=""
        draggable={false}
        style={{
          maxWidth: FRAME.w,
          maxHeight: FRAME.h,
          width: 'auto',
          height: 'auto',
          display: 'block',
        }}
      />

      {/* Grain sitting ON the note's own shape while it develops, so the note
          resolves out of the page's texture instead of out of a rectangle
          of haze. */}
      {variant === 'develop' && !reduceMotion ? (
        <motion.div
          aria-hidden="true"
          initial={{ opacity: develop.grain }}
          animate={{ opacity: 0 }}
          transition={{ duration: develop.durS, ease: EASE_OUT }}
          style={{
            position: 'absolute',
            inset: 0,
            WebkitMaskImage: `url("${noteSrc(note.id)}")`,
            maskImage: `url("${noteSrc(note.id)}")`,
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            pointerEvents: 'none',
          }}
        >
          <TunableGrainBackground />
        </motion.div>
      ) : null}

      {marks.on
        ? [
            ['top', 'left'],
            ['top', 'right'],
            ['bottom', 'right'],
            ['bottom', 'left'],
          ].map((corner, i) => (
            <RegisterMark
              key={corner.join('-')}
              corner={corner}
              inset={marks.inset}
              delayS={markStart + i * marks.stagger}
              scramble={marks.scramble}
              reduceMotion={reduceMotion}
            />
          ))
        : null}
    </>
  );
}

/**
 * The flight, driven by motion values rather than `initial`.
 *
 * This has to be explicit: motion only reads `initial` at mount, and the target
 * box can't be measured until after mount — so declaring the start transform on
 * a later render silently does nothing and the note simply appears at the centre
 * (which is the very bug we're trying to fix). Instead the wrapper mounts
 * untransformed and hidden, gets measured, and has its motion values written
 * synchronously inside a LAYOUT effect — before the browser paints — so the
 * first painted frame already has the note sitting on its tile.
 *
 * Hidden via `visibility`, never opacity: a lifted note is the same piece of
 * paper leaving the sheet, so it flies at full opacity. Fading it up mid-flight
 * makes it read as a ghost of the note rather than the note.
 */
function FlightNote({ origin, spring, onRegisterClose, children }) {
  const [scope, animate] = useAnimate();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = scope.current;
    if (!el || !origin?.width) return;
    // Measured while untransformed, so this is the true resting box.
    const to = el.getBoundingClientRect();
    if (!(to.width > 0)) return;
    const from = {
      x: origin.left + origin.width / 2 - (to.left + to.width / 2),
      y: origin.top + origin.height / 2 - (to.top + to.height / 2),
      scale: origin.width / to.width,
    };
    x.set(from.x);
    y.set(from.y);
    scale.set(from.scale);
    setReady(true);
    animate(x, 0, spring);
    animate(y, 0, spring);
    animate(scale, 1, spring);

    // Closing reverses the flight — the note goes back to the tile it came from.
    // An entrance this directional feels broken if the exit just dissolves.
    onRegisterClose(() => {
      animate(x, from.x, spring);
      animate(y, from.y, spring);
      animate(scale, from.scale, spring);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  return (
    <motion.div
      ref={scope}
      style={{
        position: 'relative',
        display: 'inline-block',
        transformOrigin: 'center center',
        visibility: ready ? 'visible' : 'hidden',
        willChange: 'transform',
        x,
        y,
        scale,
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The opened preview. `origin` is the clicked tile's IMAGE box (not the cell) —
 * measuring the img means the flight starts on the note's real pixels without
 * having to letterbox the cell by hand.
 */
function Preview({ note, origin, variant, dials, reduceMotion, onClose }) {
  const { backdrop, lift, tray, develop, marks, flight } = dials;
  const isFlight = variant === 'flight' && !!origin?.width && !reduceMotion;

  // The flight owns its own reverse (see FlightNote); everything else unmounts
  // through AnimatePresence.
  const reverseRef = useRef(null);
  const closingRef = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (isFlight && reverseRef.current) {
      reverseRef.current();
      window.setTimeout(onClose, FLIGHT_CLOSE_MS);
      return;
    }
    onClose();
  }, [isFlight, onClose]);

  // Esc lives here rather than on the page so it takes the same path as a click
  // and gets the reversed flight instead of a hard unmount.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Per-variant entrance for the note itself. `tray` moves the plate rather than
  // the note, so the note sits still inside it.
  const noteMotion = () => {
    if (reduceMotion) {
      return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
    }
    if (variant === 'lift') {
      return {
        initial: { y: lift.distance, rotate: lift.rotate, opacity: 0 },
        animate: { y: 0, rotate: 0, opacity: 1 },
        exit: { y: lift.distance * 0.6, opacity: 0, transition: { duration: 0.22, ease: EASE_OUT } },
        transition: stretched(lift.spring),
      };
    }
    if (variant === 'develop') {
      return {
        initial: {
          opacity: 0,
          scale: 1.015,
          filter: `blur(${develop.blur}px) contrast(${develop.contrast})`,
        },
        animate: { opacity: 1, scale: 1, filter: 'blur(0px) contrast(1)' },
        exit: { opacity: 0, filter: `blur(${develop.blur * 0.5}px)` },
        transition: { duration: develop.durS * SLOW, ease: EASE_OUT },
      };
    }
    return { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } };
  };

  // The whole group rides the plate up on `tray`; every other variant leaves it
  // alone and animates the note instead.
  const groupMotion =
    variant === 'tray' && !reduceMotion
      ? {
          initial: { y: '100%' },
          animate: { y: 0 },
          exit: { y: '100%', transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } },
          transition: stretched(tray.spring),
        }
      : {};

  // Marks wait for the note to be there to sit on.
  const markStart = reduceMotion ? 0 : marks.startS;

  return (
    <motion.div
      key="preview"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : backdrop.fadeS, ease: EASE_OUT }}
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        background: `rgba(6, 6, 8, ${backdrop.alpha})`,
        isolation: 'isolate',
        display: 'flex',
        alignItems: variant === 'tray' ? 'flex-end' : 'center',
        justifyContent: 'center',
        cursor: 'zoom-out',
        overflow: 'hidden',
      }}
    >
      <TunableGrainBackground />

      <motion.div
        {...groupMotion}
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          padding: variant === 'tray' ? `${tray.platePad}px 40px` : 0,
          // The tray's own surface: a soft lit plate rather than a card with a
          // hard top edge, which would read as a panel of UI.
          background:
            variant === 'tray'
              ? `linear-gradient(to top, rgba(207,202,183,${tray.plateAlpha}) 0%, rgba(207,202,183,${tray.plateAlpha * 0.5}) 55%, rgba(207,202,183,0) 100%)`
              : 'none',
          width: variant === 'tray' ? 'min(96vw, 860px)' : 'auto',
        }}
      >
        <div
          style={{
            width: FRAME.w,
            height: FRAME.h,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isFlight ? (
            <FlightNote
              origin={origin}
              spring={stretched(flight.spring)}
              onRegisterClose={(fn) => {
                reverseRef.current = fn;
              }}
            >
              <NoteBody
                note={note}
                variant={variant}
                develop={develop}
                marks={marks}
                markStart={markStart}
                reduceMotion={reduceMotion}
              />
            </FlightNote>
          ) : (
            <motion.div
              {...noteMotion()}
              style={{
                position: 'relative',
                display: 'inline-block',
                transformOrigin: 'center center',
                willChange: 'transform, opacity, filter',
              }}
            >
              <NoteBody
                note={note}
                variant={variant}
                develop={develop}
                marks={marks}
                markStart={markStart}
                reduceMotion={reduceMotion}
              />
            </motion.div>
          )}
        </div>

        {/* Metadata + transcript, arriving after the note has landed — the note
            is the event; these are the caption to it. */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.3, ease: EASE_OUT, delay: reduceMotion ? 0 : markStart }}
          style={{ maxWidth: 460, textAlign: 'center' }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: inkA(0.45),
              paddingBottom: 10,
              borderBottom: `1px solid ${inkA(0.18)}`,
              marginBottom: 12,
            }}
          >
            {note.id.replace('_', '-')}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 13, lineHeight: 1.55, color: inkA(0.85) }}>
            {note.text}
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

function EntranceExploration() {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(null); // { note, origin }
  // Bumped to remount the preview so an entrance can be re-watched in place.
  const [run, setRun] = useState(0);

  const dials = useDialKit(
    'Note Entrance',
    {
      variant: {
        type: 'select',
        options: VARIANTS.map((v) => ({ value: v, label: VARIANT_LABEL[v] })),
        default: 'flight',
      },
      backdrop: {
        fadeS: [0.24, 0, 1, 0.02],
        alpha: [0.72, 0, 1, 0.02],
      },
      flight: {
        spring: { type: 'spring', stiffness: 200, damping: 26, mass: 1 },
      },
      lift: {
        distance: [140, 20, 700, 5],
        rotate: [1.5, -8, 8, 0.5],
        spring: { type: 'spring', stiffness: 220, damping: 20, mass: 1 },
      },
      tray: {
        platePad: [44, 0, 160, 4],
        plateAlpha: [0.07, 0, 0.3, 0.01],
        spring: { type: 'spring', stiffness: 180, damping: 24, mass: 1 },
      },
      develop: {
        durS: [0.7, 0.1, 2, 0.05],
        blur: [14, 0, 40, 1],
        contrast: [1.7, 1, 3, 0.05],
        grain: [0.55, 0, 1, 0.05],
      },
      marks: {
        on: true,
        scramble: true,
        inset: [11, -20, 44, 1],
        startS: [0.2, 0, 1.2, 0.02],
        stagger: [0.07, 0, 0.4, 0.01],
      },
      replay: { type: 'action', label: '⟳ Replay' },
    },
    {
      onAction: (action) => {
        if (action === 'replay') setRun((r) => r + 1);
      },
    }
  );

  // The dial owns the selection, but the number keys have to be able to drive it
  // too — the panel is hidden unless the page is loaded with ?dial=1.
  const [variant, setVariant] = useState(dials.variant);
  useEffect(() => {
    setVariant(dials.variant);
  }, [dials.variant]);

  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'r' || e.key === 'R') {
        setRun((n) => n + 1);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= VARIANTS.length) setVariant(VARIANTS[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const openNote = (note) => (e) => {
    // The IMAGE's box, not the cell's — the note is `contain`ed inside a square
    // tile, so the cell rect would start the flight on empty letterbox.
    const img = e.currentTarget.querySelector('img');
    setOpen({ note, origin: img ? img.getBoundingClientRect() : null });
  };

  const gridW = TILE * GRID_COLS;

  return (
    <>
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
          padding: '48px 24px',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: inkA(0.8),
            }}
          >
            Note Entrance — {VARIANT_LABEL[variant]}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: inkA(0.38),
              marginTop: 8,
            }}
          >
            click a note · 1–4 switch · R replay · esc close · ?dial=1 controls · ?slow=8 slow-mo
            {SLOW > 1 ? ` · ${SLOW}× slow` : ''}
          </div>
        </div>

        {/* Contact sheet. The register marks at the cell corners are the same
            move the preview makes, which is the point of putting them here. */}
        <div style={{ position: 'relative', width: gridW }}>
          {Array.from({ length: (GRID_COLS + 1) * (GRID_COLS + 1) }).map((_, i) => {
            const col = i % (GRID_COLS + 1);
            const row = Math.floor(i / (GRID_COLS + 1));
            return (
              <span
                key={`x${i}`}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: `${(col / GRID_COLS) * 100}%`,
                  top: `${(row / GRID_COLS) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  fontFamily: MONO,
                  fontSize: 9,
                  lineHeight: 1,
                  color: inkA(0.3),
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                +
              </span>
            );
          })}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${GRID_COLS}, ${TILE}px)`,
              gridTemplateRows: `repeat(${GRID_COLS}, ${TILE}px)`,
            }}
          >
            {NOTES.map((note) => {
              // The flying note is hidden in the sheet while it's away, so it
              // reads as having left the grid rather than been duplicated.
              const away = open?.note.id === note.id && variant === 'flight';
              return (
                <button
                  key={note.id}
                  type="button"
                  onClick={openNote(note)}
                  aria-label={`Open ${note.id}`}
                  style={{
                    position: 'relative',
                    width: TILE,
                    height: TILE,
                    padding: TILE_PAD,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <img
                    src={noteSrc(note.id)}
                    alt=""
                    draggable={false}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      width: 'auto',
                      height: 'auto',
                      display: 'block',
                      opacity: away ? 0 : 1,
                      transition: away ? 'none' : 'opacity 0.3s ease 0.1s',
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <Preview
            key={`${open.note.id}-${variant}-${run}`}
            note={open.note}
            origin={open.origin}
            variant={variant}
            dials={dials}
            reduceMotion={reduceMotion}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/* ── Bench shell ────────────────────────────────────────────────────────
 * Explorations share one page and one backdrop; the tab lives in the URL
 * (?tab=dial) so a particular study can be linked or reloaded into.
 * ──────────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'entrance', label: 'Note entrance', render: () => <EntranceExploration /> },
  { id: 'dial', label: 'Category → dial', render: () => <CategoryDialLab /> },
  { id: 'about', label: 'About page', render: () => <AboutCardsLab /> },
  { id: 'about-drawer', label: 'About drawer', render: () => <AboutDrawerNavLab /> },
  { id: 'about-peek', label: 'About peek', render: () => <AboutDrawerPeekLab /> },
  { id: 'onboarding', label: 'Onboarding', render: () => <OnboardingStackLab /> },
];

export default function NoteEntranceLab() {
  const [tab, setTab] = useState(() => {
    if (typeof window === 'undefined') return TABS[0].id;
    const q = new URLSearchParams(window.location.search).get('tab');
    return TABS.some((t) => t.id === q) ? q : TABS[0].id;
  });

  const pick = (id) => {
    setTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', id);
    window.history.replaceState({}, '', url);
  };

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: PAGE_BG,
        color: INK,
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      {/* Same backdrop as the archive and the intro. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
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

      <nav
        style={{
          position: 'fixed',
          top: 28,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          display: 'flex',
          gap: 2,
          border: `1px dashed ${inkA(0.22)}`,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            style={{
              padding: '8px 16px',
              background: t.id === tab ? inkA(0.1) : 'none',
              border: 'none',
              color: inkA(t.id === tab ? 0.92 : 0.45),
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {active.render()}
    </div>
  );
}
