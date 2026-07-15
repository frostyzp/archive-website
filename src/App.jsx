import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  useMotionValue,
  useSpring,
} from 'motion/react';
import { Text, TRANSCRIPTION_TEXT, TRANSCRIPTION_FONT_SIZE, VARIANTS } from './text';
import OnboardingReveal from './OnboardingReveal';
import { Sidebar, SIDEBAR_WIDTH } from './Sidebar';
import {
  BOTTOM_DIAL_SIZE,
  BottomCompassDial,
  getCategoryBreadcrumbInfo,
  HorizontalConfessionStack,
  INTRO_SPIN_EASE_BEZIER,
} from './SideDial';
import { CONFESSIONS as FALLBACK_CONFESSIONS } from './confessions';
import { deriveEmotions, sortConfessionsByEmotions, NEUTRAL_GRADIENT } from './themes';
import { useConfessions } from './useConfessions';
import {
  TunableGrainBackground,
  noiseUrl,
  CARD_FILTER_ID,
  CardNoiseFilterDefs,
  useInactiveCardParams,
} from './noise';
import { INK, inkA } from './colors';
import { subscribeToKit } from './kit';
import NoteOpenView, { TILE_PADDING } from './NoteOpenView';
import { GridImageFilter, GRID_IMAGE_FILTER } from './NoiseDisplaceFilter';
const ease = [0.22, 1, 0.36, 1];
/** Shared hover / color / opacity transition curve (ease-out-quart). */
const HOVER_EASE = 'cubic-bezier(0.17, 0.84, 0.44, 1)';
const HOVER_EASE_ARR = [0.17, 0.84, 0.44, 1];

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

// Single-column phones. Together with ARCHIVE_NAV_COMPACT_MQ this mirrors the
// grid's responsive column count exactly (see .confession-grid media queries):
// 3 columns by default, 2 at ≤760px, 1 at ≤460px.
const GRID_ONE_COL_MQ = '(max-width: 460px)';

/** Live column count of the contact-sheet grid, so the lattice overlay can pin
 *  its hairlines to the right cell edges (percentage-positioned to the cols×rows
 *  tile grid). */
function useGridColumns() {
  const read = () => {
    if (typeof window === 'undefined') return 3;
    if (window.matchMedia(GRID_ONE_COL_MQ).matches) return 1;
    if (window.matchMedia(ARCHIVE_NAV_COMPACT_MQ).matches) return 2;
    return 3;
  };
  const [cols, setCols] = useState(read);
  useEffect(() => {
    const mqs = [
      window.matchMedia(GRID_ONE_COL_MQ),
      window.matchMedia(ARCHIVE_NAV_COMPACT_MQ),
    ];
    const onChange = () => setCols(read());
    mqs.forEach((mq) => mq.addEventListener('change', onChange));
    return () => mqs.forEach((mq) => mq.removeEventListener('change', onChange));
  }, []);
  return cols;
}

// Fixed wash behind archive top chrome (black → transparent) so labels stay
// legible when grid content scrolls underneath.
const ARCHIVE_NAV_GRADIENT_HEIGHT = 152;

/** One vertical rhythm for fixed title / view toggle / ABOUT. */
const ARCHIVE_NAV_CHROME_HEIGHT = 40;

/**
 * Archive dial entrance delay when arriving from the intro (vs. a direct/deep
 * load), so the dial spins in a beat after the archive mounts.
 */
const HANDOFF_DIAL_DELAY_MS = 560;

/** Theme stack entrance — keep in sync with ThemeView `entranceDelay` + SideDial stagger cap. */
const THEME_STACK_ENTRANCE_DELAY = 2.35;
const THEME_STACK_CARD_DURATION = 0.22;
/** How far (px) the notes stack slides across as it enters during the dial's
 *  intro spin. Notes stay at full opacity (no fade) and glide in on the spin's
 *  ease-out curve (see ThemeView). Kept small so the active card starts
 *  near-centered — a large offset parks it clipped off the right edge on load,
 *  which reads as broken (esp. during the landing→archive hold before the dial
 *  spins in). */
const NOTE_INTRO_SLIDE_PX = 72;
/** Slide duration (ms) for the notes-stack entrance. Shorter than the dial's
 *  full spin (INTRO_SPIN_DURATION = 2400) so the notes land promptly instead of
 *  dragging the slow tail — the dial uses ease-out-quart so it's ~98% settled by
 *  this point and the two still read as arriving together. */
const NOTE_INTRO_SLIDE_MS = 1500;
/** Active card + ~2 neighbor rings visible (not the full stagger tail). */
const THEME_NAV_VISIBLE_STAGGER = 0.24;
const ARCHIVE_NAV_CHROME_DELAY_THEME =
  THEME_STACK_ENTRANCE_DELAY + THEME_NAV_VISIBLE_STAGGER + THEME_STACK_CARD_DURATION;

/** Grid tile motion duration (GridView). */
const GRID_TILE_DURATION = 0.55;
/** First handful of tiles — not the full wall stagger. */
const GRID_NAV_VISIBLE_STAGGER = 0.32;
const ARCHIVE_NAV_CHROME_DELAY_GRID = GRID_NAV_VISIBLE_STAGGER + GRID_TILE_DURATION;

/** Archive nav chrome — the GRID / DIAL toggle and ABOUT. bodySmall metrics but
 *  set in Courier New (--font-mono), rendered white. Per-button active/hover
 *  states are handled via opacity. */
const ARCHIVE_NAV_TEXT = {
  ...VARIANTS.bodySmall,
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  color: INK,
};

// Plain-text nav items read as hyperlinks, so they carry a persistent underline
// (kept consistent with the About contact links + onboarding skip link). Pill /
// icon CTAs stay undecorated so they still read as buttons.
const ARCHIVE_LINK_UNDERLINE = {
  textDecorationLine: 'underline',
  textDecorationThickness: '1px',
  textUnderlineOffset: '3px',
};

const ARCHIVE_BRAND_MARK_STYLE = {
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 10,
  fontWeight: 500,
  lineHeight: 1.35,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: inkA(0.4),
};

/** Bottom-left wordmark + © on archive views (dial + grid). */
function ArchiveBrandMark({ sidebarInset = 0, entranceDelay = 0.35 }) {
  // Hidden on compact/mobile to keep the dial unobstructed.
  const compact = useArchiveNavCompact();
  if (compact) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.55, ease, delay: entranceDelay }}
      aria-label="What We Tell AI"
      style={{
        position: 'fixed',
        left: sidebarInset + 24,
        bottom: 24,
        zIndex: 180,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        ...ARCHIVE_BRAND_MARK_STYLE,
      }}
    >
      <span>What We Tell AI</span>
      <span>© 2026</span>
    </motion.div>
  );
}

function ArchiveNavGradientWash() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: ARCHIVE_NAV_GRADIENT_HEIGHT,
        zIndex: 150,
        pointerEvents: 'none',
        background:
          'linear-gradient(to bottom, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0.42) 52%, rgba(0, 0, 0, 0) 100%)',
      }}
    />
  );
}

function ViewToggle({
  view,
  onChange,
  sidebarInset = SIDEBAR_WIDTH,
  stacked = false,
  /** In mobile top bar: GRID | DIAL stay on one row, not fixed to viewport. */
  embedded = false,
  entranceDelay = 0.2,
}) {
  const columnStack = stacked && !embedded;
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: entranceDelay }}
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
        padding: '0 12px',
        minHeight: ARCHIVE_NAV_CHROME_HEIGHT,
        background: 'transparent',
        border: 'none',
        ...ARCHIVE_NAV_TEXT,
        flexShrink: 0,
      }}
    >
      {/* INTRO — leaves the archive for the onboarding intro (first screen). */}
      <ToggleButton active={false} onClick={() => window.location.assign('/onboarding')}>
        INTRO
      </ToggleButton>
      <ToggleButton active={view === 'grid'} onClick={() => onChange('grid')}>
        INDEX
      </ToggleButton>
      {/* WALL tab hidden — WallView + the `view === 'wall'` branch are kept so it
          can be restored by re-adding this ToggleButton. */}
      <ToggleButton active={view === 'theme'} onClick={() => onChange('theme')}>
        DIAL
      </ToggleButton>
    </motion.div>
  );
}

/** Hand-lettered "What We / Tell AI" wordmark button — the same outline art the
 *  onboarding hero uses, dropped into the nav. Tapping it returns to the intro
 *  onboarding. `logoHeight` lets the mobile chrome render it a touch smaller. */
