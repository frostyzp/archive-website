import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  animate,
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
  DialNavHint,
  getCategoryBreadcrumbInfo,
  HorizontalConfessionStack,
  INTRO_SPIN_EASE_BEZIER,
  NavGrainFilter,
} from './SideDial';
import { CONFESSIONS as FALLBACK_CONFESSIONS } from './confessions';
import {
  deriveEmotions,
  sortConfessionsByEmotions,
  NEUTRAL_GRADIENT,
  formatCategoryLabel,
} from './themes';
import { useConfessions } from './useConfessions';
import {
  TunableGrainBackground,
  noiseUrl,
  CARD_FILTER_ID,
  CardNoiseFilterDefs,
  useInactiveCardParams,
} from './noise';
import { INK, inkA } from './colors';
import { LINK_UNDERLINE, LINK_UNDERLINE_CSS } from './linkUnderline';
import { subscribeToKit } from './kit';
import NoteOpenView, { TILE_PADDING } from './NoteOpenView';
import { GridImageFilter, GRID_IMAGE_FILTER } from './NoiseDisplaceFilter';
import { useNoteSound } from './sounds';
import CubeScene from './CubeScene';
import { CURSOR_FLOAT, cursorOffset, floatAngles } from './cursorFloat';
const ease = [0.22, 1, 0.36, 1];
/** Shared hover / color / opacity transition curve (ease-out-quart). */
const HOVER_EASE = 'cubic-bezier(0.17, 0.84, 0.44, 1)';
const HOVER_EASE_ARR = [0.17, 0.84, 0.44, 1];

/**
 * Leans a hovered grid note toward the cursor and lifts it off the page. Written
 * straight to the node — with 350+ tiles, routing pointer moves through state
 * would re-render the whole grid on every frame.
 *
 * `paperRotate` is the tile's resting paper skew, kept underneath the lean so a
 * grid of hovered notes still reads as scattered sheets rather than a uniform
 * bank. `ms` sets --float-ms, the transform transition the CSS reads.
 */
