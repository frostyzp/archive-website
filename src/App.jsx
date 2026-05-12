import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Text } from './text';
import { Sidebar, SIDEBAR_WIDTH, SIDEBAR_PEEK } from './Sidebar';
import {
  BOTTOM_DIAL_SIZE,
  BottomCompassDial,
  getCategoryBreadcrumbInfo,
  HorizontalConfessionStack,
} from './SideDial';
import { CONFESSIONS as FALLBACK_CONFESSIONS } from './confessions';
import { deriveEmotions, sortConfessionsByEmotions } from './themes';
import { confessionNoteImageUrl } from './loadConfessions';
import { useConfessions } from './useConfessions';
import { GrainOverlay, HEAVY_PAPER, TunableGrainBackground } from './noise.jsx';

const ease = [0.22, 1, 0.36, 1];

// First three confessions used as the peek-out notes at the bottom of the
// landing page. Images live in `public/confession_notes_2` as WebP
// (`/confession_notes_2/AC_xxx.webp`), same source as live sheet data.
const LANDING_BOTTOM_NOTES = ['AC_094', 'AC_095', 'AC_096'];

// Standard ease-out-quart curve used by the intro page note slide-up.
// Feels deliberate without bouncing — a "snap-to-place" decel.
const NOTE_ENTRANCE_EASE = [0.165, 0.84, 0.44, 1];

// Per-note layout for the landing page — first the hero (peek-from-bottom)
// position, then the reveal (centered spread) position. Each entry maps to
// LANDING_BOTTOM_NOTES at the same index after we reorder rendering: we
// render [left, right, center] so the center note paints on top.
const LANDING_NOTE_CONFIGS = [
  // Left note (back-left)
  {
    noteIdx: 1,
    width: 'min(46vw, 460px)',
    hero: { bottomOffset: -120, x: -240, rotate: -8 },
    reveal: { x: -260, y: 12, rotate: -7, scale: 0.78 },
    z: 0,
  },
  // Right note (back-right)
  {
    noteIdx: 2,
    width: 'min(46vw, 460px)',
    hero: { bottomOffset: -130, x: 240, rotate: 8 },
    reveal: { x: 260, y: 16, rotate: 7, scale: 0.78 },
    z: 0,
  },
  // Center note (hero focal piece)
  {
    noteIdx: 0,
    width: 'min(48vw, 480px)',
    hero: { bottomOffset: -90, x: 0, rotate: 0 },
    reveal: { x: 0, y: 0, rotate: 0, scale: 0.88 },
    z: 1,
  },
];