function WordmarkLogo({ onReturnToIntro, logoHeight = 48 }) {
  return (
    <button
      type="button"
      onClick={onReturnToIntro}
      aria-label="What We Tell AI — return to the intro"
      title="Return to the intro"
      style={{
        pointerEvents: 'auto',
        background: 'none',
        border: 'none',
        margin: 0,
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        opacity: 0.92,
        transition: `opacity 0.28s ${HOVER_EASE}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '0.92';
      }}
    >
      <img
        src="/What%20We%20Tell%20AI.png"
        alt="What We Tell AI"
        draggable={false}
        style={{ height: logoHeight, width: 'auto', display: 'block' }}
      />
    </button>
  );
}

function SiteTitle({ entranceDelay = 0.2, onReturnToIntro }) {
  const compactNav = useArchiveNavCompact();
  if (compactNav) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: entranceDelay }}
      style={{
        position: 'fixed',
        top: 24,
        left: 24,
        zIndex: 200,
        height: ARCHIVE_NAV_CHROME_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <WordmarkLogo onReturnToIntro={onReturnToIntro} />
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
 * ABOUT HOVER NOTE — storyboard (hover-driven, no timeline)
 *
 *   rest     sketch note stowed up behind the word, tilted a
 *            touch further, fully transparent
 *   hover →  the note drops down *from the word* (transform-
 *            origin top-right): it untilts toward its resting
 *            angle, scales up, and fades in
 *   leave →  everything springs back to rest
 *
 *   The asset carries its own grainy hand-drawn border + lines
 *   (about-hover-note.png), with an extra inactive-card blur / grayscale /
 *   animated grain pass on top (see useHoverPeekInactiveStyle).
 *   Desktop only — the compact/touch top bar has no hover.
 * ───────────────────────────────────────────────────────── */
const ABOUT_NOTE = {
  src: '/about-hover-note.png', // grainy sketch note (353×388)
  width: 72, //            px — note width; height follows the aspect ratio
  aspect: '353 / 388', //  native image ratio (portrait)
  gap: 12, //              px below the ABOUT word
  hidden: {
    opacity: 0,
    y: -12, //     px — tucked up toward the word
    scale: 0.9, // slightly small before it drops
    rotate: -9, // deg — more tilt while stowed
  },
  rest: {
    opacity: 1,
    y: 0, //       resting position below the word
    scale: 1,
    rotate: -3, // deg — settled hand-pinned tilt
  },
  // Spring drives y / scale / rotate; opacity gets a quick ease so the note
  // "develops in" rather than sliding a visible ghost down the screen.
  spring: { type: 'spring', visualDuration: 0.34, bounce: 0.34 },
  fade: { duration: 0.2, ease: HOVER_EASE_ARR },
};

/**
 * Wraps the ABOUT button: hovering the word reveals a small grainy sketch note
 * that unfurls downward from the word (see ABOUT_NOTE storyboard). Reduced-motion
 * keeps the cross-fade but skips the drop / tilt / scale movement. Desktop only.
 */
function AboutHoverNote({ children }) {
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const { filter, opacity, inactive } = useHoverPeekInactiveStyle();

  const target = hovered ? ABOUT_NOTE.rest : ABOUT_NOTE.hidden;

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      <CardNoiseFilterDefs params={inactive} />
      <motion.div
        aria-hidden="true"
        initial={false}
        animate={{
          opacity: target.opacity,
          y: reduceMotion ? ABOUT_NOTE.rest.y : target.y,
          scale: reduceMotion ? ABOUT_NOTE.rest.scale : target.scale,
          rotate: reduceMotion ? ABOUT_NOTE.rest.rotate : target.rotate,
        }}
        transition={{
          y: ABOUT_NOTE.spring,
          scale: ABOUT_NOTE.spring,
          rotate: ABOUT_NOTE.spring,
          opacity: ABOUT_NOTE.fade,
        }}
        style={{
          position: 'absolute',
          top: `calc(100% + ${ABOUT_NOTE.gap}px)`,
          right: 0,
          width: ABOUT_NOTE.width,
          aspectRatio: ABOUT_NOTE.aspect,
          transformOrigin: 'top right',
          pointerEvents: 'none',
          zIndex: 210,
        }}
      >
        <img
          src={ABOUT_NOTE.src}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            opacity,
            filter,
          }}
        />
      </motion.div>
    </div>
  );
}

function AboutHeader({ onClick, open, view, onChange, stacked = false, entranceDelay = 0.2 }) {
  // Desktop top-right chrome is a small nav cluster: INTRO · INDEX · ABOUT.
  // In the stacked (compact) top bar the view tabs already live on the left,
  // so there we render only the ABOUT button to avoid duplicating them.
  // The view tabs are also hidden on the grid (INDEX) view to keep it clean;
  // ABOUT still shows. `view` is only passed to the desktop (non-stacked)
  // cluster, which is the only place these tabs render anyway.
  const showTabs = !stacked && view !== 'grid';

  // ABOUT opens the panel. On desktop it's wrapped in the grainy sketch hover
  // note (see AboutHoverNote); the compact/touch top bar keeps the plain button
  // since there's no hover there.
  const aboutButton = (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label="Open about panel"
      style={{
        background: 'none',
        border: 'none',
        padding: '2px 4px',
        ...ARCHIVE_NAV_TEXT,
        ...ARCHIVE_LINK_UNDERLINE,
        opacity: open ? 1 : 0.5,
        cursor: 'pointer',
        transition: `opacity 0.2s ${HOVER_EASE}`,
      }}
      onMouseEnter={(e) => {
        if (!open) e.currentTarget.style.opacity = '0.8';
      }}
      onMouseLeave={(e) => {
        if (!open) e.currentTarget.style.opacity = '0.5';
      }}
    >
      ABOUT
    </button>
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: entranceDelay }}
      style={{
        ...(stacked
          ? { position: 'relative', top: 'auto', right: 'auto' }
          : { position: 'fixed', top: 24, right: 24 }),
        zIndex: 200,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: '0 12px',
        minHeight: ARCHIVE_NAV_CHROME_HEIGHT,
        background: 'transparent',
        border: 'none',
        ...ARCHIVE_NAV_TEXT,
      }}
    >
      {showTabs && (
        <>
          {/* INTRO — leaves the archive for the onboarding intro. */}
          <ToggleButton active={false} onClick={() => window.location.assign('/onboarding')}>
            INTRO
          </ToggleButton>
          <ToggleButton active={view === 'grid'} onClick={() => onChange?.('grid')}>
            INDEX
          </ToggleButton>
          <ToggleButton active={view === 'theme'} onClick={() => onChange?.('theme')}>
            DIAL
          </ToggleButton>
        </>
      )}
      {/* When the full tab cluster is hidden (grid/INDEX view or the compact top
          bar), keep a standalone INDEX next to ABOUT so it stays reachable.
          Desktop upgrades it to a hover "deck of cards" that deals out the
          section links (the tabs are hidden here); the compact/touch top bar
          keeps the plain button since there's no hover. Both jump to the grid. */}
      {!showTabs &&
        (stacked ? (
          <ToggleButton active={view === 'grid'} onClick={() => onChange?.('grid')}>
            INDEX
          </ToggleButton>
        ) : (
          <IndexMenu view={view} onChange={onChange} />
        ))}
      {/* Desktop reveals the torn-paper "?" hover note; the compact/touch top
          bar keeps the plain ABOUT button (no hover). */}
      {stacked ? aboutButton : <AboutHoverNote>{aboutButton}</AboutHoverNote>}
    </motion.div>
  );
}

/**
 * Centered about modal. Backdrop + card fade in on open; on close (click-out
 * / ESC) both exit with opacity only — no scale or drift so it reads as a
 * simple dismiss. prefers-reduced-motion skips transforms on enter too.
 */
function AboutModal({ open, onClose }) {
  const reduceMotion = useReducedMotion();
  // Desktop docks the panel as a right-side drawer (matching NoteDrawer);
  // phones (≤760) take the full screen.
  const compact = useArchiveNavCompact();

  // Mailing-list signup state.
  const [email, setEmail] = useState('');
  // 'idle' | 'submitting' | 'success' | 'error'
  const [subscribeStatus, setSubscribeStatus] = useState('idle');
  const [subscribeError, setSubscribeError] = useState('');

  const subscribing = subscribeStatus === 'submitting';
  const subscribed = subscribeStatus === 'success';

  // Reset the signup form whenever the panel is closed so a reopen is fresh.
  useEffect(() => {
    if (!open) {
      setEmail('');
      setSubscribeStatus('idle');
      setSubscribeError('');
    }
  }, [open]);

  async function handleSubscribe(e) {
    e.preventDefault();
    if (!email.trim() || subscribing) return;
    setSubscribeStatus('submitting');
    setSubscribeError('');
    try {
      await subscribeToKit(email);
      setSubscribeStatus('success');
    } catch (err) {
      setSubscribeError(err.message);
      setSubscribeStatus('error');
    }
  }

  // Fonts: Faktory for body copy, mono for the contact links / credit. (The
  // foot-of-panel wordmark is now an image, not the script italic face.)
  const BODY_FONT = "'Faktory', Georgia, serif";
  const MONO_FONT = 'var(--font-mono)';

  // Torn strip of note thumbnails across the top. Fills the header width with
  // as many thumbs as fit WITHOUT the last one clipping — measured live so it
  // adapts to the desktop drawer vs the full-screen (mobile) width.
  const STRIP_NOTE_W = 30; // px — each thumb card's width
  const STRIP_GAP = 5; //     px — gap between cards (matches the row's `gap`)
  const stripRef = useRef(null);
  const [stripCount, setStripCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Fit the torn strip: as many cards as the row can hold without the last one
  // overflowing (a few px of headroom absorbs the cards' slight tilt so none
  // clip). Re-measures on open and on resize (drawer ⇄ full-screen).
  useLayoutEffect(() => {
    if (!open) return undefined;
    const el = stripRef.current;
    if (!el) return undefined;
    const fit = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const n = Math.floor((w + STRIP_GAP - 4) / (STRIP_NOTE_W + STRIP_GAP));
      setStripCount(Math.max(1, n));
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const easeOut = [0.165, 0.84, 0.44, 1];
  const drawerEase = [0.23, 1, 0.32, 1];

  const backdropMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, backdropFilter: 'blur(0px)' },
        animate: { opacity: 1, backdropFilter: 'blur(6px)' },
        exit: { opacity: 0, backdropFilter: 'blur(0px)' },
      };

  // Mobile full-screen keeps the simple fade/scale pop; the desktop drawer
  // slides in from the right edge (reverting to the pre-full-screen behavior).
  const panelMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : compact
    ? {
        initial: { opacity: 0, scale: 0.985 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.985 },
      }
    : { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="about-backdrop"
          {...backdropMotion}
          transition={{
            duration: 0.28,
            ease: easeOut,
            backdropFilter: { duration: 0.28, ease: easeOut },
          }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(8, 8, 10, 0.55)',
            WebkitBackdropFilter: 'blur(0px)',
            cursor: 'pointer',
          }}
        />
      )}
      {open && (
        <motion.aside
          key="about-panel"
          role="dialog"
          aria-modal="true"
          aria-label="About What We Tell AI"
          {...panelMotion}
          transition={
            reduceMotion
              ? { duration: 0.2, ease: easeOut }
              : compact
              ? { duration: 0.32, ease: easeOut }
              : { duration: 0.48, ease: drawerEase }
          }
          style={{
            position: 'fixed',
            zIndex: 1001,
            // Same base as the rest of the site (#111). The grain layer inside
            // paints over this, and the scrolling content sits above the grain.
            background: '#111',
            color: '#CFCAB7',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            // Phones: full-screen takeover. Desktop: right-docked drawer
            // (matches NoteDrawer) with an edge border + drop shadow.
            ...(compact
              ? { inset: 0 }
              : {
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: 'min(460px, 92vw)',
                  borderLeft: '1px solid rgba(207,202,183,0.1)',
                  boxShadow: '-24px 0 60px rgba(0,0,0,0.5)',
                }),
          }}
        >
          {/* Same base + grain as the rest of the site: an isolated #111 layer
              with the shared TunableGrainBackground (DialKit "Grain"), pinned to
              the panel so it never scrolls. Content scrolls in the wrapper below. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
              isolation: 'isolate',
              pointerEvents: 'none',
              background: '#111',
            }}
          >
            <TunableGrainBackground />
          </div>

          <div
            style={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              WebkitOverflowScrolling: 'touch',
              // Column so the reading copy stacks above a full-bleed wordmark
              // footer that gets pinned to the bottom (marginTop: auto).
              display: 'flex',
              flexDirection: 'column',
            }}
          >
          {/* Reading column — centered + width-capped so the full-screen pop-up
              doesn't stretch the copy edge-to-edge on wide viewports. */}
          <div
            style={{
              flexShrink: 0,
              width: '100%',
              maxWidth: 640,
              margin: '0 auto',
              padding: '24px 34px 56px',
            }}
          >
          <style>{`
            .about-close {
              flex: 0 0 auto; display: inline-flex; align-items: center;
              justify-content: center; padding: 6px; margin: -6px; border: none;
              background: none; color: rgba(207,202,183,0.8); cursor: pointer;
              line-height: 0; transition: color 0.18s ${HOVER_EASE}, transform 0.12s ${HOVER_EASE};
            }
            .about-close:hover { color: #CFCAB7; }
            .about-close:active { transform: scale(0.9); }
            .about-contact-link {
              display: inline-block; color: rgba(207,202,183,0.72);
              text-decoration: underline; text-decoration-thickness: 1px;
              text-underline-offset: 3px; transition: color 0.18s ${HOVER_EASE};
            }
            .about-contact-link:hover { color: #CFCAB7; }
          `}</style>

          {/* Torn strip of note thumbnails + a bare close X. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <div
              ref={stripRef}
              aria-hidden="true"
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'nowrap',
                alignItems: 'center',
                gap: STRIP_GAP,
                overflow: 'hidden',
                paddingTop: 6,
                paddingBottom: 2,
              }}
            >
              {Array.from({ length: stripCount }).map((_, i) => {
                // Alternating tilt + a repeating height pattern so the row
                // reads as a scatter of translucent notes rather than a grid.
                // Laid out with a real gap so the cards never overlap.
                const rot = (i % 2 === 0 ? -1 : 1) * (2 + ((i * 7) % 3));
                const height = [40, 30, 34, 44, 30, 38, 32][i % 7];
                return (
                  <div
                    key={i}
                    style={{
                      flex: '0 0 auto',
                      width: STRIP_NOTE_W,
                      height,
                      transform: `rotate(${rot}deg)`,
                      borderRadius: 2,
                      background: 'rgba(136,134,134,0.22)',
                    }}
                  />
                );
              })}
            </div>
            <button
              type="button"
              className="about-close"
              aria-label="Close about panel"
              onClick={onClose}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" /></svg>
            </button>
          </div>

            <p
              style={{
                margin: '0 0 18px',
                fontFamily: BODY_FONT,
                fontSize: 18,
                lineHeight: 1.4,
                letterSpacing: '0.01em',
                color: 'rgba(200,200,200,0.9)',
              }}
            >
              What We Tell AI is a collection of anonymous notes people have
              written about their relationship with{' '}
              <span
                style={{
                  textDecoration: 'underline',
                  textDecorationColor: 'rgba(207,202,183,0.5)',
                  textUnderlineOffset: '3px',
                }}
              >
                artificial intelligence
              </span>{' '}
              (AI).
            </p>

            <p
              style={{
                margin: '0 0 20px',
                fontFamily: BODY_FONT,
                fontSize: 18,
                lineHeight: 1.4,
                letterSpacing: '0.01em',
                color: 'rgba(200,200,200,0.9)',
              }}
            >
              This anthropological art project documents AI&rsquo;s growing
              presence in the most intimate details of our lives. Each
              handwritten note is collected in public parks, on street corners,
              and even at{' '}
              <span
                style={{
                  textDecoration: 'underline',
                  textDecorationColor: 'rgba(207,202,183,0.5)',
                  textUnderlineOffset: '3px',
                }}
              >
                AI conferences
              </span>
              .
            </p>

            {/* Contact links. */}
            <a
              className="about-contact-link"
              href="mailto:hello@whatwetellai.com"
              style={{
                display: 'block',
                fontFamily: MONO_FONT,
                fontSize: 13,
                letterSpacing: '0.08em',
                lineHeight: 1.95,
              }}
            >
              EMAIL
            </a>
            <a
              className="about-contact-link"
              href="https://www.instagram.com/whatwetellai"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                fontFamily: MONO_FONT,
                fontSize: 13,
                letterSpacing: '0.08em',
                lineHeight: 1.95,
              }}
            >
              INSTAGRAM
            </a>

            {/* Mailing-list signup. */}
            <div
              className="about-subscribe"
              style={{
                marginTop: 24,
                paddingTop: 20,
                borderTop: '1px solid rgba(207,202,183,0.1)',
              }}
            >
              <style>{`
                .about-subscribe input::placeholder { color: rgba(207,202,183,0.4); }
                .about-subscribe input:focus { border-color: rgba(207,202,183,0.55); }
                .about-subscribe button:hover:not(:disabled),
                .about-subscribe button:focus-visible:not(:disabled) {
                  background: #fff; border-color: #CFCAB7;
                }
                .about-subscribe button:disabled { opacity: 0.55; cursor: default; }
                .about-subscribe input:disabled { opacity: 0.55; }
              `}</style>

              <p
                style={{
                  margin: '0 0 12px',
                  fontFamily: BODY_FONT,
                  fontSize: 18,
                  lineHeight: 1.4,
                  letterSpacing: '0.01em',
                  color: 'rgba(200,200,200,0.9)',
                }}
              >
                Join the mailing list
              </p>

              {!subscribed ? (
                <form
                  onSubmit={handleSubscribe}
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                >
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@somewhere.com"
                    required
                    disabled={subscribing}
                    autoComplete="email"
                    aria-label="Email address"
                    style={{
                      flex: '1 1 200px',
                      minWidth: 0,
                      background: 'rgba(207,202,183,0.04)',
                      border: '1px solid rgba(207,202,183,0.22)',
                      borderRadius: 4,
                      color: '#CFCAB7',
                      padding: '10px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      letterSpacing: '0.02em',
                      outline: 'none',
                      transition: `border-color 0.18s ${HOVER_EASE}`,
                    }}
                  />
                  <button
                    type="submit"
                    disabled={subscribing}
                    style={{
                      flex: '0 0 auto',
                      background: '#e5e5e5',
                      color: '#111',
                      border: '1px solid #e5e5e5',
                      borderRadius: 4,
                      padding: '10px 18px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      letterSpacing: '0.12em',
                      cursor: 'pointer',
                      transition: `background 0.18s ${HOVER_EASE}, border-color 0.18s ${HOVER_EASE}`,
                    }}
                  >
                    {subscribing ? 'SUBSCRIBING…' : 'SUBSCRIBE'}
                  </button>
                </form>
              ) : (
                <Text
                  variant="bodySmall"
                  style={{
                    display: 'block',
                    fontFamily: BODY_FONT,
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: 'rgba(207,202,183,0.8)',
                  }}
                >
                  Thanks — check your inbox to confirm your subscription.
                </Text>
              )}

              {subscribeStatus === 'error' && (
                <Text
                  variant="caption"
                  mono
                  style={{
                    display: 'block',
                    marginTop: 8,
                    fontSize: 10,
                    letterSpacing: '0.04em',
                    lineHeight: 1.5,
                    color: '#f0846b',
                  }}
                >
                  {subscribeError}
                </Text>
              )}
            </div>

            <p
              style={{
                margin: '22px 0 0',
                fontFamily: MONO_FONT,
                fontSize: 12,
                letterSpacing: '0.06em',
                color: 'rgba(207,202,183,0.5)',
              }}
            >
              © What We Tell AI 2026
            </p>
          </div>

          {/* Oversized wordmark watermark — full-bleed footer pinned to the very
              bottom of the scrolling panel. It sits OUTSIDE the centred reading
              column (a direct child of the scroll area) so it spans the panel
              edge-to-edge and parks the lockup in the bottom-right corner. */}
          <div
            aria-hidden="true"
            style={{
              marginTop: 'auto',
              flexShrink: 0,
              position: 'relative',
              overflow: 'hidden',
              paddingTop: 48,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 18,
                bottom: 26,
                width: 150,
                height: 180,
                border: '1px solid rgba(207,202,183,0.055)',
                borderRadius: 2,
                transform: 'rotate(-9deg)',
              }}
            />
            <div
              style={{
                position: 'relative',
                padding: '0 18px',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              {/* Same hand-lettered outline wordmark as the nav + onboarding hero. */}
              <img
                src="/What%20We%20Tell%20AI.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                style={{
                  display: 'block',
                  width: 'auto',
                  height: 'clamp(110px, 30vw, 180px)',
                  opacity: 0.9,
                  userSelect: 'none',
                }}
              />
            </div>
          </div>
          </div>

          {/* Grain ON TOP of the copy: a single fine-noise tile blended (overlay)
              over the scrolling content so the text picks up the same film-grain
              texture instead of reading as clean type floating above it. A single
              blended element (not a nested overlay) so it composites against the
              panel's real backdrop — the blacks stay black; only the lit pixels
              (the type) take the grain. Decorative + non-interactive. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              pointerEvents: 'none',
              backgroundImage: noiseUrl({
                type: 'fractalNoise',
                baseFrequency: 1.1,
                numOctaves: 2,
                seed: 7,
                size: 200,
              }),
              backgroundSize: '200px 200px',
              backgroundRepeat: 'repeat',
              mixBlendMode: 'overlay',
              opacity: 0.5,
            }}
          />
        </motion.aside>
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
        ...ARCHIVE_NAV_TEXT,
        ...ARCHIVE_LINK_UNDERLINE,
        opacity: active ? 1 : 0.5,
        cursor: 'pointer',
        transition: `opacity 0.2s ${HOVER_EASE}`,
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

/* ─────────────────────────────────────────────────────────
 * INDEX MENU — "fan open the deck" storyboard
 *
 * Hovering INDEX fans a small hand of grainy paper cards open
 * below the button (per the provided design — /index-card-*.png).
 * At rest the cards sit stacked square under the button's right
 * edge; on hover they splay into a fan — pinned up near the
 * button, bottoms spreading down-and-left — each swinging to its
 * fan slot (x / y / rotate) + fading in, staggered like a dealer
 * spreading a deck. Quick + springy. Anchored right so the fan
 * never runs off the right edge of the viewport.
 *
 *   hover in ▸ fan open (button side → out)
 *      0ms   DIAL  card swings to its slot + fades in
 *     50ms   INDEX card  …  (stagger 50ms)
 *    100ms   INTRO card  …
 *   hover out ▸ cards collapse back into the stack (fast, reverse)
 *
 * Reduced motion: cards appear in their fanned slots — no travel.
 * ───────────────────────────────────────────────────────── */
const INDEX_MENU = {
  gap: 12, //           px below the INDEX button the fan hangs
  cardW: 56, //         px — paper-card width (matched to the INDEX word so the
  cardH: 62, //         px — deck reads as small notes centered under the text)
  stagger: 0.05, //     s between cards fanning out
  exitStagger: 0.035, // s between cards collapsing back (reverse)
  // Flick the fan open on a springy back-out ease — overshoots past the slot,
  // then settles (the 1.27 control point is what gives the little bounce).
  open: { duration: 0.42, ease: [0.18, 0.89, 0.32, 1.27] },
  exit: { duration: 0.15, ease: [0.4, 0, 1, 1] },
  closeDelayMs: 100, // grace period so button→card travel never flickers
  // Collapsed stack (rest / hidden) — all cards share this, squared up under
  // the button and centered on the text; the fan animates out from here.
  collapsed: { opacity: 0, x: 0, y: -8, rotate: -3, scale: 0.9 },
};

// The archive's three views, rendered as the fanned paper cards (assets in
// /public). `fan` is each card's resting slot { x, y, rotate } relative to the
// fan's top-right anchor (INDEX's right edge); the fan opens down-and-left so it
// stays on screen. INTRO leaves for the onboarding intro; the others switch view.
const INDEX_MENU_ITEMS = [
  { id: 'intro', label: 'INTRO', img: '/index-card-1.png', fan: { x: -40, y: 14, rotate: -18 } },
  { id: 'grid', label: 'INDEX', img: '/index-card-2.png', fan: { x: 0, y: 0, rotate: -2 } },
  { id: 'theme', label: 'DIAL', img: '/index-card-3.png', fan: { x: 38, y: 14, rotate: 16 } },
];

/* ─────────────────────────────────────────────────────────
 * INDEX NOTE HOVER — 3D card tilt
 *
 *   rest   →  card sits flat in its fanned slot
 *   hover  →  card leans toward the cursor + lifts a touch
 *             · cursor x  →  rotateY  (turn left / right)
 *             · cursor y  →  rotateX  (tip top back / forward)
 *   leave  →  spring settles it back to flat
 *
 *   Kept slight (a peek of depth, not a flip). A per-card
 *   `transformPerspective` keeps the 3D self-contained so the
 *   fan's own 2D transform / drop-shadow can't flatten it.
 * ───────────────────────────────────────────────────────── */
const INDEX_CARD_TILT = {
  maxYaw: 15, //       deg — rotateY at the card's left / right edge
  maxPitch: 12, //     deg — rotateX at the card's top / bottom edge
  perspective: 460, // px  — smaller reads as stronger 3D
  lift: 1.06, //       scale pop that sells the "toward you" lean
  spring: { stiffness: 260, damping: 20, mass: 0.5 },
};

/** Boost over the shared inactive-card dial defaults for nav hover peeks.
 *  Tune here for About + INDEX hover images. Base inactive-card values
 *  also live in the "Inactive Cards" DialKit panel (?dial=1). */
const HOVER_PEEK_INACTIVE = {
  blurMul: 0.2, //        × inactive-card blur (default dial: 4px → ~5px)
  blurMin: 0.4, //         px floor even when dial blur is low
  opacityMul: 0.92, //     × inactive-card opacity (lower = more faded)
  opacityMax: 0.76, //     cap on peek opacity
  displacementMul: 1.02, // × card-noise displacement warp
  baseFrequencyMul: 1.0, // × card-noise grain density
};

/** Blur + grayscale + animated grain for About / Index hover peek images. */
function useHoverPeekInactiveStyle() {
  const inactive = useInactiveCardParams();
  const noise = inactive.noise ?? {};
  const noiseEnabled = noise.enabled ?? true;

  const blur = Math.min(
    16,
    Math.max(HOVER_PEEK_INACTIVE.blurMin, (inactive.blur ?? 4) * HOVER_PEEK_INACTIVE.blurMul)
  );
  const grayscale = inactive.grayscale ?? 1;
  const opacity = Math.min(
    HOVER_PEEK_INACTIVE.opacityMax,
    (inactive.opacity ?? 0.75) * HOVER_PEEK_INACTIVE.opacityMul
  );
  const filter =
    [
      blur > 0 ? `blur(${blur}px)` : '',
      grayscale > 0 ? `grayscale(${grayscale})` : '',
      noiseEnabled ? `url(#${CARD_FILTER_ID})` : '',
    ]
      .filter(Boolean)
      .join(' ') || 'none';

  const boostedParams = useMemo(() => {
    const n = inactive.noise ?? {};
    return {
      ...inactive,
      noise: {
        ...n,
        displacement: Math.min(40, (n.displacement ?? 14) * HOVER_PEEK_INACTIVE.displacementMul),
        baseFrequency: Math.min(
          3,
          (n.baseFrequency ?? 1.1) * HOVER_PEEK_INACTIVE.baseFrequencyMul
        ),
      },
    };
  }, [inactive]);

  return { filter, opacity, inactive: boostedParams };
}

/**
 * One fanned "deck" card in the INDEX menu. Owns its own tilt springs so the
 * card can lean toward the cursor in 3D on hover. The image wears a boosted
 * inactive-card blur / grayscale / grain pass (see useHoverPeekInactiveStyle).
 */
function IndexMenuCard({ item, i, count, reduceMotion, active, onSelect, peekStyle }) {
  const yaw = useMotionValue(0); //   rotateY (raw target from cursor x)
  const pitch = useMotionValue(0); // rotateX (raw target from cursor y)
  const rotateY = useSpring(yaw, INDEX_CARD_TILT.spring);
  const rotateX = useSpring(pitch, INDEX_CARD_TILT.spring);

  const fanned = {
    opacity: 1,
    x: item.fan.x,
    y: item.fan.y,
    rotate: item.fan.rotate,
    scale: 1,
  };

  const handleTilt = useCallback(
    (e) => {
      if (reduceMotion) return;
      const r = e.currentTarget.getBoundingClientRect();
      // -0.5..0.5 across the card; leans toward the cursor.
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      yaw.set(nx * (INDEX_CARD_TILT.maxYaw * 2));
      pitch.set(-ny * (INDEX_CARD_TILT.maxPitch * 2));
    },
    [reduceMotion, yaw, pitch]
  );
  const resetTilt = useCallback(() => {
    yaw.set(0);
    pitch.set(0);
  }, [yaw, pitch]);

  return (
    <motion.button
      type="button"
      role="menuitem"
      aria-label={item.label}
      onClick={() => onSelect(item.id)}
      onMouseMove={handleTilt}
      onMouseLeave={resetTilt}
      onBlur={resetTilt}
      whileHover={reduceMotion ? undefined : { scale: INDEX_CARD_TILT.lift }}
      initial={reduceMotion ? { ...fanned, opacity: 0 } : INDEX_MENU.collapsed}
      animate={fanned}
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0.12 } }
          : {
              ...INDEX_MENU.collapsed,
              transition: {
                ...INDEX_MENU.exit,
                delay: i * INDEX_MENU.exitStagger,
              },
            }
      }
      transition={
        reduceMotion
          ? { duration: 0.16 }
          : { ...INDEX_MENU.open, delay: (count - 1 - i) * INDEX_MENU.stagger }
      }
      style={{
        position: 'absolute',
        top: INDEX_MENU.gap,
        right: 0,
        width: INDEX_MENU.cardW,
        height: INDEX_MENU.cardH,
        padding: 0,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        transformOrigin: 'top center',
        zIndex: active ? 3 : 2,
        filter: 'drop-shadow(0 10px 16px rgba(0,0,0,0.4))',
      }}
    >
      {/* Inner tilt layer: cursor-tracked 3D lean around the card's own center,
          with a self-contained perspective (unaffected by the button's fan
          transform / drop-shadow). */}
      <motion.div
        style={{
          width: '100%',
          height: '100%',
          rotateX,
          rotateY,
          transformPerspective: INDEX_CARD_TILT.perspective,
        }}
      >
        <img
          src={item.img}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            opacity: peekStyle.opacity,
            filter: peekStyle.filter,
          }}
        />
      </motion.div>
    </motion.button>
  );
}