function applyGridFloat(e, paperRotate, ms) {
  const el = e.currentTarget;
  const off = cursorOffset(el, e.clientX, e.clientY);
  if (!off) return;
  const { yaw, pitch } = floatAngles(off.nx, off.ny);
  const F = CURSOR_FLOAT;
  el.style.setProperty('--float-ms', `${ms}ms`);
  el.style.transform =
    `perspective(${F.perspective}px) ` +
    `rotateX(${pitch.toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg) ` +
    `translateZ(${F.rise}px) scale(${1 + F.lift}) rotate(${paperRotate}deg)`;
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

// Smallest phones. Together with ARCHIVE_NAV_COMPACT_MQ (and the wide tiers
// below) this mirrors the grid's responsive column count exactly (see
// .confession-grid media queries): 2 at ≤460px, 2 at ≤760px, 3 by default,
// 4 at ≥1640px, 5 at ≥2040px. Phones stay at a 2-up contact sheet.
const GRID_ONE_COL_MQ = '(max-width: 460px)';
// Wider desktops pack more columns so the contact sheet fills large monitors
// instead of floating in a fixed 1100px column — while keeping the square
// tiles from ballooning. Thresholds account for the ~320px of left rail +
// gutters, so each breakpoint keeps cells roughly in the 330–440px band.
const GRID_FOUR_COL_MQ = '(min-width: 1640px)';
const GRID_FIVE_COL_MQ = '(min-width: 2040px)';

/** Live column count of the contact-sheet grid, so the lattice overlay can pin
 *  its hairlines to the right cell edges (percentage-positioned to the cols×rows
 *  tile grid). */
function useGridColumns() {
  const read = () => {
    if (typeof window === 'undefined') return 3;
    if (window.matchMedia(GRID_ONE_COL_MQ).matches) return 2;
    if (window.matchMedia(ARCHIVE_NAV_COMPACT_MQ).matches) return 2;
    // Widest match wins: a 2040px screen also matches the 1640px query.
    if (window.matchMedia(GRID_FIVE_COL_MQ).matches) return 5;
    if (window.matchMedia(GRID_FOUR_COL_MQ).matches) return 4;
    return 3;
  };
  const [cols, setCols] = useState(read);
  useEffect(() => {
    const mqs = [
      window.matchMedia(GRID_ONE_COL_MQ),
      window.matchMedia(ARCHIVE_NAV_COMPACT_MQ),
      window.matchMedia(GRID_FOUR_COL_MQ),
      window.matchMedia(GRID_FIVE_COL_MQ),
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

// Plain-text nav items read as hyperlinks, so they carry the site's dotted
// underline. Pill / icon CTAs stay undecorated so they still read as buttons.
const ARCHIVE_LINK_UNDERLINE = LINK_UNDERLINE;

function ArchiveNavGradientWash({ zIndex = 150 }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: ARCHIVE_NAV_GRADIENT_HEIGHT,
        zIndex,
        pointerEvents: 'none',
        background:
          'linear-gradient(to bottom, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0.42) 52%, rgba(0, 0, 0, 0) 100%)',
      }}
    />
  );
}

/** Hand-lettered "What We / Tell AI" wordmark button — the onboarding hero's
 *  brush art, dropped into the nav. It reads from a baked PNG rather than
 *  wordmark.svg because the source carries the hero's grain detail at 1.19MB;
 *  see scripts/wordmark-logo.mjs. Tapping it returns to the intro onboarding.
 *  `logoHeight` lets the mobile chrome render it a touch smaller. */
function WordmarkLogo({ onReturnToIntro, onClick, ariaLabel, title, logoHeight = 48 }) {
  return (
    <button
      type="button"
      onClick={onClick || onReturnToIntro}
      aria-label={ariaLabel || 'What We Tell AI — return to the intro'}
      title={title || 'Return to the intro'}
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
        src="/wordmark-144.png"
        alt="What We Tell AI"
        draggable={false}
        style={{ height: logoHeight, width: 'auto', display: 'block' }}
      />
    </button>
  );
}

/**
 * Fixed top chrome shared by every archive view — wordmark (left) + INDEX/EXPLORE/
 * ABOUT (right). Stays mounted when the About panel opens; only handlers and
 * active states swap so the bar never jumps position.
 */
function ArchiveNavBar({
  compactNav,
  entranceDelay = 0.2,
  onReturnToIntro,
  view,
  onViewChange,
  aboutOpen = false,
  onAboutOpen,
  onAboutClose,
  zIndex = 200,
}) {
  const wordmarkProps = aboutOpen
    ? {
        onClick: onAboutClose,
        ariaLabel: 'What We Tell AI — close about',
        title: 'Close about',
      }
    : { onReturnToIntro };

  const handleAboutClick = aboutOpen ? onAboutClose : onAboutOpen;
  const handleViewChange = (v) => {
    if (aboutOpen) onAboutClose();
    onViewChange(v);
  };

  if (compactNav) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 24,
          left: 16,
          right: 16,
          zIndex,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          minHeight: ARCHIVE_NAV_CHROME_HEIGHT,
          pointerEvents: 'none',
        }}
      >
        <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
          <WordmarkLogo logoHeight={34} {...wordmarkProps} />
        </div>
        <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
          <AboutHeader
            onClick={handleAboutClick}
            open={aboutOpen}
            stacked
            view={view}
            onChange={handleViewChange}
            entranceDelay={entranceDelay}
            zIndex={zIndex}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease, delay: entranceDelay }}
        style={{
          position: 'fixed',
          top: 24,
          left: 24,
          zIndex,
          height: ARCHIVE_NAV_CHROME_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <WordmarkLogo {...wordmarkProps} />
      </motion.div>
      <AboutHeader
        onClick={handleAboutClick}
        open={aboutOpen}
        view={view}
        onChange={handleViewChange}
        entranceDelay={entranceDelay}
        zIndex={zIndex}
      />
    </>
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

function AboutHeader({
  onClick,
  open,
  view,
  onChange,
  stacked = false,
  // Whether INDEX/EXPLORE render as hover-preview menus (desktop) vs plain
  // toggles. Defaults to follow `stacked` (compact bar = toggles), but the
  // About panel reuses the desktop menus in its in-flow bar by passing this
  // explicitly — so the panel nav is the same component as the site chrome.
  menus = !stacked,
  entranceDelay = 0.2,
  zIndex = 200,
}) {
  // Desktop top-right chrome: INDEX (2×2 note grid on hover) · EXPLORE (3-card
  // fan) · ABOUT. The compact (stacked) bar has no hover, so it swaps those
  // menus for plain INDEX/EXPLORE toggles that sit with ABOUT as one flush-right
  // cluster (the wordmark holds the left cell).
  const showTabs = menus;

  // ABOUT opens the panel. On desktop it's wrapped in the grainy sketch hover
  // note (see AboutHoverNote); the compact/touch top bar keeps the plain button
  // since there's no hover there.
  const aboutButton = (
    <button
      type="button"
      onClick={(e) => {
        onClick?.(e);
      }}
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
        zIndex,
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
      {showTabs ? (
        <>
          <IndexMenu view={view} onChange={onChange} aboutOpen={open} />
          <ExploreMenu view={view} onChange={onChange} aboutOpen={open} />
          {/* EXPERIMENT + CUBE tabs hidden for now — the views still exist and
              stay reachable via ?view=experiment / ?view=cube. */}
        </>
      ) : (
        // Compact bar: INDEX · EXPLORE · EXPERIMENT ride flush-right alongside
        // ABOUT (plain toggles — the phone has no hover for the desktop menus).
        <>
          {/* While the About panel is open, ABOUT is the current destination, so
              INDEX/EXPLORE must read as inactive (dimmed) — otherwise INDEX stays
              lit from the underlying view and the bar shows two active tabs. This
              keeps "exactly one active tab" consistent with the archive pages. */}
          <ToggleButton active={!open && view === 'grid'} onClick={() => onChange?.('grid')}>
            INDEX
          </ToggleButton>
          <ToggleButton active={!open && view === 'explore'} onClick={() => onChange?.('explore')}>
            EXPLORE
          </ToggleButton>
          {/* EXPERIMENT + CUBE tabs hidden for now — the views still exist and
              stay reachable via ?view=experiment / ?view=cube. */}
        </>
      )}
      {/* Desktop reveals the torn-paper "?" hover note; the compact/touch top
          bar keeps the plain ABOUT button (no hover). */}
      {menus ? <AboutHoverNote>{aboutButton}</AboutHoverNote> : aboutButton}
    </motion.div>
  );
}

/* Decorative confession-note cutouts that "peek" from the panel edges — a few
 * are randomly drawn from the archive once per session (see peekImages; stable
 * across opens, re-rolled only on refresh), tucked mostly off-screen at the left
 * edge + bottom-right corner so only a torn sliver shows. Purely ambient:
 * aria-hidden, pointer-events:none, and behind the reading content. Desktop only
 * (mobile has no spare margin). */
const ABOUT_PEEK_SLOTS = [
  { key: 'left-a', pos: { left: -116, top: '33%' }, rot: -7, w: 208, from: { x: -48 } },
  { key: 'left-b', pos: { left: -104, top: '69%' }, rot: 6, w: 176, from: { x: -48 } },
  { key: 'br-a', pos: { right: -104, bottom: -78 }, rot: -12, w: 232, from: { x: 44, y: 44 } },
  { key: 'br-b', pos: { right: 88, bottom: -130 }, rot: 9, w: 150, from: { x: 20, y: 46 } },
];

function AboutPeekNotes({ images, reduceMotion }) {
  if (!images || images.length === 0) return null;
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {ABOUT_PEEK_SLOTS.map((slot, i) => {
        const src = images[i % images.length];
        if (!src) return null;
        return (
          <motion.img
            key={slot.key}
            src={src}
            alt=""
            draggable={false}
            loading="lazy"
            initial={reduceMotion ? false : { opacity: 0, rotate: slot.rot, ...slot.from }}
            animate={{ opacity: 0.7, rotate: slot.rot, x: 0, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 + i * 0.08 }}
            style={{
              position: 'absolute',
              width: slot.w,
              height: 'auto',
              ...slot.pos,
              filter: 'drop-shadow(0 12px 26px rgba(0,0,0,0.5))',
              userSelect: 'none',
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Centered about modal. Backdrop + card fade in on open; on close (click-out
 * / ESC) both exit with opacity only — no scale or drift so it reads as a
 * simple dismiss. prefers-reduced-motion skips transforms on enter too.
 */
function AboutModal({ open, onClose, confessions = [] }) {
  const reduceMotion = useReducedMotion();
  // Grain <filter> id for the active section-rail arrow (see .about-navlink::before).
  const railGrainId = 'about-rail-grain';
  // Full-screen takeover; the site nav bar stays mounted above this panel
  // (ArchiveNavBar in ArchivePage) so INDEX/EXPLORE/ABOUT never jump position.
  // Desktop puts a left section-nav rail beside ONE scrolling content column;
  // phones stack the sections. The rail links scroll the content to each section,
  // and an IntersectionObserver highlights the section in view.
  const compact = useArchiveNavCompact();

  // Mailing-list signup state.
  const [email, setEmail] = useState('');
  // 'idle' | 'submitting' | 'success' | 'error'
  const [subscribeStatus, setSubscribeStatus] = useState('idle');
  const [subscribeError, setSubscribeError] = useState('');

  const subscribing = subscribeStatus === 'submitting';
  const subscribed = subscribeStatus === 'success';

  // Section scroll-nav: the left rail (desktop) + the intro pointer links scroll
  // this content container to each section; a scroll-spy highlights the active one.
  const contentRef = useRef(null);
  const sectionRefs = useRef({});
  const [activeSection, setActiveSection] = useState('about');

  // A random handful of note cutouts for the edge "peek" decor. Locked in once
  // per session — cached in a ref the first time the archive pool is available —
  // so opening/closing About during the same visit keeps the SAME notes; only a
  // refresh / new session re-rolls. Skipped on mobile (no spare margin to peek).
  const peekImagesRef = useRef(null);
  const peekImages = useMemo(() => {
    if (compact) return [];
    if (peekImagesRef.current) return peekImagesRef.current;
    const pool = (confessions || []).map((c) => c && c.image).filter(Boolean);
    if (pool.length === 0) return [];
    const arr = [...pool];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    peekImagesRef.current = arr.slice(0, ABOUT_PEEK_SLOTS.length);
    return peekImagesRef.current;
  }, [compact, confessions]);

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

  // Fonts: Faktory for body copy, mono for chrome/links, Reckless Italic for the
  // pull-quote. (The foot-of-panel wordmark is an image, not a script face.)
  const BODY_FONT = "'Faktory', Georgia, serif";
  const MONO_FONT = 'var(--font-mono)';
  const QUOTE_FONT = "'Reckless Italic', Georgia, serif";

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Where a jumped-to section lands, measured from the top of the scrollport.
  //
  // The content scrolls UNDER the fixed nav chrome (which is why both layouts pad
  // their top by it), so a small offset parked a heading behind the wordmark row.
  // This is the panel's own resting top inset instead — the same one the first
  // section sits at — so jumping to a section puts its heading exactly where the
  // top of the document sits when the panel opens.
  const sectionInset = compact ? 24 + ARCHIVE_NAV_CHROME_HEIGHT + 16 : FILTER_SIDEBAR_TOP;

  // Smooth-scroll the content container to a section (used by the rail links and
  // the inline "our process" / "why we care" pointers in the intro).
  const scrollToSection = useCallback(
    (id) => {
      const root = contentRef.current;
      const el = sectionRefs.current[id];
      if (!root || !el) return;
      const top =
        el.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop -
        sectionInset;
      root.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
    },
    [sectionInset, reduceMotion]
  );

  // Fresh open always starts on the first section.
  useEffect(() => {
    if (open) setActiveSection('about');
  }, [open]);

  // Scroll-spy (desktop rail): mark whichever section sits nearest the top.
  useEffect(() => {
    if (!open || compact) return;
    const root = contentRef.current;
    if (!root) return;
    const els = ['about', 'why', 'process']
      .map((id) => sectionRefs.current[id])
      .filter(Boolean);
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = top?.target?.getAttribute('data-section');
        if (id) setActiveSection(id);
      },
      { root, rootMargin: '0px 0px -65% 0px', threshold: 0.01 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [open, compact]);

  const easeOut = [0.165, 0.84, 0.44, 1];

  // Content reveals top→down — each block fades + settles in from slightly above.
  // On mobile it cascades down the single column; on desktop each of the three
  // columns cascades (offset per column) so the page assembles left-to-right.
  const backdropMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, backdropFilter: 'blur(0px)' },
        animate: { opacity: 1, backdropFilter: 'blur(6px)' },
        exit: { opacity: 0, backdropFilter: 'blur(0px)' },
      };

  // Full-screen takeover on every breakpoint — a gentle fade (no drawer slide);
  // the reading blocks handle the entrance motion.
  const panelMotion = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  };

  // ── Shared copy + styles for the three columns ──────────────────────────
  const BODY_COLOR = 'rgba(200,200,200,0.9)';
  const bodySize = compact ? 16 : 15;
  const bodyStyle = {
    margin: '0 0 15px',
    fontFamily: BODY_FONT,
    fontSize: bodySize,
    lineHeight: 1.5,
    letterSpacing: '0.01em',
    color: BODY_COLOR,
  };
  // Tracking eases off as the size goes up — 0.16em reads as an eyebrow at 11px
  // but gets airy and hard to scan at 16px.
  const headStyle = {
    margin: '0 0 16px',
    fontFamily: MONO_FONT,
    fontSize: compact ? 14 : 16,
    fontWeight: 400,
    letterSpacing: '0.11em',
    lineHeight: 1.25,
    textTransform: 'uppercase',
    color: '#fff',
  };
  const captionStyle = {
    margin: '8px 0 0',
    fontFamily: MONO_FONT,
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: inkA(0.4),
  };

  const introParas = [
    'What We Tell AI is a project exploring our secrets about our complex relationship with A.I. (artificial intelligence).',
    'Last September, we set up a box in Dolores Park, San Francisco and asked strangers to write down a confession about their relationship with A.I.',
    'Since then, we’ve collected more than 350 handwritten notes gathered in parks, shopping malls, and even AI conferences across the California Bay Area, New York, and beyond.',
    'A snapshot of these strange times, WWTAI shines a light on the emerging taboos around AI use and its increasing presence in our intimate lives in 2026, just 3 years after the release of ChatGPT.',
    'At its best, we hope this project invites deeper reflection about AI’s impact not just on our world, but on our personal lives: how we think, how we love, and how we make sense of it all together.',
  ];

  const whyLead = 'AI is reshaping our social lives faster than we can understand.';
  const whyParas = [
    {
      text:
        'AI is occupying roles once reserved for people we surround ourselves with: lovers, therapists, oracles. The attention economy is evolving into an intimacy economy, where multimodal AI services offer to fulfill our deepest needs for human connection and/or replace them with new forms of synthetic intimacies. What happens when millions of people interact daily with AI in this way?',
    },
    {
      lead: 'The core issue:',
      text:
        ' this social change is happening too fast for individual sense-making. Public debates center on economy and geopolitics, overshadowing the everyday questions: What is this? How should I feel about it? Is this changing me for the better? While “everyone is talking about AI,” certain topics remain taboo: fear of being left behind, shame around emotional dependence and personal experimentation. Personalized AI also silos us into singular experiences, making collective discussion difficult — we’re not all experiencing the same version of “chat.”',
    },
    {
      lead: 'At its worst,',
      text:
        ' we’ll be bombarded with AI products too quickly for thoughtful adoption, leading to crises in human connection and well-being. AI will become an unlimited attention pool, diverting our love and energy away from friends, families, neighbors, and communities. Trust and authenticity will erode in digital spaces where AI and humans become indistinguishable. We will start to prioritize AI’s “knowledge” over our own, losing touch with our embodied, lived experience.',
    },
    {
      lead: 'At its best,',
      text:
        ' we’ll recognize AI simply as a radical new technology and learn how to steward it wisely into our lives and communities. We’ll stay cautious and curious. Like ecological concepts of “indicator species,” we’ll learn to sense emergent invisible harms — raising awareness throughout our networks to protect the health of our human ecosystems. Our collective wisdom will create and uphold cultural norms around AI use that protect the values most important to us.',
    },
  ];

  const processIntro =
    'WWTAI collects anonymous confessions by installing a makeshift confession booth across more than twenty sites in California, Massachusetts, Colorado, and New York. Locations range from ordinary public space (e.g. parks, shopping malls) to gatherings where AI is already the explicit subject (e.g. workshops, conferences).';
  const processParas = [
    'Most often, we’d sit about 6ft from the booth for three to five hours. This was close enough to chat occasionally or reset the booth when the wind knocked it over, but far enough to keep the writing private. Other times we’d leave the booth entirely unattended, sitting on the other side of the park. Unmanned booths drew noticeably more pranks — young boys, in particular, filling the box with lewd jokes — but they also drew longer, more vulnerable disclosures. Context shaped the encounter in other ways too: in some places, Washington Square among them, people assumed by default that they were being filmed and this was a content creator scheme.',
  ];

  const renderPara = (p, i) => (
    <p key={i} style={bodyStyle}>
      {typeof p === 'string' ? (
        p
      ) : (
        <>
          {p.lead ? (
            <strong style={{ color: inkA(0.9), fontWeight: 600 }}>{p.lead}</strong>
          ) : null}
          {p.text}
        </>
      )}
    </p>
  );

  // ABOUT column — the project blurb + a pointer into the other two columns.
  const sectionAbout = (
    <>
      <h2 style={headStyle}>About</h2>
      {introParas.map(renderPara)}
      <p style={{ ...bodyStyle, color: inkA(0.6), marginTop: 4 }}>
      </p>
    </>
  );

  // WHY WE CARE column — a McLuhan pull-quote, a thesis line, then the essay.
  const sectionWhy = (
    <>
      <h2 style={headStyle}>Why we care about this</h2>
      <blockquote style={{ margin: '0 0 20px', padding: 0 }}>
        <p
          style={{
            margin: '0 0 8px',
            fontFamily: BODY_FONT,
            // Faktory ships upright only (no italic face); fontStyle:'italic' would
            // synthesize an ugly faux slant, so keep the pull-quote roman.
            fontStyle: 'normal',
            fontSize: compact ? 20 : 19,
            lineHeight: 1.36,
            color: inkA(0.9),
          }}
        >
          “There is absolutely no inevitability as long as there is a willingness
          to contemplate what is happening”
        </p>
        <cite
          style={{
            fontStyle: 'normal',
            fontFamily: MONO_FONT,
            fontSize: 11,
            letterSpacing: '0.08em',
            color: inkA(0.5),
          }}
        >
          — Marshall McLuhan
        </cite>
      </blockquote>
      <p style={{ ...bodyStyle, color: inkA(0.85), fontSize: bodySize + 1, margin: '0 0 16px' }}>
        {whyLead}
      </p>
      {whyParas.map(renderPara)}
    </>
  );

  // OUR PROCESS column — how the booth works + an installation image.
  const sectionProcess = (
    <>
      <h2 style={headStyle}>Our process</h2>
      {renderPara(processIntro, 'p-intro')}
      <figure style={{ margin: '4px 0 16px' }}>
        <img
          src="/box-bg.png"
          alt="A What We Tell AI confession booth installed in a public space."
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            aspectRatio: '4 / 3',
            objectFit: 'cover',
            borderRadius: 3,
            border: `1px solid ${inkA(0.12)}`,
            filter: 'grayscale(0.2)',
          }}
        />
        <figcaption style={captionStyle}>Fig. 01 — the confession booth</figcaption>
      </figure>
      {processParas.map((p, i) => renderPara(p, `pp-${i}`))}
    </>
  );

  // Contact + mailing list + copyright. Foot of the ABOUT column on desktop;
  // end of the stack on mobile.
  const connectBlock = (
    <div
      className="about-subscribe"
      style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${inkA(0.1)}` }}
    >
      <style>{`
        .about-subscribe input::placeholder { color: ${inkA(0.4)}; }
        .about-subscribe input:focus { border-color: ${inkA(0.55)}; }
        .about-subscribe button:hover:not(:disabled),
        .about-subscribe button:focus-visible:not(:disabled) {
          background: #fff; border-color: #CFCAB7;
        }
        .about-subscribe button:disabled { opacity: 0.55; cursor: default; }
        .about-subscribe input:disabled { opacity: 0.55; }
      `}</style>
      <div style={{ display: 'flex', gap: 18, marginBottom: 16 }}>
        <a
          className="about-contact-link"
          href="mailto:hello@whatwetellai.com"
          style={{ fontFamily: MONO_FONT, fontSize: 12, letterSpacing: '0.08em' }}
        >
          EMAIL
        </a>
        <a
          className="about-contact-link"
          href="https://www.instagram.com/whatwetellai"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontFamily: MONO_FONT, fontSize: 12, letterSpacing: '0.08em' }}
        >
          INSTAGRAM
        </a>
      </div>
      <p style={{ margin: '0 0 10px', fontFamily: BODY_FONT, fontSize: bodySize, lineHeight: 1.4, color: BODY_COLOR }}>
        Join the mailing list
      </p>
      {!subscribed ? (
        <form onSubmit={handleSubscribe} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
              flex: '1 1 180px',
              minWidth: 0,
              background: inkA(0.04),
              border: `1px solid ${inkA(0.22)}`,
              borderRadius: 4,
              color: '#CFCAB7',
              padding: '10px 12px',
              fontFamily: BODY_FONT,
              fontSize: 14,
              letterSpacing: '0.01em',
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
              fontFamily: BODY_FONT,
              fontSize: 14,
              letterSpacing: '0.02em',
              cursor: 'pointer',
              transition: `background 0.18s ${HOVER_EASE}, border-color 0.18s ${HOVER_EASE}`,
            }}
          >
            {subscribing ? 'SUBSCRIBING…' : 'SUBSCRIBE'}
          </button>
        </form>
      ) : (
        <p style={{ margin: 0, fontFamily: BODY_FONT, fontSize: 14, lineHeight: 1.6, color: inkA(0.8) }}>
          Thanks — check your inbox to confirm your subscription.
        </p>
      )}
      {subscribeStatus === 'error' && (
        <p style={{ margin: '8px 0 0', fontFamily: MONO_FONT, fontSize: 10, letterSpacing: '0.04em', lineHeight: 1.5, color: '#f0846b' }}>
          {subscribeError}
        </p>
      )}
    </div>
  );

  const copyrightLine = (
    <p style={{ margin: 0, fontFamily: MONO_FONT, fontSize: 11, letterSpacing: '0.06em', color: inkA(0.45) }}>
      © What We Tell AI 2026
    </p>
  );

  // Typefaces are the ones actually loaded in index.html and used in the app:
  // Faktory (body), Reckless (pull-quotes), TRJN Da Vinci (intro display).
  const credits = [
    { role: 'Project conceptualized by', name: 'Olivia Tai' },
    { role: 'Site designed by', name: 'Arin Pantja' },
    { role: 'Typefaces', name: 'Faktory, Reckless, TRJN Da Vinci' },
  ];

  const creditsBlock = (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ ...headStyle, margin: '0 0 14px' }}>Credits</h2>
      <dl style={{ margin: 0 }}>
        {credits.map((c) => (
          <div
            key={c.role}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0 6px',
              fontFamily: MONO_FONT,
              fontSize: 11,
              lineHeight: 1.9,
              letterSpacing: '0.06em',
            }}
          >
            <dt style={{ color: inkA(0.45) }}>{c.role}</dt>
            <dd style={{ color: inkA(0.75) }}>{c.name}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  // Foot of the panel on both breakpoints: credits, then the copyright line.
  const footerBlock = (
    <>
      {creditsBlock}
      {copyrightLine}
    </>
  );

  // The three reading sections, in order. The rail links + scroll-spy key off
  // these ids; the shorter `label` is what the left rail shows.
  const sections = [
    { id: 'about', label: 'About', node: sectionAbout },
    { id: 'why', label: 'Why we care', node: sectionWhy },
    { id: 'process', label: 'Our process', node: sectionProcess },
  ];

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
          transition={{ duration: reduceMotion ? 0.2 : 0.4, ease: easeOut }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1001,
            // Same base as the rest of the site (#111). The grain layer inside
            // paints over this, and the content sits above the grain.
            background: '#111',
            color: INK,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
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

          {/* Ambient confession-note cutouts peeking from the panel edges. */}
          <AboutPeekNotes images={peekImages} reduceMotion={reduceMotion} />

          <style>{`
            /* No underline, unlike the site's other text links: these two sit
               alone on their own row as mono caps, so they read as links from
               position rather than needing the rule. */
            .about-contact-link {
              display: inline-block; color: ${inkA(0.72)};
              text-decoration: none;
              transition: color 0.18s ${HOVER_EASE};
            }
            .about-contact-link:hover { color: #CFCAB7; }
            .about-emph { color: ${inkA(0.85)}; ${LINK_UNDERLINE_CSS} }
            .about-col::-webkit-scrollbar { width: 9px; }
            .about-col::-webkit-scrollbar-thumb {
              background: ${inkA(0.14)}; border-radius: 4px;
            }
            /* Entrance animates transform + a fade that always resolves visible:
               opacity starts at 0.4 (never fully hidden) so content is legible
               even if the tab throttles/pauses animation time. */
            @keyframes aboutFadeUp {
              from { opacity: 0.4; transform: translateY(14px); }
              to { opacity: 1; transform: none; }
            }
            .about-fade { animation: aboutFadeUp 0.6s cubic-bezier(0.165, 0.84, 0.44, 1) both; }
            @media (prefers-reduced-motion: reduce) {
              .about-fade { animation: none; }
            }
            /* Inline pointers in the intro copy ("our process" / "why we care")
               reuse the dotted .about-emph underline but scroll on click. */
            .about-inline-link {
              /* background-color, not the background shorthand — this is worn
                 alongside .about-emph, whose underline is a background image. */
              background-color: transparent; border: none; padding: 0; margin: 0;
              font: inherit; color: inherit; cursor: pointer;
            }
            /* Left section-nav rail — styled to echo the index filter rail:
               mono, uppercase, hairline-separated rows with a dot on the active. */
            .about-navlink {
              position: relative; display: block; width: 100%; text-align: left;
              background: none; border: none;
              border-bottom: 1px solid ${inkA(0.12)};
              padding: 11px 2px 11px 18px; margin: 0; cursor: pointer;
              font-family: var(--font-mono); font-size: 13px; font-weight: 400;
              letter-spacing: 0.12em; text-transform: uppercase; color: ${inkA(0.5)};
              transition: color 0.18s ${HOVER_EASE};
            }
            .about-navlink:hover { color: #CFCAB7; }
            .about-navlink[data-active='true'] { color: #CFCAB7; }
            /* Active row is marked by a small "->" pointing at the label in the
               left gutter, roughened by the shared SVG grain displacement filter.
               letter-spacing is reset so the two glyphs read as one tight arrow
               (the rail's 0.12em tracking would otherwise split it into "- >"). */
            .about-navlink::before {
              content: '->'; position: absolute; left: 0; top: 50%;
              font-size: 11px; line-height: 1; letter-spacing: 0; color: #CFCAB7;
              opacity: 0; transform: translate(-4px, -50%) scale(0.7);
              filter: url(#${railGrainId});
              transition: opacity 0.2s ${HOVER_EASE}, transform 0.2s ${HOVER_EASE};
            }
            .about-navlink:hover::before { opacity: 0.55; transform: translate(-2px, -50%) scale(0.85); }
            .about-navlink[data-active='true']::before { opacity: 1; transform: translate(0, -50%) scale(1); }
          `}</style>

          {compact ? (
            /* MOBILE — one scroll column, sections stacked (with anchors so the
               intro pointer links still jump between them). */
            <div
              ref={contentRef}
              style={{
                position: 'relative',
                zIndex: 1,
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                WebkitOverflowScrolling: 'touch',
                outline: 'none',
                // Clear the shared fixed nav (ArchiveNavBar) — same inset as index.
                paddingTop: 24 + ARCHIVE_NAV_CHROME_HEIGHT + 16,
              }}
            >
              <div style={{ maxWidth: 680, margin: '0 auto', padding: '26px 22px 8px' }}>
                {sections.map((s, i) => (
                  <div key={s.id}>
                    {i > 0 ? (
                      <div style={{ height: 1, background: inkA(0.1), margin: '30px 0' }} />
                    ) : null}
                    <section
                      id={`about-sec-${s.id}`}
                      data-section={s.id}
                      ref={(el) => {
                        sectionRefs.current[s.id] = el;
                      }}
                      className="about-fade"
                      style={{ animationDelay: `${0.05 + i * 0.08}s`, scrollMarginTop: sectionInset }}
                    >
                      {s.node}
                    </section>
                    {s.id === 'about' && (
                      <div className="about-fade" style={{ animationDelay: '0.13s' }}>{connectBlock}</div>
                    )}
                  </div>
                ))}
              </div>
              <div
                aria-hidden="true"
                style={{ display: 'flex', justifyContent: 'flex-end', padding: '32px 22px 26px' }}
              >
                <img
                  src="/wordmark-420.png"
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  style={{ height: 'clamp(90px, 26vw, 140px)', width: 'auto', opacity: 0.85, userSelect: 'none' }}
                />
              </div>
              <div className="about-fade" style={{ padding: '0 22px 32px', animationDelay: '0.2s' }}>
                {footerBlock}
              </div>
            </div>
          ) : (
            /* DESKTOP — left section-nav rail + ONE scrolling content column.
               The rail+content group is capped and centered so it sits in the
               middle of wide screens instead of hugging the left edge. */
            <div
              style={{
                position: 'relative',
                zIndex: 1,
                flex: 1,
                minHeight: 0,
                display: 'flex',
                width: '100%',
                maxWidth: 1100,
                margin: '0 auto',
              }}
            >
              {/* Left rail — sits where the index filter rail lives; its links
                  scroll the content to each section (scroll-spy highlights). */}
              <nav
                aria-label="About sections"
                style={{
                  flexShrink: 0,
                  width: FILTER_SIDEBAR_LEFT + FILTER_SIDEBAR_W,
                  paddingLeft: FILTER_SIDEBAR_LEFT,
                  paddingRight: 24,
                  paddingTop: FILTER_SIDEBAR_TOP,
                }}
              >
                <NavGrainFilter id={railGrainId} reduceMotion={reduceMotion} />
                {sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="about-navlink"
                    data-active={activeSection === s.id}
                    onClick={() => scrollToSection(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </nav>
              {/* Content — single column, scrolls. */}
              <div
                ref={contentRef}
                className="about-col"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: `${FILTER_SIDEBAR_TOP}px 40px 96px`,
                  // Chrome makes overflow:auto regions keyboard-focusable and
                  // paints a :focus-visible ring around them — suppress it.
                  outline: 'none',
                }}
              >
                <div style={{ maxWidth: 720 }}>
                  {sections.map((s, i) => (
                    <div key={s.id}>
                      <section
                        id={`about-sec-${s.id}`}
                        data-section={s.id}
                        ref={(el) => {
                          sectionRefs.current[s.id] = el;
                        }}
                        className="about-fade"
                        style={{
                          animationDelay: `${0.05 + i * 0.06}s`,
                          scrollMarginTop: sectionInset,
                          marginBottom: 44,
                        }}
                      >
                        {s.node}
                      </section>
                      {s.id === 'about' && (
                        <div className="about-fade" style={{ animationDelay: '0.11s', marginBottom: 44 }}>{connectBlock}</div>
                      )}
                    </div>
                  ))}
                  <div className="about-fade" style={{ animationDelay: '0.25s', paddingTop: 24, borderTop: `1px solid ${inkA(0.08)}` }}>
                    {footerBlock}
                  </div>
                </div>
              </div>
            </div>
          )}

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
      onClick={(e) => {
        onClick?.(e);
      }}
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
 * INDEX HOVER — 2×2 note grid
 *
 * Hovering INDEX reveals four small note images in a tight grid
 * beneath the tab (inactive blur / grain pass). EXPLORE uses the
 * older 3-card fan deck (see ExploreMenu below).
 * ───────────────────────────────────────────────────────── */
const INDEX_HOVER_GRID = {
  belowGap: 10, // px between the INDEX label and the grid
  cellW: 34,
  cellH: 40,
  gridGap: 5,
  closeDelayMs: 100, // grace so pointer travel never flickers closed
};

const INDEX_HOVER_IMAGES = [
  '/index-card-2.png',
  '/index-card-1.png',
  '/index-card-3.png',
  '/index-card-2.png',
];

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

/* ─────────────────────────────────────────────────────────
 * EXPLORE HOVER — 3-card fan deck
 *
 * The fan INDEX used to show: three small note images splay
 * beneath the tab on hover, with a springy back-out open and
 * a slight 3D tilt toward the cursor. Decorative peek only —
 * clicking EXPLORE still opens the explore view.
 * ───────────────────────────────────────────────────────── */
const EXPLORE_HOVER_FAN = {
  gap: 12, //           px below the EXPLORE button the fan hangs
  cardW: 56, //         px — paper-card width
  cardH: 62, //         px — paper-card height
  stagger: 0.05, //     s between cards fanning out
  exitStagger: 0.035, // s between cards collapsing back (reverse)
  open: { duration: 0.42, ease: [0.18, 0.89, 0.32, 1.27] },
  exit: { duration: 0.15, ease: [0.4, 0, 1, 1] },
  closeDelayMs: 100, // grace so pointer travel never flickers closed
  collapsed: { opacity: 0, x: 0, y: -8, rotate: -3, scale: 0.9 },
};

const EXPLORE_HOVER_ITEMS = [
  { img: '/index-card-1.png', fan: { x: -40, y: 14, rotate: -18 } },
  { img: '/index-card-2.png', fan: { x: 0, y: 0, rotate: -2 } },
  { img: '/index-card-3.png', fan: { x: 38, y: 14, rotate: 16 } },
];

const EXPLORE_FAN_TILT = {
  maxYaw: 15,
  maxPitch: 12,
  perspective: 460,
  lift: 1.06,
  spring: { stiffness: 260, damping: 20, mass: 0.5 },
};

/** One decorative card in the EXPLORE hover fan. */
function ExploreHoverFanCard({ item, i, count, reduceMotion, peekStyle }) {
  const yaw = useMotionValue(0);
  const pitch = useMotionValue(0);
  const rotateY = useSpring(yaw, EXPLORE_FAN_TILT.spring);
  const rotateX = useSpring(pitch, EXPLORE_FAN_TILT.spring);

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
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      yaw.set(nx * (EXPLORE_FAN_TILT.maxYaw * 2));
      pitch.set(-ny * (EXPLORE_FAN_TILT.maxPitch * 2));
    },
    [reduceMotion, yaw, pitch]
  );
  const resetTilt = useCallback(() => {
    yaw.set(0);
    pitch.set(0);
  }, [yaw, pitch]);

  return (
    <motion.div
      aria-hidden="true"
      onMouseMove={handleTilt}
      onMouseLeave={resetTilt}
      initial={reduceMotion ? { ...fanned, opacity: 0 } : EXPLORE_HOVER_FAN.collapsed}
      animate={fanned}
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0.12 } }
          : {
              ...EXPLORE_HOVER_FAN.collapsed,
              transition: {
                ...EXPLORE_HOVER_FAN.exit,
                delay: i * EXPLORE_HOVER_FAN.exitStagger,
              },
            }
      }
      transition={
        reduceMotion
          ? { duration: 0.16 }
          : { ...EXPLORE_HOVER_FAN.open, delay: (count - 1 - i) * EXPLORE_HOVER_FAN.stagger }
      }
      whileHover={reduceMotion ? undefined : { scale: EXPLORE_FAN_TILT.lift }}
      style={{
        position: 'absolute',
        top: EXPLORE_HOVER_FAN.gap,
        left: '50%',
        marginLeft: -EXPLORE_HOVER_FAN.cardW / 2,
        width: EXPLORE_HOVER_FAN.cardW,
        height: EXPLORE_HOVER_FAN.cardH,
        transformOrigin: 'top center',
        zIndex: 2,
        filter: 'drop-shadow(0 10px 16px rgba(0,0,0,0.4))',
        pointerEvents: 'auto',
      }}
    >
      <motion.div
        style={{
          width: '100%',
          height: '100%',
          rotateX,
          rotateY,
          transformPerspective: EXPLORE_FAN_TILT.perspective,
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
            // Same blur + grayscale + animated-grain peek as the INDEX grid /
            // ABOUT hover note, so the fanned notes read as degraded peeks.
            opacity: peekStyle.opacity,
            filter: peekStyle.filter,
          }}
        />
      </motion.div>
    </motion.div>
  );
}

/**
 * EXPLORE tab with a hover-revealed 3-card fan (the old INDEX deck).
 * Decorative peek only — the tab click still opens explore.
 */
function ExploreMenu({ view, onChange, aboutOpen = false }) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const peekStyle = useHoverPeekInactiveStyle();
  const count = EXPLORE_HOVER_ITEMS.length;

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
    closeTimer.current = setTimeout(() => setOpen(false), EXPLORE_HOVER_FAN.closeDelayMs);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  const fanW = EXPLORE_HOVER_FAN.cardW + Math.abs(EXPLORE_HOVER_ITEMS[0].fan.x) + EXPLORE_HOVER_ITEMS[2].fan.x;
  const fanH = EXPLORE_HOVER_FAN.gap + EXPLORE_HOVER_FAN.cardH + 18;

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
      {/* Dim while the About panel owns the nav so exactly one tab reads active. */}
      <ToggleButton active={!aboutOpen && view === 'explore'} onClick={() => onChange?.('explore')}>
        EXPLORE
      </ToggleButton>

      {/* Fan hangs BELOW the button (top: 100%) so this hover-bridge layer never
          covers the EXPLORE label — otherwise it would intercept the tab click. */}
      <div
        aria-hidden={!open}
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: fanW,
          height: fanH,
          zIndex: 220,
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <CardNoiseFilterDefs params={peekStyle.inactive} />
        <AnimatePresence>
          {open
            ? EXPLORE_HOVER_ITEMS.map((item, i) => (
                <ExploreHoverFanCard
                  key={item.img}
                  item={item}
                  i={i}
                  count={count}
                  reduceMotion={reduceMotion}
                  peekStyle={peekStyle}
                />
              ))
            : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * INDEX tab with a hover-revealed 2×2 grid of small note images.
 * Decorative peek only — the tab click still opens the grid.
 */
function IndexMenu({ view, onChange, aboutOpen = false }) {
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
    closeTimer.current = setTimeout(() => setOpen(false), INDEX_HOVER_GRID.closeDelayMs);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  const gridW = INDEX_HOVER_GRID.cellW * 2 + INDEX_HOVER_GRID.gridGap;
  const gridH = INDEX_HOVER_GRID.cellH * 2 + INDEX_HOVER_GRID.gridGap;

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
      {/* Dim while the About panel owns the nav so exactly one tab reads active. */}
      <ToggleButton active={!aboutOpen && view === 'grid'} onClick={() => onChange?.('grid')}>
        INDEX
      </ToggleButton>

      <div
        aria-hidden={!open}
        style={{
          position: 'absolute',
          top: `calc(100% + ${INDEX_HOVER_GRID.belowGap}px)`,
          left: 0,
          width: gridW,
          height: gridH,
          zIndex: 220,
          pointerEvents: 'none',
        }}
      >
        <CardNoiseFilterDefs params={peekStyle.inactive} />
        <AnimatePresence>
          {open ? (
            <motion.div
              key="index-hover-grid"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.22, ease: HOVER_EASE }}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(2, ${INDEX_HOVER_GRID.cellW}px)`,
                gridTemplateRows: `repeat(2, ${INDEX_HOVER_GRID.cellH}px)`,
                gap: INDEX_HOVER_GRID.gridGap,
                transformOrigin: 'top left',
              }}
            >
              {INDEX_HOVER_IMAGES.map((src, i) => (
                <motion.div
                  key={`index-hover-${i}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={{
                    duration: reduceMotion ? 0.12 : 0.2,
                    ease: HOVER_EASE,
                    delay: reduceMotion ? 0 : i * 0.04,
                  }}
                  style={{
                    width: INDEX_HOVER_GRID.cellW,
                    height: INDEX_HOVER_GRID.cellH,
                    overflow: 'hidden',
                    filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.35))',
                  }}
                >
                  <img
                    src={src}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      display: 'block',
                      opacity: peekStyle.opacity,
                      filter: peekStyle.filter,
                    }}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : null}
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

/** Floating dropdown surface for the facet menu (compact/phone bar only —
    desktop uses the sidebar accordions). Opens downward below the button since
    the phone filter bar docks at the top of the view. */
const facetMenuPanelStyle = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
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

/** Desktop grid filter rail — a left sidebar (search on top, then Category and
    Location accordions with checkbox lists). Phone widths keep the docked bar
    instead. Geometry lives here so the sidebar and the grid's matching left pad
    stay in sync. */
const FILTER_SIDEBAR_W = 200; //    px — rail width
const FILTER_SIDEBAR_LEFT = 32; //  px — inset from the view's left edge
const FILTER_SIDEBAR_TOP = 112; //  px — starts below the wordmark chrome
const FILTER_SIDEBAR_GAP = 40; //   px — clearance between rail and grid
// Entrance: the rail's rows (search → Category → Location) slide in one after
// another, starting just after the nav chrome has landed (see
// ARCHIVE_NAV_CHROME_DELAY_GRID) so the sidebar reads as a follow-on beat.
const FILTER_SIDEBAR_ENTER_DELAY = ARCHIVE_NAV_CHROME_DELAY_GRID + 0.15;
const FILTER_SIDEBAR_ENTER_STAGGER = 0.1;

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
function WallView({ confessions, sidebarInset = SIDEBAR_WIDTH, onExplore }) {
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
                      {formatCategoryLabel(c.category)}
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
        onExplore={onExplore}
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
 *   parked     tiles parked just off their nearest edge (hidden),
 *      ↓        pre-tilted a few degrees toward their travel direction
 *   flying     +80ms · fly to home, ease-out, 75ms stagger (row-by-row;
 *      ↓                columns alternate per row — see gridColumnOrder),
 *      ↓                each tile untilts (rotate → 0) as it settles
 *  settled     native scrolling restored
 * ───────────────────────────────────────────────────────── */
const GRID_ENTRANCE = {
  startDelay: 80, // ms before the first tile leaves its edge
  stagger: 0.075, // s between tiles, in reveal order (see gridColumnOrder)
  duration: 0.8, // s per tile fly-in
  ease: [0.17, 0.84, 0.44, 1], // ease-out (cubic-bezier): quick launch, gentle settle
  offscreenPad: 64, // px past the nearest edge so a tile parks fully hidden
  rotate: 8, // deg — parked tilt (signed by travel dir); unwinds to 0 on landing
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
const GRID_TILE_REST = { x: 0, y: 0, rot: 0, delay: 0 };

// Each target carries its own transition, so measuring→parked is instant
// (no fly-out) while parked→flying eases in. `custom` = { x, y, rot, delay } per tile.
const gridTileVariants = {
  measuring: { opacity: 0, x: 0, y: 0, rotate: 0, transition: { duration: 0 } },
  parked: (d) => ({ opacity: 1, x: d.x, y: d.y, rotate: d.rot, transition: { duration: 0 } }),
  flying: (d) => ({
    opacity: 1,
    x: 0,
    y: 0,
    rotate: 0,
    transition: { duration: GRID_ENTRANCE.duration, ease: GRID_ENTRANCE.ease, delay: d.delay },
  }),
  settled: { opacity: 1, x: 0, y: 0, rotate: 0, transition: { duration: 0 } },
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

/**
 * The grid tally's number, counted rather than swapped: applying a filter runs
 * 165 down to 40 in front of you, so the header reads as the archive re-counting
 * itself instead of cutting to a new figure. Any change tweens — narrowing the
 * set counts down, clearing filters counts back up.
 *
 * A fixed duration (not a spring) on the page's shared ease-out: a spring would
 * overshoot, and briefly showing 38 when the answer is 40 reads as a glitch in
 * something whose whole job is to be a correct count. The first value jumps
 * (the archive loads async, so animating that would count up from a placeholder)
 * and reduced motion always jumps.
 */
const COUNT_TWEEN = { durS: 0.55, ease };

function AnimatedCount({ value, reduceMotion }) {
  const [shown, setShown] = useState(value);
  // The tween starts from whatever is currently on screen, so a filter changed
  // mid-count continues from there instead of jumping back.
  const shownRef = useRef(value);
  shownRef.current = shown;
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current || reduceMotion) {
      firstRef.current = false;
      setShown(value);
      return undefined;
    }
    const controls = animate(shownRef.current, value, {
      duration: COUNT_TWEEN.durS,
      ease: COUNT_TWEEN.ease,
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, reduceMotion]);

  return shown;
}

/* ── ASCII grid lattice ────────────────────────────────────────────────
 * Contact-sheet hairlines drawn as monospace glyphs instead of 1px rules.
 * Each line gets a deterministic scramble from its key so the grid doesn't
 * reshuffle on re-render or filter changes. */

const LATTICE_ASCII = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+-=.:;!?';
const LATTICE_H_CHARS = 360;
const LATTICE_V_CHARS = 120;

function latticeAscii(key, count) {
  let t = 0;
  for (let i = 0; i < key.length; i++) t = (t * 31 + key.charCodeAt(i)) >>> 0;
  let out = '';
  for (let n = 0; n < count; n++) {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    const r = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    out += LATTICE_ASCII[Math.floor(r * LATTICE_ASCII.length)];
  }
  return out;
}

function GridView({
  confessions,
  sidebarInset = SIDEBAR_WIDTH,
  onOpenNote,
  /** Notifies the parent when the Lightbox opens/closes (so App can dim the top
   *  chrome to match the grid's own inactive-state recession). */
  onLightboxOpenChange,
  noteOpen = false,
  /** When true, skip the fly-in entrance (e.g. returning from dial → grid). */
  skipEntrance = false,
  onEntranceSettled,
  onExplore,
}) {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const reduceMotion = useReducedMotion();
  const playNote = useNoteSound();
  // Phone widths (≤760): the filter bar moves to the TOP and stacks (search
  // above the Category/Location tabs). On desktop it stays pinned to the
  // bottom with the search centred between the tabs.
  const compact = useArchiveNavCompact();
  // Live grid column count (3 / 2 / 1) — positions the lattice hairlines.
  const gridCols = useGridColumns();
  // Tiles whose image failed to load (file not yet on disk for that GlobalID).
  // We drop the whole tile rather than show a broken-image icon.
  const [failedIds, setFailedIds] = useState(() => new Set());
  // Tiles whose image has finished loading — until then a soft pulsing skeleton
  // fills the tile (notes stream in lazily, so this shows on both mobile + desktop).
  const [loadedIds, setLoadedIds] = useState(() => new Set());

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
  // Desktop sidebar accordions (Category / Location). Independent open/close,
  // collapsed by default so the rail stays compact until a facet is expanded.
  const [openSections, setOpenSections] = useState(() => new Set());
  const toggleSection = useCallback((id) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Sidebar entrance stagger — skipped when returning dial→grid (already
  // settled) or when the visitor prefers reduced motion; otherwise each row
  // (search, then the accordions) fades/slides in a beat after the nav chrome.
  const sidebarSkipEnter = reduceMotion || skipEntrance;
  const sidebarItemInitial = sidebarSkipEnter ? false : { opacity: 0, x: -10 };
  const sidebarEnterDelay = sidebarSkipEnter ? 0 : FILTER_SIDEBAR_ENTER_DELAY;
  const sidebarStagger = sidebarSkipEnter ? 0 : FILTER_SIDEBAR_ENTER_STAGGER;

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
    // Re-run across the compact↔desktop switch: the docked bar only mounts in
    // compact mode now, so barRef attaches (or detaches) when `compact` flips.
  }, [compact]);

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
        // Tilt is signed by travel direction so a tile swings in from its edge:
        // side-entering tiles lean off their x, top/bottom off their y.
        const dir = t.x !== 0 ? Math.sign(t.x) : t.y !== 0 ? Math.sign(t.y) : 1;
        offsets.set(t.id, {
          x: t.x,
          y: t.y,
          rot: dir * GRID_ENTRANCE.rotate,
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
    { id: 'recency', label: 'Recency', active: sortOrder != null },
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
  // When the Lightbox is open, the grid + chrome behind it recede into a muted
  // backdrop: the grid drops to its "inactive" image state (desaturated +
  // softened) and the surrounding chrome fades down. See the scroll container /
  // sidebar / count treatments below.
  const lightboxOpen = !!selected;
  // Bubble the open/close up so App can dim the top chrome in step; clear it on
  // unmount (e.g. switching views) so the chrome never stays stuck dimmed.
  useEffect(() => {
    onLightboxOpenChange?.(lightboxOpen);
    return () => onLightboxOpenChange?.(false);
  }, [lightboxOpen, onLightboxOpenChange]);
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
        glyphs: latticeAscii(`lattice-v${k}`, LATTICE_V_CHARS).split('').join('\n'),
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
        glyphs: latticeAscii(`lattice-h${m}`, LATTICE_H_CHARS),
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
        /* Contact-sheet lattice — monospace glyphs on their own layer
           (.grid-lattice), a sibling of the tiles rather than borders riding on
           each flying tile, so the grid can draw on independently. Each hairline
           is a seeded scramble of ASCII (see latticeAscii) that scales in from
           one end — same stagger as before, but the lines read as texture. */
        /* Fills the available width (rail + gutters aside) up to a generous cap,
           so wide monitors get a denser sheet rather than a fixed 1100px column
           floating with dead space. Column count steps up with the min-width
           queries below (kept in lockstep with useGridColumns for the lattice). */
        .grid-stack { position: relative; max-width: 2200px; margin: 0 auto; }
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
          overflow: hidden;
          color: rgba(207, 202, 183, 0.11);
        }
        .grid-lattice-glyphs {
          display: block;
          font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
          font-size: 8px;
          line-height: 1;
          letter-spacing: 0.06em;
          white-space: nowrap;
          pointer-events: none;
          user-select: none;
        }
        .grid-lattice-glyphs-v {
          white-space: pre;
          letter-spacing: 0;
          line-height: 0.92;
        }
        .grid-tile { box-sizing: border-box; transition: filter 0.4s ${HOVER_EASE}; }
        /* Loading skeleton — a faint warm fill that breathes until the note's
           image has decoded (tiles load lazily). Inset to the image box so it
           reads as the note materialising in place. */
        .grid-tile-loading {
          position: absolute;
          inset: ${TILE_PADDING}px;
          border-radius: 2px;
          background: rgba(207, 202, 183, 0.08);
          animation: gridTilePulse 1.5s ${HOVER_EASE} infinite;
          pointer-events: none;
          z-index: 0;
        }
        @keyframes gridTilePulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 1; }
        }
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
          .confession-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        /* Wide desktops: more columns so tiles fill the sheet without ballooning.
           Ordered widest-last so the 2040px rule wins when both match — mirrors
           useGridColumns() so the lattice hairlines stay pinned to cell edges. */
        @media (min-width: 1640px) {
          .confession-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
        @media (min-width: 2040px) {
          .confession-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
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
        /* Desktop filter sidebar (search + Category/Location accordions). */
        .facet-accordion-btn:hover { color: #EDE7D6; }
        .facet-checkbox-row:hover { color: #CFCAB7 !important; }
        .facet-checkbox-row:hover .facet-checkbox-box { border-color: rgba(207,202,183,0.7); }
        .filter-sidebar { scrollbar-width: none; }
        .filter-sidebar::-webkit-scrollbar { width: 0; height: 0; }
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
        /* At rest the note is clipped to its square cell. On hover the clip drops
           and the tile lifts over its neighbours so the cursor-float (see
           cursorFloat.js) can actually leave the cell — a note pinned inside its
           own box doesn't read as floating. */
        .grid-tile { overflow: hidden; }
        .grid-tile:hover { overflow: visible; z-index: 3; }
        /* --float-ms is swapped per pointer event: short while tracking the
           cursor so the lean stays attached, longer on enter/leave so the lift
           and the drop back both breathe. Lives here rather than inline so a
           re-render (a lazy image committing) can't reset it mid-hover. */
        .grid-tile img {
          transition: transform var(--float-ms, ${CURSOR_FLOAT.settleMs}ms) ${HOVER_EASE},
                      opacity 0.5s ${HOVER_EASE};
        }
        @media (prefers-reduced-motion: reduce) {
          .grid-tile-num, .grid-tile-cat { transition: none; }
          .grid-tile { transition: none; }
          .grid-tile img { transition: none; }
          .grid-tile-loading { animation: none; }
        }
      `}</style>

      {/* Compact (phone) filter bar docked at the top: transcript search + a row
          of filter tabs (Category · Location), each opening a dropdown of its own
          selectable values. The gradient masks tiles scrolling underneath;
          pointerEvents pass through the empty areas so the list still scrolls.
          Fades out with the tiles when a note opens (see GRID EXIT storyboard).
          Desktop routes these same controls into the left sidebar below. */}
      {compact ? (
      <motion.div
        ref={barRef}
        initial={false}
        animate={{ opacity: noteOpen ? 0 : lightboxOpen ? 0.12 : 1 }}
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
            // Mobile: stretch children full-width and left-align them so the
            // search + tally sit flush to the grid's edges (the desktop rail
            // model). Desktop keeps the centred row.
            alignItems: compact ? 'stretch' : 'center',
            gap: 12,
          }}
        >
          {/* Total tally, pinned above the search so the index announces its
              size at a glance (mobile only — desktop carries its own rail). Shows
              the whole archive normally; narrows to "shown / total" once a filter
              trims the set. */}
          <div
            aria-live="polite"
            style={{
              pointerEvents: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(207,202,183,0.5)',
              textAlign: 'left',
            }}
          >
            {anyFilterActive
              ? `${visible.length} / ${withImages.length} confessions`
              : `${withImages.length} confessions`}
          </div>

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
              // Mobile column: left-align so search + tabs sit flush left (like
              // the desktop rail); desktop row stays centred.
              alignItems: compact ? 'stretch' : 'center',
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
                justifyContent: compact ? 'flex-start' : 'flex-end',
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
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
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
              placeholder="SEARCH CONFESSIONS"
              aria-label="Search note transcripts"
              style={{
                pointerEvents: 'auto',
                order: 1,
                flex: '0 0 auto',
                width: '100%',
                // Full-bleed to the grid's edges — the bar's 16px inset matches
                // the tile scroller — so no centred 440px cap.
                maxWidth: 'none',
                // Keep the frosted tint fill + backdrop blur (grounds the field
                // over the notes scrolling beneath), but adopt the desktop rail's
                // dashed hairline + square corners so the two searches read as one.
                background: 'rgba(207,202,183,0.14)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px dashed rgba(207,202,183,0.3)',
                borderRadius: 0,
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
      ) : (
        /* Desktop: left filter rail — search on top, then Category and Location
           accordions, each expanding to a checkbox list of its values. Fixed
           beside the scrolling grid; fades out with the tiles on note-open. */
        <motion.aside
          aria-label="Filter notes"
          initial={false}
          animate={{ opacity: noteOpen ? 0 : lightboxOpen ? 0.12 : 1 }}
          transition={{
            duration: reduceMotion ? 0 : GRID_EXIT.barFade,
            ease: noteOpen ? GRID_EXIT.exitEase : GRID_EXIT.enterEase,
          }}
          className="filter-sidebar"
          style={{
            position: 'absolute',
            top: FILTER_SIDEBAR_TOP,
            left: FILTER_SIDEBAR_LEFT,
            bottom: 32,
            width: FILTER_SIDEBAR_W,
            zIndex: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            pointerEvents: noteOpen ? 'none' : 'auto',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <motion.input
            className="grid-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search confessions..."
            aria-label="Search note transcripts"
            initial={sidebarItemInitial}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.5, ease, delay: sidebarEnterDelay }}
            style={{
              flex: '0 0 auto',
              width: '100%',
              background: 'transparent',
              border: '1px dashed rgba(207,202,183,0.3)',
              borderRadius: 0,
              padding: '9px 16px',
              color: '#CFCAB7',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              letterSpacing: '0.04em',
              outline: 'none',
              transition: `border-color 0.2s ${HOVER_EASE}`,
            }}
          />

          {[
            { id: 'category', label: 'Category' },
            { id: 'location', label: 'Location' },
          ].map((f, idx) => {
            const isOpen = openSections.has(f.id);
            // Reuse the facet value rows; drop the "All …" reset — an empty
            // checkbox set already means "show everything".
            const opts = facetValues(f.id).filter((o) => o.key !== '__all');
            const activeCount = f.id === 'category' ? selectedCats.size : selectedLocs.size;
            return (
              <motion.div
                key={f.id}
                initial={sidebarItemInitial}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.5,
                  ease,
                  delay: sidebarEnterDelay + (idx + 1) * sidebarStagger,
                }}
                style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}
              >
                <button
                  type="button"
                  className="facet-accordion-btn"
                  aria-expanded={isOpen}
                  onClick={() => toggleSection(f.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    width: '100%',
                    padding: '6px 2px 8px',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid rgba(207,202,183,0.14)',
                    color: '#CFCAB7',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    fontWeight: 400,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {f.label}
                    {activeCount > 0 ? (
                      <span style={{ fontSize: 10, color: 'rgba(207,202,183,0.5)' }}>({activeCount})</span>
                    ) : null}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      fontSize: 9,
                      opacity: 0.7,
                      transform: isOpen ? 'none' : 'rotate(-90deg)',
                      transition: 'transform 0.18s ease',
                    }}
                  >
                    ▼
                  </span>
                </button>

                {isOpen ? (
                  <div
                    role="group"
                    aria-label={f.label}
                    style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 6 }}
                  >
                    {opts.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={opt.on}
                        className="facet-checkbox-row"
                        onClick={opt.onClick}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          width: '100%',
                          padding: '7px 2px',
                          background: 'none',
                          border: 'none',
                          color: opt.on ? INK : inkA(0.7),
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="facet-checkbox-box"
                          style={{
                            width: 13,
                            height: 13,
                            flex: '0 0 auto',
                            borderRadius: 2,
                            border: `1px solid ${
                              opt.on ? 'rgba(207,202,183,0.9)' : 'rgba(207,202,183,0.4)'
                            }`,
                            background: opt.on ? '#CFCAB7' : 'transparent',
                            transition: `border-color 0.18s ${HOVER_EASE}, background 0.18s ${HOVER_EASE}`,
                          }}
                        />
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {opt.label}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </motion.div>
            );
          })}
        </motion.aside>
      )}

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
          // leave the bottom light. Desktop: clear the left filter rail so tiles
          // never sit under it, and mirror it with a matching right gutter.
          padding: compact
            ? `${barH + 16}px 16px 56px`
            : `112px 48px 64px ${FILTER_SIDEBAR_LEFT + FILTER_SIDEBAR_W + FILTER_SIDEBAR_GAP}px`,
          // Lightbox open → the whole grid recedes into its inactive image
          // state (desaturated + softened + dimmed) so the focused note reads
          // as the only live thing. Eased so it settles as the Lightbox fades in.
          filter: lightboxOpen ? 'grayscale(1) blur(3px)' : 'none',
          opacity: lightboxOpen ? 0.5 : 1,
          transition: `filter 0.32s ${HOVER_EASE}, opacity 0.32s ${HOVER_EASE}`,
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
                  ...LINK_UNDERLINE,
                  cursor: 'pointer',
                }}
              >
                Clear all filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid-stack">
            {/* Count header — "N Confessions" pinned to the grid's top-left,
                floating in the band just above the first row. Absolutely placed
                inside grid-stack (bottom: calc(100% + …)) so it locks to the
                grid's left edge on every breakpoint and never shifts the tiles.
                Fades in with the tile labels once the entrance settles, and out
                with the grid when a note opens. Desktop only — the mobile bar is
                docked at the top, so there's no room for a header there. */}
            {!compact && (
              <motion.div
                className="grid-count"
                initial={false}
                animate={{ opacity: noteOpen ? 0 : entranceStage === 'settled' ? 1 : 0 }}
                transition={{
                  duration: reduceMotion ? 0 : noteOpen ? GRID_EXIT.fadeOut : 0.5,
                  ease: noteOpen ? GRID_EXIT.exitEase : GRID_EXIT.enterEase,
                }}
                style={{
                  position: 'absolute',
                  left: 0,
                  bottom: 'calc(100% + 14px)',
                  zIndex: 2,
                  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                  fontSize: 13,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    color: 'rgba(255,255,255,0.92)',
                    // Equal digit advance, so the count doesn't wobble as it runs.
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <AnimatedCount value={noteCount} reduceMotion={reduceMotion} />
                </span>
                {/* The noun follows the settled count, not the tweening one, so
                    it doesn't flicker to "Confession" while passing through 1. */}
                <span style={{ color: 'rgba(255,255,255,0.92)' }}>
                  {` ${noteCount === 1 ? 'Confession' : 'Confessions'}`}
                </span>
              </motion.div>
            )}
            {/* Lattice layer — ASCII hairlines drawn on independently of the
                tiles. Each line is a seeded scramble of mono glyphs pinned to a
                cell edge; it draws on by scaling from one end (top→down for
                verticals, left→right for horizontals), staggered after the notes
                land. */}
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
                        ? { top: 0, left: ln.main, width: '0.72em', height: `${ln.lenPct}%` }
                        : { left: 0, top: ln.main, height: '0.92em', width: `${ln.lenPct}%` }),
                    }}
                    initial={v ? { scaleY: reduceMotion ? 1 : 0 } : { scaleX: reduceMotion ? 1 : 0 }}
                    animate={v ? { scaleY: latticeDrawn ? 1 : 0 } : { scaleX: latticeDrawn ? 1 : 0 }}
                    transition={
                      latticeDrawn && !reduceMotion && !skipEntrance
                        ? { duration: 0.6, ease: GRID_ENTRANCE.ease, delay: ln.delay }
                        : { duration: 0 }
                    }
                  >
                    <span
                      className={`grid-lattice-glyphs${v ? ' grid-lattice-glyphs-v' : ''}`}
                      aria-hidden="true"
                    >
                      {ln.glyphs}
                    </span>
                  </motion.div>
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
              const loaded = loadedIds.has(c.id);
              // Resting paper skew, alternating per tile so a run of hovered
              // notes doesn't all lean the same way.
              const paperRotate = i % 2 === 0 ? -2 : 2;
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
                  // Post-it "peel" as the note opens.
                  playNote();
                  // Mobile (no filter): open the vertical note-scroll view — the
                  // note enlarges with its metadata and you swipe up/down through
                  // the rest (NoteOpenView → VerticalConfessionStack). Desktop, a
                  // live filter, or a missing handler falls back to the Lightbox
                  // (a "search / compare" task where the quick zoom is faster).
                  if (!compact || anyFilterActive || !onOpenNote) {
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
                  // overflow lives in .grid-tile so :hover can unclip it — an
                  // inline value would win over the stylesheet.
                  cursor: 'pointer',
                }}
              >
                {!loaded ? <span aria-hidden="true" className="grid-tile-loading" /> : null}
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
                  onLoad={() =>
                    setLoadedIds((s) => {
                      if (s.has(c.id)) return s;
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
                    // Fade the note in once its image decodes; the skeleton
                    // (rendered above) unmounts on the same load, handing off.
                    opacity: loaded ? 1 : 0,
                    // At rest the tile is full colour — no grayscale. The noise +
                    // displacement warp is applied on hover only.
                    // Filter isn't transitioned: swapping to/from the url() noise
                    // filter can't interpolate, so we apply it crisply on hover.
                    // transform / transition live in .grid-tile img (CSS) so the
                    // float can be written imperatively without React clobbering it.
                  }}
                  onMouseEnter={(e) => {
                    // The note lifts off the grid and starts leaning toward the
                    // cursor. The noise + displacement warp switches on here (and
                    // only here) to focus the hovered note — it's a static filter
                    // swap, so it stays on under reduced motion; the lift doesn't.
                    e.currentTarget.style.filter = GRID_IMAGE_FILTER;
                    if (!reduceMotion) applyGridFloat(e, paperRotate, CURSOR_FLOAT.settleMs);
                  }}
                  onMouseMove={
                    reduceMotion
                      ? undefined
                      : (e) => applyGridFloat(e, paperRotate, CURSOR_FLOAT.trackMs)
                  }
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.setProperty('--float-ms', `${CURSOR_FLOAT.settleMs}ms`);
                    el.style.transform = '';
                    el.style.filter = 'none';
                  }}
                />
                <span className="grid-tile-num" style={{ opacity: settled ? 1 : 0 }}>
                  {c.id}
                </span>
                {c.category ? (
                  <span className="grid-tile-cat" style={{ opacity: settled ? 1 : 0 }}>
                    {formatCategoryLabel(c.category)}
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
        onExplore={onExplore}
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
// Shared <filter> id for the Lightbox nav arrows' animated grain "boil" (same
// feTurbulence + feDisplacementMap as the note-stack A / D glyphs). Only one
// Lightbox is ever mounted, so a constant id is safe (no clobbering).
const LB_ARROW_GRAIN_ID = 'lb-arrow-grain';

/**
 * The frame every previewed note is displayed inside — a constant box, not a
 * per-image limit.
 *
 * The notes are all 1600px wide but run from 800 to 2046 tall (0.78–2.0 aspect),
 * so sizing the layout to each image swung the column's height by ~200px: a
 * 2.0-aspect note rendered 720x360 where a portrait one rendered 437x560. Since
 * the column is vertically centred, that moved the metadata above and the
 * transcript below on every note. Holding the frame constant and containing the
 * image inside it keeps both pinned while each note still displays as large as
 * its shape allows.
 */
const PREVIEW_FRAME = { w: 'min(90vw, 720px)', h: 'min(62vh, 560px)' };

function Lightbox({ confession, onClose, onPrev, onNext, onExplore }) {
  const reduceMotion = useReducedMotion();
  const compact = useArchiveNavCompact();
  const open = !!confession;
  const canNav = !!(onPrev || onNext);

  // Drives the top nav legend's pressed-key highlight (see DialNavHint). Set on
  // keydown / button press, cleared on keyup / release — same wiring as the
  // full-screen note-open view so the two surfaces feel identical.
  const [pressedNavKey, setPressedNavKey] = useState(null);
  const runNav = useCallback(
    (id) => {
      if (id === 'esc') onClose?.();
      else if (id === 'left') onPrev?.();
      else if (id === 'right') onNext?.();
    },
    [onClose, onPrev, onNext]
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

  // ESC closes; ← / → (or A / D) step through notes (the legend shows the arrows).
  useEffect(() => {
    if (!open) return;
    const keyToId = {
      Escape: 'esc',
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
    };
    const onKeyDown = (e) => {
      const id = keyToId[e.key];
      if (!id) return;
      // Don't hijack A / D (or arrows) while typing in a field.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
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
  }, [open, runNav]);

  const easeOut = [0.165, 0.84, 0.44, 1];

  // Backdrop just fades — the veil is textured with film grain (below) rather
  // than blurred, so there's no backdropFilter to animate.
  const backdropMotion = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
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
    ['THEME', confession?.category ? confession.category.toUpperCase() : null, 'theme'],
  ].filter(([, v]) => v);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="lightbox-backdrop"
          {...backdropMotion}
          transition={{ duration: 0.24, ease: easeOut }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            // Dark veil over the (already desaturated + softened) grid so the
            // focused note preview pops. `isolation` scopes the film-grain's
            // mix-blend to this layer.
            background: 'rgba(8, 8, 10, 0.72)',
            isolation: 'isolate',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            padding: 24,
            overflowY: 'auto',
          }}
        >
          {/* Film grain over the veil — same DialKit "Grain" as the rest of the
              site, standing in for the removed backdrop blur. */}
          <TunableGrainBackground />

          {/* Top-centre keyboard legend — the same ← / → flip keys as the
              full-screen note view. Only shown when there's more than one note
              to page through. pointer-events are none on the wrap (so blank-area
              clicks still dismiss); the legend's own buttons opt back in, and we
              stop their clicks from bubbling to the backdrop's close handler. */}
          {canNav && !compact && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.4, ease: easeOut, delay: reduceMotion ? 0 : 0.06 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 24,
                left: 0,
                right: 0,
                zIndex: 2,
                display: 'flex',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <DialNavHint
                pressedKey={pressedNavKey}
                onPress={handleNavPress}
                onRelease={handleNavRelease}
                style={{ position: 'static', bottom: 'auto', left: 'auto', transform: 'none' }}
                grainArrows
                showExit={false}
              />
            </motion.div>
          )}

          <div
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              // Tight gap between the metadata (above) / transcription (below)
              // and the image so the note reads as one grouped unit.
              gap: 10,
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
                  // Match the transcription block's width below.
                  maxWidth: 'min(88vw, 560px)',
                }}
              >
                {metaRows.map(([label, value, kind]) => (
                  <div
                    key={label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      alignItems: 'baseline',
                      columnGap: 0,
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
                    {kind === 'theme' && onExplore ? (
                      <button
                        type="button"
                        title="Explore notes in this category"
                        onClick={(e) => { e.stopPropagation(); onExplore(confession.category); }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          margin: 0,
                          font: 'inherit',
                          color: 'inherit',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: TRANSCRIPTION_FONT_SIZE,
                            letterSpacing: '0.02em',
                            lineHeight: 1.45,
                            color: 'rgba(207,202,183,0.85)',
                            ...LINK_UNDERLINE,
                          }}
                        >
                          {value}
                        </span>
                      </button>
                    ) : (
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: TRANSCRIPTION_FONT_SIZE,
                          letterSpacing: '0.02em',
                          lineHeight: 1.45,
                          color: 'rgba(207,202,183,0.85)',
                        }}
                      >
                        {value}
                      </span>
                    )}
                  </div>
                ))}
              </motion.div>
            ) : null}

            {/* Constant frame (see PREVIEW_FRAME). The tilt wrapper inside still
                hugs the image itself, so the hover float pivots on the note
                rather than on the frame's empty margins. */}
            <div
              style={{
                width: PREVIEW_FRAME.w,
                height: PREVIEW_FRAME.h,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <motion.div
                key="lightbox-img"
                {...imageMotion}
                transition={{ duration: 0.24, ease: easeOut, exit: { duration: 0.18 } }}
                onClick={onClose}
                onMouseEnter={reduceMotion ? undefined : (e) => {
                  const el = e.currentTarget;
                  const F = CURSOR_FLOAT;
                  el.style.setProperty('--float-ms', '420ms');
                  const off = cursorOffset(el, e.clientX, e.clientY);
                  if (!off) return;
                  const { yaw, pitch } = floatAngles(off.nx, off.ny);
                  el.style.transform =
                    `perspective(${F.perspective}px) rotateX(${pitch.toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg) translateZ(${F.rise}px) scale(1.05)`;
                }}
                onMouseMove={reduceMotion ? undefined : (e) => {
                  const el = e.currentTarget;
                  const F = CURSOR_FLOAT;
                  el.style.setProperty('--float-ms', '160ms');
                  const off = cursorOffset(el, e.clientX, e.clientY);
                  if (!off) return;
                  const { yaw, pitch } = floatAngles(off.nx, off.ny);
                  el.style.transform =
                    `perspective(${F.perspective}px) rotateX(${pitch.toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg) translateZ(${F.rise}px) scale(1.05)`;
                }}
                onMouseLeave={reduceMotion ? undefined : (e) => {
                  const el = e.currentTarget;
                  el.style.setProperty('--float-ms', '420ms');
                  el.style.transform = '';
                }}
                style={{
                  display: 'inline-block',
                  cursor: 'zoom-out',
                  willChange: 'transform, opacity',
                  transition: 'transform var(--float-ms, 420ms) cubic-bezier(0.165,0.84,0.44,1)',
                }}
              >
                <img
                  src={confession.image}
                  alt={`Confession ${confession.id}`}
                  draggable={false}
                  style={{
                    // Absolute rather than 100%: the wrapper shrink-wraps the
                    // image, so a percentage here would have nothing to resolve
                    // against. Every source is 1600px wide, well past the cap, so
                    // each note lands exactly on one edge of the frame.
                    maxWidth: PREVIEW_FRAME.w,
                    maxHeight: PREVIEW_FRAME.h,
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              </motion.div>
            </div>

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
              {/* Animated grain "boil" for the arrow strokes — the same
                  feTurbulence + feDisplacementMap filter the note-stack A / D
                  glyphs use, so the arrows dissolve into noise the same way. */}
              <NavGrainFilter id={LB_ARROW_GRAIN_ID} reduceMotion={reduceMotion} />
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
                  overflow: hidden;
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
                  style={{ position: 'relative', zIndex: 1, filter: `url(#${LB_ARROW_GRAIN_ID})` }}
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
                  style={{ position: 'relative', zIndex: 1, filter: `url(#${LB_ARROW_GRAIN_ID})` }}
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
    ['Theme', confession?.category ? formatCategoryLabel(confession.category) : null],
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

/* ─────────────────────────────────────────────────────────
 * EXPERIMENT — notes outline a rectangle around the page
 *
 * The thumbnails are placed in RING ORDER (outermost ring first, then
 * inward), so they trace a rectangular outline hugging the edges of the
 * content area — a frame around the site with a large empty middle. When a
 * filter narrows the set to fewer notes than one ring, they're spaced evenly
 * around the perimeter so it still reads as a rectangle. Hovering a thumbnail
 * enlarges that note (+ metadata) in the center stage; the stage carries ‹ ›
 * arrows (and ← / → keys) to page between notes like the INDEX lightbox. A
 * category filter rail sits on the left.
 * ───────────────────────────────────────────────────────── */
const EXP_GAP = 6; //       px between thumbnails
const EXP_MAX_CELL = 40; // px — thumbnail size ceiling (bigger screens → bigger tiles)
const EXP_MIN_CELL = 22; // px — floor before we thicken the ring inward instead of shrinking
const EXP_RAIL_W = 150; //  px — left category-filter rail width

/** Cells of a cols×rows grid in concentric-ring order (outermost ring first,
 *  each ring walked clockwise). Placing notes in this order traces a filled
 *  rectangular outline that thickens inward as the note count grows. */
function expRingOrder(cols, rows) {
  const cells = [];
  let top = 0;
  let left = 0;
  let bottom = rows - 1;
  let right = cols - 1;
  while (top <= bottom && left <= right) {
    if (top === bottom) {
      for (let c = left; c <= right; c += 1) cells.push([top, c]);
    } else if (left === right) {
      for (let r = top; r <= bottom; r += 1) cells.push([r, left]);
    } else {
      for (let c = left; c <= right; c += 1) cells.push([top, c]);
      for (let r = top + 1; r <= bottom; r += 1) cells.push([r, right]);
      for (let c = right - 1; c >= left; c -= 1) cells.push([bottom, c]);
      for (let r = bottom - 1; r > top; r -= 1) cells.push([r, left]);
    }
    top += 1;
    left += 1;
    bottom -= 1;
    right -= 1;
  }
  return cells;
}

const expLabelStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(207,202,183,0.4)',
};
const expValueStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.02em',
  color: 'rgba(207,202,183,0.85)',
};

/** Metadata caption under the enlarged note (NOTE # / DATE / LOCATION / THEME
 *  + a two-line transcript peek). */
function ExperimentCaption({ note }) {
  const m = note.metadata || {};
  const rows = [
    ['DATE', m.date],
    ['LOCATION', m.location],
    ['THEME', note.category ? formatCategoryLabel(note.category) : ''],
  ];
  const transcription = (note.transcription || '').trim();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '0 0 auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={expLabelStyle}>NOTE</span>
          <span style={expValueStyle}>{String(note.id)}</span>
        </div>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <span style={expLabelStyle}>{label}</span>
            <span style={expValueStyle}>{value || '—'}</span>
          </div>
        ))}
      </div>
      {transcription ? (
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            lineHeight: 1.5,
            color: 'rgba(207,202,183,0.6)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {transcription}
        </p>
      ) : null}
    </div>
  );
}