function LandingPage({ onEnter }) {
  const reduceMotion = useReducedMotion();
  // Two phases share the same screen:
  //   'hero'   → big title + ENTER button, notes peek from the bottom.
  //   'reveal' → title fades out, notes animate UP into a centered spread,
  //              caption + CONTINUE fade in below them.
  const [phase, setPhase] = useState('hero');

  // The "lift-up" distance for the reveal phase depends on viewport height,
  // because the notes are anchored to the bottom in hero phase. We measure
  // once on mount and on resize so the centered position stays correct
  // across window sizes.
  const [vh, setVh] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : 900
  );
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // How far up to translate each note from its hero (bottom-anchored)
  // position so they land near the true vertical middle of the viewport.
  //
  // Math: notes are anchored at `bottom: -120` (about) below the viewport
  // bottom and scaled around `transformOrigin: center bottom`. To put the
  // image's visible CENTER at vh/2, we need to lift further than vh/2
  // because:
  //   visible_center_y = wrapper_bottom_y + liftY - (image_height × scale)/2
  //                    ≈ vh + 120 + liftY - 90  (for ~322px image @ 0.55)
  //   ⇒ liftY ≈ -(vh/2 + 30)  to land at vh/2.
  // The +60 buffer pushes them slightly above true center so the caption
  // + CONTINUE button below them have visual breathing room.
  const liftY = -(vh / 2 + 60);

  // ease-out-expo for the lift: longer decel tail so the notes "float" into
  // place rather than snapping. Paired with a slightly faster duration.
  const easeOut = [0.19, 1, 0.22, 1];

  return (
    <motion.div
      key="landing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -30 }}
      transition={{ duration: 0.6, ease }}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: 40,
        textAlign: 'center',
        overflow: 'hidden',
        background:
          'radial-gradient(ellipse at center, #000000 0%, #000000 75%, #171717 100%)',
      }}
    >
      {/* Full-viewport grain backdrop. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          isolation: 'isolate',
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at center, #000000 0%, #000000 75%, #171717 100%)',
        }}
      >
        <TunableGrainBackground />
      </div>

      {/* Notes layer. Each note is wrapped in a static-positioning div
          (anchored to the viewport bottom at its hero offset) so the inner
          motion.img is free to own its `transform` for animation. The
          motion.img animates between hero and reveal targets when `phase`
          changes — Motion writes a single combined transform that
          interpolates x, y, rotate, scale together. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        {LANDING_NOTE_CONFIGS.map((n, i) => {
          const heroTransform = `translateX(calc(-50% + ${n.hero.x}px))`;
          const target =
            phase === 'hero'
              ? { x: 0, y: 0, rotate: n.hero.rotate, scale: 1 }
              : {
                  x: n.reveal.x - n.hero.x,
                  y: liftY + n.reveal.y,
                  rotate: n.reveal.rotate,
                  scale: n.reveal.scale,
                };
          return (
            <div
              key={n.noteIdx}
              style={{
                position: 'absolute',
                bottom: n.hero.bottomOffset,
                left: '50%',
                width: n.width,
                transform: heroTransform,
                transformOrigin: 'center bottom',
                zIndex: n.z,
              }}
            >
              {/* Entrance wrapper — slides each note up from below the
                  viewport into its hero peek position with a stagger.
                  Lives separately from the phase-change motion.img so the
                  two transforms compose cleanly: outer = mount entry,
                  inner = phase target (hero ↔ reveal). */}
              <motion.div
                initial={reduceMotion ? false : { y: 260, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.95,
                  ease: easeOut,
                  // Stagger across notes — render order is [left, right,
                  // center], so the side notes anchor first then the
                  // hero center note slides up last on top of them.
                  delay: reduceMotion ? 0 : 0.45 + i * 0.13,
                }}
                style={{ willChange: 'transform' }}
              >
                <motion.img
                  src={confessionNoteImageUrl(LANDING_BOTTOM_NOTES[n.noteIdx])}
                  alt=""
                  draggable={false}
                  initial={false}
                  animate={target}
                  transition={{
                    duration: reduceMotion ? 0 : 0.7,
                    ease: easeOut,
                    // Reveal stagger: back notes land first (i=0,1), center
                    // (i=2) lands last so it reads as the focal piece.
                    delay: phase === 'reveal' ? i * 0.07 : 0,
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    transformOrigin: 'center bottom',
                    willChange: 'transform',
                  }}
                />
              </motion.div>
            </div>
          );
        })}
      </div>

      {/* Hero phase content: title + ENTER button. Fades out when the user
          clicks ENTER, freeing the screen for the notes to animate up. */}
      <AnimatePresence>
        {phase === 'hero' && (
          <motion.div
            key="hero-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: easeOut }}
            style={{
              position: 'relative',
              zIndex: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease, delay: 0.1 }}
            >
              <h1
                style={{
                  fontFamily: "'OT Brut', 'News Plantin', Georgia, serif",
                  fontSize: '52px',
                  fontWeight: 400,
                  lineHeight: 1,
                  letterSpacing: '0.01em',
                  color: '#e5e5e5',
                  margin: 0,
                }}
              >
                WHAT WE TELL AI
              </h1>
              <p
                style={{
                  margin: '18px 0 0',
                  maxWidth: 520,
                  fontFamily: "'OT Brut', 'News Plantin', Georgia, serif",
                  fontSize: 18,
                  fontWeight: 400,
                  lineHeight: 1.45,
                  letterSpacing: '0.02em',
                  color: 'rgba(229, 229, 229, 0.78)',
                }}
              >
                Anonymous confessions about AI&rsquo;s presence in our intimate
                lives
              </p>
            </motion.div>

            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease, delay: 0.5 }}
              whileHover={{ scale: 1.02, opacity: 1 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setPhase('reveal')}
              style={{
                marginTop: 40,
                padding: '12px 32px',
                background: 'transparent',
                border: 'none',
                color: '#e5e5e5',
                fontSize: 14,
                fontWeight: 400,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                letterSpacing: '0.18em',
                opacity: 0.85,
              }}
            >
              CONTINUE
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reveal phase content: caption + CONTINUE. Fades in below the
          centered notes once the lift-up animation is well underway. */}
      <AnimatePresence>
        {phase === 'reveal' && (
          <motion.div
            key="reveal-content"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.5,
              ease: easeOut,
              // Wait for the notes to be most of the way up before the
              // caption appears so it doesn't collide with the spread.
              delay: 0.7,
            }}
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 'calc(50vh - 200px)',
              zIndex: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 24,
              padding: '0 40px',
              textAlign: 'center',
              pointerEvents: 'auto',
            }}
          >
            <p
              style={{
                margin: 0,
                maxWidth: 520,
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                fontSize: 13,
                lineHeight: 1.7,
                letterSpacing: '0.04em',
                color: '#e5e5e5',
                opacity: 0.85,
              }}
            >
              We asked strangers to confess about the way they&rsquo;ve
              interacted with AI.
            </p>

            <motion.button
              whileHover={{ opacity: 1 }}
              whileTap={{ scale: 0.98 }}
              onClick={onEnter}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#e5e5e5',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                letterSpacing: '0.18em',
                opacity: 0.85,
                padding: '8px 16px',
              }}
            >
              VIEW CONFESSIONS
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Matches grid breakpoints in this file; also drives archive top chrome layout.
const ARCHIVE_NAV_COMPACT_MQ = '(max-width: 760px)';