/**
 * INDEX with a hover-revealed "deck of cards" menu of the archive's views.
 * Desktop only (hover/focus); the trigger still clicks through to the grid.
 */
function IndexMenu({ view, onChange }) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const peekStyle = useHoverPeekInactiveStyle();

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), INDEX_MENU.closeDelayMs);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  const go = useCallback(
    (id) => {
      setOpen(false);
      if (id === 'intro') window.location.assign('/onboarding');
      else onChange?.(id);
    },
    [onChange]
  );

  const count = INDEX_MENU_ITEMS.length;

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
      onFocusCapture={openNow}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) scheduleClose();
      }}
    >
      {/* Trigger — visually the same INDEX toggle; still jumps to the grid. */}
      <ToggleButton active={view === 'grid'} onClick={() => onChange?.('grid')}>
        INDEX
      </ToggleButton>

      {/* Fan anchor — a box pinned under the button's right edge that also
          bridges the gap (hoverable while open, so travelling from the button
          onto a card never crosses a dead zone). Cards are absolutely stacked
          at its top-right and fan out via transform. */}
      <div
        role="menu"
        aria-label="Sections"
        style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          width: 200,
          height: 160,
          zIndex: 220,
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <CardNoiseFilterDefs params={peekStyle.inactive} />
        <AnimatePresence>
          {open &&
            INDEX_MENU_ITEMS.map((item, i) => (
              <IndexMenuCard
                key={item.id}
                item={item}
                i={i}
                count={count}
                reduceMotion={reduceMotion}
                active={item.id === view}
                onSelect={go}
                peekStyle={peekStyle}
              />
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Spatial-canvas layout tuning (grid view → pannable wall of notes).
 *  Tile + cell sizes scale together (~1.25×) so the wall just zooms — gaps stay
 *  proportional and nothing overlaps. */
const CANVAS_TILE_W = 188;
const CANVAS_TILE_H = 236;
const CANVAS_CELL_X = 290;
const CANVAS_CELL_Y = 315;
const CANVAS_JITTER = 42;
const CANVAS_MAX_ROT = 2.2;
const CANVAS_PAD = 260;

/**
 * Deterministic 0..1 hash so each note's jitter + rotation is stable across
 * renders (no reshuffle when React re-renders / images settle).
 */
function canvasHash(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Pill style for the grid-view category filter chips. */
const gridChipStyle = (active) => ({
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontWeight: 400,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '6px 13px',
  borderRadius: 999,
  border: active ? '1px solid transparent' : '1px solid rgba(207,202,183,0.2)',
  background: active ? 'rgba(207,202,183,0.92)' : 'rgba(207,202,183,0.05)',
  color: active ? '#111' : 'rgba(207,202,183,0.72)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

/** Embedded facet menu trigger (pill) that sits beside the search field. */
const facetMenuButtonStyle = {
  pointerEvents: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  fontWeight: 400,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#CFCAB7',
  background: 'rgba(207,202,183,0.1)',
  border: '1px solid rgba(207,202,183,0.18)',
  borderRadius: 999,
  padding: '9px 16px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: `border-color 0.2s ${HOVER_EASE}, background 0.2s ${HOVER_EASE}`,
};

/** Floating dropdown surface for the facet menu (see 2nd reference shot).
    Opens upward since the filter bar is pinned to the bottom of the view. */
const facetMenuPanelStyle = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  minWidth: 208,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: 6,
  borderRadius: 14,
  background: 'rgba(26,22,24,0.97)',
  border: '1px solid rgba(207,202,183,0.14)',
  boxShadow: '0 18px 46px rgba(0,0,0,0.55)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
};

/** A single Category / Location / Recency row inside the facet menu. */
const facetMenuItemStyle = (current) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '9px 12px',
  borderRadius: 9,
  border: 'none',
  background: current ? 'rgba(207,202,183,0.09)' : 'transparent',
  color: current ? INK : inkA(0.72),
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
});

/** "M/D/YYYY" → epoch ms for recency sort. NaN when missing/unparseable. */
function parseNoteDate(s) {
  if (!s) return NaN;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return new Date(y, Number(m[1]) - 1, Number(m[2])).getTime();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

/** "San Francisco, CA" → "San Francisco" for compact location chips. */
const cityLabel = (loc) => String(loc || '').split(',')[0].trim();

/**
 * Spatial canvas of notes — the "WALL" tab. A loose grid with deterministic
 * jitter (reads as a hand-placed wall, not a rigid grid) on a large pannable
 * surface. Trackpad / touch keep native momentum scrolling; mouse + pen get
 * grab-to-pan. Hover reveals a small metadata caption; click opens the Lightbox.
 */
function WallView({ confessions, sidebarInset = SIDEBAR_WIDTH }) {
  const [selected, setSelected] = useState(null);
  const reduceMotion = useReducedMotion();
  // Tiles whose image failed to load (e.g. file not yet on disk for that
  // GlobalID). We drop the whole tile rather than showing a broken-image icon.
  const [failedIds, setFailedIds] = useState(() => new Set());
  const visible = useMemo(
    () => confessions.filter((c) => c.image && !failedIds.has(c.id)),
    [confessions, failedIds]
  );

  // Category filter (chips, top-left). null = show all; otherwise notes whose
  // category !== activeCat fade out (they stay mounted, just de-emphasized).
  const [activeCat, setActiveCat] = useState(null);
  const categories = useMemo(() => deriveEmotions(visible).map((e) => e.label), [visible]);
  const isDimmed = (c) => activeCat != null && c.category !== activeCat;

  // Lightbox prev/next: step through the visible notes, wrapping at the ends.
  const goRelative = useCallback(
    (dir) => {
      setSelected((cur) => {
        const n = visible.length;
        if (!cur || n <= 1) return cur;
        const idx = visible.findIndex((c) => c.id === cur.id);
        if (idx < 0) return cur;
        return visible[(idx + dir + n) % n];
      });
    },
    [visible]
  );
  const goPrev = useCallback(() => goRelative(-1), [goRelative]);
  const goNext = useCallback(() => goRelative(1), [goRelative]);

  const layout = useMemo(() => {
    const n = visible.length;
    // Roughly landscape wall: a touch wider than tall.
    const cols = Math.max(1, Math.round(Math.sqrt(n * 1.7)));
    const positions = visible.map((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const jx = (canvasHash(c.id + ':x') - 0.5) * 2 * CANVAS_JITTER;
      const jy = (canvasHash(c.id + ':y') - 0.5) * 2 * CANVAS_JITTER;
      const rot = (canvasHash(c.id + ':r') - 0.5) * 2 * CANVAS_MAX_ROT;
      return {
        left: CANVAS_PAD + col * CANVAS_CELL_X + jx,
        top: CANVAS_PAD + row * CANVAS_CELL_Y + jy,
        rot,
      };
    });
    const rows = Math.ceil(n / cols) || 1;
    return {
      positions,
      width: CANVAS_PAD * 2 + cols * CANVAS_CELL_X,
      height: CANVAS_PAD * 2 + rows * CANVAS_CELL_Y,
    };
  }, [visible]);

  const scrollRef = useRef(null);
  const dragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, sl: 0, st: 0 });
  const hasCenteredRef = useRef(false);

  // Start centered so visitors land in the middle of the wall and can pan
  // outward in any direction. Runs once, before paint, to avoid a jump.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || hasCenteredRef.current) return;
    if (layout.width <= el.clientWidth && layout.height <= el.clientHeight) return;
    el.scrollLeft = Math.max(0, (layout.width - el.clientWidth) / 2);
    el.scrollTop = Math.max(0, (layout.height - el.clientHeight) / 2);
    hasCenteredRef.current = true;
  }, [layout.width, layout.height]);

  // Grab-to-pan for mouse / pen. Touch pointers fall through to native scroll
  // so we don't fight the OS's momentum + rubber-banding.
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.active) return;
      const el = scrollRef.current;
      if (!el) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
      el.scrollLeft = d.sl - dx;
      el.scrollTop = d.st - dy;
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d.active) return;
      d.active = false;
      const el = scrollRef.current;
      if (el) el.style.cursor = 'grab';
      // Let the tile's click handler observe `moved` first, then reset.
      requestAnimationFrame(() => {
        d.moved = false;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const onPointerDown = (e) => {
    if (e.pointerType === 'touch') return;
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      sl: el.scrollLeft,
      st: el.scrollTop,
    };
    el.style.cursor = 'grabbing';
  };

  return (
    <motion.div
      key="wall-view"
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
        overflow: 'hidden',
        zIndex: 1,
      }}
    >
      {/* Same grain as landing / theme: `TunableGrainBackground` → DialKit "Grain".
          Fixed backdrop; the note wall pans over it. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          isolation: 'isolate',
          pointerEvents: 'none',
          background: '#111',
        }}
      >
        <TunableGrainBackground />
      </div>

      <style>{`
        .canvas-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .canvas-scroll::-webkit-scrollbar { display: none; }
        .cstamp__img {
          filter: grayscale(0.25);
          transition: transform 0.4s cubic-bezier(0.22,1,0.36,1), filter 0.35s ${HOVER_EASE};
        }
        .cstamp:hover .cstamp__img { transform: scale(1.06); filter: grayscale(0); }
        .cstamp__frame { transition: opacity 0.45s ${HOVER_EASE}; }
        .cstamp__meta {
          opacity: 0;
          transform: translateY(3px);
          transition: opacity 0.25s ${HOVER_EASE}, transform 0.25s ${HOVER_EASE};
        }
        .cstamp:hover .cstamp__meta { opacity: 1; transform: translateY(0); }
        .grid-chip { transition: background 0.2s ${HOVER_EASE}, color 0.2s ${HOVER_EASE}, border-color 0.2s ${HOVER_EASE}; }
        .grid-chip:not(.is-active):hover { border-color: rgba(207,202,183,0.45); color: #CFCAB7; }
      `}</style>

      {/* Category filter chips (top-left). Click one to fade out notes that
          aren't in that category; click it again (or "All") to clear. */}
      {categories.length > 1 ? (
        <div
          style={{
            position: 'absolute',
            top: 72,
            left: 24,
            zIndex: 5,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            maxWidth: 'min(62vw, 560px)',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            className={`grid-chip${activeCat == null ? ' is-active' : ''}`}
            onClick={() => setActiveCat(null)}
            style={gridChipStyle(activeCat == null)}
          >
            All
          </button>
          {categories.map((label) => {
            const active = activeCat === label;
            return (
              <button
                key={label}
                type="button"
                className={`grid-chip${active ? ' is-active' : ''}`}
                onClick={() => setActiveCat((cur) => (cur === label ? null : label))}
                style={gridChipStyle(active)}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="canvas-scroll"
        onPointerDown={onPointerDown}
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100%',
          width: '100%',
          overflow: 'auto',
          cursor: 'grab',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'pan-x pan-y',
        }}
      >
        <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
          {visible.map((c, i) => {
            const p = layout.positions[i];
            const base = { scale: 1, rotate: p.rot };
            return (
              <motion.div
                key={c.id}
                className="cstamp"
                initial={reduceMotion ? { opacity: 1, ...base } : { opacity: 0, scale: 0.94, rotate: p.rot }}
                animate={{ opacity: 1, ...base }}
                transition={{
                  duration: 0.5,
                  ease,
                  delay: reduceMotion ? 0 : Math.min(i * 0.01, 0.5),
                }}
                onClick={() => {
                  if (!dragRef.current.moved) setSelected(c);
                }}
                style={{
                  position: 'absolute',
                  left: p.left,
                  top: p.top,
                  width: CANVAS_TILE_W,
                  cursor: 'pointer',
                }}
              >
                <div
                  className="cstamp__frame"
                  style={{
                    position: 'relative',
                    width: CANVAS_TILE_W,
                    height: CANVAS_TILE_H,
                    overflow: 'hidden',
                    opacity: isDimmed(c) ? 0.12 : 1,
                  }}
                >
                  <img
                    className="cstamp__img"
                    src={c.image}
                    alt={`Note ${c.id}`}
                    draggable={false}
                    loading="lazy"
                    decoding="async"
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
                      padding: 12,
                      boxSizing: 'border-box',
                      display: 'block',
                    }}
                  />
                </div>
                <div
                  className="cstamp__meta"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  {c.category ? (
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'rgba(206,108,82,0.95)',
                        marginBottom: 3,
                      }}
                    >
                      {c.category}
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      color: 'rgba(207,202,183,0.78)',
                    }}
                  >
                    No. {String(c.id).padStart(3, '0')}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <Lightbox
        confession={selected}
        onClose={() => setSelected(null)}
        onPrev={visible.length > 1 ? goPrev : undefined}
        onNext={visible.length > 1 ? goNext : undefined}
      />
    </motion.div>
  );
}

/**
 * Rigid gallery grid — the original "GRID" view (restored) before the pannable
 * canvas/WALL replaced it. A centered, bordered CSS grid of square note tiles
 * (3 / 2 / 1 columns, responsive). The search field at the top filters tiles by
 * their transcript text (case-insensitive); click any tile to open the Lightbox
 * (←/→ steps through the filtered set).
 */
/* ─────────────────────────────────────────────────────────
 * GRID ENTRANCE STORYBOARD  (index — note tiles)
 *
 * Only tiles on screen at mount animate; tiles below the fold
 * render in place. Each tile flies home from whichever viewport
 * edge is nearest to it (shortest path), ease-out, staggered.
 *
 *  measuring   measure each tile, choose its nearest edge
 *      ↓       (runs pre-paint, so nothing flashes at rest first)
 *   parked     tiles parked just off their nearest edge (hidden)
 *      ↓
 *   flying     +80ms · fly to home, ease-out, 45ms stagger (row-by-row;
 *      ↓                columns alternate per row — see gridColumnOrder)
 *  settled     native scrolling restored
 * ───────────────────────────────────────────────────────── */
const GRID_ENTRANCE = {
  startDelay: 80, // ms before the first tile leaves its edge
  stagger: 0.045, // s between tiles, in reveal order (see gridColumnOrder)
  duration: 0.72, // s per tile fly-in
  ease: [0.16, 1, 0.3, 1], // ease-out (expo-ish): fast launch, soft landing
  offscreenPad: 64, // px past the nearest edge so a tile parks fully hidden
};

/* Per-row reveal order for the entrance stagger. Rows fly in top→bottom, but the
 * columns within a row alternate so the wall doesn't wipe in a plain left→right
 * march:
 *   even rows (top, 3rd, 5th…):  left → right → middle   → [0, 2, 1]
 *   odd rows  (2nd, 4th…):       middle → left → right   → [1, 0, 2]
 * Narrower responsive layouts (2 / 1 col) fall back to a simple zig-zag /
 * top-down order. `parity` is the row's index from the top, mod 2. */
function gridColumnOrder(cols, parity) {
  if (cols === 3) return parity === 0 ? [0, 2, 1] : [1, 0, 2];
  if (cols === 2) return parity === 0 ? [0, 1] : [1, 0];
  return Array.from({ length: cols }, (_, i) => i);
}

// Rest transform for tiles that don't participate (below the fold at mount).
const GRID_TILE_REST = { x: 0, y: 0, delay: 0 };

// Each target carries its own transition, so measuring→parked is instant
// (no fly-out) while parked→flying eases in. `custom` = { x, y, delay } per tile.
const gridTileVariants = {
  measuring: { opacity: 0, x: 0, y: 0, transition: { duration: 0 } },
  parked: (d) => ({ opacity: 1, x: d.x, y: d.y, transition: { duration: 0 } }),
  flying: (d) => ({
    opacity: 1,
    x: 0,
    y: 0,
    transition: { duration: GRID_ENTRANCE.duration, ease: GRID_ENTRANCE.ease, delay: d.delay },
  }),
  settled: { opacity: 1, x: 0, y: 0, transition: { duration: 0 } },
};

/* ─────────────────────────────────────────────────────────
 * GRID EXIT / DISSOLVE STORYBOARD  (index — on note open)
 *
 * Trigger: a note is clicked → the full-screen note view opens.
 * The clicked note lifts away (shared-element bridge, NoteOpenView),
 * and everything else on the index dissolves so it lands in a clean
 * focus view. The top nav lives ABOVE the grid, so it stays put.
 *
 *    0ms   note clicked · bridge lifts off the tile (NoteOpenView)
 *    0ms   note tiles fade → 0 (y 0 → 6px), rippling
 *          OUTWARD from the clicked tile — nearest first, ~160ms spread
 *    0ms   search + filter bar fades → 0
 * ~140ms   the note view's dark backdrop veils in over the emptied grid
 *
 * On return (view closed) the tiles + bar fade back in, decelerating.
 * ───────────────────────────────────────────────────────── */
const GRID_EXIT = {
  fadeOut: 0.34, //  s — per-tile opacity fade to 0
  fadeIn: 0.5, //    s — per-tile fade back in on return
  stagger: 0.16, //  s — max delay spread, rippling out from the clicked note
  yTo: 6, //         px — tiny downward settle
  exitEase: [0.4, 0, 1, 1], //     ease-in: notes accelerate away
  enterEase: [0.16, 1, 0.3, 1], // ease-out: notes settle back on return
  barFade: 0.26, //  s — search / filter bar fade
};

/* Scrim behind the search / filter bar. A 3-stop linear ramp holds near-opaque
 * for the first half then falls straight to 0, which kinks and leaves a hard
 * "Mach band" edge where the scrim meets the grid. These closely-spaced stops
 * trace an ease curve whose alpha *flattens* into 0 at the transparent end, so
 * the fade is imperceptibly smooth. Fades to a transparent version of the SAME
 * charcoal (not black) to avoid a grey wash. `dir` = the side it darkens toward
 * ('to top' desktop / bottom-docked bar, 'to bottom' mobile / top-docked bar). */
const filterBarScrim = (dir) =>
  `linear-gradient(${dir},` +
  ' rgba(17,17,17,0.96) 0%,' +
  ' rgba(17,17,17,0.945) 11%,' +
  ' rgba(17,17,17,0.9) 21%,' +
  ' rgba(17,17,17,0.82) 31%,' +
  ' rgba(17,17,17,0.71) 40%,' +
  ' rgba(17,17,17,0.58) 49%,' +
  ' rgba(17,17,17,0.44) 58%,' +
  ' rgba(17,17,17,0.31) 67%,' +
  ' rgba(17,17,17,0.19) 76%,' +
  ' rgba(17,17,17,0.1) 85%,' +
  ' rgba(17,17,17,0.04) 93%,' +
  ' rgba(17,17,17,0) 100%)';

function GridView({
  confessions,
  sidebarInset = SIDEBAR_WIDTH,
  onOpenNote,
  noteOpen = false,
  /** When true, skip the fly-in entrance (e.g. returning from dial → grid). */
  skipEntrance = false,
  onEntranceSettled,
}) {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const reduceMotion = useReducedMotion();
  // Phone widths (≤760): the filter bar moves to the TOP and stacks (search
  // above the Category/Location tabs). On desktop it stays pinned to the
  // bottom with the search centred between the tabs.
  const compact = useArchiveNavCompact();
  // Live grid column count (3 / 2 / 1) — positions the lattice hairlines.
  const gridCols = useGridColumns();
  // Tiles whose image failed to load (file not yet on disk for that GlobalID).
  // We drop the whole tile rather than show a broken-image icon.
  const [failedIds, setFailedIds] = useState(() => new Set());

  // Filter hierarchy. Each facet has its own tab + dropdown, but every facet's
  // selection stays live and they combine with AND:
  //   transcript search  ∧  category(s)  ∧  location(s)  ∧  recency sort.
  // Non-matching notes are removed (not dimmed) — same behavior as search.
  const [selectedCats, setSelectedCats] = useState(() => new Set());
  const [selectedLocs, setSelectedLocs] = useState(() => new Set());
  const [sortOrder, setSortOrder] = useState(null); // null | 'newest' | 'oldest'
  // Which filter tab's dropdown is open (null = all closed). Each tab
  // (Category / Location / Recency) opens a menu of its own selectable values.
  const [openFacet, setOpenFacet] = useState(null); // null | 'category' | 'location' | 'recency'
  const facetMenuRef = useRef(null); // anchor for outside-click / Escape dismissal

  const withImages = useMemo(
    () => confessions.filter((c) => c.image && !failedIds.has(c.id)),
    [confessions, failedIds]
  );

  // Facet option lists, derived from what's actually present in the data.
  const categoryOpts = useMemo(
    () => deriveEmotions(withImages).map((e) => e.label),
    [withImages]
  );
  const locationOpts = useMemo(() => {
    const counts = new Map();
    withImages.forEach((c) => {
      const loc = (c.metadata?.location || '').trim();
      if (loc) counts.set(loc, (counts.get(loc) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([loc]) => loc);
  }, [withImages]);

  // Transcript search (case-insensitive). Every loaded note carries a
  // transcription (see loadConfessions `isUsable`), so the filter is reliable.
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    let arr = withImages;
    if (q) arr = arr.filter((c) => (c.transcription || '').toLowerCase().includes(q));
    if (selectedCats.size) arr = arr.filter((c) => selectedCats.has(c.category));
    if (selectedLocs.size)
      arr = arr.filter((c) => selectedLocs.has((c.metadata?.location || '').trim()));
    if (sortOrder) {
      const dir = sortOrder === 'newest' ? -1 : 1;
      arr = [...arr].sort((a, b) => {
        const ta = parseNoteDate(a.metadata?.date);
        const tb = parseNoteDate(b.metadata?.date);
        const na = Number.isNaN(ta);
        const nb = Number.isNaN(tb);
        if (na && nb) return 0;
        if (na) return 1; // notes with no date sink to the bottom either way
        if (nb) return -1;
        return (ta - tb) * dir;
      });
    }
    return arr;
  }, [withImages, q, selectedCats, selectedLocs, sortOrder]);

  const anyFilterActive =
    !!q || selectedCats.size > 0 || selectedLocs.size > 0 || sortOrder != null;
  const clearAll = useCallback(() => {
    setQuery('');
    setSelectedCats(new Set());
    setSelectedLocs(new Set());
    setSortOrder(null);
  }, []);
  const toggleInSet = (setter) => (value) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  const toggleCat = toggleInSet(setSelectedCats);
  const toggleLoc = toggleInSet(setSelectedLocs);

  // The filter bar floats over the top; measure it so the grid starts just below
  // (its height changes when chips wrap or the active facet changes).
  const barRef = useRef(null);
  const [barH, setBarH] = useState(188);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => setBarH(el.offsetHeight);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Grid entrance — see GRID ENTRANCE STORYBOARD above. Measure every tile
  //    that's on screen at mount, park it just off its nearest viewport edge,
  //    then fly it home (ease-out, staggered). Tiles below the fold sit still.
  const tileRefs = useRef(new Map());
  const offsetsRef = useRef(new Map());
  const flyCountRef = useRef(0);
  const measuredRef = useRef(skipEntrance);
  const [entranceStage, setEntranceStage] = useState(
    reduceMotion || skipEntrance ? 'settled' : 'measuring'
  );

  // ── Grid exit — see GRID EXIT / DISSOLVE STORYBOARD above. On note-open the
  //    tiles fade out rippling OUTWARD from the clicked one; we snapshot each
  //    tile's distance-from-click (→ stagger delay) the instant the note opens.
  const exitDelaysRef = useRef(new Map());
  const computeExitDelays = useCallback(
    (originRect) => {
      if (reduceMotion) {
        exitDelaysRef.current = new Map();
        return;
      }
      const ox = originRect.left + originRect.width / 2;
      const oy = originRect.top + originRect.height / 2;
      let maxD = 1;
      const dist = new Map();
      visible.forEach((c) => {
        const el = tileRefs.current.get(c.id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dd = Math.hypot(r.left + r.width / 2 - ox, r.top + r.height / 2 - oy);
        dist.set(c.id, dd);
        if (dd > maxD) maxD = dd;
      });
      const delays = new Map();
      dist.forEach((dd, id) => delays.set(id, (dd / maxD) * GRID_EXIT.stagger));
      exitDelaysRef.current = delays;
    },
    [reduceMotion, visible]
  );

  useLayoutEffect(() => {
    if (reduceMotion || measuredRef.current || entranceStage !== 'measuring') return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = GRID_ENTRANCE.offscreenPad;

    // 1) Measure every on-screen tile + the park offset it flies in from (its
    //    nearest viewport edge). Below-the-fold tiles get no offset → in place.
    const onscreen = [];
    visible.forEach((c) => {
      const el = tileRefs.current.get(c.id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const onScreen = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
      if (!onScreen) return; // below the fold at mount → no fly-in
      const dTop = r.top;
      const dBottom = vh - r.bottom;
      const dLeft = r.left;
      const dRight = vw - r.right;
      const nearest = Math.min(dTop, dBottom, dLeft, dRight);
      let x = 0;
      let y = 0;
      if (nearest === dTop) y = -(r.bottom + pad); // top is closest → park above
      else if (nearest === dBottom) y = vh - r.top + pad; // bottom → park below
      else if (nearest === dLeft) x = -(r.right + pad); // left → park to the left
      else x = vw - r.left + pad; // right → park to the right
      onscreen.push({ id: c.id, top: r.top, left: r.left, height: r.height, x, y });
    });

    // 2) Cluster tiles into visual rows (those sharing a top), ordered top→down.
    const rowTol = onscreen.length ? Math.max(24, onscreen[0].height * 0.5) : 24;
    const rows = [];
    [...onscreen]
      .sort((a, b) => a.top - b.top)
      .forEach((t) => {
        const row = rows[rows.length - 1];
        if (row && Math.abs(row.top - t.top) <= rowTol) row.items.push(t);
        else rows.push({ top: t.top, items: [t] });
      });

    // 3) Stagger row-by-row; within each row the columns reveal in a per-row
    //    order (see gridColumnOrder) so the entrance reads as a woven cascade
    //    rather than a flat left→right sweep.
    const offsets = new Map();
    let order = 0;
    rows.forEach((row, rowIdx) => {
      const cols = [...row.items].sort((a, b) => a.left - b.left); // 0 = leftmost
      gridColumnOrder(cols.length, rowIdx % 2).forEach((colIdx) => {
        const t = cols[colIdx];
        if (!t) return;
        offsets.set(t.id, {
          x: t.x,
          y: t.y,
          delay: GRID_ENTRANCE.startDelay / 1000 + order * GRID_ENTRANCE.stagger,
        });
        order += 1;
      });
    });

    offsetsRef.current = offsets;
    flyCountRef.current = order;
    measuredRef.current = true;
    setEntranceStage(order > 0 ? 'parked' : 'settled');
  }, [reduceMotion, entranceStage, visible]);

  // Parked (hidden, off its edge) → fly in on the next frame.
  useEffect(() => {
    if (entranceStage !== 'parked') return undefined;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setEntranceStage('flying'))
    );
    return () => cancelAnimationFrame(raf);
  }, [entranceStage]);

  // Once the last tile lands, restore native scrolling (the grid is clipped
  // during the flight so parked / flying tiles can't spawn a scrollbar).
  useEffect(() => {
    if (entranceStage !== 'flying') return undefined;
    const total =
      GRID_ENTRANCE.startDelay +
      Math.max(0, flyCountRef.current - 1) * GRID_ENTRANCE.stagger * 1000 +
      GRID_ENTRANCE.duration * 1000 +
      120;
    const t = setTimeout(() => {
      setEntranceStage('settled');
      onEntranceSettled?.();
    }, total);
    return () => clearTimeout(t);
  }, [entranceStage, onEntranceSettled]);

  // First paint with nothing to fly (or skipEntrance) — mark entrance done.
  useEffect(() => {
    if (entranceStage === 'settled' && measuredRef.current) onEntranceSettled?.();
  }, [entranceStage, onEntranceSettled]);

  // Close the facet menu on outside click / Escape.
  useEffect(() => {
    if (!openFacet) return undefined;
    const onDown = (e) => {
      if (facetMenuRef.current && !facetMenuRef.current.contains(e.target))
        setOpenFacet(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenFacet(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openFacet]);

  const FACETS = [
    { id: 'category', label: 'Category', active: selectedCats.size > 0 },
    { id: 'location', label: 'Location', active: selectedLocs.size > 0 },
    // Recency tab hidden — restore this entry to bring the sort dropdown back.
    // { id: 'recency', label: 'Recency', active: sortOrder != null },
  ];

  // The selectable rows shown inside a tab's dropdown. Category/Location are
  // multi-select (with an "All" reset at top); Recency is a single-select sort
  // that toggles off when the active option is picked again.
  const facetValues = (facetId) => {
    if (facetId === 'recency') {
      return [
        {
          key: 'newest',
          label: 'Newest first',
          on: sortOrder === 'newest',
          onClick: () => setSortOrder((c) => (c === 'newest' ? null : 'newest')),
        },
        {
          key: 'oldest',
          label: 'Oldest first',
          on: sortOrder === 'oldest',
          onClick: () => setSortOrder((c) => (c === 'oldest' ? null : 'oldest')),
        },
      ];
    }
    if (facetId === 'location') {
      return [
        {
          key: '__all',
          label: 'All locations',
          on: selectedLocs.size === 0,
          onClick: () => setSelectedLocs(new Set()),
        },
        ...locationOpts.map((loc) => ({
          key: loc,
          label: cityLabel(loc),
          on: selectedLocs.has(loc),
          onClick: () => toggleLoc(loc),
        })),
      ];
    }
    return [
      {
        key: '__all',
        label: 'All categories',
        on: selectedCats.size === 0,
        onClick: () => setSelectedCats(new Set()),
      },
      ...categoryOpts.map((label) => ({
        key: label,
        label,
        on: selectedCats.has(label),
        onClick: () => toggleCat(label),
      })),
    ];
  };

  // Lightbox prev/next over the *filtered* set, wrapping at the ends.
  const goRelative = useCallback(
    (dir) => {
      setSelected((cur) => {
        const n = visible.length;
        if (!cur || n <= 1) return cur;
        const idx = visible.findIndex((c) => c.id === cur.id);
        if (idx < 0) return cur;
        return visible[(idx + dir + n) % n];
      });
    },
    [visible]
  );
  const goPrev = useCallback(() => goRelative(-1), [goRelative]);
  const goNext = useCallback(() => goRelative(1), [goRelative]);

  // Lattice reveal — the hairline grid is its OWN layer, so it animates apart
  // from the tiles. It stays hidden for the entire fly-in and only draws on once
  // the tiles have landed (entranceStage 'settled'), so the lattice appears
  // AFTER the notes. Rather than a clip-path wipe, each grid line is a solid 1px
  // <div> that draws on by scaling from one end (scaleY top→down for verticals,
  // scaleX left→right for horizontals), staggered so the grid constructs itself.
  // Solid lines (no stroke-dasharray), so they never read as dashed. Reduced
  // motion shows it immediately.
  const latticeDrawn = reduceMotion || skipEntrance || entranceStage === 'settled';

  // Line geometry for the lattice. Each line is positioned by percentage on the
  // overlay (which sits exactly over the tile grid), so it pins to a cell edge at
  // any column count without measuring. We mirror the tile grid exactly —
  // including a ragged last row — so lines only exist where a note sits: a
  // vertical at column k runs full height only while a cell still sits beneath it
  // in the last row; the bottom edge is as wide as the last row is full. The far
  // right/bottom edge lines are pulled in 1px so the whole stroke stays inside.
  const noteCount = visible.length;
  const latticeRows = Math.max(1, Math.ceil(noteCount / gridCols));
  const latticeLastRow = noteCount - (latticeRows - 1) * gridCols; // cells in last row
  const latticeLines = useMemo(() => {
    const rows = latticeRows;
    const cols = gridCols;
    const last = latticeLastRow;
    const lines = [];
    // Verticals stagger left→right; horizontals top→down. Spreads are bounded
    // (a fraction of the count) so the draw stays snappy even for tall grids.
    const V_SPREAD = 0.22;
    const H_SPREAD = 0.34;
    const BASE = 0.15; // beat after the tiles settle
    for (let k = 0; k <= cols; k += 1) {
      const yEnd = k <= last ? rows : rows - 1; // stop before the ragged last row
      if (yEnd <= 0) continue;
      lines.push({
        key: `v${k}`,
        axis: 'v',
        main: k < cols ? `${(k / cols) * 100}%` : 'calc(100% - 1px)',
        lenPct: (yEnd / rows) * 100,
        delay: BASE + (cols ? (k / cols) * V_SPREAD : 0),
      });
    }
    const topWidth = rows > 1 ? cols : last; // single partial row → top edge = last
    for (let m = 0; m <= rows; m += 1) {
      const xEnd = m === 0 ? topWidth : m === rows ? last : cols;
      if (xEnd <= 0) continue;
      lines.push({
        key: `h${m}`,
        axis: 'h',
        main: m < rows ? `${(m / rows) * 100}%` : 'calc(100% - 1px)',
        lenPct: (xEnd / cols) * 100,
        delay: BASE + (rows ? (m / rows) * H_SPREAD : 0),
      });
    }
    return lines;
  }, [gridCols, latticeRows, latticeLastRow]);

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
        overflow: 'hidden',
        zIndex: 1,
      }}
    >
      {/* Shared SVG filter def (paints nothing) — referenced ONLY by the
          hovered grid image (see the tile below) for a heavier light-noise +
          displacement warp. Punchier grain/warp than the resting scan since it's
          now a focus treatment on one note at a time, not a wash over the whole
          grid. The noise field animates (breathing warp + shimmering grain)
          unless the visitor prefers reduced motion.
          Strength is live-tunable via the "Note Hover Filter" DialKit panel
          (append ?dial=1 to the URL, then hover a tile to preview). */}
      <GridImageFilter animate={!reduceMotion} />

      {/* Same backdrop as the dial: solid #111 base → neutral radial glow →
          film grain (mix-blend). The gradient gives the grain something to
          blend against so the noise actually reads here instead of washing out
          on flat black. Isolated so mix-blend stays within this layer. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          isolation: 'isolate',
          pointerEvents: 'none',
          background: '#111',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: NEUTRAL_GRADIENT }} />
        <TunableGrainBackground />
      </div>

      <style>{`
        /* Contact-sheet lattice — the hairline grid. It lives on its OWN layer
           (.grid-lattice), a sibling of the tiles rather than borders riding on
           each flying tile, so the grid can draw on independently instead of
           assembling out of the notes as they fly in. It's an overlay of solid
           1px <div> lines (see GridView / latticeLines) positioned by percentage
           onto the square-cell grid, so every line pins to a cell edge and draws
           on by scaling from one end — solid strokes, never dashed. */
        .grid-stack { position: relative; max-width: 1100px; margin: 0 auto; }
        .confession-grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .grid-lattice {
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .grid-lattice-line {
          position: absolute;
          background: rgba(207, 202, 183, 0.07);
        }
        .grid-tile { box-sizing: border-box; transition: filter 0.4s ${HOVER_EASE}; }
        /* Spotlight the note under the cursor: while the grid is hovered, gently
           fade every other tile, then lift that treatment off the one actually
           hovered so it stays crisp (its own scale/warp is handled inline).
           Using filter: opacity() rather than plain opacity sidesteps the inline
           opacity/transform Motion writes per tile, so no !important is needed;
           the specificity of the :hover-inside-:hover rule restores the active
           tile. All pure CSS group-hover — scrubbing 100+ tiles never re-renders
           React. */
        .confession-grid:hover .grid-tile { filter: opacity(0.8); }
        .confession-grid:hover .grid-tile:hover { filter: none; }
        @media (max-width: 760px) {
          .confession-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 460px) {
          .confession-grid { grid-template-columns: 1fr; }
        }
        .grid-search-input::placeholder { color: rgba(207,202,183,0.4); }
        .grid-search-input:focus { border-color: rgba(207,202,183,0.5); }
        /* The native search "clear" (✕) renders as a near-invisible dark glyph
           on this dark input — replace it with a white ✕ drawn via inline SVG
           (WebKit/Chromium only; this is where the type=search button lives). */
        .grid-search-input::-webkit-search-cancel-button {
          -webkit-appearance: none;
          appearance: none;
          height: 13px;
          width: 13px;
          cursor: pointer;
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 5 L19 19 M19 5 L5 19' stroke='%23CFCAB7' stroke-width='2.6' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
        }
        .grid-chip { transition: background 0.2s ${HOVER_EASE}, color 0.2s ${HOVER_EASE}, border-color 0.2s ${HOVER_EASE}; }
        .grid-chip:not(.is-active):hover { border-color: rgba(207,202,183,0.45); color: #CFCAB7; }
        .facet-menu-btn:hover { border-color: rgba(207,202,183,0.4); background: rgba(207,202,183,0.14); }
        .facet-menu-item:hover { background: rgba(207,202,183,0.09); color: #CFCAB7; }
        /* Metadata: note number top-left, category bottom-right only. Grey at
           rest, ink on hover. Fades in once the grid entrance settles. */
        .grid-tile-num,
        .grid-tile-cat {
          position: absolute;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 13px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(207,202,183,0.4);
          transition: color 0.28s ${HOVER_EASE}, opacity 0.5s ${HOVER_EASE} 0.1s;
          pointer-events: none;
        }
        .grid-tile-num {
          top: 8px;
          left: 10px;
        }
        .grid-tile-cat {
          bottom: 8px;
          right: 10px;
          max-width: calc(100% - 20px);
          text-align: right;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .grid-tile:hover .grid-tile-num,
        .grid-tile:hover .grid-tile-cat { color: #CFCAB7; }
        @media (prefers-reduced-motion: reduce) {
          .grid-tile-num, .grid-tile-cat { transition: none; }
          .grid-tile { transition: none; }
        }
      `}</style>

      {/* Filter bar is pinned to the bottom: transcript search + a row of filter
          tabs (Category · Location · Recency), each opening a dropdown of its own
          selectable values. The gradient masks tiles scrolling underneath;
          pointerEvents pass through the empty areas so the list still scrolls.
          Fades out with the tiles when a note opens (see GRID EXIT storyboard). */}
      <motion.div
        ref={barRef}
        initial={false}
        animate={{ opacity: noteOpen ? 0 : 1 }}
        transition={{
          duration: reduceMotion ? 0 : GRID_EXIT.barFade,
          ease: noteOpen ? GRID_EXIT.exitEase : GRID_EXIT.enterEase,
        }}
        style={{
          position: 'absolute',
          // Mobile: dock to the top (below the ABOUT chrome); desktop: bottom.
          ...(compact ? { top: 0, bottom: 'auto' } : { top: 'auto', bottom: 0 }),
          left: 0,
          right: 0,
          zIndex: 6,
          pointerEvents: 'none',
          // Top padding on mobile clears the fixed ABOUT row (top:24, ~40 tall).
          padding: compact ? '76px 16px 20px' : '44px 24px 26px',
          background: filterBarScrim(compact ? 'to bottom' : 'to top'),
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {/* Row 1 — filter tabs (Category · Location · Recency) + transcript
              search on one line. Each tab opens a dropdown of its own selectable
              values, so no persistent chip row is needed. */}
          <div
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              // Mobile stacks (search on top, tabs below); desktop is one row
              // with the search centred between an empty spacer and the tabs.
              flexDirection: compact ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: compact ? 12 : 10,
              flexWrap: compact ? 'nowrap' : 'wrap',
              width: '100%',
            }}
          >
            {/* Desktop-only left spacer. It mirrors the tabs cell (both flex:1),
                so the search input lands dead-centre in the bar no matter how
                wide the tabs get. Hidden on mobile, where the row stacks. */}
            <div
              aria-hidden="true"
              style={{ order: 0, flex: '1 1 0', minWidth: 0, display: compact ? 'none' : 'block' }}
            />
            <div
              ref={facetMenuRef}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: compact ? 'center' : 'flex-end',
                gap: 8,
                flex: compact ? '0 0 auto' : '1 1 0',
                minWidth: 0,
                flexWrap: 'wrap',
                order: 2,
              }}
            >
              {FACETS.map((f) => {
                const isOpen = openFacet === f.id;
                return (
                  <div key={f.id} style={{ position: 'relative', flex: '0 0 auto' }}>
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={isOpen}
                      className="facet-menu-btn"
                      onClick={() => setOpenFacet((cur) => (cur === f.id ? null : f.id))}
                      style={{
                        ...facetMenuButtonStyle,
                        // A facet with an active selection flips to a solid white
                        // pill with black text (inline styles beat the :hover rule,
                        // so it stays white on hover).
                        ...(f.active
                          ? { background: '#fff', color: '#111', border: '1px solid #fff' }
                          : null),
                      }}
                    >
                      {f.label}
                      <span
                        aria-hidden="true"
                        style={{
                          fontSize: 9,
                          opacity: 0.7,
                          transform: isOpen ? 'rotate(180deg)' : 'none',
                          transition: 'transform 0.18s ease',
                        }}
                      >
                        ▼
                      </span>
                    </button>

                    <AnimatePresence>
                      {isOpen ? (
                        <motion.div
                          role="menu"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                          transition={{ duration: 0.16, ease }}
                          style={{ ...facetMenuPanelStyle, maxHeight: 340, overflowY: 'auto' }}
                        >
                          {facetValues(f.id).map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={opt.on}
                              className="facet-menu-item"
                              onClick={opt.onClick}
                              style={facetMenuItemStyle(opt.on)}
                            >
                              <span
                                aria-hidden="true"
                                style={{
                                  width: 14,
                                  height: 14,
                                  borderRadius: 999,
                                  flex: '0 0 auto',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  border: `1px solid ${
                                    opt.on ? 'rgba(207,202,183,0.9)' : 'rgba(207,202,183,0.4)'
                                  }`,
                                }}
                              >
                                {opt.on ? (
                                  <span
                                    style={{ width: 7, height: 7, borderRadius: 999, background: '#fff' }}
                                  />
                                ) : null}
                              </span>
                              <span style={{ flex: 1, textAlign: 'left' }}>{opt.label}</span>
                            </button>
                          ))}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            <input
              className="grid-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transcripts…"
              aria-label="Search note transcripts"
              style={{
                pointerEvents: 'auto',
                order: 1,
                flex: compact ? '0 0 auto' : '0 1 440px',
                width: compact ? '100%' : 'auto',
                maxWidth: 440,
                background: 'rgba(207,202,183,0.1)',
                border: '1px solid rgba(207,202,183,0.18)',
                borderRadius: 999,
                padding: '9px 16px',
                color: '#CFCAB7',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                letterSpacing: '0.04em',
                outline: 'none',
                transition: `border-color 0.2s ${HOVER_EASE}`,
              }}
            />
          </div>
        </div>
      </motion.div>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100%',
          // Clip while tiles are parked / flying so off-edge tiles can't spawn
          // a scrollbar; restore native scroll once they've settled.
          overflowY: entranceStage === 'settled' ? 'auto' : 'hidden',
          overflowX: 'hidden',
          scrollbarGutter: 'stable',
          // Mobile: bar is docked at the top, so pad the top by its height and
          // leave the bottom light. Desktop: pad the bottom for the docked bar.
          padding: compact ? `${barH + 16}px 16px 56px` : `112px 32px ${barH + 24}px`,
        }}
      >
        {visible.length === 0 ? (
            <div
            style={{
              maxWidth: 1100,
              margin: '0 auto',
              paddingTop: 48,
              textAlign: 'center',
              color: 'rgba(207,202,183,0.5)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              letterSpacing: '0.06em',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
              }}
            >
              <img
                src="/box-bg.png"
                alt="AI Confessions installation"
                draggable={false}
                style={{
                  width: 120,
                  height: 'auto',
                  flexShrink: 0,
                  objectFit: 'contain',
                  opacity: 0.55,
                  filter: 'grayscale(0.3)',
                }}
              />
              <span>
                {q ? (
                  <>No notes match &ldquo;{query.trim()}&rdquo;.</>
                ) : (
                  'No notes match these filters.'
                )}
              </span>
            </div>
            {anyFilterActive ? (
              <button
                type="button"
                onClick={clearAll}
                style={{
                  marginTop: 14,
                  background: 'none',
                  border: 'none',
                  color: 'rgba(207,202,183,0.8)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                  cursor: 'pointer',
                }}
              >
                Clear all filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid-stack">
            {/* Lattice layer — the hairline grid drawn on independently of the
                tiles. Each line is a solid 1px <div> pinned to a cell edge by
                percentage; it "draws on" by scaling from one end (top→down for
                verticals, left→right for horizontals), staggered so the grid
                constructs itself a beat after the notes land. No stroke-dasharray
                anywhere, so the lines are always solid, never dashed. */}
            <motion.div
              className="grid-lattice"
              aria-hidden="true"
              initial={false}
              animate={{ opacity: noteOpen ? 0 : 1 }}
              transition={{
                duration: reduceMotion
                  ? 0
                  : noteOpen
                    ? GRID_EXIT.fadeOut
                    : GRID_EXIT.fadeIn,
                ease: noteOpen ? GRID_EXIT.exitEase : GRID_EXIT.enterEase,
              }}
            >
              {latticeLines.map((ln) => {
                const v = ln.axis === 'v';
                return (
                  <motion.div
                    key={ln.key}
                    className="grid-lattice-line"
                    style={{
                      transformOrigin: v ? 'top center' : 'left center',
                      ...(v
                        ? { top: 0, left: ln.main, width: 1, height: `${ln.lenPct}%` }
                        : { left: 0, top: ln.main, height: 1, width: `${ln.lenPct}%` }),
                    }}
                    initial={v ? { scaleY: reduceMotion ? 1 : 0 } : { scaleX: reduceMotion ? 1 : 0 }}
                    animate={v ? { scaleY: latticeDrawn ? 1 : 0 } : { scaleX: latticeDrawn ? 1 : 0 }}
                    transition={
                      latticeDrawn && !reduceMotion && !skipEntrance
                        ? { duration: 0.6, ease: GRID_ENTRANCE.ease, delay: ln.delay }
                        : { duration: 0 }
                    }
                  />
                );
              })}
            </motion.div>
            <div className="confession-grid">
            {visible.map((c, i) => {
              const d = offsetsRef.current.get(c.id) || GRID_TILE_REST;
              // Once the entrance has settled, the tile's motion is owned by the
              // exit/dissolve (driven by noteOpen); before that the fly-in
              // variants run. exitDelay ripples the fade out from the clicked tile.
              const settled = entranceStage === 'settled';
              const exitDelay = exitDelaysRef.current.get(c.id) || 0;
              return (
              <motion.div
                key={c.id}
                className="grid-tile"
                ref={(el) => {
                  const m = tileRefs.current;
                  if (el) m.set(c.id, el);
                  else m.delete(c.id);
                }}
                custom={d}
                variants={gridTileVariants}
                initial={false}
                animate={
                  settled
                    ? {
                        opacity: noteOpen ? 0 : 1,
                        y: noteOpen ? GRID_EXIT.yTo : 0,
                      }
                    : entranceStage
                }
                transition={
                  settled
                    ? {
                        duration: reduceMotion
                          ? 0
                          : noteOpen
                            ? GRID_EXIT.fadeOut
                            : GRID_EXIT.fadeIn,
                        ease: noteOpen ? GRID_EXIT.exitEase : GRID_EXIT.enterEase,
                        delay: reduceMotion ? 0 : exitDelay,
                      }
                    : undefined
                }
                onClick={(e) => {
                  // Mobile always uses the Lightbox overlay (the full-screen
                  // note-open / dial view is a desktop treatment). On desktop we
                  // also fall back to the Lightbox when a filter is active or no
                  // open handler was provided.
                  if (compact || anyFilterActive || !onOpenNote) {
                    setSelected(c);
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  computeExitDelays(rect);
                  onOpenNote(c, rect);
                }}
                style={{
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
              >
                <img
                  src={c.image}
                  alt={`Note ${c.id}`}
                  draggable={false}
                  loading="lazy"
                  decoding="async"
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
                    // Shared with NoteOpenView's morph origin — see TILE_PADDING.
                    // Tighter padding = bigger images + less gap between them.
                    padding: TILE_PADDING,
                    boxSizing: 'border-box',
                    display: 'block',
                    // At rest the tile is full colour — no grayscale. The noise +
                    // displacement warp is applied on hover only.
                    // Filter isn't transitioned: swapping to/from the url() noise
                    // filter can't interpolate, so we apply it crisply on hover.
                    transition: `transform 0.3s ${HOVER_EASE}`,
                  }}
                  onMouseEnter={(e) => {
                    // Slight paper-tilt on hover; alternate direction per tile
                    // so the grid reads like scattered notes lifting, not a
                    // uniform mechanical spin. The noise + displacement warp
                    // switches on here (and only here) to focus the hovered note.
                    e.currentTarget.style.transform = `scale(1.04) rotate(${
                      i % 2 === 0 ? -2 : 2
                    }deg)`;
                    e.currentTarget.style.filter = GRID_IMAGE_FILTER;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
                    e.currentTarget.style.filter = 'none';
                  }}
                />
                <span className="grid-tile-num" style={{ opacity: settled ? 1 : 0 }}>
                  {c.id}
                </span>
                {c.category ? (
                  <span className="grid-tile-cat" style={{ opacity: settled ? 1 : 0 }}>
                    {c.category}
                  </span>
                ) : null}
              </motion.div>
              );
            })}
            </div>
          </div>
        )}
      </div>

      <Lightbox
        confession={selected}
        onClose={() => setSelected(null)}
        onPrev={visible.length > 1 ? goPrev : undefined}
        onNext={visible.length > 1 ? goNext : undefined}
      />
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
function Lightbox({ confession, onClose, onPrev, onNext }) {
  const reduceMotion = useReducedMotion();
  const open = !!confession;
  const canNav = !!(onPrev || onNext);

  // ESC to close; ←/→ to step through notes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev?.();
      else if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onPrev, onNext]);

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

  const transcription = confession?.transcription?.trim();

  // Detail metadata shown at the top of the view, matching the note detail
  // view's labelled key/value rows: DATE and LOCATION, plus THEME. Fields with
  // no value drop out (live sheet vs. bundled fallback carry different subsets).
  const meta = confession?.metadata || {};
  const metaRows = [
    ['DATE', meta.date],
    ['LOCATION', meta.location],
    ['THEME', confession?.category],
  ].filter(([, v]) => v);

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
            padding: 24,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 20,
              width: '100%',
              maxWidth: 'min(94vw, 900px)',
              margin: 'auto',
              // No stopPropagation here: clicks on the column's blank areas (and
              // the image / text) bubble up to the backdrop and dismiss the view.
              // Only the prev/next nav buttons stop propagation, so paging never
              // closes it. The zoom-out cursor signals the click-to-close affordance.
              cursor: 'zoom-out',
            }}
          >
            {metaRows.length > 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24, ease: easeOut, delay: 0.04 }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  rowGap: 4,
                  width: '100%',
                  maxWidth: 'min(90vw, 360px)',
                }}
              >
                {metaRows.map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      columnGap: 24,
                      width: '100%',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: TRANSCRIPTION_FONT_SIZE,
                        letterSpacing: '0.08em',
                        lineHeight: 1.45,
                        textTransform: 'uppercase',
                        color: 'rgba(207,202,183,0.5)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: TRANSCRIPTION_FONT_SIZE,
                        letterSpacing: '0.02em',
                        lineHeight: 1.45,
                        color: 'rgba(207,202,183,0.85)',
                        textAlign: 'right',
                      }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </motion.div>
            ) : null}

            <motion.img
              key="lightbox-img"
              src={confession.image}
              alt={`Confession ${confession.id}`}
              draggable={false}
              onClick={onClose}
              {...imageMotion}
              transition={{ duration: 0.24, ease: easeOut, exit: { duration: 0.18 } }}
              style={{
                maxWidth: 'min(90vw, 720px)',
                maxHeight: 'min(62vh, 560px)',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block',
                boxShadow: 'none',
                willChange: 'transform, opacity',
                cursor: 'zoom-out',
              }}
            />

            {transcription ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24, ease: easeOut, delay: 0.05 }}
                style={{
                  width: '100%',
                  maxWidth: 'min(88vw, 560px)',
                  textAlign: 'center',
                }}
              >
                <Text
                  variant="bodySmall"
                  mono
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    ...TRANSCRIPTION_TEXT,
                  }}
                >
                  {transcription}
                </Text>
              </motion.div>
            ) : null}
          </div>

          {canNav && (
            <>
              <style>{`
                .lb-nav {
                  position: fixed;
                  top: 50%;
                  transform: translateY(-50%);
                  z-index: 1001;
                  width: 52px;
                  height: 52px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 0;
                  border: none;
                  border-radius: 50%;
                  background: transparent;
                  color: #CFCAB7;
                  opacity: 0.8;
                  cursor: pointer;
                  transition: opacity 0.2s ${HOVER_EASE}, transform 0.15s ${HOVER_EASE};
                }
                .lb-nav--left { left: max(12px, 2.5vw); }
                .lb-nav--right { right: max(12px, 2.5vw); }
                .lb-nav:hover { opacity: 1; }
                .lb-nav:active { transform: translateY(-50%) scale(0.92); }
              `}</style>
              <button
                type="button"
                aria-label="Previous note"
                className="lb-nav lb-nav--left"
                onClick={(e) => {
                  e.stopPropagation();
                  onPrev?.();
                }}
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
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Next note"
                className="lb-nav lb-nav--right"
                onClick={(e) => {
                  e.stopPropagation();
                  onNext?.();
                }}
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
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Right-side detail drawer for a single note. Slides in from the right edge with
 * the enlarged image on top, the metadata below, then the full transcription.
 * Backdrop click / ESC closes; ←/→ step through notes when onPrev/onNext given.
 */
function NoteDrawer({ confession, onClose, onPrev, onNext }) {
  const reduceMotion = useReducedMotion();
  const open = !!confession;
  const canNav = !!(onPrev || onNext);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev?.();
      else if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onPrev, onNext]);

  const easeOut = [0.165, 0.84, 0.44, 1];
  const transcription = confession?.transcription?.trim();

  // Detail metadata — show whichever fields are present (live sheet vs. bundled
  // fallback carry different subsets). Order: theme → location → collected.
  const meta = confession?.metadata || {};
  const metaEntries = [
    ['Theme', confession?.category],
    ['Location', meta.location],
    ['Collected', meta.collected],
  ].filter(([, v]) => v);

  const backdropMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, backdropFilter: 'blur(0px)' },
        animate: { opacity: 1, backdropFilter: 'blur(6px)' },
        exit: { opacity: 0, backdropFilter: 'blur(0px)' },
      };
  const panelMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } };

  const labelStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'rgba(207,202,183,0.4)',
  };
  const valueStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.02em',
    color: 'rgba(207,202,183,0.85)',
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="note-drawer-backdrop"
          {...backdropMotion}
          transition={{
            duration: 0.28,
            ease: easeOut,
            backdropFilter: { duration: 0.28, ease: easeOut },
          }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(8, 8, 10, 0.55)',
            WebkitBackdropFilter: 'blur(0px)',
            cursor: 'pointer',
          }}
        />
      )}
      {open && (
        <motion.aside
          key="note-drawer-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Note detail"
          {...panelMotion}
          transition={
            reduceMotion
              ? { duration: 0.2, ease: easeOut }
              : { type: 'spring', stiffness: 320, damping: 38, mass: 0.9 }
          }
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 1001,
            width: 'min(440px, 92vw)',
            background: 'rgba(16, 13, 15, 0.985)',
            borderLeft: '1px solid rgba(207,202,183,0.1)',
            boxShadow: '-24px 0 60px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '16px 22px 28px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <style>{`
            .nd-btn {
              width: 34px; height: 34px; flex: 0 0 auto;
              display: inline-flex; align-items: center; justify-content: center;
              padding: 0; border: 1px solid rgba(207,202,183,0.12);
              border-radius: 50%; background: rgba(207,202,183,0.04);
              color: #CFCAB7; cursor: pointer; opacity: 0.85;
              transition: opacity 0.18s ${HOVER_EASE}, background 0.18s ${HOVER_EASE}, transform 0.12s ${HOVER_EASE};
            }
            .nd-btn:hover { opacity: 1; background: rgba(207,202,183,0.14); }
            .nd-btn:active { transform: scale(0.92); }
          `}</style>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: canNav ? 'space-between' : 'flex-end',
              gap: 8,
              marginBottom: 14,
            }}
          >
            {canNav && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="nd-btn" aria-label="Previous note" onClick={() => onPrev?.()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <button type="button" className="nd-btn" aria-label="Next note" onClick={() => onNext?.()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>
            )}
            <button type="button" className="nd-btn" aria-label="Close note detail" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          {confession && (
            <>
              <motion.img
                key={confession.image}
                src={confession.image}
                alt={`Confession ${confession.id}`}
                draggable={false}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: reduceMotion ? 0 : 0.26, ease: easeOut }}
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '52vh',
                  objectFit: 'contain',
                  display: 'block',
                  borderRadius: 2,
                }}
              />

              {metaEntries.length > 0 && (
                <div
                  style={{
                    marginTop: 18,
                    paddingTop: 14,
                    borderTop: '1px solid rgba(207,202,183,0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                  }}
                >
                  {metaEntries.map(([label, value]) => (
                    <div
                      key={label}
                      style={{ display: 'flex', gap: 14, alignItems: 'baseline', justifyContent: 'space-between' }}
                    >
                      <span style={{ ...labelStyle, flex: '0 0 auto' }}>{label}</span>
                      <span style={{ ...valueStyle, flex: '1 1 auto', minWidth: 0, textAlign: 'right', overflowWrap: 'anywhere' }}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {transcription && (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(207,202,183,0.1)' }}>
                  <div style={{ ...labelStyle, marginBottom: 8 }}>Transcription</div>
                  <Text
                    variant="bodySmall"
                    mono
                    style={{ display: 'block', textAlign: 'left', ...TRANSCRIPTION_TEXT, lineHeight: 1.6 }}
                  >
                    {transcription}
                  </Text>
                </div>
              )}
            </>
          )}
        </motion.aside>
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
  onReturnToIntro,
  aboutOpen = false,
  sidebarInset = SIDEBAR_WIDTH,
  dialSize = BOTTOM_DIAL_SIZE,
  dialLabelInset = Math.round(BOTTOM_DIAL_SIZE * 0.232 + 40),
  // Landing→archive handoff: delay the dial's fade-in (s) and its intro spin
  // (ms) so the bridge note fades out first, then the dial spins in.
  dialEntranceDelay = 0.15,
  dialSpinDelayMs = 0,
}) {
  const [lightboxConfession, setLightboxConfession] = useState(null);
  const reduceMotion = useReducedMotion();
  const compact = useArchiveNavCompact();
  const dialBreadcrumb = useMemo(
    () => getCategoryBreadcrumbInfo(confessions, activeConfession),
    [confessions, activeConfession]
  );
  // On phones the half-disc sits flush to the bottom edge, which buries the
  // labels off-screen. Lift it up a touch (and give the cards more bottom
  // clearance) so the active label + its neighbours read clearly.
  const dialBottomOffset = compact ? 8 : -24;
  const cardBottomInset = compact ? dialLabelInset + dialBottomOffset + 72 : dialLabelInset;

  return (
    <motion.div
      key="theme-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease }}
      style={{ position: 'absolute', inset: 0 }}
    >
      {/* Background layer: gradient crossfade + grain (same `TunableGrainBackground`
          / DialKit "Grain" as landing + grid). Isolated so mix-blend-mode blends
          with the gradient; solid #111 base avoids white pulse at gradient midpoint. */}
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
          bottom: cardBottomInset,
          zIndex: 1,
          overflow: 'visible',
        }}
      >
        <motion.div
          initial={reduceMotion ? false : { x: NOTE_INTRO_SLIDE_PX }}
          animate={{ x: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  // Notes stay at full opacity (no fade) and slide into view on
                  // the dial spin's ease-out curve. Shorter than the full spin
                  // so they settle promptly — the dial decelerates (ease-out-
                  // quart) so it's ~98% there by the time the notes land, and
                  // the two still read as arriving together.
                  x: {
                    duration: NOTE_INTRO_SLIDE_MS / 1000,
                    ease: INTRO_SPIN_EASE_BEZIER,
                    delay: dialSpinDelayMs / 1000,
                  },
                }
          }
          style={{ width: '100%', height: '100%' }}
        >
          <HorizontalConfessionStack
            confessions={confessions}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            onImageClick={setLightboxConfession}
            mountEntrance={false}
            showNavHint={!compact}
            onReturnToIntro={onReturnToIntro}
            navDisabled={aboutOpen || !!lightboxConfession}
          />
        </motion.div>
      </div>

      {/* Desktop-only edge vignette: darkens the far left/right so the notes
          fade into the background at the screen edges instead of hard-clipping
          as they slide. Above the cards (z 1), below the dial (z 10) and the
          note drawer; never intercepts pointer events. */}
      {!compact && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 5,
            pointerEvents: 'none',
            background:
              'linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 7%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 78%, rgba(0,0,0,0.6) 93%, rgba(0,0,0,0.92) 100%)',
          }}
        />
      )}

      <NoteDrawer
        confession={lightboxConfession}
        onClose={() => setLightboxConfession(null)}
      />

      {/* Outer div keeps the centering transform stable; inner motion.div
          owns the opacity fade so Motion doesn't fight the translateX.
          Negative bottom drops the dial below the viewport edge so its
          half-disc reads as rising up from beneath the fold (-24px ≈ 12px
          lower than the previous -12px anchor).
          Within-category ticks are drawn on the dial canvas (active sector). */}
      <div
        style={{
          position: 'absolute',
          bottom: dialBottomOffset,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          pointerEvents: 'auto',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 70 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease, delay: dialEntranceDelay }}
        >
          <BottomCompassDial
            emotions={emotions}
            activeEmotion={activeEmotion}
            onEmotionChange={handleEmotionChange}
            size={dialSize}
            compact={compact}
            breadcrumb={dialBreadcrumb}
            introSpinDelayMs={dialSpinDelayMs}
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
    // On phones the 480px floor overflows the viewport and shoves the dial's
    // labels off both edges / below the fold, so the dial reads as missing.
    // Size to (just under) the viewport width instead so the whole label arc
    // stays on-screen and tappable. Desktop keeps the roomy 70%-width clamp.
    const widthCap =
      w <= 760
        ? Math.round(w * 0.96)
        : Math.min(880, Math.max(480, Math.round(w * 0.7)));
    // Clamp height contribution too — on short viewports the half-circle
    // would otherwise eat too much vertical space.
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

const ARCHIVE_LOADING_TEXT = 'Entering the Archive';

function ArchiveLoading() {
  const reduceMotion = useReducedMotion();
  // Type the line out one character at a time; reduced-motion shows it whole.
  const [typed, setTyped] = useState(() => (reduceMotion ? ARCHIVE_LOADING_TEXT : ''));

  useEffect(() => {
    if (reduceMotion) {
      setTyped(ARCHIVE_LOADING_TEXT);
      return undefined;
    }
    setTyped('');
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(ARCHIVE_LOADING_TEXT.slice(0, i));
      if (i >= ARCHIVE_LOADING_TEXT.length) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [reduceMotion]);

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
        color: 'rgba(207,202,183,0.6)',
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: 'clamp(13px, 1.9vw, 18px)',
        letterSpacing: '0.16em',
      }}
    >
      <span role="status" aria-label={ARCHIVE_LOADING_TEXT} style={{ whiteSpace: 'pre' }}>
        <span aria-hidden="true">{typed}</span>
      </span>
    </motion.div>
  );
}

function ArchivePage({ confessionQuery, initialEmotion = null, initialView = 'theme', onReturnToIntro }) {
  // Live data from the published Google Sheet. Falls back to the bundled
  // sample data if the network call fails so the prototype still works
  // offline / behind a captive portal.
  const { confessions: liveConfessions, emotions: liveEmotions, loading, error } =
    confessionQuery;

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
  // `initialView` lets a deep link (e.g. `/?view=grid`) open straight on a view.
  const [view, setView] = useState(initialView);
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
  // The note opened from the (unfiltered) grid → full-screen note-open view.
  const [openNote, setOpenNote] = useState(null);
  // Grid fly-in runs once per session; returning from dial → grid stays settled.
  const gridEntranceDoneRef = useRef(false);
  const compactNav = useArchiveNavCompact();
  const reduceMotion = useReducedMotion();
  const navChromeEntranceDelay = reduceMotion
    ? 0
    : view === 'theme'
      ? ARCHIVE_NAV_CHROME_DELAY_THEME
      : ARCHIVE_NAV_CHROME_DELAY_GRID;

  // Dial size scales with the viewport so it has room to breathe on big
  // screens but doesn't dominate on small ones. The visible portion is half
  // the dial's height (only the top half is shown), so we cap the height
  // contribution before the cards start to feel cramped.
  const dialSize = useResponsiveDialSize();
  // The dial canvas is `size × size/2` tall, but the active label only
  // sits `labelR` (≈ size * 0.232) above the bottom — everything above the
  // label is just transparent canvas. Reserve only enough space for the
  // labels + a modest breathing strip so the cards above sit a bit closer
  // real estate and read as "centered" rather than crammed at the top.
  const dialLabelInset = Math.round(dialSize * 0.232 + 26);
  // Seeded from the landing selection so the dial spins to the chosen
  // category on entry; falls back to the first emotion when entered directly.
  const [activeEmotion, setActiveEmotion] = useState(initialEmotion);
  const [activeIndex, setActiveIndex] = useState(0);

  // Entered via the landing EXPLORE CTA (vs. a direct/deep load). Captured once
  // so the dial entrance can wait for the bridge note to fade out first, then
  // spin in to the chosen category.
  const enteredFromLanding = useRef(initialEmotion != null).current;
  const dialEntranceDelay = reduceMotion ? 0 : enteredFromLanding ? HANDOFF_DIAL_DELAY_MS / 1000 : 0.15;
  const dialSpinDelayMs = reduceMotion ? 0 : enteredFromLanding ? HANDOFF_DIAL_DELAY_MS : 0;

  // Default the dial to the seeded/first emotion and align the card stack to
  // the first confession in that category. Otherwise activeIndex stays 0 while
  // the dial shows e.g. "Refusal" — sort order can put another category at
  // index 0, so every card looks inactive until the user scrolls.
  useEffect(() => {
    if (emotions.length === 0 || themedConfessions.length === 0) return;

    // Validate against the live emotion set: a stale/missing seed (e.g. landing
    // used fallback data) falls back to the first emotion instead of leaving
    // the dial pointing at nothing.
    const seedValid = activeEmotion && emotions.some((e) => e.id === activeEmotion);
    const emoId = seedValid ? activeEmotion : emotions[0].id;
    if (emoId !== activeEmotion) {
      setActiveEmotion(emoId);
    }

    const label = emotions.find((e) => e.id === emoId)?.label;
    if (!label) return;

    const idx = themedConfessions.findIndex((c) => c.category === label);
    if (idx < 0) return;

    const inBounds = activeIndex >= 0 && activeIndex < themedConfessions.length;
    const cur = inBounds ? themedConfessions[activeIndex] : null;
    const aligned = cur?.category === label;

    if (!aligned) {
      setActiveIndex(idx);
    }
  }, [emotions, themedConfessions, activeEmotion, activeIndex]);

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
      <ArchiveNavGradientWash />
      <SiteTitle entranceDelay={navChromeEntranceDelay} onReturnToIntro={onReturnToIntro} />
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
            minHeight: ARCHIVE_NAV_CHROME_HEIGHT,
            pointerEvents: 'none',
          }}
        >
          {/* View tabs are hidden on the grid (INDEX) view; the wordmark logo
              takes the left cell there instead so the mobile index keeps a
              top-left brand mark. Other views show the tabs. */}
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
            {view === 'grid' ? (
              <WordmarkLogo onReturnToIntro={onReturnToIntro} logoHeight={34} />
            ) : (
              <ViewToggle
                view={view}
                onChange={setView}
                sidebarInset={sidebarInset}
                embedded
                entranceDelay={navChromeEntranceDelay}
              />
            )}
          </div>
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
            <AboutHeader
              onClick={() => setAboutOpen(true)}
              open={aboutOpen}
              stacked
              view={view}
              onChange={setView}
              entranceDelay={navChromeEntranceDelay}
            />
          </div>
        </div>
      ) : (
        <AboutHeader
          onClick={() => setAboutOpen(true)}
          open={aboutOpen}
          view={view}
          onChange={setView}
          entranceDelay={navChromeEntranceDelay}
        />
      )}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      {/* Bottom-left wordmark + © — hidden on the grid/index, where SiteTitle
          already shows the wordmark top-left (the bottom mark was redundant). */}
      {view !== 'grid' ? (
        <ArchiveBrandMark
          sidebarInset={sidebarInset}
          entranceDelay={view === 'theme' ? navChromeEntranceDelay : 0.2}
        />
      ) : null}

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
            onReturnToIntro={onReturnToIntro}
            aboutOpen={aboutOpen}
            sidebarInset={sidebarInset}
            dialSize={dialSize}
            dialLabelInset={dialLabelInset}
            dialEntranceDelay={dialEntranceDelay}
            dialSpinDelayMs={dialSpinDelayMs}
          />
        ) : view === 'wall' ? (
          <WallView key="wall" confessions={confessions} sidebarInset={sidebarInset} />
        ) : (
          <GridView
            key="grid"
            confessions={confessions}
            sidebarInset={sidebarInset}
            onOpenNote={(c, rect) => setOpenNote({ confession: c, rect })}
            noteOpen={!!openNote}
            skipEntrance={gridEntranceDoneRef.current}
            onEntranceSettled={() => {
              gridEntranceDoneRef.current = true;
            }}
          />
        )}
      </AnimatePresence>

      {/* Full-screen note-open view — opened by clicking an unfiltered grid
          note (see NoteOpenView.jsx + docs/note-open-view-handoff.md). Sits
          above the grid, which stays mounted + blurred behind it. */}
      <AnimatePresence>
        {openNote && (
          <NoteOpenView
            key={openNote.confession.id}
            confession={openNote.confession}
            originRect={openNote.rect}
            confessions={confessions}
            emotions={emotions}
            onExit={() => setOpenNote(null)}
            onAbout={() => setAboutOpen(true)}
            onIndex={() => {
              setOpenNote(null);
              setView('grid');
            }}
          />
        )}
      </AnimatePresence>

      {/* Sidebar hidden — see comment by sidebarInset above to restore. */}
    </motion.div>
  );
}

export default function App() {
  // Deep link: `/?view=grid` (also `theme` | `wall`) opens straight into the
  // archive on that view — e.g. the onboarding "Enter the archive" CTA. Any
  // other load starts on the landing page as usual.
  const deepLinkView = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : ''
  ).get('view');
  const deepLinkArchive =
    deepLinkView === 'grid' || deepLinkView === 'theme' || deepLinkView === 'wall';

  const [page, setPage] = useState(deepLinkArchive ? 'archive' : 'landing');
  // Which view the archive opens on. The onboarding's ENTER lands on the grid
  // (its designed destination); deep links honor their own `?view=`.
  const [archiveView, setArchiveView] = useState(
    deepLinkArchive ? deepLinkView : 'grid'
  );
  const confessionQuery = useConfessions();

  return (
    <AnimatePresence mode="wait">
      {page === 'landing' && (
        <OnboardingReveal
          key="onboarding"
          skipEntrance
          onEnter={() => {
            setArchiveView('grid');
            setPage('archive');
          }}
        />
      )}
      {page === 'archive' && (
        <ArchivePage
          key="archive"
          confessionQuery={confessionQuery}
          initialEmotion={null}
          initialView={archiveView}
          onReturnToIntro={() => {
            // Drop any deep-link `?view=` so the intro sits at a clean `/` (and a
            // reload won't bounce straight back into the archive).
            if (typeof window !== 'undefined') {
              window.history.replaceState(null, '', '/');
            }
            setPage('landing');
          }}
        />
      )}
    </AnimatePresence>
  );
}