/** The center stage: an empty grey square by default; the current note
 *  (enlarged image + caption) crossfades in over it, flanked by ‹ › arrows. */
function ExperimentStage({ note, reduceMotion, onPrev, onNext, canNav }) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Base layer: the empty grey square (pic 2) — always present so it shows
          through as the note crossfades out. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(207,202,183,0.05)',
          border: '1px solid rgba(207,202,183,0.16)',
        }}
      />
      <AnimatePresence>
        {note ? (
          <motion.div
            key={note.id}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.26, ease }}
            style={{
              position: 'absolute',
              inset: 0,
              background: '#111',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 16,
            }}
          >
            <div
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={note.image}
                alt={`Note ${note.id}`}
                draggable={false}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  display: 'block',
                  boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
                }}
              />
            </div>
            <ExperimentCaption note={note} />
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease }}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                ...expLabelStyle,
                color: 'rgba(207,202,183,0.28)',
                letterSpacing: '0.2em',
              }}
            >
              Hover a note
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Paging arrows — flank the stage (INDEX-lightbox parity). Shown only when
          a note is up and there's more than one to page through. */}
      {note && canNav ? (
        <>
          <button
            type="button"
            className="exp-arrow"
            aria-label="Previous note"
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            style={{ left: -14, transform: 'translate(-100%, -50%)' }}
          >
            ‹
          </button>
          <button
            type="button"
            className="exp-arrow"
            aria-label="Next note"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            style={{ right: -14, transform: 'translate(100%, -50%)' }}
          >
            ›
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * CUBE tab — every note mapped onto the six faces of a rotating 3D cube
 * (total / 6 per face). Drag to spin it; it idles with a slow auto-rotate.
 * Clicking a note opens the same close-up Lightbox the INDEX grid uses, with
 * ← / → stepping through the whole set (wrapping at the ends).
 *
 * The heavy three.js scene lives in CubeScene.jsx (no App import → no cycle);
 * this wrapper just owns the data + the shared Lightbox.
 */
function CubeView({ confessions, onExplore }) {
  const notes = useMemo(
    () => confessions.filter((c) => c.image),
    [confessions]
  );
  const [selected, setSelected] = useState(null);

  const step = useCallback(
    (dir) => {
      setSelected((cur) => {
        if (!cur || notes.length === 0) return cur;
        const i = notes.findIndex((n) => n.id === cur.id);
        if (i < 0) return cur;
        return notes[(i + dir + notes.length) % notes.length];
      });
    },
    [notes]
  );

  return (
    <motion.div
      key="cube"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease }}
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'radial-gradient(circle at 50% 42%, #18160f 0%, #0c0b09 58%, #070706 100%)',
        overflow: 'hidden',
      }}
    >
      {notes.length > 0 ? (
        <CubeScene notes={notes} onSelect={setSelected} />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'rgba(207,202,183,0.55)',
          }}
        >
          Loading the archive…
        </div>
      )}

      {/* Interaction hint, bottom-center — fades with the view. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 26,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'rgba(207,202,183,0.42)',
          whiteSpace: 'nowrap',
        }}
      >
        drag to rotate · click a note
      </div>

      <Lightbox
        confession={selected}
        onClose={() => setSelected(null)}
        onPrev={notes.length > 1 ? () => step(-1) : undefined}
        onNext={notes.length > 1 ? () => step(1) : undefined}
        onExplore={onExplore}
      />
    </motion.div>
  );
}

function ExperimentView({ confessions }) {
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [current, setCurrent] = useState(null);
  const [failedIds, setFailedIds] = useState(() => new Set());
  const [activeCat, setActiveCat] = useState(null);

  const withImages = useMemo(
    () => confessions.filter((c) => c.image && !failedIds.has(c.id)),
    [confessions, failedIds]
  );
  const categories = useMemo(
    () => deriveEmotions(withImages).map((e) => e.label),
    [withImages]
  );
  const notes = useMemo(
    () =>
      activeCat ? withImages.filter((c) => c.category === activeCat) : withImages,
    [withImages, activeCat]
  );

  // Drop the current note if a filter change removes it from the set.
  useEffect(() => {
    if (current && !notes.some((n) => n.id === current.id)) setCurrent(null);
  }, [notes, current]);

  // Measure the framed content area (right of the filter rail).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Size tiles so the notes form a DENSE, one-tile-thick rectangle hugging the
  // content-area edges: pick the LARGEST cell (≤ ceiling) whose single outer
  // ring can seat every note. If even the smallest cell can't (a big corpus on
  // a small screen), we stop at the floor and `placed` thickens the ring inward.
  const layout = useMemo(() => {
    const { w, h } = box;
    const N = notes.length;
    if (!w || !h || N === 0) return null;
    let chosen = null;
    for (let cell = EXP_MAX_CELL; cell >= EXP_MIN_CELL; cell -= 1) {
      const step = cell + EXP_GAP;
      const cols = Math.max(3, Math.floor((w + EXP_GAP) / step));
      const rows = Math.max(3, Math.floor((h + EXP_GAP) / step));
      const perim = cols > 1 && rows > 1 ? 2 * cols + 2 * rows - 4 : cols * rows;
      chosen = { cell, cols, rows };
      if (perim >= N) break;
    }
    return chosen;
  }, [box, notes.length]);

  // Place notes ring-by-ring → a rectangular outline that thickens inward.
  // Complete outer rings are filled solid; the first ring that can't be filled
  // gets its notes spaced EVENLY around it, so the frame stays balanced (never
  // top-heavy) whether it's the full corpus or a small filtered subset.
  const placed = useMemo(() => {
    if (!layout) return [];
    const { cols, rows } = layout;
    const cells = expRingOrder(cols, rows);
    if (cells.length === 0 || notes.length === 0) return [];

    // Slice `cells` into concentric rings and record each ring's [start, len].
    const rings = [];
    let offset = 0;
    let cc = cols;
    let rr = rows;
    while (cc > 0 && rr > 0) {
      const len = rr === 1 ? cc : cc === 1 ? rr : 2 * cc + 2 * rr - 4;
      rings.push([offset, len]);
      offset += len;
      cc -= 2;
      rr -= 2;
    }

    const out = [];
    let remaining = notes.length;
    let ni = 0;
    for (const [start, len] of rings) {
      if (remaining <= 0) break;
      if (remaining >= len) {
        for (let j = 0; j < len; j += 1) {
          const [r, c] = cells[start + j];
          out.push({ note: notes[ni], r, c });
          ni += 1;
        }
        remaining -= len;
      } else {
        for (let j = 0; j < remaining; j += 1) {
          const [r, c] = cells[start + Math.floor((j * len) / remaining)];
          out.push({ note: notes[ni], r, c });
          ni += 1;
        }
        remaining = 0;
      }
    }
    return out;
  }, [layout, notes]);

  // Page through the (filtered) notes, wrapping at the ends — INDEX parity.
  const goRelative = useCallback(
    (dir) => {
      setCurrent((cur) => {
        const n = notes.length;
        if (n === 0) return cur;
        if (!cur) return notes[dir > 0 ? 0 : n - 1];
        const idx = notes.findIndex((c) => c.id === cur.id);
        if (idx < 0) return notes[0];
        return notes[(idx + dir + n) % n];
      });
    },
    [notes]
  );

  // ← / → step through notes while one is open; ESC returns to the empty stage.
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
        return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goRelative(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goRelative(1);
      } else if (e.key === 'Escape') {
        setCurrent(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, goRelative]);

  const stageSize =
    box.w && box.h
      ? Math.round(Math.max(300, Math.min(520, box.w * 0.4, box.h * 0.52)))
      : 420;
  const canNav = notes.length > 1;

  return (
    <motion.div
      key="experiment"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease }}
      style={{ position: 'absolute', inset: 0, background: '#111' }}
    >
      <style>{`
        .exp-arrow{position:absolute;top:50%;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;padding:0 0 3px;border:1px solid rgba(207,202,183,0.18);border-radius:50%;background:rgba(17,17,17,0.55);color:#CFCAB7;font-family:var(--font-mono);font-size:22px;line-height:1;cursor:pointer;opacity:0.72;transition:opacity .18s ${HOVER_EASE},background .18s ${HOVER_EASE};z-index:6;}
        .exp-arrow:hover{opacity:1;background:rgba(207,202,183,0.14);}
        .exp-cat{display:block;width:100%;text-align:left;background:none;border:none;padding:5px 0;font-family:var(--font-mono);font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:rgba(207,202,183,0.5);cursor:pointer;transition:color .18s ${HOVER_EASE};}
        .exp-cat:hover{color:rgba(207,202,183,0.85);}
        .exp-cat.is-active{color:#CFCAB7;${LINK_UNDERLINE_CSS}}
      `}</style>

      {/* Left category-filter rail — single-select (click again to clear). */}
      {categories.length > 1 ? (
        <div
          style={{
            position: 'absolute',
            left: 24,
            top: 112,
            bottom: 24,
            width: EXP_RAIL_W,
            zIndex: 8,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ ...expLabelStyle, color: 'rgba(207,202,183,0.4)', marginBottom: 8 }}>
            Category
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingRight: 4 }}>
            <button
              type="button"
              className={`exp-cat${activeCat == null ? ' is-active' : ''}`}
              onClick={() => setActiveCat(null)}
            >
              All
            </button>
            {categories.map((label) => (
              <button
                key={label}
                type="button"
                className={`exp-cat${activeCat === label ? ' is-active' : ''}`}
                onClick={() => setActiveCat((cur) => (cur === label ? null : label))}
              >
                {formatCategoryLabel(label)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Framed content area (right of the rail): the note-outline + center stage.
          Leaving this area returns the stage to the empty square; moving between
          a thumbnail and the stage/arrows keeps the current note up. */}
      <div
        ref={wrapRef}
        onMouseLeave={() => setCurrent(null)}
        style={{
          position: 'absolute',
          top: 84, //   clear the fixed wordmark + INDEX/EXPLORE/EXPERIMENT/ABOUT nav
          left: 24 + EXP_RAIL_W + 24,
          right: 24,
          bottom: 24,
          overflow: 'hidden',
        }}
      >
        {layout ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              gridTemplateColumns: `repeat(${layout.cols}, ${layout.cell}px)`,
              gridTemplateRows: `repeat(${layout.rows}, ${layout.cell}px)`,
              gap: EXP_GAP,
              justifyContent: 'center',
              alignContent: 'center',
            }}
          >
            {placed.map(({ note, r, c }) => {
              const isCurrent = current && current.id === note.id;
              const dim = current && !isCurrent;
              return (
                <button
                  key={note.id}
                  type="button"
                  onMouseEnter={() => setCurrent(note)}
                  onFocus={() => setCurrent(note)}
                  onClick={() => setCurrent(note)}
                  aria-label={`Preview note ${note.id}`}
                  style={{
                    gridColumn: c + 1,
                    gridRow: r + 1,
                    padding: 0,
                    margin: 0,
                    border: 'none',
                    background: 'transparent',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <img
                    src={note.image}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    loading="eager"
                    decoding="async"
                    onError={() =>
                      setFailedIds((s) => {
                        const next = new Set(s);
                        next.add(note.id);
                        return next;
                      })
                    }
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      display: 'block',
                      opacity: dim ? 0.4 : 0.92,
                      transform: isCurrent ? 'scale(1.1)' : 'scale(1)',
                      transition: `opacity 0.22s ${HOVER_EASE}, transform 0.22s ${HOVER_EASE}`,
                    }}
                  />
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Center stage floats in the empty middle of the outline. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'relative', width: stageSize, height: stageSize, pointerEvents: 'auto' }}>
            <ExperimentStage
              note={current}
              reduceMotion={reduceMotion}
              canNav={canNav}
              onPrev={() => goRelative(-1)}
              onNext={() => goRelative(1)}
            />
          </div>
        </div>
      </div>
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
  // Mirrors GridView's Lightbox open state so the top chrome (wordmark + nav)
  // can recede while a note is focused in the Lightbox — the grid itself dims
  // via GridView, and this dims the surrounding chrome to match.
  const [gridLightboxOpen, setGridLightboxOpen] = useState(false);
  // Mobile grid tap opens the vertical note-scroll view as a full-screen overlay
  // (NoteOpenView). `{ confession, rect }`; null when closed. Desktop grid taps
  // use the Lightbox instead (see GridView tile onClick).
  const [openNote, setOpenNote] = useState(null);
  const handleExplore = useCallback(() => setView('explore'), []);
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
      <ArchiveNavGradientWash zIndex={aboutOpen ? 1010 : 150} />
      {/* Top chrome (wordmark + INDEX/EXPLORE/ABOUT). Stays fixed in place when
          About opens — elevated above the panel so it never re-mounts or jumps.
          Recedes while the grid Lightbox is open. */}
      <motion.div
        initial={false}
        animate={{ opacity: gridLightboxOpen ? 0.22 : 1 }}
        transition={{ duration: 0.32, ease }}
      >
        <ArchiveNavBar
          compactNav={compactNav}
          entranceDelay={navChromeEntranceDelay}
          onReturnToIntro={onReturnToIntro}
          view={view}
          onViewChange={setView}
          aboutOpen={aboutOpen}
          onAboutOpen={() => setAboutOpen(true)}
          onAboutClose={() => setAboutOpen(false)}
          zIndex={aboutOpen ? 1010 : 200}
        />
      </motion.div>
      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        confessions={confessions}
      />

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
        ) : view === 'explore' ? (
          /* EXPLORE tab — the immersive note browser (horizontal coverflow +
             left theme dial + A/D flip + date/location + transcription), the
             same experience NoteOpenView renders as a grid-click overlay, but
             promoted to a persistent top-level view. `standalone` opens it on
             the first note, sits it below the nav chrome, and hides its own
             INDEX/ABOUT cluster (the nav bar provides those). */
          <NoteOpenView
            key="explore"
            standalone
            confessions={confessions}
            emotions={emotions}
            onExit={() => setView('grid')}
            onAbout={() => setAboutOpen(true)}
            onIndex={() => setView('grid')}
          />
        ) : view === 'experiment' ? (
          /* EXPERIMENT tab — a super-small contact-sheet of every note with an
             empty grey stage dead-center; hovering a thumbnail enlarges that
             note (+ metadata) into the stage. */
          <ExperimentView key="experiment" confessions={confessions} />
        ) : view === 'cube' ? (
          /* CUBE tab — every note mapped onto the six faces of a rotating
             three.js cube; click a face tile to open the INDEX-style close-up. */
          <CubeView key="cube" confessions={confessions} onExplore={handleExplore} />
        ) : view === 'wall' ? (
          <WallView key="wall" confessions={confessions} sidebarInset={sidebarInset} onExplore={handleExplore} />
        ) : (
          <GridView
            key="grid"
            confessions={confessions}
            sidebarInset={sidebarInset}
            onOpenNote={(c, rect) => setOpenNote({ confession: c, rect })}
            noteOpen={!!openNote}
            onLightboxOpenChange={setGridLightboxOpen}
            skipEntrance={gridEntranceDoneRef.current}
            onEntranceSettled={() => {
              gridEntranceDoneRef.current = true;
            }}
            onExplore={handleExplore}
          />
        )}
      </AnimatePresence>

      {/* Mobile grid tap → full-screen vertical note-scroll view (up/down through
          the notes). Keyed by note id so a fresh open remounts the stack seeded
          to the tapped note. Desktop grid taps use the Lightbox instead. */}
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
            onIndex={() => setOpenNote(null)}
            onExplore={() => { setOpenNote(null); setView('explore'); }}
          />
        )}
      </AnimatePresence>

      {/* Sidebar hidden — see comment by sidebarInset above to restore. */}
    </motion.div>
  );
}

export default function App() {
  // Deep link: `/?view=grid` (also `theme` | `explore` | `wall`) opens straight
  // into the archive on that view — e.g. the onboarding "Enter the archive" CTA.
  // Any other load starts on the landing page as usual.
  const deepLinkView = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : ''
  ).get('view');
  const deepLinkArchive =
    deepLinkView === 'grid' ||
    deepLinkView === 'theme' ||
    deepLinkView === 'explore' ||
    deepLinkView === 'wall' ||
    deepLinkView === 'experiment' ||
    deepLinkView === 'cube';

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