function useArchiveNavCompact() {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(ARCHIVE_NAV_COMPACT_MQ).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(ARCHIVE_NAV_COMPACT_MQ);
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return compact;
}

function ViewToggle({
  view,
  onChange,
  sidebarInset = SIDEBAR_WIDTH,
  stacked = false,
  /** In mobile top bar: GRID | THEME stay on one row, not fixed to viewport. */
  embedded = false,
}) {
  const columnStack = stacked && !embedded;
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: 0.2 }}
      style={{
        ...(embedded || columnStack
          ? {
              position: 'relative',
              left: 'auto',
              right: 'auto',
              marginLeft: 0,
              marginRight: 0,
            }
          : {
              position: 'fixed',
              top: 24,
              left: sidebarInset,
              right: 0,
              marginLeft: 'auto',
              marginRight: 'auto',
            }),
        width: 'fit-content',
        zIndex: 200,
        display: 'flex',
        flexDirection: columnStack ? 'column' : 'row',
        alignItems: 'center',
        gap: columnStack ? 10 : 12,
        padding: '6px 12px',
        background: 'transparent',
        border: 'none',
        fontFamily: 'var(--font-mono)',
        flexShrink: 0,
      }}
    >
      <ToggleButton active={view === 'grid'} onClick={() => onChange('grid')}>
        GRID
      </ToggleButton>
      {columnStack ? (
        <div
          style={{
            width: 40,
            height: 1,
            background: 'rgba(255,255,255,0.25)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.25)' }} />
      )}
      <ToggleButton active={view === 'theme'} onClick={() => onChange('theme')}>
        THEME
      </ToggleButton>
    </motion.div>
  );
}

function SiteTitle() {
  const compactNav = useArchiveNavCompact();
  if (compactNav) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: 0.2 }}
      style={{
        position: 'fixed',
        top: 24,
        left: 24,
        zIndex: 200,
        padding: '6px 12px',
        color: '#fdfdfd',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.14em',
        lineHeight: 1.06,
        opacity: 0.85,
        textTransform: 'uppercase',
        pointerEvents: 'none',
      }}
    >
      What we tell AI
    </motion.div>
  );
}

function AboutHeader({ onClick, open, stacked = false }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: 0.2 }}
      onClick={onClick}
      aria-expanded={open}
      aria-label="Open about panel"
      style={{
        ...(stacked
          ? { position: 'relative', top: 'auto', right: 'auto' }
          : { position: 'fixed', top: 24, right: 24 }),
        zIndex: 200,
        background: 'transparent',
        border: 'none',
        padding: '6px 12px',
        color: '#fdfdfd',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.14em',
        lineHeight: 1.06,
        cursor: 'pointer',
        opacity: 0.85,
        transition: 'opacity 0.2s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.85')}
    >
      ABOUT
    </motion.button>
  );
}

/**
 * Centered about modal. Mirrors the Lightbox motion choreography (paired
 * backdrop blur + card scale, ESC to close, click-out to close, ~20% faster
 * exit, prefers-reduced-motion respected) so all overlays in the app feel
 * like they belong to the same family.
 */
function AboutModal({ open, onClose }) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const easeOut = [0.165, 0.84, 0.44, 1];

  const backdropMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, backdropFilter: 'blur(0px)' },
        animate: { opacity: 1, backdropFilter: 'blur(12px)' },
        exit: { opacity: 0, backdropFilter: 'blur(0px)' },
      };

  const cardMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.96, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97, y: 4 },
      };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="about-backdrop"
          {...backdropMotion}
          transition={{ duration: 0.28, ease: easeOut, backdropFilter: { duration: 0.28, ease: easeOut } }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(6, 6, 8, 0.78)',
            WebkitBackdropFilter: 'blur(0px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            padding: 24,
          }}
        >
          <motion.div
            key="about-card"
            {...cardMotion}
            transition={{ duration: 0.32, ease: easeOut, exit: { duration: 0.2 } }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: 560,
              width: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '40px 40px 32px',
              background: 'rgba(15,15,18,0.96)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              cursor: 'default',
              color: '#e5e5e5',
              boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
            }}
          >
            <button
              onClick={onClose}
              aria-label="Close about"
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.18)',
                color: 'rgba(255,255,255,0.65)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                width: 28,
                height: 28,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                transition: 'color 0.2s, border-color 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#fff';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(255,255,255,0.65)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)';
              }}
            >
              ×
            </button>

            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 28,
                fontWeight: 400,
                lineHeight: 1,
                letterSpacing: '0.01em',
                margin: 0,
                marginBottom: 24,
                textTransform: 'uppercase',
              }}
            >
              About
            </h2>

            <Text
              variant="bodySmall"
              style={{ display: 'block', lineHeight: 1.7, opacity: 0.85, fontSize: 14, marginBottom: 16 }}
            >
              What We Tell AI is a collection of anonymous notes people have written about their relationship with artificial intelligence.
            </Text>

            <Text
              variant="bodySmall"
              style={{ display: 'block', lineHeight: 1.7, opacity: 0.75, fontSize: 14, marginBottom: 16 }}
            >
              This anthropological art project documents AI&rsquo;s growing presence in the most intimate details of our lives.
            </Text>

            <Text
              variant="bodySmall"
              style={{ display: 'block', lineHeight: 1.7, opacity: 0.65, fontSize: 14, marginBottom: 18 }}
            >
              Each handwritten note is collected in public parks, on street corners, and even at AI conferences.
            </Text>

            <Text variant="caption" mono style={{ display: 'block', opacity: 0.6, letterSpacing: '0.12em' }}>
              Collection is ongoing — get in touch!
            </Text>

            <div
              style={{
                marginTop: 28,
                paddingTop: 18,
                borderTop: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.1em',
                color: 'rgba(255,255,255,0.45)',
              }}
            >
              <div>Project by Olivia</div>
              <div>Website by Arin</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ToggleButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: '2px 4px',
        color: '#fdfdfd',
        opacity: active ? 1 : 0.5,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 11,
        letterSpacing: '0.14em',
        lineHeight: 1.06,
        transition: 'opacity 0.2s ease',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.opacity = 0.8;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.opacity = 0.5;
      }}
    >
      {children}
    </button>
  );
}

function GridView({ confessions, sidebarInset = SIDEBAR_WIDTH }) {
  const [selected, setSelected] = useState(null);
  // Tiles whose image failed to load (e.g. file not yet on disk for that
  // GlobalID). We hide the whole tile rather than showing a broken-image
  // icon, since the grid is meant to read like a photo wall.
  const [failedIds, setFailedIds] = useState(() => new Set());
  const visible = confessions.filter((c) => c.image && !failedIds.has(c.id));

  return (
    <motion.div
      key="grid-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease }}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: sidebarInset,
        right: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '88px 32px 48px',
        zIndex: 1,
      }}
    >
      <style>{`
        .confession-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          border: 1px solid #2a2a2a;
          max-width: 1100px;
          margin: 0 auto;
        }
        @media (max-width: 760px) {
          .confession-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 460px) {
          .confession-grid { grid-template-columns: 1fr; }
        }
      `}</style>
      <div className="confession-grid">
        {visible.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, ease, delay: Math.min(i * 0.04, 1.2) }}
            whileHover={{ zIndex: 2 }}
            onClick={() => setSelected(c)}
            style={{
              position: 'relative',
              aspectRatio: '1 / 1',
              outline: '1px solid #2a2a2a',
              outlineOffset: -1,
              overflow: 'hidden',
              cursor: 'pointer',
            }}
          >
            <img
              src={c.image}
              alt={`Confession ${c.id}`}
              draggable={false}
              loading="lazy"
              onError={() =>
                setFailedIds((s) => {
                  const next = new Set(s);
                  next.add(c.id);
                  return next;
                })
              }
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                padding: 42,
                boxSizing: 'border-box',
                display: 'block',
                filter: 'grayscale(0.2)',
                transition: 'transform 0.4s ease, filter 0.3s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.04)';
                e.currentTarget.style.filter = 'grayscale(0)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.filter = 'grayscale(0.2)';
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 8,
                bottom: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
                color: 'rgba(255,255,255,0.75)',
                pointerEvents: 'none',
              }}
            >
              {String(c.id).padStart(3, '0')}
              {c.category ? ` · ${c.category.toUpperCase()}` : ''}
            </div>
          </motion.div>
        ))}
      </div>

      <Lightbox confession={selected} onClose={() => setSelected(null)} />
    </motion.div>
  );
}

/**
 * Click-to-zoom modal for a single confession image.
 *
 * Animation choices (per Emil Kowalski's framework):
 *  - Element enters viewport → ease-out (cubic-bezier(0.165, 0.84, 0.44, 1)).
 *  - Modal class → 240ms enter, 180ms exit (~20% faster than enter).
 *  - Image starts at scale 0.96, not 0 — avoids the "appears from nowhere"
 *    feeling. Only opacity + transform are animated for GPU acceleration.
 *  - Backdrop and image share timing/easing (paired-elements rule).
 *  - prefers-reduced-motion disables motion entirely.
 */
function Lightbox({ confession, onClose }) {
  const reduceMotion = useReducedMotion();
  const open = !!confession;

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const easeOut = [0.165, 0.84, 0.44, 1];

  const backdropMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, backdropFilter: 'blur(0px)' },
        animate: { opacity: 1, backdropFilter: 'blur(12px)' },
        exit: { opacity: 0, backdropFilter: 'blur(0px)' },
      };

  const imageMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.96 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.97 },
      };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="lightbox-backdrop"
          {...backdropMotion}
          transition={{
            duration: 0.24,
            ease: easeOut,
            backdropFilter: { duration: 0.24, ease: easeOut },
          }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(8, 8, 10, 0.78)',
            // backdropFilter is animated above; this fallback ensures the
            // animation has something to interpolate from when the layer mounts.
            WebkitBackdropFilter: 'blur(0px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <motion.img
            key="lightbox-img"
            src={confession.image}
            alt={`Confession ${confession.id}`}
            draggable={false}
            {...imageMotion}
            transition={{ duration: 0.24, ease: easeOut, exit: { duration: 0.18 } }}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 'min(90vw, 900px)',
              maxHeight: '88vh',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              display: 'block',
              boxShadow: 'none',
              cursor: 'default',
              willChange: 'transform, opacity',
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 0.7, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: easeOut, delay: 0.05 }}
            style={{
              position: 'absolute',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              color: 'rgba(255,255,255,0.7)',
              pointerEvents: 'none',
            }}
          >
            {String(confession.id).padStart(3, '0')}
            {confession.category ? ` · ${confession.category.toUpperCase()}` : ''}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ThemeView({
  emotions,
  activeEmotion,
  activeIndex,
  setActiveIndex,
  confessions,
  activeConfession,
  activeEmotionData,
  handleEmotionChange,
  sidebarInset = SIDEBAR_WIDTH,
  dialSize = BOTTOM_DIAL_SIZE,
  dialLabelInset = Math.round(BOTTOM_DIAL_SIZE * 0.232 + 40),
}) {
  const dialBreadcrumb = useMemo(
    () => getCategoryBreadcrumbInfo(confessions, activeConfession),
    [confessions, activeConfession]
  );

  return (
    <motion.div
      key="theme-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease }}
      style={{ position: 'absolute', inset: 0 }}
    >
      {/* Background layer: gradient crossfade + grain, isolated so the
          grain's mix-blend-mode actually blends with the gradient as
          backdrop instead of falling through to transparency.
          The solid #111 base is critical — without it the half-faded gradient
          midpoint lets the `overlay` blend on the grain layer pulse white. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          isolation: 'isolate',
          pointerEvents: 'none',
          background: '#111',
        }}
      >
        <AnimatePresence>
          <motion.div
            key={activeEmotion}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.165, 0.84, 0.44, 1] }}
            style={{
              position: 'absolute',
              inset: 0,
              background: activeEmotionData?.gradient,
            }}
          />
        </AnimatePresence>
        <TunableGrainBackground />
      </div>

      {/* Cards take the area between the top header pills and the dial
          *labels* (not the full canvas). The dial canvas extends another
          ~size*0.27 above the labels but it's transparent up there, so we
          let cards visually overlap that empty region — the dial canvas
          (z-index 10) still draws over them where the labels actually
          are. Net effect: cards sit visually low / centered with the dial
          rather than hugging the top header. */}
      <div
        style={{
          position: 'absolute',
          top: 80,
          left: sidebarInset,
          right: 0,
          bottom: dialLabelInset,
          zIndex: 1,
        }}
      >
        <HorizontalConfessionStack
          confessions={confessions}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          entranceDelay={1.5}
        />
      </div>

      {/* Outer div keeps the centering transform stable; inner motion.div
          owns the opacity fade so Motion doesn't fight the translateX.
          Negative bottom drops the dial below the viewport edge so its
          half-disc reads as rising up from beneath the fold.
          Within-category ticks are drawn on the dial canvas (active sector). */}
      <div
        style={{
          position: 'absolute',
          bottom: -12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          pointerEvents: 'auto',
        }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.55, ease, delay: 0.35 }}
        >
          <BottomCompassDial
            emotions={emotions}
            activeEmotion={activeEmotion}
            onEmotionChange={handleEmotionChange}
            size={dialSize}
            breadcrumb={dialBreadcrumb}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}


/**
 * Pick a comfortable dial size for the current viewport.
 *
 *   width  ≈ 70% of viewport width (gives the labels room to spread out)
 *   bounds ≈ [480, 880] px so it never feels cramped or absurd
 *   height impact ≈ size / 2 (only the top half is visible at the bottom
 *                              of the screen)
 *
 * Recomputes on window resize. Uses a ref-style measure to avoid a layout
 * thrash if multiple consumers ever call this.
 */
function useResponsiveDialSize() {
  const compute = () => {
    if (typeof window === 'undefined') return 720;
    const w = window.innerWidth;
    // Clamp height contribution too — on short viewports the half-circle
    // would otherwise eat too much vertical space.
    const widthCap = Math.min(880, Math.max(480, Math.round(w * 0.7)));
    const heightCap = Math.round(window.innerHeight * 0.9); // half-circle = 0.45 of viewport
    return Math.min(widthCap, heightCap);
  };
  const [size, setSize] = useState(compute);
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSize(compute()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, []);
  return size;
}

function ArchiveLoading() {
  return (
    <motion.div
      key="archive-loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease }}
      style={{
        height: '100vh',
        background: '#111',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.55)',
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: 12,
        letterSpacing: '0.18em',
      }}
    >
      Entering the Archive
    </motion.div>
  );
}

function ArchivePage() {
  // Live data from the published Google Sheet. Falls back to the bundled
  // sample data if the network call fails so the prototype still works
  // offline / behind a captive portal.
  const { confessions: liveConfessions, emotions: liveEmotions, loading, error } =
    useConfessions();

  const usingFallback = !loading && (error || liveConfessions.length === 0);
  const fallbackEmotions = useMemo(
    () => deriveEmotions(FALLBACK_CONFESSIONS),
    []
  );
  const fallbackConfessions = useMemo(
    () => sortConfessionsByEmotions(FALLBACK_CONFESSIONS, fallbackEmotions),
    [fallbackEmotions]
  );

  const confessions = usingFallback ? fallbackConfessions : liveConfessions;
  const emotions = usingFallback ? fallbackEmotions : liveEmotions;

  // The dial/theme view only makes sense for confessions that have a theme —
  // they're the ones bucketed under a dial slot. The grid view shows
  // everything (themed or not) so visitors can browse the full archive.
  const themedConfessions = useMemo(
    () => confessions.filter((c) => c.category),
    [confessions]
  );

  // Main content area: 'theme' (default) or 'grid' — controlled by the pill.
  const [view, setView] = useState('theme');
  // Sidebar panel content under the nav: 'metadata' (default — shows active
  // confession info) | 'about' | 'submit'.
  // ABOUT/SUBMIT in the sidebar nav swap to those panels; otherwise we stay
  // on metadata so the theme notes remain the focus.
  const [sidebarPanel, setSidebarPanel] = useState('metadata');
  // Sidebar is hidden for now — content reclaims the full viewport width.
  // To bring the sidebar back, restore the collapsed state + the
  // <Sidebar /> render below and set sidebarInset to the peek/full width.
  const sidebarInset = 0;
  // Top-right "ABOUT" header → modal. Independent of the sidebar's About
  // panel so it works regardless of sidebar state.
  const [aboutOpen, setAboutOpen] = useState(false);
  const compactNav = useArchiveNavCompact();

  // Dial size scales with the viewport so it has room to breathe on big
  // screens but doesn't dominate on small ones. The visible portion is half
  // the dial's height (only the top half is shown), so we cap the height
  // contribution before the cards start to feel cramped.
  const dialSize = useResponsiveDialSize();
  // The dial canvas is `size × size/2` tall, but the active label only
  // sits `labelR` (≈ size * 0.232) above the bottom — everything above the
  // label is just transparent canvas. Reserve only enough space for the
  // labels + a 40px breathing strip so the cards above can use the extra
  // real estate and read as "centered" rather than crammed at the top.
  const dialLabelInset = Math.round(dialSize * 0.232 + 40);
  const [activeEmotion, setActiveEmotion] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Once data loads, snap activeEmotion to the first available emotion.
  useEffect(() => {
    if (!activeEmotion && emotions.length > 0) {
      setActiveEmotion(emotions[0].id);
    }
  }, [emotions, activeEmotion]);

  const activeEmotionData = emotions.find((e) => e.id === activeEmotion);
  // Active confession is indexed against themedConfessions because the
  // theme/dial view only iterates over themed rows. The sidebar metadata
  // panel reflects this same selection.
  const activeConfession =
    themedConfessions[activeIndex] || themedConfessions[0];

  // Map every confession's category label to the matching emotion id once.
  const emotionByLabel = useMemo(() => {
    const m = new Map();
    emotions.forEach((e) => m.set(e.label, e.id));
    return m;
  }, [emotions]);

  // Click on a dial label → jump to first confession of that category.
  const handleEmotionChange = (emotionId) => {
    setActiveEmotion(emotionId);
    const label = emotions.find((e) => e.id === emotionId)?.label;
    const firstIdx = themedConfessions.findIndex((c) => c.category === label);
    if (firstIdx >= 0) setActiveIndex(firstIdx);
    setSidebarPanel('metadata');
  };

  // User-driven scroll or click in the stack updates activeIndex; mirror the
  // current card's category onto the dial so it auto-rotates as you scroll.
  const handleActiveIndexChange = (i) => {
    setActiveIndex(i);
    const cat = themedConfessions[i]?.category;
    const emoId = cat ? emotionByLabel.get(cat) : null;
    if (emoId && emoId !== activeEmotion) setActiveEmotion(emoId);
    setSidebarPanel('metadata');
  };

  if (loading) {
    return <ArchiveLoading />;
  }

  return (
    <motion.div
      key="archive"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease }}
      style={{ height: '100vh', position: 'relative', overflow: 'hidden', background: '#111' }}
    >
      <SiteTitle />
      {compactNav ? (
        <div
          style={{
            position: 'fixed',
            top: 24,
            left: 16,
            right: 16,
            zIndex: 200,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            pointerEvents: 'none',
          }}
        >
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
            <ViewToggle
              view={view}
              onChange={setView}
              sidebarInset={sidebarInset}
              embedded
            />
          </div>
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
            <AboutHeader
              onClick={() => setAboutOpen(true)}
              open={aboutOpen}
              stacked
            />
          </div>
        </div>
      ) : (
        <>
          <ViewToggle view={view} onChange={setView} sidebarInset={sidebarInset} />
          <AboutHeader onClick={() => setAboutOpen(true)} open={aboutOpen} />
        </>
      )}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <AnimatePresence mode="wait">
        {view === 'theme' ? (
          <ThemeView
            key="theme"
            emotions={emotions}
            activeEmotion={activeEmotion}
            activeIndex={activeIndex}
            setActiveIndex={handleActiveIndexChange}
            confessions={themedConfessions}
            activeConfession={activeConfession}
            activeEmotionData={activeEmotionData}
            handleEmotionChange={handleEmotionChange}
            sidebarInset={sidebarInset}
            dialSize={dialSize}
            dialLabelInset={dialLabelInset}
          />
        ) : (
          <GridView key="grid" confessions={confessions} sidebarInset={sidebarInset} />
        )}
      </AnimatePresence>

      {/* Sidebar hidden — see comment by sidebarInset above to restore. */}
    </motion.div>
  );
}

export default function App() {
  const [page, setPage] = useState('landing');

  return (
    <AnimatePresence mode="wait">
      {page === 'landing' && (
        <LandingPage onEnter={() => setPage('archive')} />
      )}
      {page === 'archive' && <ArchivePage />}
    </AnimatePresence>
  );
}
