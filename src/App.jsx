import {
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  memo,
} from 'react';
import { createPortal } from 'react-dom';
import {
  animate,
  motion,
  AnimatePresence,
  useReducedMotion,
  useMotionValue,
  useSpring,
} from 'motion/react';
import { Text, TRANSCRIPTION_TEXT, TRANSCRIPTION_FONT_SIZE, VARIANTS } from './text';
// The landing page is the beat-stepped telling; the scrolled original is still
// itself at /onboarding.
import OnboardingBeats from './OnboardingBeats';
import { Sidebar, SIDEBAR_WIDTH } from './Sidebar';
import {
  BOTTOM_DIAL_SIZE,
  BottomCompassDial,
  getCategoryBreadcrumbInfo,
  HorizontalConfessionStack,
  INTRO_SPIN_EASE_BEZIER,
  NavGrainFilter,
  NOTE_META_STYLE,
} from './SideDial';
import { CONFESSIONS as FALLBACK_CONFESSIONS } from './confessions';
import {
  deriveEmotions,
  sortConfessionsByEmotions,
  formatCategoryLabel,
} from './themes';
import { PAGE_BG, PAGE_GRADIENT } from './NoiseGradient';
import { useConfessions } from './useConfessions';
import {
  TunableGrainBackground,
  noiseUrl,
  CARD_FILTER_ID,
  CardNoiseFilterDefs,
  useInactiveCardParams,
} from './noise';
import { INK, inkA } from './colors';
import { PaperTextureLayer, usePaperStockDials } from './PaperTexture';
import { LINK_UNDERLINE, LINK_UNDERLINE_CSS, linkUnderlineRaised } from './linkUnderline';
import { ScatterLabel } from './letterScatter';
import { TracedOutline } from './TracedOutline';
import { subscribeToKit } from './kit';
import NoteOpenView, {
  NOTE_SURFACE_Z,
  TILE_PADDING,
  WHEEL,
  wheelSlot,
  wheelOffset,
  wheelVisible,
} from './NoteOpenView';
import CategoryFlight from './CategoryFlight';
import {
  GridImageFilter,
  GRID_IMAGE_FILTER,
  NoiseDisplaceFilter,
} from './NoiseDisplaceFilter';
import { useNoteSound } from './sounds';
import CubeScene from './CubeScene';
import { CURSOR_FLOAT, cursorOffset, floatAngles } from './cursorFloat';
const ease = [0.22, 1, 0.36, 1];
/** Shared hover / color / opacity transition curve (ease-out-quart). */
const HOVER_EASE = 'cubic-bezier(0.17, 0.84, 0.44, 1)';
const HOVER_EASE_ARR = [0.17, 0.84, 0.44, 1];

/**
 * How the page behind a focused surface gets out of the way: desaturated,
 * softened and dimmed into the same inactive state a resting grid image wears,
 * so the thing on top reads as the only live layer. Eased slowly enough that it
 * settles with whatever is fading in over it.
 *
 * Worn by the grid behind the note Lightbox. The About drawer dims the page with
 * its own backdrop instead — the index categories and notes stay as they are
 * behind that wash rather than being blurred and halved again on top of it.
 */
const recede = (on) => ({
  filter: on ? 'grayscale(1) blur(3px)' : 'none',
  opacity: on ? 0.5 : 1,
  transition: `filter 0.32s ${HOVER_EASE}, opacity 0.32s ${HOVER_EASE}`,
});

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

// A pointer that can actually hover. Asked by capability rather than by width:
// a phone held in landscape is wider than the compact breakpoint but still has
// nothing to hover with, and a tap on a touchscreen fires the emulated
// mouseenter and then leaves the note lifted, dimmed neighbours and all, until
// you tap somewhere else.
const HOVER_CAPABLE_MQ = '(hover: hover) and (pointer: fine)';

function useHoverCapable() {
  const [capable, setCapable] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(HOVER_CAPABLE_MQ).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(HOVER_CAPABLE_MQ);
    const onChange = () => setCapable(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return capable;
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

// Fixed wash at the archive's top and bottom edges (black → transparent) so
// labels stay legible when grid content scrolls underneath.
const ARCHIVE_NAV_GRADIENT_HEIGHT = 152;

/**
 * The layer the edge washes sit on. Anything that puts TEXT inside the top or
 * bottom 152px has to clear this or it gets read through up to 0.88 of black —
 * which is a scrim, not a colour choice, and no amount of brightening the type
 * fixes it. The full-note surfaces (the index Lightbox, the EXPLORE tab) are
 * both in that band, so both elevate past it; see NOTE_SURFACE_Z.
 */
const ARCHIVE_EDGE_WASH_Z = 150;

/** One vertical rhythm for fixed title / view toggle / ABOUT. */
const ARCHIVE_NAV_CHROME_HEIGHT = 40;

/** Desktop grid filter rail geometry — shared by the index sidebar, About
 *  drawer tab top, and the INDEX / EXPLORE nav. Nav + the "N Confessions"
 *  tally align to the first tile's number (GRID_TILE_NUM_INSET inside the
 *  cell), not the lattice edge. */
const FILTER_SIDEBAR_W = 200; //    px — rail width
const FILTER_SIDEBAR_LEFT = 32; //  px — inset from the view's left edge
const FILTER_SIDEBAR_TOP = 112; //  px — starts below the wordmark chrome
const FILTER_SIDEBAR_GAP = 40; //   px — clearance between rail and grid
const GRID_CONTENT_LEFT = FILTER_SIDEBAR_LEFT + FILTER_SIDEBAR_W + FILTER_SIDEBAR_GAP;
/** Inset of `.grid-tile-num` from the cell's left edge — also the shared
 *  left align for INDEX / EXPLORE and the confessions count. */
const GRID_TILE_NUM_INSET = 18; // px
const GRID_NAV_LEFT = GRID_CONTENT_LEFT + GRID_TILE_NUM_INSET;

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
// Raised because these sit in padded buttons at 16px/24px: at the default
// position the rule hangs ~9px under the caps and reads as a detached line
// rather than an underline.
const ARCHIVE_LINK_UNDERLINE = linkUnderlineRaised(0.4);

/** Surface for the grid's facet dropdowns. Flat and opaque rather than frosted:
 *  they open over moving note images, and a translucent panel dragged that
 *  motion through the type. */
const MENU_SURFACE = '#1a1618';
const MENU_SURFACE_BORDER = inkA(0.14);
const MENU_SURFACE_SHADOW = '0 18px 46px rgba(0,0,0,0.55)';

/**
 * Wash pinned to one edge of the viewport. The top one keeps the nav chrome
 * legible over scrolling content; the bottom is its mirror, closing the frame so
 * content fades out at the edge instead of being cut off. Both ends share the
 * same stops and height — only the direction flips.
 */
function ArchiveEdgeGradientWash({ edge = 'top', zIndex = ARCHIVE_EDGE_WASH_Z }) {
  const atTop = edge === 'top';
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        [atTop ? 'top' : 'bottom']: 0,
        left: 0,
        right: 0,
        height: ARCHIVE_NAV_GRADIENT_HEIGHT,
        zIndex,
        pointerEvents: 'none',
        background: `linear-gradient(to ${atTop ? 'bottom' : 'top'}, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0.42) 52%, rgba(0, 0, 0, 0) 100%)`,
      }}
    />
  );
}

/** Hand-lettered "What We Tell AI" wordmark button — the onboarding hero's
 *  brush art, dropped into the nav. It reads from a baked PNG rather than
 *  wwtai_2.svg because the source carries the hero's grain detail, and the
 *  separable strokes its write-on needs, at 1.6MB; see scripts/wordmark-logo.mjs.
 *  Tapping it returns to the intro onboarding.
 *
 *  `logoHeight` is the height of the whole one-line lockup, so it is much
 *  shorter than the two-line mark it replaced while the letters themselves come
 *  out the same size — the old 48px block was two ~20px lines. Sizing the new
 *  one to match that block instead would have put a 260px mark in the corner.
 */
function WordmarkLogo({ onReturnToIntro, onClick, ariaLabel, title, logoHeight = 26 }) {
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
        src="/wordmark-line-96.png"
        alt="What We Tell AI"
        draggable={false}
        style={{ height: logoHeight, width: 'auto', display: 'block' }}
      />
    </button>
  );
}

/**
 * Fixed top chrome shared by every archive view — wordmark (far left) and
 * INDEX / EXPLORE (at the grid's left edge). ABOUT opens from the peeking
 * drawer tab on the right (desktop); phones still reach it via the hamburger.
 * Stays mounted when the About panel opens; only handlers and active states
 * swap so the bar never jumps position. The same INDEX / EXPLORE slot is used
 * on EXPLORE, where it sits in the same vertical band as the ← / → theme controls.
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
  // Wordmark stays above the drawer so it can close About; INDEX / EXPLORE sink
  // under the backdrop so they don't compete with the panel.
  const wordmarkZ = aboutOpen ? 1010 : zIndex;
  const viewTabsZ = aboutOpen ? 150 : zIndex;

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
          <WordmarkLogo logoHeight={20} {...wordmarkProps} />
        </div>
        {/* Phone: the three destinations collapse into one hamburger, so the bar
            is just wordmark + menu and nothing competes with the wordmark for
            the strip. Desktop lays all three out in the open instead. */}
        <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
          <MobileNavMenu
            view={view}
            onChange={handleViewChange}
            aboutOpen={aboutOpen}
            onAboutClick={handleAboutClick}
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
          zIndex: wordmarkZ,
          height: ARCHIVE_NAV_CHROME_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <WordmarkLogo {...wordmarkProps} />
      </motion.div>

      {/* INDEX / EXPLORE — aligned to the first tile's number (and kept there
          on EXPLORE). Vertically matches the ← / → theme controls (top: 24). */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: aboutOpen ? 0 : 1, y: 0 }}
        transition={{ duration: 0.28, ease, delay: aboutOpen ? 0 : entranceDelay }}
        style={{
          position: 'fixed',
          top: 24,
          left: GRID_NAV_LEFT,
          zIndex: viewTabsZ,
          height: ARCHIVE_NAV_CHROME_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          pointerEvents: aboutOpen ? 'none' : 'none',
        }}
      >
        <ViewTabs view={view} onChange={handleViewChange} aboutOpen={aboutOpen} />
      </motion.div>

      {/* ABOUT lives on the peeking drawer tab now — no top-right chrome. */}
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

/** Desktop's far-right ABOUT, wrapped in the grainy sketch hover note. Phone
 *  widths reach ABOUT through the hamburger instead (see MobileNavMenu), so
 *  this is desktop-only and can assume a pointer. */
function AboutHeader({ onClick, open, entranceDelay = 0.2, zIndex = 200 }) {
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
        position: 'fixed',
        top: 24,
        right: 24,
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
      <AboutHoverNote>{aboutButton}</AboutHoverNote>
    </motion.div>
  );
}

/** Bars of the phone nav's hamburger. The outer two cross into an X when the
 *  menu is open (both rotating about the middle bar's line) and the middle one
 *  drops out, so the button states as "this closes what it opened". */
const NAV_BURGER = {
  w: 20, //     px — bar length
  h: 1, //      px — hairline weight, matching the nav's dotted underline
  gap: 5, //    px between bars at rest
  ease: [0.22, 1, 0.36, 1],
  durS: 0.28,
};

/** Phone nav sheet — the full-screen cover the hamburger opens. */
const NAV_SHEET = {
  // Items hang off the wordmark's left edge: the bar's 16px inset plus the
  // wordmark button's 12px padding, less each item's own 4px padding.
  padLeft: 16 + 12 - 4,
  // Clear of the bar, which stays visible on top of the sheet.
  padTop: 24 + ARCHIVE_NAV_CHROME_HEIGHT + 28,
  // The rows carry their own padding and 24px type brings its own leading, so
  // there is no flex gap on top of that — the three of them read as one block.
  gap: 0,
  // Each row's vertical padding, which is now the whole of the air between them.
  // Shallow, but deep enough to keep a row's tap target above 40px.
  rowPadY: 5,
  durS: 0.26,
  stagS: 0.05,
};

/** The sheet's destinations, set larger than the bar's 16px chrome — they are
 *  the only thing on the screen while it is open. */
const NAV_SHEET_TEXT = { ...ARCHIVE_NAV_TEXT, fontSize: 24, lineHeight: 1.3 };

/**
 * Phone nav menu — the compact bar's whole navigation in one hamburger: INDEX,
 * EXPLORE, and ABOUT stacked on a sheet that covers the screen.
 *
 * Desktop keeps INDEX / EXPLORE at the grid's left edge (ABOUT peeks from the
 * drawer — see AboutModal); that open layout doesn't fit a phone without
 * crowding the wordmark. The current destination is the one item at
 * full opacity, so the closed button still implies where you are once opened.
 */
function MobileNavMenu({ view, onChange, aboutOpen, onAboutClick, entranceDelay = 0.2, zIndex = 200 }) {
  const [open, setOpen] = useState(false);

  // The sheet covers the screen, so there is no "outside" to tap — bare sheet
  // taps dismiss it (below) and Escape covers the keyboard.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // INDEX and EXPLORE switch view; ABOUT opens the panel over whichever view is
  // behind it, which is why it reads as active rather than replacing the other
  // two's highlight.
  const items = [
    { key: 'grid', label: 'INDEX', active: !aboutOpen && view === 'grid', run: () => onChange?.('grid') },
    { key: 'explore', label: 'EXPLORE', active: !aboutOpen && view === 'explore', run: () => onChange?.('explore') },
    { key: 'about', label: 'ABOUT', active: aboutOpen, run: () => onAboutClick?.() },
  ];

  const bar = (i) => {
    const pitch = NAV_BURGER.h + NAV_BURGER.gap;
    const rest = { y: pitch * i, rotate: 0, opacity: 1 };
    // All three gather on the middle bar's line; the outer two cross there and
    // the middle one drops out underneath them.
    const crossed = { y: pitch, rotate: i === 0 ? 45 : -45, opacity: i === 1 ? 0 : 1 };
    return (
      <motion.span
        key={i}
        aria-hidden="true"
        initial={false}
        animate={open ? crossed : rest}
        transition={{ duration: NAV_BURGER.durS, ease: NAV_BURGER.ease }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: NAV_BURGER.w,
          height: NAV_BURGER.h,
          background: INK,
        }}
      />
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: entranceDelay }}
      style={{ position: 'relative', zIndex, minHeight: ARCHIVE_NAV_CHROME_HEIGHT, display: 'flex', alignItems: 'center' }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none',
          border: 'none',
          // Padding, not size, gives the 44px touch target — the bars stay a
          // 20px glyph optically aligned with the wordmark beside them.
          padding: '12px',
          margin: '-12px',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span
          style={{
            position: 'relative',
            display: 'block',
            width: NAV_BURGER.w,
            height: NAV_BURGER.h * 3 + NAV_BURGER.gap * 2,
          }}
        >
          {[0, 1, 2].map(bar)}
        </span>
      </button>

      {/* Portalled to the body so the sheet fills the viewport rather than the
          bar's cell, and so it paints under the whole bar — the wordmark and the
          X stay legible on top of it. */}
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              role="menu"
              aria-label="Site"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: NAV_SHEET.durS, ease }}
              onClick={() => setOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: zIndex - 1,
                // The site's own backdrop, so the sheet reads as the archive
                // stepping aside rather than a panel laid over it.
                background: `${PAGE_GRADIENT}, ${PAGE_BG}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: NAV_SHEET.gap,
                padding: `${NAV_SHEET.padTop}px 24px 24px ${NAV_SHEET.padLeft}px`,
              }}
            >
              {items.map((it, i) => (
                <motion.button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  aria-current={it.active || undefined}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: it.active ? 1 : 0.5, x: 0 }}
                  transition={{ duration: NAV_SHEET.durS, ease, delay: i * NAV_SHEET.stagS }}
                  onClick={() => {
                    it.run();
                    setOpen(false);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: `${NAV_SHEET.rowPadY}px 4px`,
                    ...NAV_SHEET_TEXT,
                    ...ARCHIVE_LINK_UNDERLINE,
                    textAlign: 'left',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {it.label}
                </motion.button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  );
}

/** Right-side About drawer. Peeks from the archive's right edge when closed;
 *  opens to 33vw with file-folder tabs that swap the reading section. */
const ABOUT_DRAWER = {
  w: '33vw',
  // The lit surface: the open panel, and the tab of the section being read.
  bg: '#2e2e2e',
  // The resting surface: the closed drawer's sliver, the tab hanging off it,
  // and any tab you aren't on. Nothing wears `bg` while the drawer is shut —
  // at #2e2e2e against a #0a0a0a page a closed drawer reads as a light grey
  // slab stuck to the edge of the screen rather than something put away.
  idle: '#1f1f1f',
  // How much paper stock the panel wears, and the folder tabs cut from the same
  // surface with it. This is the drawer's own knob — the sheet's character lives
  // in PaperTexture; this is only how far it comes through here. Raise for more
  // present stock, drop toward 0 for a flat panel. See PaperTexture for what the
  // grain measures at this strength.
  paperStrength: 0.09,
  // Section headings ride on a card — see `headStyle`. Darker than the panel
  // and set in a mid grey rather than the warm ink the copy wears, so it reads
  // as a label laid on the panel instead of a brighter run of the same text.
  headCard: '#202020',
  headInk: '#929292',
  headTilt: -1.4, // deg — enough to catch the eye, short of looking broken
  // Mailing-list card. Darker than the panel it sits on, so it reads as a slab
  // laid into the column; the button is the one thing lifted back off it.
  cardBg: '#212121',
  cardBtn: '#3a3a3a',
  cardBtnHover: '#4a4a4a',
  cardTilt: -1.2, // deg — leans with the heading cards, a touch shallower
  // How far past the copy column's inset the card runs, each side. The slab is
  // the one object in the column that isn't a run of text, and at the column's
  // own width it read as another paragraph with a box drawn round it; carried out
  // into the panel's margin it reads as laid over the column instead of set into
  // it. Both figures leave the tilted card ~12px short of the panel's edge — the
  // phone's inset is only 22px, so the desktop bleed there would put the card
  // nearly on the screen edge, hence the shorter one.
  cardBleedX: 12,
  cardBleedXCompact: 8,
  tabOutline: 'rgba(255,255,255,0.12)',
  // Wide enough for nav-sized type (16px) once it is rotated −90°, plus air on
  // the outer edge and at the spine.
  tabW: 48,
  tabPadX: 10,
  // Tall enough for the longest label ("THE WHY") with room above and below.
  tabH: 108,
  tabPadY: 14,
  // Air between index-card tabs — the angled clip already notches each edge,
  // but a real gap is what sells them as separate pieces.
  tabGap: 8,
  // How far right of its resting place a tab starts as it slides in — out from
  // under the drawer's spine and away to the left. Short on purpose: the strip
  // hangs outside the panel with nothing to hide behind, so a long travel reads
  // as a tab drifting across the page rather than one coming out from under the
  // drawer. Most of the distance is covered while it is still nearly clear.
  tabInX: 18,
  // Trapezoid: outer (left) edge pinched at top/bottom, spine (right) square.
  tabClip: 'polygon(0 14%, 100% 0, 100% 100%, 0 86%)',
  tabRadius: '5px 0 0 5px',
  // Panel body visible beyond the hanging tab — enough to read as a drawer
  // peeking, not just a lone tab.
  peekSliver: 18,
  // Further out the shut drawer leans while the pointer is on it. Held under the
  // 10px the sliver has spare before the copy column's 28px inset: at 12 the
  // nudge brought the first line of the section out past the edge, so instead of
  // a drawer acknowledging the cursor it looked like one coming open a crack and
  // stopping — and the exposed edge is where the column's own scrollbar lives.
  hoverNudgeX: 6,
  // Deliberately unlike the rest of the site's hover work, which answers in
  // ~0.18s. Six pixels covered that fast is a twitch; drawn out this long the
  // same six read as the drawer breathing toward you.
  hoverNudgeS: 0.7,
  slideS: 0.48,
  fadeS: 0.22,
  // Between the tabs that only exist once the drawer is open, as they drop in
  // one after the next. They wait out the slide first: the drawer should arrive
  // as one object and then show what else is filed in it, rather than growing
  // extra tabs while it is still moving.
  tabInStepS: 0.09,
};

/* A hidden tab can't animate its way to nothing: `box-sizing: border-box` keeps
   its own padding and borders no matter what height it is given, so `height: 0`
   still leaves this much of it standing. The hidden tabs pull that remainder
   back out of the strip with a negative margin — otherwise the shut drawer would
   show ABOUT with 60px of reserved nothing hanging underneath it. */
const ABOUT_TAB_COLLAPSED_H = ABOUT_DRAWER.tabPadY * 2 + 2;

/* `label` is the tab; `title` is the heading the panel shows for it. The two are
   different words on purpose — a tab is a marker and wants to be short, while the
   heading is read as a sentence's worth of the section. */
const ABOUT_TABS = [
  { id: 'about', label: 'ABOUT', title: 'About' },
  { id: 'process', label: 'PROCESS', title: 'Our process' },
  { id: 'why', label: 'THE WHY', title: 'The Why' },
];

/**
 * Centered about modal. Backdrop + card fade in on open; on close (click-out
 * / ESC) both exit with opacity only — no scale or drift so it reads as a
 * simple dismiss. prefers-reduced-motion skips transforms on enter too.
 */
function AboutModal({ open, onOpen, onClose, skipPeekEntrance = false, onPeekLanded }) {
  const reduceMotion = useReducedMotion();
  // Desktop: right-side peek drawer with file-folder tabs. Phone: full-bleed
  // takeover (same copy), opened from the nav — no permanent peek on a narrow
  // screen. The site nav bar stays mounted above either shell.
  const compact = useArchiveNavCompact();
  // The peek entrance is a mount-time animation: `initial` parks the drawer off
  // the right edge with no animation, and framer's own `delay` holds it there
  // until the filter rail has landed. Driving it from state instead animated the
  // drawer *out* first, which is what read as a bounce. It runs once a session —
  // the parent refuses it after the first landing (`aboutPeekIsSpent`), so a tab
  // that is already peeking never gets pulled back off the edge to arrive again.
  const shouldPeekEntrance = !compact && !reduceMotion && !skipPeekEntrance;
  const peekEntranceDone = useRef(!shouldPeekEntrance);

  // Whether the pointer (or the keyboard) is on the shut drawer, which leans it a
  // few pixels further out and lights its tab. An invitation, not an opening: the
  // drawer answers that you have found it and waits to be clicked.
  const [peekInvited, setPeekInvited] = useState(false);
  // Only ever while the drawer is shut, and never on a phone, where there is no
  // sliver to lean and no pointer to lean toward. Everything downstream reads
  // this rather than the raw state, so an invitation left standing by a drawer
  // that opened under the cursor can't reach the panel's x or the tab's colour.
  const peekInviting = peekInvited && !open && !compact;
  // Reduced motion keeps the lit tab and loses the travel: a pointer landing on
  // something and that thing brightening is feedback, whereas the panel sliding
  // is the part someone who asked for less movement asked to be without.
  const peekNudged = peekInviting && !reduceMotion;

  // Mailing-list signup state.
  const [email, setEmail] = useState('');
  // 'idle' | 'submitting' | 'success' | 'error'
  const [subscribeStatus, setSubscribeStatus] = useState('idle');
  const [subscribeError, setSubscribeError] = useState('');

  const subscribing = subscribeStatus === 'submitting';
  const subscribed = subscribeStatus === 'success';

  const [activeSection, setActiveSection] = useState('about');

  // Reset the signup form whenever the panel is closed so a reopen is fresh.
  useEffect(() => {
    if (!open) {
      setEmail('');
      setSubscribeStatus('idle');
      setSubscribeError('');
      setActiveSection('about');
    }
  }, [open]);

  // A panel that opens under the cursor never gets a pointerleave, so the
  // invitation has to be withdrawn when it is accepted. Without this the drawer
  // came back from a close still holding it and settled six pixels off the edge
  // with the pointer nowhere near — and nothing would clear it until the pointer
  // entered the sliver and left it again.
  useEffect(() => {
    if (open) setPeekInvited(false);
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

  const easeOut = [0.165, 0.84, 0.44, 1];

  // One sheet of stock for the whole drawer — the panel and every folder tab cut
  // from it — so tuning it in the "Paper Stock" panel (?dial=1) can't leave the
  // tabs wearing different paper than the surface they belong to. The strength
  // the drawer ships is what the dial opens on; each tab still adds its own seed
  // offset below to keep its own crop of the field.
  const paper = usePaperStockDials({ strength: ABOUT_DRAWER.paperStrength });

  // ── Shared copy + styles for the three columns ──────────────────────────
  // Body copy sits on the same warm ink as the rest of the drawer. It used to be
  // a neutral grey, which at this lightness didn't read as a different weight so
  // much as a different paper — the lead paragraph right above it is `inkA(0.85)`
  // and the two stacked up looking like two temperatures of white.
  const BODY_COLOR = inkA(0.85);
  // The onboarding hero's yellow, carried into the drawer for the address typed
  // into the mailing-list card and the button once there's something to send —
  // brighter and warmer than the ink the copy wears, so neither reads as more
  // body text.
  const ACCENT_INK = '#DDDDAE';
  const bodySize = compact ? 16 : 15;
  const bodyStyle = {
    margin: '0 0 15px',
    fontFamily: BODY_FONT,
    fontSize: bodySize,
    lineHeight: 1.5,
    letterSpacing: '0.01em',
    color: BODY_COLOR,
  };
  // Section headings are labels stuck to the panel rather than type set on it:
  // a light card, dark ink, canted a degree off square like the notes pinned up
  // in the index. `inline-block` so the card hugs its words instead of ruling a
  // line across the column, and the tilt pivots on the left edge so every
  // heading still starts flush with the copy beneath it.
  //
  // Tracking eases off as the size goes up — 0.16em reads as an eyebrow at 11px
  // but gets airy and hard to scan at 16px.
  const headStyle = {
    display: 'inline-block',
    margin: '0 0 16px',
    // Right padding runs light: 0.11em of tracking hangs off the last letter and
    // pads the card by itself.
    padding: '7px 10px 6px 12px',
    fontFamily: BODY_FONT,
    fontSize: compact ? 14 : 16,
    fontWeight: 400,
    letterSpacing: '0.11em',
    lineHeight: 1.25,
    textTransform: 'uppercase',
    color: ABOUT_DRAWER.headInk,
    background: ABOUT_DRAWER.headCard,
    transform: `rotate(${ABOUT_DRAWER.headTilt}deg)`,
    transformOrigin: 'left center',
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
    'What We Tell AI is a project exploring our secrets about our complex relationship with Artificial Intelligence (A.I.)',
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
  // Headings live in the panel's header beside the close button, not here: they
  // belong to the tab you are on rather than to the copy, and a heading inside
  // the swapped body would fade out and back in on every tab change.
  const sectionAbout = (
    <>
      {introParas.map(renderPara)}
      <p style={{ ...bodyStyle, color: inkA(0.6), marginTop: 4 }}>
      </p>
    </>
  );

  // WHY WE CARE column — a McLuhan pull-quote, a thesis line, then the essay.
  const sectionWhy = (
    <>
      {/* The rule rides on the blockquote rather than being its own element, so it
          can't drift from the attribution if the quote's spacing changes. Same
          weight as the rules inside the credits card — the drawer only has one. */}
      <blockquote
        style={{
          margin: '0 0 22px',
          padding: '0 0 18px',
          borderBottom: `1px solid ${inkA(0.18)}`,
        }}
      >
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
            textTransform: 'uppercase',
            color: BODY_COLOR,
          }}
        >
          — Marshall McLuhan
        </cite>
      </blockquote>
      {/* Leads on size alone now that the body wears the same ink. */}
      <p style={{ ...bodyStyle, fontSize: bodySize + 1, margin: '0 0 16px' }}>
        {whyLead}
      </p>
      {whyParas.map(renderPara)}
    </>
  );

  // OUR PROCESS column — how the booth works + an installation image.
  const sectionProcess = (
    <>
      {renderPara(processIntro, 'p-intro')}
      <figure style={{ margin: '4px 0 16px' }}>
        <img
          src="/about-booth-alamo.jpg"
          alt="The confession box — a hand-painted sign reading “everyone has an AI secret” beside a folding table of blank notes, set up in Alamo Square with the San Francisco skyline behind it."
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            // Set narrower than the measure, the way a portrait plate is in
            // print. At the full column width this stands over 700px tall on a
            // wide monitor and takes the section over; on a laptop, where the
            // drawer is already narrower than this, the cap never bites.
            maxWidth: 400,
            // The photograph's own ratio, declared so the column doesn't jump
            // while it loads. It is a portrait frame — the sign is at the
            // bottom of it and the city at the top — so cropping it to a
            // landscape figure would have to throw one of them away.
            aspectRatio: '701 / 934',
            objectFit: 'cover',
            borderRadius: 3,
            border: `1px solid ${inkA(0.12)}`,
            filter: 'grayscale(0.2)',
          }}
        />
        <figcaption style={captionStyle}>Fig. 01 — the confession box, Alamo Square</figcaption>
      </figure>
      {processParas.map((p, i) => renderPara(p, `pp-${i}`))}
    </>
  );

  const creditCardLabelStyle = {
    fontFamily: MONO_FONT,
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    // The same ink as the values opposite them. These rows are the column's
    // closing matter, not a form — CONTACT and INSTAGRAM are one line of
    // information read across, and dropping the label to a dimmer grey made it
    // look like a field caption sat behind glass. The alignment and the hairlines
    // already say which side is which without a change of colour doing it.
    color: inkA(0.88),
    lineHeight: 1.5,
  };
  const creditCardValueStyle = {
    fontFamily: MONO_FONT,
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: inkA(0.88),
    lineHeight: 1.5,
    textAlign: 'right',
  };
  // A row carrying more than one value stacks them down the right edge rather
  // than running them together on one line. At this tracking a comma list is
  // long enough to reach the label opposite it — "FAKTORY, COURIER NEW" sat on
  // top of TYPEFACES — and the two contact links already read as a stack, so the
  // whole card holds one shape for "this row has several answers".
  const creditCardStackStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
  };

  // Credits + contact — mono rows, label left and value right, hairlines between
  // bands. Unlike the mailing-list card above it this is not a slab: no tilt and
  // no fill, so it reads as the column's own closing matter rather than a second
  // object. Which is also why it carries no padding — the inset and the radius
  // only ever existed to hold a background off the column's edges, and without
  // one they would just push these rows out of line with everything above.
  const creditsCardBlock = () => (
    <div
      className="about-credits-card"
      style={{
        marginTop: 22,
      }}
    >
      {[
        {
          key: 'contact',
          label: 'Contact',
          value: (
            <div style={creditCardStackStyle}>
              <a
                className="about-contact-link"
                href="https://www.instagram.com/whatwetellai"
                target="_blank"
                rel="noopener noreferrer"
                style={creditCardValueStyle}
              >
                Instagram
              </a>
              <a
                className="about-contact-link"
                href="mailto:hello@whatwetellai.com"
                style={creditCardValueStyle}
              >
                Email
              </a>
            </div>
          ),
        },
        {
          key: 'lead',
          label: 'Project Lead',
          value: (
            <a
              className="about-credit-link"
              href="https://oliviaiscurious.substack.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={creditCardValueStyle}
            >
              Olivia Tai
            </a>
          ),
        },
        {
          key: 'design',
          label: 'Web Design',
          value: (
            <a
              className="about-credit-link"
              href="https://arinp.space/"
              target="_blank"
              rel="noopener noreferrer"
              style={creditCardValueStyle}
            >
              Arin Pantja
            </a>
          ),
        },
        {
          key: 'type',
          label: 'Typefaces',
          value: (
            <div style={creditCardStackStyle}>
              <span style={creditCardValueStyle}>Faktory</span>
              <span style={creditCardValueStyle}>Courier New</span>
            </div>
          ),
          last: true,
        },
      ].map((row) => (
        <div
          key={row.key}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: '10px 18px',
            alignItems: 'start',
            padding: row.key === 'contact' ? '0 0 12px' : '12px 0',
            borderBottom: row.last ? 'none' : `1px solid ${inkA(0.18)}`,
          }}
        >
          <span style={creditCardLabelStyle}>{row.label}</span>
          {row.value}
        </div>
      ))}
    </div>
  );

  const copyrightLine = (
    <p
      style={{
        margin: '16px 0 0',
        fontFamily: MONO_FONT,
        fontSize: 11,
        letterSpacing: '0.06em',
        color: inkA(0.45),
      }}
    >
      © What We Tell AI 2026
    </p>
  );

  const footerBlock = (
    <>
      {creditsCardBlock()}
      {copyrightLine}
    </>
  );

  // Mailing-list signup, built to the card in Figma: a slab a shade darker than
  // the panel, tilted with the section headings, holding a title line over a
  // hairline, a rule-only field, and a filled button across the foot. Rendered
  // once per breakpoint, so the <style> block is safe here.
  //
  // The dashed edge is the same hairline the search fields and facet tabs wear,
  // which is what keeps a filled slab in a panel of unfilled matter reading as
  // part of the same drawing rather than as a component from somewhere else. It
  // is a border on the card, not a ring around it: the width comes from the
  // column plus the bleed below, so the 1px comes out of the inside.
  const cardBleedX = compact ? ABOUT_DRAWER.cardBleedXCompact : ABOUT_DRAWER.cardBleedX;
  // The column clips what leaves it, and its padding box sits exactly on the
  // inset the copy is set to — so a card bleeding outward would have its dashed
  // edge sliced off at both sides. See the copy column, which opens its clip by
  // this much without moving the copy. Wider than the bleed itself: the tilt
  // swings the corners ~2px further out again, and the rest is air, so the dash
  // sits clear of the clip rather than against it.
  const colBleedGutter = cardBleedX + 6;
  const emailArmed = email.trim().length > 0;
  const mailingListBlock = () => (
    <div
      className="about-subscribe"
      style={{
        marginTop: 22,
        // Negative, so the slab runs out past the column's inset on both sides
        // rather than being held to the width of the copy above it.
        marginInline: -cardBleedX,
        padding: compact ? '16px 16px 15px' : '17px 18px 16px',
        background: ABOUT_DRAWER.cardBg,
        border: `1px dashed ${inkA(0.22)}`,
        // Held at the SUBSCRIBE button's own radius (8) rather than going tighter:
        // that button runs the full width of the card, so anything smaller here
        // would leave the inner corner rounder than the outer one it sits in.
        borderRadius: 8,
        transform: `rotate(${ABOUT_DRAWER.cardTilt}deg)`,
      }}
    >
      <style>{`
        .about-subscribe input:focus { border-bottom-color: ${inkA(0.55)}; }
        .about-subscribe button:not(.is-armed):hover:not(:disabled),
        .about-subscribe button:not(.is-armed):focus-visible:not(:disabled) {
          background: ${ABOUT_DRAWER.cardBtnHover}; color: #fff;
        }
        /* Already lit, so hover brightens the fill rather than swapping it. */
        .about-subscribe button.is-armed:hover:not(:disabled),
        .about-subscribe button.is-armed:focus-visible:not(:disabled) {
          background: #EDEDD2;
        }
        .about-subscribe button:disabled { opacity: 0.55; cursor: default; }
        .about-subscribe input:disabled { opacity: 0.55; }
      `}</style>
      {/* Title and kicker share a baseline over the rule, so the hairline reads
          as one line under both rather than a box around either. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          paddingBottom: 9,
          borderBottom: `1px solid ${inkA(0.18)}`,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: BODY_FONT,
            fontSize: bodySize + 5,
            lineHeight: 1.15,
            color: BODY_COLOR,
          }}
        >
          Mailing List
        </p>
        <span
          style={{
            flex: '0 0 auto',
            fontFamily: MONO_FONT,
            fontSize: 11,
            letterSpacing: '0.14em',
            color: inkA(0.45),
          }}
        >
          SIGN UP
        </span>
      </div>
      {!subscribed ? (
        <form onSubmit={handleSubscribe}>
          {/* Standing label rather than a placeholder, so the prompt survives
              typing instead of being the first thing the field loses. */}
          <label
            htmlFor="about-subscribe-email"
            style={{
              display: 'block',
              margin: '14px 0 6px',
              fontFamily: MONO_FONT,
              fontSize: 11,
              letterSpacing: '0.12em',
              color: inkA(0.45),
            }}
          >
            ENTER EMAIL
          </label>
          <input
            id="about-subscribe-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={subscribing}
            autoComplete="email"
            style={{
              display: 'block',
              width: '100%',
              minWidth: 0,
              padding: '4px 2px 9px',
              background: 'none',
              border: 'none',
              borderBottom: `1px solid ${inkA(0.18)}`,
              borderRadius: 0,
              // Display-only caps: the value still submits as typed, so the
              // address isn't mangled on its way to the list.
              textTransform: 'uppercase',
              color: ACCENT_INK,
              fontFamily: MONO_FONT,
              fontSize: 12,
              letterSpacing: '0.1em',
              outline: 'none',
              transition: `border-color 0.18s ${HOVER_EASE}`,
            }}
          />
          {/* Dark and quiet until there is an address to send: the button lights
              into the accent the moment the field has something in it, so the
              card shows you it is ready rather than looking equally clickable
              empty or full. Still submittable when empty — the field's own
              `required` message is more use than a button that ignores you. */}
          <button
            type="submit"
            className={emailArmed ? 'is-armed' : undefined}
            disabled={subscribing}
            style={{
              width: '100%',
              marginTop: 14,
              padding: '11px 12px',
              background: emailArmed ? ACCENT_INK : ABOUT_DRAWER.cardBtn,
              color: emailArmed ? '#1c1c18' : inkA(0.55),
              border: 'none',
              borderRadius: 8,
              fontFamily: MONO_FONT,
              fontSize: 12,
              letterSpacing: '0.18em',
              cursor: 'pointer',
              transition: `background 0.18s ${HOVER_EASE}, color 0.18s ${HOVER_EASE}`,
            }}
          >
            {subscribing ? 'SUBSCRIBING…' : 'SUBSCRIBE'}
          </button>
        </form>
      ) : (
        <p
          style={{
            margin: '14px 0 2px',
            fontFamily: MONO_FONT,
            fontSize: 11,
            letterSpacing: '0.04em',
            lineHeight: 1.7,
            color: inkA(0.8),
          }}
        >
          Thanks — check your inbox to confirm your subscription.
        </p>
      )}
      {subscribeStatus === 'error' && (
        <p style={{ margin: '10px 0 0', fontFamily: MONO_FONT, fontSize: 10, letterSpacing: '0.04em', lineHeight: 1.5, color: '#f0846b' }}>
          {subscribeError}
        </p>
      )}
    </div>
  );

  // Tab → panel body. About carries mailing + credits; the other two are just
  // their reading blocks. Swapped with a fade rather than scrolled.
  const sectionBody = {
    about: (
      <>
        {sectionAbout}
        {mailingListBlock()}
        {footerBlock}
      </>
    ),
    process: sectionProcess,
    why: sectionWhy,
  };

  const selectTab = (id) => {
    setActiveSection(id);
    if (!open) onOpen?.();
  };

  // Visible tabs: ABOUT alone while peeking; the full set once the drawer opens.
  const visibleTabIds = !open && !compact ? ['about'] : ABOUT_TABS.map((t) => t.id);

  // Every rest position is written as `calc(N% + Mpx)` — same shape, same
  // operator, always two terms. Framer interpolates a calc() by reusing one
  // end's template and tweening the numbers inside it, so mixing `100% - 18px`
  // with `100% + 48px` made it read the 48 into the minus template and start the
  // slide 66px past where it should (the drawer popped too far in, then eased
  // back out — the bounce). Matching templates keeps the tween monotonic.
  const openX = 'calc(0% + 0px)';
  // Peek: a few px of panel body + the hanging ABOUT tab. Fully hidden on
  // phone (opened from the nav) and when the drawer would cover a note lightbox.
  //
  // The hover lean is folded into this one resting figure rather than given an
  // animation of its own. Two animations on x — the slide and the nudge — fought
  // over the transform: whichever ran last won the property outright, so a hover
  // caught near the end of a close snapped the drawer to the sliver and back out.
  const closedX = compact
    ? `calc(100% + ${ABOUT_DRAWER.tabW}px)`
    : `calc(100% + ${-(
        ABOUT_DRAWER.peekSliver + (peekNudged ? ABOUT_DRAWER.hoverNudgeX : 0)
      )}px)`;
  const peekHiddenX = `calc(100% + ${ABOUT_DRAWER.tabW}px)`;

  // Phone's section navigation: three markers on a hairline, the one you are
  // reading sitting on the panel's own surface with the rule broken under it, the
  // way the file-folder tabs read against the drawer on desktop. Only on this
  // breakpoint — the folder tabs hang off the panel's left edge, which on a
  // full-bleed takeover is the edge of the screen, so without these the other two
  // sections would be unreachable.
  const activeTab = ABOUT_TABS.find((t) => t.id === activeSection) || ABOUT_TABS[0];
  const topTabs = !compact ? null : (
    <div
      role="tablist"
      aria-label="About sections"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 2,
        // The rule runs the width of the column and the live tab covers its own
        // stretch of it, so the selected marker joins the page below the line.
        borderBottom: `1px solid ${inkA(0.16)}`,
        marginBottom: 16,
      }}
    >
      {ABOUT_TABS.map((tab) => {
        const on = activeSection === tab.id;
        return (
          <button
            key={tab.id}
            id={`about-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls="about-panel-body"
            className="about-top-tab"
            onClick={() => selectTab(tab.id)}
            style={{
              position: 'relative',
              // Sits a hairline low so its own bottom edge lands on the rule and
              // hides it, rather than stopping a pixel short of it.
              marginBottom: -1,
              padding: '8px 11px 7px',
              border: '1px solid transparent',
              borderColor: on ? ABOUT_DRAWER.tabOutline : 'transparent',
              borderBottomColor: on ? ABOUT_DRAWER.bg : 'transparent',
              borderRadius: '5px 5px 0 0',
              background: on ? ABOUT_DRAWER.bg : 'transparent',
              color: on ? '#fff' : inkA(0.42),
              cursor: 'pointer',
              fontFamily: MONO_FONT,
              fontSize: 10,
              letterSpacing: '0.14em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              transition: `color 0.18s ${HOVER_EASE}, background 0.18s ${HOVER_EASE}`,
            }}
          >
            {/* Only the live tab has a surface to texture — the rest are cut-outs
                in the panel, and stock over nothing would just be a grey smear
                where a transparent tab used to be. */}
            {on ? (
              <PaperTextureLayer
                {...paper}
                id="roughpaper-about-top-tab"
                seed={paper.seed + 3}
                radius="5px 5px 0 0"
              />
            ) : null}
            {/* Over the stock, which sits at z-index 0. */}
            <span style={{ position: 'relative' }}>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );

  // The section's name, and on phone the way out of the drawer beside it. Hoisted
  // out of the section bodies so neither fades when you change tabs.
  //
  // Phone only, like the tab row above it: that breakpoint is a full-bleed
  // takeover with nothing of the page left showing to tap, so the ✕ is the way
  // back. The desktop drawer keeps the exits it already had — the dimmed page
  // behind it, ESC, and the wordmark — and none of them cost the header a mark.
  //
  // Which is also why the row is mounted in different places by breakpoint (see
  // below): first thing inside the scrolling column on desktop, so the heading
  // travels with the copy it names rather than hanging over it, but still in the
  // fixed header on phone, where scrolling this row away would take the only
  // visible way out of a full-bleed takeover with it. The bottom margin is the
  // gap the column's top padding used to give the heading, carried on the row
  // now that the row lives inside the scroll.
  const titleRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: compact ? 0 : 18,
      }}
    >
      <h2 style={{ ...headStyle, margin: 0 }}>{activeTab.title}</h2>
      {compact ? (
        <button
          type="button"
          className="about-close"
          aria-label="Close about"
          onClick={onClose}
          style={{
            flex: '0 0 auto',
            // Out into the panel's own padding: the glyph lines up with the right
            // edge of the copy, and the hit area it needs spills into the margin
            // rather than pushing the mark in off the column.
            marginRight: -7,
            width: 34,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            border: 'none',
            borderRadius: 6,
            background: 'none',
            color: inkA(0.55),
            cursor: 'pointer',
            fontFamily: MONO_FONT,
            fontSize: 16,
            lineHeight: 1,
            transition: `color 0.18s ${HOVER_EASE}, background 0.18s ${HOVER_EASE}`,
          }}
        >
          ✕
        </button>
      ) : null}
    </div>
  );

  const sharedStyles = `
    .about-top-tab:hover:not([aria-selected='true']) { color: ${inkA(0.7)}; }
    .about-close:hover, .about-close:focus-visible {
      color: #fff; background: ${inkA(0.08)};
    }
    .about-contact-link {
      display: inline-block; color: ${inkA(0.72)};
      text-decoration: none;
      transition: color 0.18s ${HOVER_EASE};
    }
    .about-contact-link:hover { color: #CFCAB7; }
    .about-credit-link {
      display: inline-block;
      color: inherit;
      text-decoration: none;
      transition: color 0.18s ${HOVER_EASE};
    }
    .about-credit-link:hover,
    .about-credit-link:focus-visible { color: ${ACCENT_INK}; }
    .about-emph { color: ${inkA(0.85)}; ${LINK_UNDERLINE_CSS} }
    .about-col::-webkit-scrollbar { width: 9px; }
    .about-col::-webkit-scrollbar-thumb {
      background: ${inkA(0.14)}; border-radius: 4px;
    }
    .about-drawer-tab {
      clip-path: ${ABOUT_DRAWER.tabClip};
      -webkit-clip-path: ${ABOUT_DRAWER.tabClip};
    }
    /* The open drawer's unread sections lift on hover from here, where a rule
       can out-rank the colour framer writes inline on the tab. The peeking tab
       is held out of it: while the drawer is shut that same lift is animated with
       the panel's lean (see \`invited\`), and this rule — !important, untransitioned,
       and a duller grey than the accent — would win it, snapping ABOUT to
       rgba(…,0.72) the instant the pointer arrived and pinning it there for the
       length of the fade that was supposed to be taking it somewhere brighter. */
    .about-drawer-tab:hover:not([aria-selected='true']):not(:disabled):not([data-peek]) {
      color: ${inkA(0.72)} !important;
    }
  `;

  const drawerContent = (
    <>
      <style>{sharedStyles}</style>

      {/* The panel's stock. An empty layer that generates lit paper and blends it
          into the fill behind it, so the surface keeps its grey — and keeps
          riding the light/dark switch of the slide — while picking up tooth. It
          sits under the copy (the column is z-index 1) and under the folder tabs
          (z-index 2), and stops at the panel's edges, so the tabs hanging off the
          spine stay clean. */}
      <PaperTextureLayer {...paper} />

      {/* File-folder tabs on the left edge — flush to the top, and the section
          navigation on desktop. They hang outside the panel, which a phone's
          full-bleed takeover has no room for, so that breakpoint gets the tab row
          across the top of the header instead (see topTabs). */}
      {compact ? null : (
      <div
        role="tablist"
        aria-label="About sections"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          // Explicit rather than shrink-to-fit: the open tab's -1px right margin
          // would otherwise pull the strip a pixel narrower than the tabs in it,
          // and the clip below is measured off this edge.
          width: ABOUT_DRAWER.tabW,
          transform: 'translateX(-100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: ABOUT_DRAWER.tabGap,
          overflow: 'visible',
          // Cuts the strip off at the drawer's spine, so a tab sliding in from
          // the right is only seen from the moment it clears the panel — it
          // comes out from under the drawer rather than gliding over it. The
          // −1px lets the open tab keep the overhang that seals it to the panel.
          clipPath: 'inset(0px -1px 0px 0px)',
          WebkitClipPath: 'inset(0px -1px 0px 0px)',
          zIndex: 2,
        }}
      >
        {ABOUT_TABS.map((tab, n) => {
          const shown = visibleTabIds.includes(tab.id);
          // Only lit while the drawer is actually open. `activeSection` resets to
          // 'about' on close, so without this the peeking tab always wore the
          // selected treatment — the panel's own light grey, on a black page,
          // announcing a section nobody is reading.
          const isActive = open && activeSection === tab.id;
          // ABOUT is the only lettering a shut drawer has on screen, and it is
          // dim on purpose, so it is the thing that brightens while the panel
          // leans out. `shown` narrows this to that one tab: the other two are
          // hidden at zero opacity behind the spine while the drawer is shut, and
          // lighting type nobody can see is how a hover ends up costing three
          // colour tweens instead of one.
          const invited = peekInviting && shown;

          // ABOUT is the tab that hangs off the closed drawer, so it is already
          // there and waits for nothing. The rest arrive after the panel has
          // finished sliding, each a beat behind the one above.
          //
          // Only on the way in. Closing runs them all out at once: a drawer
          // being put away shouldn't leave its tabs hanging in the air behind
          // it, one at a time, after the thing they belong to has gone.
          const arriveDelay =
            reduceMotion || !open || n === 0
              ? 0
              : ABOUT_DRAWER.slideS + (n - 1) * ABOUT_DRAWER.tabInStepS;
          const arrive = {
            duration: reduceMotion ? 0 : ABOUT_DRAWER.fadeS,
            ease: easeOut,
            delay: arriveDelay,
          };

          // The slot a tab occupies in the strip is switched, not animated: it
          // opens the instant that tab's beat comes up so there is something for
          // the tab to slide into, and on the way out it stays open until the
          // fade has finished so nothing shrinks while you can still see it.
          // Either way the change lands under a transparent tab, so the strip
          // never appears to grow or drop a step.
          const slot = {
            duration: 0,
            delay: reduceMotion ? 0 : open ? arriveDelay : ABOUT_DRAWER.fadeS,
          };
          return (
            <motion.button
              key={tab.id}
              // Same id the phone's top tabs use — only one of the two sets is
              // ever mounted, so the panel body can point its aria-labelledby at
              // whichever navigation this breakpoint has.
              id={`about-tab-${tab.id}`}
              type="button"
              role="tab"
              className="about-drawer-tab"
              aria-label={tab.label}
              aria-selected={isActive}
              aria-controls="about-panel-body"
              // What exempts the peeking tab from the stylesheet's hover lift —
              // see the `.about-drawer-tab:hover` rule.
              data-peek={!open && shown ? 'true' : undefined}
              disabled={!shown}
              onClick={() => shown && selectTab(tab.id)}
              // The keyboard gets the same invitation the pointer does: the shut
              // drawer's tab is reachable by tab key and, without this, was the
              // one control on the page that gave nothing back when it was
              // reached. Guarded on :focus-visible because a click focuses too,
              // and a mouse already has the hover — counting that click as an
              // invitation left the drawer leaning out behind the panel it had
              // just opened, with the pointer long gone.
              onFocus={(e) => {
                if (!open && peekEntranceDone.current && e.currentTarget.matches(':focus-visible')) {
                  setPeekInvited(true);
                }
              }}
              onBlur={() => setPeekInvited(false)}
              initial={false}
              animate={{
                opacity: shown ? 1 : 0,
                // Sideways, not downwards: a tab comes out from under the panel's
                // spine and travels left into place, and leaves the same way.
                x: shown ? 0 : ABOUT_DRAWER.tabInX,
                height: shown ? ABOUT_DRAWER.tabH : 0,
                marginBottom: shown
                  ? 0
                  : -(ABOUT_DRAWER.tabGap + ABOUT_TAB_COLLAPSED_H),
                pointerEvents: shown ? 'auto' : 'none',
                // Animated rather than set in `style` so the tab lights with the
                // panel it belongs to instead of snapping ahead of the slide.
                backgroundColor: isActive ? ABOUT_DRAWER.bg : ABOUT_DRAWER.idle,
                // The accent the drawer already spends on called-out type, rather
                // than a brighter grey: the tab is being offered, and the yellow
                // is what the rest of the panel uses to say so.
                color: isActive ? '#fff' : invited ? ACCENT_INK : inkA(0.48),
              }}
              transition={{
                duration: reduceMotion ? 0 : ABOUT_DRAWER.fadeS,
                ease: easeOut,
                // Only the tab's arrival is held back. Its colours keep the
                // panel's own clock, so the section you are reading lights up
                // with the surface it belongs to rather than half a beat later.
                x: arrive,
                opacity: arrive,
                height: slot,
                marginBottom: slot,
                // Except the invitation, which travels with the panel it belongs
                // to: on `fadeS` the letters were at full accent while the drawer
                // was a third of the way out, so the tab lit and then the drawer
                // followed instead of the two being one gesture. It is a tween
                // even under reduced motion — a colour arriving instantly is a
                // different thing from a panel that moves.
                ...(invited
                  ? { color: { duration: ABOUT_DRAWER.hoverNudgeS, ease: easeOut } }
                  : null),
              }}
              style={{
                position: 'relative',
                zIndex: isActive ? 3 : 1,
                flex: '0 0 auto',
                boxSizing: 'border-box',
                width: ABOUT_DRAWER.tabW,
                padding: `${ABOUT_DRAWER.tabPadY}px ${ABOUT_DRAWER.tabPadX}px`,
                margin: 0,
                border: `1px solid ${ABOUT_DRAWER.tabOutline}`,
                borderRight: isActive ? 'none' : `1px solid ${ABOUT_DRAWER.tabOutline}`,
                borderRadius: ABOUT_DRAWER.tabRadius,
                cursor: shown ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                // Pull the open tab flush to the panel edge so it reads as one piece.
                marginRight: isActive ? -1 : 0,
              }}
            >
              {/* A tab is cut from the same stock as the panel, so it carries the
                  same grain — its own crop of the field, seeded per tab so four
                  of them stacked up the spine don't repeat the same patch. The
                  panel's layer already declares the filter for the drawer; these
                  each need their own, since the seed is what differs. */}
              <PaperTextureLayer
                {...paper}
                id={`roughpaper-about-tab-${n}`}
                seed={paper.seed + n * 7}
              />
              <span
                style={{
                  // Over the stock, which sits at z-index 0.
                  position: 'relative',
                  fontFamily: ARCHIVE_NAV_TEXT.fontFamily,
                  fontSize: ARCHIVE_NAV_TEXT.fontSize,
                  fontWeight: ARCHIVE_NAV_TEXT.fontWeight,
                  lineHeight: ARCHIVE_NAV_TEXT.lineHeight,
                  letterSpacing: ARCHIVE_NAV_TEXT.letterSpacing,
                  whiteSpace: 'nowrap',
                  transform: 'rotate(-90deg)',
                  userSelect: 'none',
                }}
              >
                {tab.label}
              </span>
            </motion.button>
          );
        })}
      </div>
      )}

      {/* Only the phone gets a header out of the scroll: the top tabs and the ✕
          are how you get around and out of a full-bleed takeover, so they stay
          put while a long section runs under them. Desktop needs neither pinned —
          its section navigation hangs off the spine in the folder tabs — so the
          heading goes into the column and scrolls with the copy. Side padding is
          shared by header and column, which keeps the tab rule the same width as
          the copy it sits over. */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          // Modest inset — the drawer is full-bleed under the chrome, so matching
          // the grid's 112px top left a dead band above the copy.
          padding: compact
            ? `${24 + ARCHIVE_NAV_CHROME_HEIGHT + 16}px 22px 0`
            : `28px 28px 0`,
          boxSizing: 'border-box',
        }}
      >
        {compact ? (
          <div style={{ flex: '0 0 auto' }}>
            {topTabs}
            {titleRow}
          </div>
        ) : null}

        <div
          id="about-panel-body"
          role="tabpanel"
          aria-labelledby={`about-tab-${activeSection}`}
          className="about-col"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            outline: 'none',
            // Air under the heading card, and enough at the foot that the last
            // line clears the phone's home bar. Desktop opens flush instead: its
            // heading is inside this column now and carries that gap on its own
            // margin, so a top pad here would push the title down the panel and
            // leave a band of dead space the copy never scrolls through.
            //
            // Side padding and the negative margin below are one move, not two:
            // together they widen the box (and with it the clip `overflowX` cuts
            // at) while putting the copy back on exactly the inset it had, so the
            // mailing-list card can bleed out past the text without its dashed
            // edge being sliced off. Nothing here moves the reading column.
            padding: compact
              ? `16px ${colBleedGutter}px 72px`
              : `0 ${colBleedGutter}px 48px`,
            marginInline: -colBleedGutter,
          }}
        >
          {compact ? null : titleRow}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={reduceMotion || !open ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion || !open ? undefined : { opacity: 0 }}
              transition={{ duration: ABOUT_DRAWER.fadeS, ease: easeOut }}
            >
              {sectionBody[activeSection]}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );

  // Phone keeps the old full-bleed takeover (no permanent side peek).
  if (compact) {
    return (
      <AnimatePresence>
        {open && (
          <motion.div
            key="about-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: easeOut }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              background: 'rgba(8, 8, 10, 0.55)',
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.2 : 0.4, ease: easeOut }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1001,
              background: ABOUT_DRAWER.bg,
              color: INK,
              overflow: 'hidden',
            }}
          >
            {drawerContent}
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  // Desktop — always mounted. Peeks from the right; slides open to 33vw.
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.button
            key="about-backdrop"
            type="button"
            aria-label="Close about drawer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: easeOut }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              border: 'none',
              padding: 0,
              margin: 0,
              background: 'rgba(8, 8, 10, 0.55)',
              cursor: 'pointer',
            }}
          />
        )}
      </AnimatePresence>

      <motion.aside
        role="dialog"
        aria-modal={open}
        aria-label="About What We Tell AI"
        // Parked off the edge on mount when the peek entrance is due, so the
        // slide in is the only movement anyone sees.
        initial={
          shouldPeekEntrance
            ? { x: peekHiddenX, backgroundColor: ABOUT_DRAWER.idle }
            : false
        }
        // The sliver left on screen when the drawer is shut is this panel's own
        // surface, so it lights and darkens with the slide rather than sitting
        // at reading brightness against a black page all the time.
        animate={{
          x: open ? openX : closedX,
          backgroundColor: open ? ABOUT_DRAWER.bg : ABOUT_DRAWER.idle,
        }}
        // The entrance delay belongs to the mount animation alone; a click has to
        // be answered at once, even one that lands mid-wait.
        transition={{
          duration: reduceMotion ? 0 : ABOUT_DRAWER.slideS,
          ease: easeOut,
          delay: open || peekEntranceDone.current ? 0 : ABOUT_PEEK_ENTER_DELAY,
          // Leaning out is a slower thing than the drawer's own slide, and both
          // are the same property, so the lean brings its own clock for as long
          // as it lasts. Framer takes a named value's transition whole rather
          // than merging it into the defaults above, which is what keeps the
          // entrance delay off a nudge that lands after the drawer has arrived.
          //
          // The way out only. Settling back rides `slideS`, which is also what a
          // close needs, and x cannot tell those two apart without a record of
          // why it last changed — while a six-pixel return drawn out longer than
          // the tab's own dimming reads as the drawer lagging behind the pointer
          // rather than easing home.
          ...(peekNudged
            ? { x: { duration: ABOUT_DRAWER.hoverNudgeS, ease: easeOut } }
            : null),
        }}
        // Read on the panel, not on the tab. The tab hangs outside the spine on a
        // translateX(-100%), so what the pointer meets is two strips of one
        // object — a handler on each fired an end and a start as the cursor
        // crossed between them, and the drawer settled a pixel back before
        // leaning out again. The tab is a descendant of this element, so
        // pointerenter/leave here spans both and ignores the seam.
        //
        // Framer's hover pair rather than a CSS :hover, because it is
        // pointer-aware: a tap fires neither, so a touch that never "leaves"
        // can't strand the drawer six pixels out for the rest of the session.
        onHoverStart={() => {
          // Nothing during the once-a-session entrance. The arrival owns x and
          // still has `ABOUT_PEEK_ENTER_DELAY` on it, so a nudge landing while
          // the drawer was still sliding in re-queued that wait from wherever it
          // had got to and left the panel stopped short of the edge.
          if (!open && peekEntranceDone.current) setPeekInvited(true);
        }}
        onHoverEnd={() => setPeekInvited(false)}
        // Told upward as well as kept here: this ref only lives as long as the
        // component, and the guarantee that the peeking tab stays on screen has
        // to outlast any remount.
        onAnimationComplete={() => {
          peekEntranceDone.current = true;
          onPeekLanded?.();
        }}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: ABOUT_DRAWER.w,
          zIndex: open ? 1001 : 180,
          color: INK,
          overflow: 'visible',
          boxShadow: open ? '-24px 0 60px rgba(0,0,0,0.45)' : 'none',
        }}
      >
        {drawerContent}
      </motion.aside>
    </>
  );
}

/** How much of the onboarding cta's scatter the view tabs take.
 *
 *  Less, because these are chrome rather than a closing flourish: the cta is met
 *  once at the end of a sequence, while a cursor crosses INDEX / EXPLORE on the
 *  way to everything else in the bar. At full strength the pair twitched as the
 *  pointer passed over them, which is the difference between a label coming
 *  loose and a nav bar that can't sit still. */
const NAV_SCATTER_STRENGTH = 0.6;

function ToggleButton({ active, onClick, children, style }) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.button
      onClick={(e) => {
        onClick?.(e);
      }}
      // Motion's hover pair rather than mouseenter / :hover, because it is
      // pointer-aware: a tap on a phone fires neither, so the letters can't be
      // left scattered by a touch that never "leaves."
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      // The label is a span per glyph below, which a screen reader would
      // otherwise spell out a letter at a time.
      aria-label={children}
      style={{
        background: 'none',
        border: 'none',
        padding: '2px 4px',
        ...ARCHIVE_NAV_TEXT,
        ...ARCHIVE_LINK_UNDERLINE,
        // The lift rides the same state as the scatter rather than being
        // written onto the node, so a re-render under the cursor can't drop it
        // back to the resting value.
        opacity: active ? 1 : hovered ? 0.8 : 0.5,
        cursor: 'pointer',
        transition: `opacity 0.2s ${HOVER_EASE}`,
        ...style,
      }}
    >
      {/* The dotted rule is painted on the button, so it stays one line under
          the word while the glyphs come loose above it.

          The tab you are already on doesn't scatter: hover on this pair has
          always meant "you can go here" — it is why the opacity lift skips the
          active tab too — and the current view is not somewhere to go. */}
      <ScatterLabel
        text={children}
        scattered={hovered && !active}
        strength={NAV_SCATTER_STRENGTH}
      />
    </motion.button>
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
  belowGap: 8, // px between the INDEX label and the grid
  cellW: 26,
  cellH: 30,
  gridGap: 4,
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
  gap: 10, //           px below the EXPLORE button the fan hangs
  cardW: 42, //         px — paper-card width
  cardH: 46, //         px — paper-card height
  stagger: 0.05, //     s between cards fanning out
  exitStagger: 0.035, // s between cards collapsing back (reverse)
  open: { duration: 0.42, ease: [0.18, 0.89, 0.32, 1.27] },
  exit: { duration: 0.15, ease: [0.4, 0, 1, 1] },
  closeDelayMs: 100, // grace so pointer travel never flickers closed
  collapsed: { opacity: 0, x: 0, y: -6, rotate: -3, scale: 0.9 },
};

const EXPLORE_HOVER_ITEMS = [
  { img: '/index-card-1.png', fan: { x: -30, y: 10, rotate: -18 } },
  { img: '/index-card-2.png', fan: { x: 0, y: 0, rotate: -2 } },
  { img: '/index-card-3.png', fan: { x: 28, y: 10, rotate: 16 } },
];

const EXPLORE_FAN_TILT = {
  maxYaw: 12,
  maxPitch: 10,
  perspective: 420,
  lift: 1.05,
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
      {/* Flush left so INDEX glyphs sit on the grid edge — the dotted underline
          paints across the padding box, so left pad would leave dots before the I. */}
      <ToggleButton
        active={!aboutOpen && view === 'grid'}
        onClick={() => onChange?.('grid')}
        style={{ paddingLeft: 0 }}
      >
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

/** Non-interactive divider so the pair reads as one "INDEX / EXPLORE" nav unit
 *  rather than two loose tabs. Dimmer than an inactive tab so it never looks
 *  clickable. */
function NavSlash() {
  return (
    <span
      aria-hidden="true"
      style={{ ...ARCHIVE_NAV_TEXT, opacity: 0.3, userSelect: 'none' }}
    >
      /
    </span>
  );
}

/**
 * The archive's view switch: INDEX / EXPLORE, each carrying its desktop hover
 * preview (INDEX's 2×2 note grid, EXPLORE's 3-card fan). Desktop-only — phone
 * widths switch views from the hamburger, which has no hover to preview into.
 *
 * While the About panel is open, ABOUT is the current destination, so both tabs
 * must read as inactive (dimmed) — otherwise INDEX stays lit from the underlying
 * view and the bar shows two active tabs.
 */
function ViewTabs({ view, onChange, aboutOpen = false }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        pointerEvents: 'auto',
      }}
    >
      <IndexMenu view={view} onChange={onChange} aboutOpen={aboutOpen} />
      <NavSlash />
      <ExploreMenu view={view} onChange={onChange} aboutOpen={aboutOpen} />
      {/* EXPERIMENT + CUBE tabs hidden for now — the views still exist and stay
          reachable via ?view=experiment / ?view=cube. */}
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

/** Semi-translucent fill for the phone filter row — search + facet tabs share
    one charcoal so tiles can drift through as the bar floats over the grid,
    without the frosted smear backdrop-filter used to leave behind. */
const MOBILE_FILTER_FILL = 'rgba(31, 30, 28, 0.72)';
const MOBILE_FILTER_FILL_HOVER = 'rgba(31, 30, 28, 0.86)';

/* ── SEARCH FIELD ICON ──────────────────────────────────────────────────
 * A magnifier set just left of the placeholder, drawn as a background image
 * because an <input> can't hold a child. It stays put once there's a query in
 * the field: it marks what the field IS, so having it leave with the placeholder
 * would turn it into decoration on empty state.
 *
 * The glyph is inline SVG rather than a font glyph (⌕ is missing from the mono
 * stack and lands as a box) or a component, matching how the native clear ✕ is
 * replaced in .grid-search-input's stylesheet below.
 *
 * It rides the placeholder's own alpha at rest, so nothing in an untouched field
 * is brighter than anything else in it — the whole control reads as one unlit
 * object until you're in it.
 *
 * MUST be spread into an inline style, and any fill declared alongside it MUST be
 * `backgroundColor`, not the `background` shorthand: inline wins over the class,
 * and the shorthand would blank the image back out (the same trap documented in
 * linkUnderline.js).
 * ────────────────────────────────────────────────────────────────────── */
const SEARCH_ICON_PX = 13;
/** px between the glyph and the text that follows it. */
const SEARCH_ICON_GAP = 8;
const searchIconStyle = (inset) => ({
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23CFCAB7' stroke-opacity='0.4' stroke-width='1.5' stroke-linecap='round'%3E%3Ccircle cx='6.75' cy='6.75' r='4.25'/%3E%3Cpath d='M10.1 10.1 L13.6 13.6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: `left ${inset}px center`,
  backgroundSize: `${SEARCH_ICON_PX}px ${SEARCH_ICON_PX}px`,
  // The glyph occupies the padding, so the text has to start clear of both.
  paddingLeft: inset + SEARCH_ICON_PX + SEARCH_ICON_GAP,
});

/** Embedded facet menu trigger that sits beside the search field, squared off to
    match it — they share a row, and a pill next to that dashed rectangle read as
    a control borrowed from somewhere else. The lighter fill is what still tells
    them apart. */
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
  background: MOBILE_FILTER_FILL,
  border: '1px solid rgba(207,202,183,0.18)',
  borderRadius: 0,
  // 12 rather than the 16 the search field used to use alongside it: the two
  // pills and the field now share one row, and at 360px — the narrowest phone
  // worth designing for — the wider pills left the field too short to show its
  // own placeholder.
  padding: '9px 12px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: `border-color 0.2s ${HOVER_EASE}, background 0.2s ${HOVER_EASE}`,
};

/** Floating dropdown surface for the facet menu (compact/phone bar only —
    desktop uses the sidebar accordions). Opens downward below the button since
    the phone filter bar docks at the top of the view, and hangs from the
    button's RIGHT edge: the tabs sit against the right of the bar, and a panel
    wider than its tab would otherwise run off that edge of a phone. */
const facetMenuPanelStyle = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  minWidth: 208,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: 6,
  // Square, like the tab it hangs from and the search field beside it.
  borderRadius: 0,
  background: MENU_SURFACE,
  border: `1px solid ${MENU_SURFACE_BORDER}`,
  boxShadow: MENU_SURFACE_SHADOW,
};

/** A single Category / Location row inside the facet menu. */
const facetMenuItemStyle = (current) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '9px 12px',
  borderRadius: 0,
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
    instead. Geometry (FILTER_SIDEBAR_*, GRID_CONTENT_LEFT, GRID_NAV_LEFT) is
    declared above with the archive nav chrome so INDEX / EXPLORE can align to
    the first tile's number.
    Entrance: the rail's rows (search → Category → Location) slide in one after
    another, starting just after the nav chrome has landed (see
    ARCHIVE_NAV_CHROME_DELAY_GRID) so the sidebar reads as a follow-on beat. */
// How long the category checkboxes take to let go before their labels lift off
// toward the explore dial. Long enough to read as a release, short enough that
// EXPLORE still feels like it responded to the click.
const FLIGHT_FADE_MS = 220;
// The flight home is parked for now: explore → index just switches views. The
// machinery is untouched and still exercised in the other direction, so this is
// the only thing standing between it and coming back.
const FLY_HOME = false;
/* ─────────────────────────────────────────────────────────────────────
 * ANIMATION STORYBOARD — LEAVING THE INDEX (index → explore)
 *
 * What the flight leaves behind. The index doesn't go as one sheet: the
 * rail follows the words out, the grid holds the screen alone for a beat,
 * and only then dissolves. Times are ms after the EXPLORE click — the
 * words' own journey is storyboarded in CategoryFlight.jsx.
 *
 *    0ms   category checkboxes let go                        (220ms)
 *  220ms   words lift off; the emptied rail goes with them    (220ms)
 *  440ms   sidebar gone — the grid is the only thing left
 *  620ms   the grid dissolves beneath the flight              (240ms)
 *  860ms   grid gone; the dial mounts behind the words, dark
 *  920ms   words land; the dial cuts in under them
 *
 * Both exits are triggered by the same frame (the one that unmounts
 * GridView, which is also lift-off), so these are delays from 220ms
 * rather than from the click.
 *
 * THE GRID MUST FINISH BEFORE THE WORDS LAND. The view switch is an
 * AnimatePresence mode="wait", so the dial doesn't exist until the index
 * has cleared — and the flight hands off on its own clock at 920ms
 * whether or not there's anything underneath to hand off to. Overrun that
 * and the words dissolve into a gap, with the dial fading up behind them a
 * beat later. `cameByFlight` keeps that failure survivable; these numbers
 * are what stop it happening.
 * ───────────────────────────────────────────────────────────────────── */
const DEPARTURE = {
  sidebarFade: 0.22, //  s — the rail follows the words it just released
  gridHold: 0.4, //      s — the beat where the grid stands alone
  gridFade: 0.24, //     s — dissolve, done just before the words land
};
// The two ends of a category's journey, as the flight's overlay draws them. It
// renders every word at the dial's own font size, so the rail end is that size
// scaled down rather than a second font.
const RAIL_POSE = { scale: 12 / WHEEL.labelFont, track: '0.1em' };
const DIAL_POSE = { scale: 1, track: '0em', color: '#e2e2e2' };
// Rows further from the arc's centre set off fractionally later, so the fan
// opens and closes outward instead of every word moving as one block.
const FLIGHT_STAGGER_S = 0.025;
// A checked row is brighter. Read the tick off the row rather than mirroring
// selectedCats: starting (or ending) a copy on the wrong ink pops at the cut.
const railInk = (el) =>
  el.closest('[role="menuitemcheckbox"]')?.getAttribute('aria-checked') === 'true'
    ? INK
    : inkA(0.7);
/**
 * `labels`, rotated so `centre` sits in the middle position.
 *
 * With the dial's centre in the rail's middle row, rail order and arc order
 * line up one-to-one: the top row flies to the top of the arc, the middle row
 * stays put, the bottom row flies to the bottom. Nothing crosses anything
 * else. Left in canonical order the arc's centre would be the FIRST row, so
 * the back half of the list has to wrap up and over the top — four words
 * swimming through each other on every trip.
 *
 * A rotation rather than a re-sort, because the wheel is cyclic: rotating the
 * list is just turning the wheel, and every category keeps the same
 * neighbours it has on the dial.
 */
const centreOn = (labels, centre) => {
  const n = labels.length;
  const d = labels.indexOf(centre);
  if (n < 3 || d < 0) return labels;
  const mid = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => labels[(i + d - mid + n) % n]);
};
/**
 * Where `label` sits in the rail, as a flight pose: upright, lit, and small.
 *
 * A word's row is not a fixed property of the word. The rail is a rotation of
 * the dial (see `centreOn`), so turning the wheel on the explore view moves
 * every category up or down the list. `order` is the arrangement to aim at —
 * pass the one the rail is about to mount with, which on the way home is not
 * the one it had when it was last measured.
 */
const railPoseAt = (geom, label, order) => {
  const box = geom?.box.get(label);
  if (!box) return null;
  const row = (order ?? geom.order).indexOf(label);
  if (row < 0 || row >= geom.rows.length) return null;
  return {
    cx: box.left + box.width / 2,
    cy: geom.rows[row],
    rotate: 0,
    opacity: 1,
    ...RAIL_POSE,
    color: box.color,
  };
};
const FILTER_SIDEBAR_ENTER_DELAY = ARCHIVE_NAV_CHROME_DELAY_GRID + 0.15;
const FILTER_SIDEBAR_ENTER_STAGGER = 0.1;
/**
 * The search field's outline is drawn rather than faded (see TracedOutline), on
 * the rail's own first beat. Long enough at a 470px perimeter to read as a line
 * travelling the box, short enough to be closed before the second accordion has
 * finished arriving under it — the trace is the top of one arrival, not a
 * flourish the rest of the rail waits on.
 */
const SEARCH_OUTLINE_TRACE_DURATION = 0.62;
/** The glyph and placeholder come up just behind the front of the trace, so the
    field reads as a box being drawn and then filled rather than a label with a
    line appearing around it. */
const SEARCH_FIELD_INK_DELAY = 0.18;
/** Last sidebar row (search + 2 accordions + copyright) lands, then ABOUT peeks in. */
const ABOUT_PEEK_ENTER_DELAY =
  FILTER_SIDEBAR_ENTER_DELAY + 3 * FILTER_SIDEBAR_ENTER_STAGGER + 0.5;

/**
 * Facet checkbox (Category / Location rows). Empty square at rest; checking
 * draws a checkmark in rather than filling the box. The mark rides the same
 * NoiseDisplaceFilter the old asterisk used — at this size the wobble sells it
 * as inked rather than set. Its own filter id because the grid's is tuned for
 * 200px photographs, and a 3px push on a 13px glyph tears it apart.
 */
const FACET_MARK_FILTER_ID = 'facet-mark-noise';
const FACET_MARK_FILTER = {
  displaceFrequency: '0.09 0.11',
  scale: 1.3,
  grainFrequency: 1.1,
  grainOpacity: 0.32,
  seed: 9,
  warpDur: 11,
  grainFps: 8,
  grainSteps: 6,
};
const FACET_CHECK_SIZE = 13;
const FACET_CHECK_EASE = [0.165, 0.84, 0.44, 1];

/** Square checkbox with a pathLength-drawn checkmark (no fill-in). */
function FacetCheckboxMark({ on, style }) {
  const reduceMotion = useReducedMotion();
  return (
    <span
      aria-hidden="true"
      className="facet-checkbox-box"
      style={{
        width: FACET_CHECK_SIZE,
        height: FACET_CHECK_SIZE,
        flex: '0 0 auto',
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 2,
        border: `1px solid ${on ? inkA(0.9) : inkA(0.4)}`,
        background: 'transparent',
        color: on ? INK : inkA(0.4),
        ...style,
      }}
    >
      <svg
        width={FACET_CHECK_SIZE - 2}
        height={FACET_CHECK_SIZE - 2}
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        style={{
          display: 'block',
          // Grain / warp rides the SVG so the stroke edges shimmer like ink.
          filter: on ? `url(#${FACET_MARK_FILTER_ID})` : 'none',
          overflow: 'visible',
        }}
      >
        <motion.path
          d="M2.2 6.2 L5 9 L9.8 3.2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={
            on
              ? { pathLength: 1, opacity: 1 }
              : { pathLength: 0, opacity: 0 }
          }
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.22, ease: FACET_CHECK_EASE }
          }
        />
      </svg>
    </span>
  );
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
// Glyphs per line before the sheet has been measured — see GridLattice, which
// replaces these with counts derived from the real box. Only ever visible for a
// frame, so they just need to be plausible rather than right.
const LATTICE_H_CHARS = 360;
const LATTICE_V_CHARS = 120;
// Characters in each measuring probe. Long enough that rounding on a single
// glyph's advance doesn't matter once it's divided back out.
const LATTICE_PROBE = 100;
const LATTICE_PROBE_H = 'X'.repeat(LATTICE_PROBE);
const LATTICE_PROBE_V = LATTICE_PROBE_H.split('').join('\n');

/* Deterministic PRNG (mulberry32) seeded off a string. The scramble and the
   order it types itself on in both have to survive re-renders, so neither can
   reach for Math.random. */
function latticeRng(key) {
  let t = 0;
  for (let i = 0; i < key.length; i++) t = (t * 31 + key.charCodeAt(i)) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function latticeAscii(key, count) {
  const rand = latticeRng(key);
  let out = '';
  for (let n = 0; n < count; n++) out += LATTICE_ASCII[Math.floor(rand() * LATTICE_ASCII.length)];
  return out;
}

/* Crossings. Where two hairlines meet they used to write over each other, and
   two 8px glyphs in one cell come out as a smudge rather than as either
   character. Each crossing is now a single '+' on its own layer, with the glyphs
   underneath cleared out from both runs so nothing collides with it.
 
   Two cells are cleared per axis, not one. The lines are positioned as a
   percentage of the sheet while their glyphs are positioned by the font's
   advance, so a crossing falls wherever it falls inside a cell; clearing the
   cell the crossing lands in AND the one after it is what guarantees the '+'
   has clear air whichever way that rounding goes. */
const LATTICE_CROSS = '+';
const LATTICE_CROSS_CLEAR = 2;

/** `text` with every index in `indices` blanked out. */
function latticeClear(text, indices) {
  if (!indices || !indices.size) return text;
  const chars = text.split('');
  indices.forEach((at) => {
    if (at >= 0 && at < chars.length) chars[at] = ' ';
  });
  return chars.join('');
}

/* Type-on. A hairline doesn't draw from one end — its glyphs land in a shuffled
   order, so the sheet reads as characters being typed all over it rather than
   as lines sweeping out. Every position a glyph hasn't reached yet is held by a
   space, so the run's extent is right from the first frame and nothing shifts
   as it fills.
   Lines start on their own stagger (see latticeLines) plus a random head start,
   so they overlap unevenly instead of marching in a wave. */
const LATTICE_TYPE = {
  perLineS: 0.9, // how long one hairline takes to fill
  jitterS: 0.3, // extra random head start on top of the line's stagger
  tickMs: 50, //   beat between fills; the sheet runs to ~30k glyphs, and a
  //               rewrite every frame buys nothing you can see
};

/* Occasional churn — every so often a handful of glyphs somewhere in the sheet
   swap for other characters, so the lattice keeps rewriting itself under the
   notes. Swaps are kept rather than reverted: the sheet drifts instead of
   blinking between two states.
   Two things make a swap something you actually catch out of the corner of your
   eye rather than a statistical event. A burst lands on ONE line within
   `clusterSpan` glyphs of an anchor, so a few characters change together in one
   spot instead of scattering across 30k of them. And the anchor is picked from
   what's on screen — the sheet is the full height of the archive (~29,000px at
   three columns), so a swap chosen uniformly would land off-screen ~97% of the
   time. The beat is a random interval rather than a metronome so it reads as
   occasional. */
const LATTICE_CHURN = {
  minMs: 420, //      shortest gap between bursts
  maxMs: 1500, //     longest
  minSwaps: 2, //     glyphs changed in a burst
  maxSwaps: 6,
  clusterSpan: 12, // how far from the anchor a burst's glyphs can land
};

/* Hover — the four hairline segments boxing the note under the cursor trade
   their scramble for shade blocks, one glyph at a time, so the lattice draws a
   frame around what you're looking at.
   The blocks are picked per position off `glyphs` rather than at random, so the
   run comes out mottled and stays put: at 8px the two densities read as a
   dither rather than as characters. Listing ▒ twice weights it over ░.
   Wipes are short — this is a pointer response, not a beat of the entrance. */
const LATTICE_HOVER = {
  glyphs: '░▒▒░',
  inS: 0.22, //  segment fills in
  outS: 0.16, // and falls back to the scramble
};

/**
 * One hairline of the lattice.
 *
 * Memoized, and handed its text already laid out (verticals arrive newline-
 * separated), because the layer re-renders on every beat of the type-on and
 * again on every churn swap. Only the lines whose string actually changed
 * re-render; without this each beat would rebuild all ~60 lines in the sheet.
 */
const LatticeLine = memo(function LatticeLine({ line, text, endInset }) {
  const v = line.axis === 'v';
  // The closing line on each axis sits ON the far edge, where the layer clips
  // it away; back it off by the run's own thickness so it lands flush inside
  // instead. Every other line hangs off its cell boundary as-is.
  const main = line.atEnd ? `calc(${line.main} - ${v ? endInset.v : endInset.h}px)` : line.main;
  return (
    <div
      className="grid-lattice-line"
      style={
        v
          ? { top: 0, left: main, width: '0.72em', height: `${line.lenPct}%` }
          : { left: 0, top: main, height: '0.92em', width: `${line.lenPct}%` }
      }
    >
      <span className={`grid-lattice-glyphs${v ? ' grid-lattice-glyphs-v' : ''}`} aria-hidden="true">
        {text}
      </span>
    </div>
  );
});

/**
 * The lattice layer — ASCII hairlines drawn on independently of the tiles. Each
 * line is a seeded scramble of mono glyphs pinned to a cell edge, and it types
 * itself on a character at a time in a shuffled order once the notes have
 * landed (see LATTICE_TYPE).
 *
 * Its own component so the type-on, churn and hover clocks re-render the
 * hairlines alone. Held in GridView the same state would rebuild every tile in
 * the grid on every beat — which is also why the hovered cell arrives through a
 * ref rather than a prop: a note lighting up its box shouldn't re-render the
 * other 164 notes.
 */
const GridLattice = forwardRef(function GridLattice(
  { lines, crosses, cols, rows, drawn, noteOpen, reduceMotion, skipEntrance, disableChurn },
  ref,
) {
  const hostRef = useRef(null);
  const hProbeRef = useRef(null);
  const vProbeRef = useRef(null);

  // How many glyphs a line needs to reach the end of the sheet. Measured rather
  // than fixed, because the sheet's height is the note count divided by the
  // column count: at two columns the archive runs ~29,000px, which is 4,000
  // glyphs down a vertical. A fixed count is what left the verticals stopping a
  // few hundred px in, and no single constant can cover both that and a wide
  // monitor's short, broad sheet.
  //
  // The per-glyph advance has to be measured too — it falls out of the resolved
  // mono face, the font size and the letter-spacing, all of which live in the
  // stylesheet rather than here.
  const [counts, setCounts] = useState({ h: LATTICE_H_CHARS, v: LATTICE_V_CHARS });
  // How thick a run is across its own axis — a horizontal's line box, a
  // vertical's column. The closing line on each axis is pinned to the far edge
  // and has to be pulled back inside by this much to clear `overflow: hidden`.
  // Measured for the same reason the advance is: it falls out of the resolved
  // mono face and font size, both of which live in the stylesheet. The seed
  // values match the 8px run the stylesheet asks for, and hold for the frame
  // before the probes are read.
  const [endInset, setEndInset] = useState({ h: 8, v: 5 });
  // Kept alongside the counts for the churn, which turns a glyph index on a
  // vertical back into a y offset to work out which ones are on screen.
  const stepRef = useRef({ h: 0, v: 0 });
  useLayoutEffect(() => {
    const host = hostRef.current;
    const hProbe = hProbeRef.current;
    const vProbe = vProbeRef.current;
    if (!host || !hProbe || !vProbe) return undefined;
    const measure = () => {
      // Both probes are absolutely positioned, so they size to their own text
      // and their rect IS the run's extent. Measured off the rect rather than
      // scrollWidth/scrollHeight because those round to whole pixels: the true
      // vertical advance is ~7.36px, and rounding it to 7.37 compounds across
      // 4,000 glyphs into a line that stops short of the bottom.
      const hRect = hProbe.getBoundingClientRect();
      const vRect = vProbe.getBoundingClientRect();
      const hStep = hRect.width / LATTICE_PROBE;
      const vStep = vRect.height / LATTICE_PROBE;
      const box = host.getBoundingClientRect();
      if (!(hStep > 0) || !(vStep > 0)) return;
      stepRef.current = { h: hStep, v: vStep };
      // The probes run the length of their own axis, so their other dimension
      // is exactly the run's thickness.
      const inset = { h: hRect.height, v: vRect.width };
      setEndInset((prev) => (prev.h === inset.h && prev.v === inset.v ? prev : inset));
      // A couple extra each way, so a line runs off the end rather than
      // stopping a glyph short of it.
      const h = Math.ceil(box.width / hStep) + 2;
      const v = Math.ceil(box.height / vStep) + 2;
      setCounts((prev) => (prev.h === h && prev.v === v ? prev : { h, v }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // key → the glyph indices that line has to leave clear for its crossings. The
  // counts carry two spare glyphs so a run overshoots the sheet rather than
  // stopping short of it, so `count - 2` is what actually spans the box — which
  // is what turns a crossing's fraction along the axis into an index.
  const cleared = useMemo(() => {
    const m = new Map();
    if (!cols || !rows) return m;
    const hSpan = Math.max(1, counts.h - 2);
    const vSpan = Math.max(1, counts.v - 2);
    const add = (key, from) => {
      let set = m.get(key);
      if (!set) m.set(key, (set = new Set()));
      for (let n = 0; n < LATTICE_CROSS_CLEAR; n += 1) set.add(from + n);
    };
    (crosses || []).forEach(({ col, row }) => {
      add(`h${row}`, Math.floor((col / cols) * hSpan));
      add(`v${col}`, Math.floor((row / rows) * vSpan));
    });
    return m;
  }, [crosses, cols, rows, counts]);

  // key → that line's seeded scramble at the current length, with its crossings
  // cleared. `latticeAscii` walks its PRNG forward from the key, so a longer
  // sheet extends a line's existing scramble rather than reshuffling it —
  // growing the grid doesn't redraw the glyphs already on screen.
  const seeded = useMemo(() => {
    const m = new Map();
    lines.forEach((line) => {
      const text = latticeAscii(
        `lattice-${line.key}`,
        line.axis === 'v' ? counts.v : counts.h,
      );
      m.set(line.key, latticeClear(text, cleared.get(line.key)));
    });
    return m;
  }, [lines, counts, cleared]);

  // key → that line's current text, once churn has touched it. A line missing
  // from the map is still showing its seeded scramble.
  const [churned, setChurned] = useState(() => new Map());

  // A relayout reseeds every line, so drop the swaps rather than carrying them
  // onto strings they no longer line up with.
  useEffect(() => {
    setChurned(new Map());
  }, [seeded]);

  /* ---- type-on ---------------------------------------------------------- */

  const animateType = !reduceMotion && !skipEntrance;
  const [typed, setTyped] = useState(() => new Map());
  const [typeDone, setTypeDone] = useState(false);
  // Before the tiles have landed nothing has been typed yet, so every line is
  // holding an empty string — the sheet is blank until `drawn`.
  const settled = !animateType || typeDone;

  // Per line: the order its glyphs arrive in (a seeded shuffle of every
  // position) and when it starts. Rebuilt with the scramble because the order
  // indexes into it.
  const typePlan = useMemo(() => {
    if (!animateType) return null;
    const m = new Map();
    lines.forEach((line) => {
      const text = seeded.get(line.key) ?? '';
      const rand = latticeRng(`type-${line.key}`);
      const order = new Int32Array(text.length);
      for (let i = 0; i < order.length; i += 1) order[i] = i;
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
      }
      m.set(line.key, {
        text,
        order,
        delay: line.delay + rand() * LATTICE_TYPE.jitterS,
        sep: line.axis === 'v' ? '\n' : '',
      });
    });
    return m;
  }, [animateType, lines, seeded]);

  useEffect(() => {
    if (settled || !drawn || !typePlan || !lines.length) return undefined;
    // Each line keeps a mutable buffer of spaces and a cursor into its order,
    // so a beat only writes the glyphs that just arrived rather than walking
    // the whole scramble again. The join is the only per-beat O(length) cost,
    // and lines that didn't gain a glyph hand back the same string so their
    // LatticeLine skips the render entirely.
    const state = [];
    typePlan.forEach((plan, key) => {
      state.push({ key, plan, chars: new Array(plan.text.length).fill(' '), cursor: 0, out: '' });
    });
    const t0 = performance.now();
    let raf = 0;
    let last = -Infinity;
    const step = (now) => {
      if (now - last >= LATTICE_TYPE.tickMs) {
        last = now;
        const elapsed = (now - t0) / 1000;
        let done = true;
        const next = new Map();
        for (const s of state) {
          const len = s.plan.text.length;
          const p = (elapsed - s.plan.delay) / LATTICE_TYPE.perLineS;
          const target = p <= 0 ? 0 : p >= 1 ? len : Math.floor(p * len);
          if (target < len) done = false;
          if (target !== s.cursor) {
            for (let i = s.cursor; i < target; i += 1) {
              const at = s.plan.order[i];
              s.chars[at] = s.plan.text[at];
            }
            s.cursor = target;
            s.out = s.chars.join(s.plan.sep);
          }
          next.set(s.key, s.out);
        }
        if (done) {
          setTypeDone(true);
          return;
        }
        setTyped(next);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [settled, drawn, typePlan, lines]);

  // key → that line's glyphs with churn applied, one character per position.
  // The hover wipe splices into these, so it needs them before the verticals
  // get their newlines.
  const raws = useMemo(() => {
    const m = new Map();
    lines.forEach((line) => m.set(line.key, churned.get(line.key) ?? seeded.get(line.key) ?? ''));
    return m;
  }, [lines, seeded, churned]);

  // key → the exact string the line paints. Verticals get their newlines here
  // rather than in LatticeLine so the type-on can write straight into the laid
  // out form instead of splitting a fresh copy on every beat.
  const rendered = useMemo(() => {
    const m = new Map();
    lines.forEach((line) => {
      const raw = raws.get(line.key) ?? '';
      m.set(line.key, line.axis === 'v' ? raw.split('').join('\n') : raw);
    });
    return m;
  }, [lines, raws]);

  // Paused while the note view is open — the layer is faded to zero there, so
  // the swaps would be invisible work — and until the sheet has finished
  // typing, which owns the text until then.
  const live = !reduceMotion && drawn && !noteOpen && settled && !disableChurn;
  useEffect(() => {
    if (!live || !lines.length) return undefined;
    let timer = 0;
    const beat = () => {
      // Next beat is booked first, so a burst that finds nothing to swap skips
      // its turn rather than ending the churn for the session.
      timer = window.setTimeout(
        beat,
        LATTICE_CHURN.minMs + Math.random() * (LATTICE_CHURN.maxMs - LATTICE_CHURN.minMs),
      );
      // Layout is read out here rather than inside the updater, which has to
      // stay a pure function of the previous map.
      const rect = hostRef.current?.getBoundingClientRect();
      const vStep = stepRef.current.v;
      // The slice of the sheet that's on screen, in host-local coordinates.
      const top = rect ? Math.max(0, -rect.top) : 0;
      const bottom = rect ? Math.min(rect.height, -rect.top + window.innerHeight) : 0;
      // Verticals always cross the viewport; a horizontal only counts if its
      // own row is in it. Falls back to the whole sheet if the host hasn't been
      // laid out yet.
      const pool = rect
        ? lines.filter((line) => {
            if (line.axis === 'v') return true;
            const y = (rect.height * line.mainPct) / 100;
            return y >= top && y <= bottom;
          })
        : lines;
      if (!pool.length) return;
      const line = pool[Math.floor(Math.random() * pool.length)];

      setChurned((prev) => {
        const cur = prev.get(line.key) ?? seeded.get(line.key);
        if (!cur) return prev;
        // Window of glyph indices that are on screen. Horizontals run across
        // the host, which is never wider than the viewport, so all of theirs
        // are; a vertical's index is its row, so it maps back through the
        // measured advance.
        let lo = 0;
        let hi = cur.length;
        if (line.axis === 'v' && vStep > 0) {
          const a = Math.max(0, Math.floor(top / vStep));
          const b = Math.min(cur.length, Math.ceil(bottom / vStep));
          if (b - a > 1) {
            lo = a;
            hi = b;
          }
        }
        const chars = cur.split('');
        const skip = cleared.get(line.key);
        const anchor = lo + Math.floor(Math.random() * (hi - lo));
        const swaps =
          LATTICE_CHURN.minSwaps +
          Math.floor(Math.random() * (LATTICE_CHURN.maxSwaps - LATTICE_CHURN.minSwaps + 1));
        for (let n = 0; n < swaps; n += 1) {
          const drift = Math.round((Math.random() * 2 - 1) * LATTICE_CHURN.clusterSpan);
          const at = Math.min(hi - 1, Math.max(lo, anchor + drift));
          // A burst that drifts onto a crossing skips that glyph — the churn
          // must not write back into the gap the '+' sits in.
          if (skip?.has(at)) continue;
          chars[at] = LATTICE_ASCII[Math.floor(Math.random() * LATTICE_ASCII.length)];
        }
        const next = new Map(prev);
        next.set(line.key, chars.join(''));
        return next;
      });
    };
    timer = window.setTimeout(beat, LATTICE_CHURN.minMs);
    return () => clearTimeout(timer);
  }, [live, lines, seeded, cleared]);

  /* ---- hover box -------------------------------------------------------- */

  // Read through a ref so the running wipe always splices into the current
  // scramble — a churn burst mid-hover shouldn't be rolled back when the
  // pointer leaves.
  const rawsRef = useRef(raws);
  rawsRef.current = raws;

  const [hoverCell, setHoverCell] = useState(null);
  useImperativeHandle(ref, () => ({ hoverCell: setHoverCell }), []);

  // The four segments boxing a cell: the two verticals either side of it,
  // clipped to the rows it spans, and the two horizontals above and below it,
  // clipped to its column. A line's glyph count covers the whole sheet, so a
  // cell's slice of it is just its slice of the grid.
  const cellSegments = useCallback(
    (cell) => {
      if (!cell || !cols || !rows) return null;
      const { row, col } = cell;
      const segs = [];
      const add = (key, from, to) => {
        const raw = rawsRef.current.get(key);
        if (!raw) return;
        const lo = Math.floor(from * raw.length);
        const hi = Math.min(raw.length, Math.ceil(to * raw.length));
        if (hi > lo) segs.push({ key, lo, hi, sep: key[0] === 'v' ? '\n' : '' });
      };
      add(`v${col}`, row / rows, (row + 1) / rows);
      add(`v${col + 1}`, row / rows, (row + 1) / rows);
      add(`h${row}`, col / cols, (col + 1) / cols);
      add(`h${row + 1}`, col / cols, (col + 1) / cols);
      return segs.length ? segs : null;
    },
    [cols, rows],
  );

  // key → the string a boxed line paints while the wipe is up. Null when the
  // box is down, which hands the lines back to `rendered`.
  const [boxed, setBoxed] = useState(null);
  const segsRef = useRef(null);
  const cellRef = useRef(null);
  const wipeRef = useRef(0); // how far along the box is, 0..1

  useEffect(() => {
    if (reduceMotion) return undefined;
    if (hoverCell) {
      // Crossing to a different note starts its box from nothing, rather than
      // inheriting how far the last one had got — otherwise sliding along a row
      // pops each box in fully formed instead of tracing it.
      const id = `${hoverCell.row}:${hoverCell.col}`;
      if (id !== cellRef.current) {
        cellRef.current = id;
        wipeRef.current = 0;
        segsRef.current = cellSegments(hoverCell);
      }
    } else {
      cellRef.current = null;
    }
    const segs = segsRef.current;
    if (!segs) return undefined;
    const from = wipeRef.current;
    const to = hoverCell ? 1 : 0;
    const ms = (hoverCell ? LATTICE_HOVER.inS : LATTICE_HOVER.outS) * 1000;
    const t0 = performance.now();
    let raf = 0;
    const step = (now) => {
      const k = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
      const p = from + (to - from) * k;
      wipeRef.current = p;
      const next = new Map();
      for (const seg of segs) {
        const raw = rawsRef.current.get(seg.key);
        if (!raw) continue;
        // Glyphs land in order from the segment's start, so the box traces
        // itself rather than dissolving in.
        const end = seg.lo + Math.round((seg.hi - seg.lo) * p);
        let block = '';
        for (let i = seg.lo; i < end; i += 1) {
          block += LATTICE_HOVER.glyphs[i % LATTICE_HOVER.glyphs.length];
        }
        const line = raw.slice(0, seg.lo) + block + raw.slice(seg.lo + block.length);
        next.set(seg.key, seg.sep ? line.split('').join(seg.sep) : line);
      }
      setBoxed(next);
      if (k < 1) {
        raf = requestAnimationFrame(step);
      } else if (!to) {
        segsRef.current = null;
        setBoxed(null);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [hoverCell, cellSegments, reduceMotion]);

  // The box is meaningless once the sheet is on its way out.
  useEffect(() => {
    if (noteOpen) setHoverCell(null);
  }, [noteOpen]);

  return (
    <motion.div
      ref={hostRef}
      className="grid-lattice"
      aria-hidden="true"
      initial={false}
      animate={{ opacity: noteOpen ? 0 : 1 }}
      transition={{
        duration: reduceMotion ? 0 : noteOpen ? GRID_EXIT.fadeOut : GRID_EXIT.fadeIn,
        ease: noteOpen ? GRID_EXIT.exitEase : GRID_EXIT.enterEase,
      }}
    >
      {/* Off-screen rather than `visibility: hidden`, so the probes can't be
          picked up as text and don't paint, while still being laid out. */}
      <span
        ref={hProbeRef}
        className="grid-lattice-glyphs"
        aria-hidden="true"
        style={{ position: 'absolute', top: -9999, left: 0 }}
      >
        {LATTICE_PROBE_H}
      </span>
      <span
        ref={vProbeRef}
        className="grid-lattice-glyphs grid-lattice-glyphs-v"
        aria-hidden="true"
        style={{ position: 'absolute', top: -9999, left: 0 }}
      >
        {LATTICE_PROBE_V}
      </span>
      {lines.map((line) => (
        <LatticeLine
          key={line.key}
          line={line}
          endInset={endInset}
          text={
            boxed?.get(line.key) ??
            (settled ? rendered.get(line.key) : typed.get(line.key)) ??
            ''
          }
        />
      ))}

      {/* The crossing marks. Placed by the same percentage the hairlines are, so
          each '+' lands exactly where its two runs meet rather than on whichever
          glyph cell the rounding picked. One wrapper carries the fade so the
          marks come up with the sheet instead of standing there waiting for it. */}
      <div
        className="grid-lattice-crosses"
        style={{ opacity: drawn ? 1 : 0 }}
      >
        {(crosses || []).map(({ col, row }) => {
          // The closing line on each axis is pulled back inside the layer's clip
          // (see LatticeLine); its crossings have to come with it.
          const x = `${(col / cols) * 100}%`;
          const y = `${(row / rows) * 100}%`;
          return (
            <span
              key={`${col}:${row}`}
              className="grid-lattice-glyphs"
              style={{
                position: 'absolute',
                left: col === cols ? `calc(${x} - ${endInset.v}px)` : x,
                top: row === rows ? `calc(${y} - ${endInset.h}px)` : y,
              }}
            >
              {LATTICE_CROSS}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
});

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
  /** Hands the parent a ref to each category label, so it can measure where
   *  the words start from before this view unmounts — and where they are
   *  headed once it mounts again. See CategoryFlight. */
  registerCategoryLabel,
  /** null while idle | 'fading' as the checkboxes let go | 'flying' once the
   *  labels have been handed to the flight overlay and ours must step aside |
   *  'returning' while the words are on their way back to us. */
  flightPhase = null,
  /** The category the explore dial is pointing at. The rail's category rows
   *  are rotated around it so the two lists stay in step. */
  dialCenterLabel = null,
}) {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const reduceMotion = useReducedMotion();
  const playNote = useNoteSound();
  // Phone widths (≤760): the filter bar moves to the TOP and stacks (search
  // above the Category/Location tabs). On desktop it stays pinned to the
  // bottom with the search centred between the tabs.
  const compact = useArchiveNavCompact();
  // Whether the sheet gets a hover treatment at all — see hoverLive below.
  const hoverCapable = useHoverCapable();
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
  //   transcript search  ∧  category(s)  ∧  location(s).
  // Non-matching notes are removed (not dimmed) — same behavior as search.
  const [selectedCats, setSelectedCats] = useState(() => new Set());
  const [selectedLocs, setSelectedLocs] = useState(() => new Set());
  // Which filter tab's dropdown is open (null = all closed). Each tab
  // (Category / Location) opens a menu of its own selectable values.
  const [openFacet, setOpenFacet] = useState(null); // null | 'category' | 'location'
  const facetMenuRef = useRef(null); // anchor for outside-click / Escape dismissal
  // Desktop sidebar accordions (Category / Location). Independent open/close,
  // both expanded on arrival: the category rows are what fly to the explore
  // dial, so they need to be on screen (and measurable) the moment EXPLORE is
  // clicked. Collapsing category by hand simply forfeits that animation.
  const [openSections, setOpenSections] = useState(() => new Set(['category', 'location']));
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
  // A returning flight also settles the rail at once: the words in the air are
  // aiming at these rows, so the rows have to be standing at their final
  // positions to be measured, not still sliding in.
  const sidebarSkipEnter = reduceMotion || skipEntrance || flightPhase === 'returning';
  const sidebarItemInitial = sidebarSkipEnter ? false : { opacity: 0, x: -10 };
  // Leaving for the dial the two halves of the page exit on their own clocks
  // (see DEPARTURE); every other way off the index is a plain fade. Read off
  // the flight rather than the destination because an exiting subtree keeps
  // the props it was last rendered with — here, the frame before lift-off.
  const leavingForDial = !!flightPhase;
  const gridExit = leavingForDial
    ? { duration: DEPARTURE.gridFade, delay: DEPARTURE.gridHold, ease }
    : { duration: 0.4, ease };
  const sidebarEnterDelay = sidebarSkipEnter ? 0 : FILTER_SIDEBAR_ENTER_DELAY;
  const sidebarStagger = sidebarSkipEnter ? 0 : FILTER_SIDEBAR_ENTER_STAGGER;

  const withImages = useMemo(
    () => confessions.filter((c) => c.image && !failedIds.has(c.id)),
    [confessions, failedIds]
  );

  // Facet option lists, derived from what's actually present in the data.
  // Categories are rotated so the dial's current centre sits in the middle
  // row: the rail and the arc are the same list, and keeping them in step is
  // what lets a category fly between them without crossing its neighbours.
  const categoryOpts = useMemo(
    () => centreOn(deriveEmotions(withImages).map((e) => e.label), dialCenterLabel),
    [withImages, dialCenterLabel]
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
    return arr;
  }, [withImages, q, selectedCats, selectedLocs]);

  const anyFilterActive = !!q || selectedCats.size > 0 || selectedLocs.size > 0;
  const clearAll = useCallback(() => {
    setQuery('');
    setSelectedCats(new Set());
    setSelectedLocs(new Set());
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

  // Category and Location only. These tabs are the phone bar's alone (the
  // desktop rail has its own accordions), and a Recency sort earned the least of
  // the three on a wall you browse by scrolling: the other two cut the wall down,
  // Recency only reshuffled it while costing a third of a cramped row.
  const FACETS = [
    { id: 'category', label: 'Category', active: selectedCats.size > 0 },
    { id: 'location', label: 'Location', active: selectedLocs.size > 0 },
  ];

  // The selectable rows shown inside a tab's dropdown. Both are multi-select,
  // with an "All" reset at the top.
  const facetValues = (facetId) => {
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
  // AFTER the notes. From there each hairline types itself on a glyph at a time
  // in a scattered order (see LATTICE_TYPE), staggered line by line so the sheet
  // fills in rather than switching on. Reduced motion shows it immediately.
  const latticeDrawn = reduceMotion || skipEntrance || entranceStage === 'settled';

  // Nothing in the grid answers the cursor until the notes have landed. The
  // hover treatment and the entrance are both writing the same properties —
  // the group dim is a filter over Motion's per-tile opacity, the cursor float
  // a transform over the tile's fly-in — so a pointer resting anywhere over the
  // grid at mount fights the entrance for every tile it passes, and the lattice
  // is asked to box a cell that hasn't drawn itself yet. `entranceStage` is
  // seeded 'settled' when the entrance is skipped (reduced motion, or arriving
  // back from explore mid-session), so those cases stay live throughout.
  const hoverArmed = entranceStage === 'settled';
  // The imperative half of the hover treatment — the lean, the noise warp, the
  // lattice box — needs a pointer that can hover as well as a settled grid. A
  // touchscreen fires the emulated mouseenter on tap and never the leave, so a
  // tapped note would stay lifted and warped behind the view that opens over it.
  // The CSS half sits behind the same query (see HOVER_CAPABLE_MQ). `hoverArmed`
  // is left alone: it also gates the metadata fade and which animation branch a
  // tile is on, neither of which is about hovering.
  const hoverLive = hoverArmed && hoverCapable;

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
  // Tiles reach the lattice through this rather than through state, so hovering
  // one note doesn't re-render the rest of the grid.
  const latticeRef = useRef(null);
  const latticeRows = Math.max(1, Math.ceil(noteCount / gridCols));
  const latticeLastRow = noteCount - (latticeRows - 1) * gridCols; // cells in last row
  const { latticeLines, latticeCrosses } = useMemo(() => {
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
        main: `${(k / cols) * 100}%`,
        // The closing line is pinned to the far edge, so it has to be pulled
        // back inside by its own width or the layer's `overflow: hidden` takes
        // it. LatticeLine does that, off the measured run (see `endInset`).
        atEnd: k === cols,
        // `main` as a plain number, so the churn can work out where a line sits
        // without parsing a CSS string.
        mainPct: cols ? Math.min(100, (k / cols) * 100) : 0,
        lenPct: (yEnd / rows) * 100,
        delay: BASE + (cols ? (k / cols) * V_SPREAD : 0),
      });
    }
    const topWidth = rows > 1 ? cols : last; // single partial row → top edge = last
    const hReach = []; // columns each horizontal actually runs to
    for (let m = 0; m <= rows; m += 1) {
      const xEnd = m === 0 ? topWidth : m === rows ? last : cols;
      hReach[m] = xEnd;
      if (xEnd <= 0) continue;
      lines.push({
        key: `h${m}`,
        axis: 'h',
        main: `${(m / rows) * 100}%`,
        atEnd: m === rows,
        mainPct: rows ? Math.min(100, (m / rows) * 100) : 0,
        lenPct: (xEnd / cols) * 100,
        delay: BASE + (rows ? (m / rows) * H_SPREAD : 0),
      });
    }

    // Where two hairlines actually meet — a cross is only real if the vertical
    // reaches down to that row AND the horizontal reaches across to that column.
    // The last row of the archive is usually ragged, so the bottom-right corner
    // of the sheet has crossings that don't exist.
    const crosses = [];
    for (let k = 0; k <= cols; k += 1) {
      const yEnd = k <= last ? rows : rows - 1;
      for (let m = 0; m <= rows; m += 1) {
        if (m > yEnd) continue;
        if (k > (hReach[m] ?? 0)) continue;
        crosses.push({ col: k, row: m });
      }
    }
    return { latticeLines: lines, latticeCrosses: crosses };
  }, [gridCols, latticeRows, latticeLastRow]);

  return (
    <motion.div
      key="grid-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: gridExit }}
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

      {/* The same treatment at glyph scale, for the rail's checkmark strokes. */}
      <NoiseDisplaceFilter
        id={FACET_MARK_FILTER_ID}
        {...FACET_MARK_FILTER}
        animate={!reduceMotion}
      />

      {/* Same backdrop the onboarding uses (`PAGE_BG` + `PAGE_GRADIENT`) → film
          grain (mix-blend). ENTER hands off straight to this view, so anything
          but the intro's own backdrop reads as the room changing colour on the
          way in. The lift is at the top; previously a radial sat at 50% 100% and
          put a grey glow under the bottom row of notes.

          The gradient also gives the grain something to blend against — on flat
          black the overlay blend has nothing to bite into and the noise washes
          out. Isolated so mix-blend stays within this layer. */}
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

      <style>{`
        /* Contact-sheet lattice — monospace glyphs on their own layer
           (.grid-lattice), a sibling of the tiles rather than borders riding on
           each flying tile, so the grid can draw on independently. Each hairline
           is a seeded scramble of ASCII (see latticeAscii) that types itself on
           glyph by glyph — same stagger as before, but the lines read as
           texture. */
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
          color: rgba(207, 202, 183, 0.32);
        }
        /* pre rather than nowrap: a line types itself on by holding its
           not-yet-arrived positions as spaces, and nowrap would collapse those
           runs and slide the glyphs that have landed out of place. */
        .grid-lattice-glyphs {
          display: block;
          font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
          font-size: 8px;
          line-height: 1;
          letter-spacing: 0.06em;
          white-space: pre;
          pointer-events: none;
          user-select: none;
        }
        .grid-lattice-glyphs-v {
          white-space: pre;
          letter-spacing: 0;
          line-height: 0.92;
        }
        /* Crossing marks. A touch brighter than the hairlines so the '+' reads as
           a deliberate register mark holding the corners of each cell, rather
           than as one more character in the scramble. */
        .grid-lattice-crosses {
          position: absolute;
          inset: 0;
          color: rgba(207, 202, 183, 0.42);
          transition: opacity 0.6s ${HOVER_EASE};
          pointer-events: none;
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
           React.
           Every hover rule below hangs off .is-live, which the grid only wears
           once the entrance has settled (see hoverArmed) — before that a cursor
           already sitting over the grid would dim and unclip tiles that are
           still flying in.
           Hover-capable pointers only (see HOVER_CAPABLE_MQ): on a touchscreen
           these fire on tap and then stick, so a phone would be left with one
           lifted note and a dimmed sheet behind it. */
        @media ${HOVER_CAPABLE_MQ} {
          .confession-grid.is-live:hover .grid-tile { filter: opacity(0.8); }
          .confession-grid.is-live:hover .grid-tile:hover { filter: none; }
          .confession-grid.is-live .grid-tile:hover .grid-tile-num,
          .confession-grid.is-live .grid-tile:hover .grid-tile-cat { color: #CFCAB7; }
          /* At rest the note is clipped to its square cell. On hover the clip
             drops and the tile lifts over its neighbours so the cursor-float
             (see cursorFloat.js) can actually leave the cell — a note pinned
             inside its own box doesn't read as floating. */
          .confession-grid.is-live .grid-tile:hover { overflow: visible; z-index: 3; }
        }
        @media (max-width: 760px) {
          .confession-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          /* Off-screen tiles skip layout/paint until scrolled near — big win on
             a 165-tile phone grid with no change to the entrance animation. */
          .grid-tile {
            content-visibility: auto;
            contain-intrinsic-size: 180px 180px;
          }
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
        /* The rail's search field wears a traced outline instead of a border, so
           the ink it is drawn in lives on the wrapper and reaches the stroke as
           currentColor. Which also means the field brightening under the caret
           is one colour on one element, rather than the four sides of a border. */
        .grid-search-field {
          color: rgba(207,202,183,0.3);
          transition: color 0.2s ${HOVER_EASE};
        }
        .grid-search-field:focus-within { color: rgba(207,202,183,0.5); }
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
        .facet-menu-btn:hover { border-color: rgba(207,202,183,0.4); background: ${MOBILE_FILTER_FILL_HOVER}; }
        .facet-menu-item:hover { background: rgba(207,202,183,0.09); color: #CFCAB7; }
        /* Desktop filter sidebar (search + Category/Location accordions). */
        .facet-accordion-btn:hover { color: #EDE7D6; }
        .facet-checkbox-row:hover { color: #CFCAB7 !important; }
        /* Only the unchecked box border brightens on hover — a checked one is
           already at full ink. !important because the box carries its resting
           colour inline. */
        .facet-checkbox-row[aria-checked='false']:hover .facet-checkbox-box {
          border-color: rgba(207,202,183,0.7) !important;
          color: rgba(207,202,183,0.7) !important;
        }
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
        /* Inset off the cell corners rather than tucked into them — the lattice
           hairline runs along both edges, and at 8px the number sat close enough
           to read as sitting on the rule. Shared with INDEX / EXPLORE + the
           confessions tally via GRID_TILE_NUM_INSET. */
        .grid-tile-num {
          top: 16px;
          left: ${GRID_TILE_NUM_INSET}px;
        }
        .grid-tile-cat {
          bottom: 16px;
          right: 18px;
          max-width: calc(100% - 36px);
          text-align: right;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .grid-tile { overflow: hidden; }
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
          {/* The tally used to sit here, above the search. It now rides with the
              grid instead — see the count header in the grid-stack below, which
              both breakpoints share. */}

          {/* Row 1 — transcript search + filter tabs (Category · Location) on one
              line, search taking whatever the tabs leave. Each tab opens a
              dropdown of its own selectable values, so no persistent chip row is
              needed. */}
          <div
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              // No second line: the bar already covers the top of the grid, so
              // the search shrinks rather than the tabs wrapping under it.
              flexWrap: 'nowrap',
              width: '100%',
              marginBottom: 16,
            }}
          >
            <div
              ref={facetMenuRef}
              style={{
                display: 'flex',
                alignItems: 'center',
                // Held at their natural width against the right edge; the search
                // gives up the difference.
                flex: '0 0 auto',
                gap: 8,
                minWidth: 0,
                flexWrap: 'nowrap',
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
              // Just "SEARCH": it shares the row with the two filter tabs, which
              // leaves it about a third of a phone's width. The aria-label still
              // says what is being searched.
              placeholder="SEARCH"
              aria-label="Search note transcripts"
              style={{
                pointerEvents: 'auto',
                order: 1,
                // Takes exactly what the tabs leave (basis 0 rather than the
                // input's own intrinsic ~20ch), and minWidth:0 lets it shrink
                // past its placeholder instead of pushing them off the edge.
                flex: '1 1 0',
                minWidth: 0,
                // Semi-translucent charcoal — same fill as the facet tabs beside
                // it, so notes can show through as the grid scrolls under the
                // bar. Dashed hairline + square corners are the desktop rail's.
                backgroundColor: MOBILE_FILTER_FILL,
                border: '1px dashed rgba(207,202,183,0.3)',
                borderRadius: 0,
                padding: '9px 12px',
                ...searchIconStyle(12),
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
          // Off ahead of the grid on the way to the dial: the rows the words
          // just left are empty, and an empty rail hanging around under a
          // flight is the one thing that reads as a bug rather than a beat.
          exit={
            leavingForDial
              ? { opacity: 0, transition: { duration: DEPARTURE.sidebarFade, ease } }
              : undefined
          }
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
          {/* The dashes round the field are a traced SVG outline, drawn in place
              on the rail's first beat — so this row alone arrives without the
              slide the rest of the rail has, and the field is standing at its
              final position from the first frame. The wrapper is what the
              outline is measured against and what carries the ink colour it
              follows; it is a flex box because an <input> is inline, and the
              descender space under an inline child would have pushed the
              accordions a few px down the rail. */}
          <div
            className="grid-search-field"
            style={{ position: 'relative', display: 'flex', flex: '0 0 auto', width: '100%' }}
          >
            <motion.input
              className="grid-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // "SEARCH CONFESSIONS..." needed 175px inside a 200px rail that only
              // offers 166 — the ellipsis was already being clipped before the
              // magnifier took another 21px for itself, which is the kind of thing
              // that reads as a rendering bug rather than as a truncated string.
              placeholder="SEARCH NOTES"
              aria-label="Search note transcripts"
              initial={sidebarSkipEnter ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{
                duration: reduceMotion ? 0 : 0.5,
                ease,
                delay: sidebarEnterDelay + (sidebarSkipEnter ? 0 : SEARCH_FIELD_INK_DELAY),
              }}
              style={{
                width: '100%',
                backgroundColor: 'transparent',
                // Transparent, and only here to hold the 1px the box has always
                // been inset by: the dashes themselves are the traced outline
                // laid over this edge.
                border: '1px solid transparent',
                borderRadius: 0,
                padding: '9px 16px',
                ...searchIconStyle(16),
                color: '#CFCAB7',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                letterSpacing: '0.04em',
                outline: 'none',
              }}
            />
            <TracedOutline
              play={!sidebarSkipEnter}
              delay={sidebarEnterDelay}
              duration={SEARCH_OUTLINE_TRACE_DURATION}
            />
          </div>

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
                      <span style={{ color: 'rgba(207,202,183,0.5)' }}>({activeCount})</span>
                    ) : null}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      fontSize: 12,
                      lineHeight: 1,
                      opacity: 0.85,
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.18s ease',
                    }}
                  >
                    {'>'}
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
                        <FacetCheckboxMark
                          on={opt.on}
                          style={{
                            // Category marks let go first on the way to
                            // EXPLORE, leaving the words standing alone to fly,
                            // and come back last once the words are home.
                            opacity: f.id === 'category' && flightPhase ? 0 : 1,
                            transition: `border-color 0.18s ${HOVER_EASE}, color 0.18s ${HOVER_EASE}, opacity ${FLIGHT_FADE_MS}ms ${HOVER_EASE}`,
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
                          {/* Inline-block so the measured box is the text, not
                              the flexed row — the flight centres each copy on
                              this rect and a full-width box would start it
                              adrift. */}
                          <span
                            ref={
                              f.id === 'category' && registerCategoryLabel
                                ? registerCategoryLabel(opt.label)
                                : undefined
                            }
                            style={{
                              display: 'inline-block',
                              // Blank while copies of these words are in the
                              // air: on the way out ours would show through the
                              // dissolving grid as a double, and on the way
                              // back the row has to look empty for a word to
                              // land in. Still laid out, so it can be measured.
                              opacity:
                                f.id === 'category' &&
                                (flightPhase === 'flying' || flightPhase === 'returning')
                                  ? 0
                                  : 1,
                            }}
                          >
                            {opt.label}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </motion.div>
            );
          })}

          {/* Sits on the floor of the rail: `marginTop: auto` eats the slack
              under the last filter, so it rides the bottom of the column when
              the facets are collapsed and simply follows them down when they
              are open and the rail scrolls. Arrives last, after both facets. */}
          <motion.div
            initial={sidebarItemInitial}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.5,
              ease,
              delay: sidebarEnterDelay + 3 * sidebarStagger,
            }}
            style={{
              flex: '0 0 auto',
              marginTop: 'auto',
              paddingTop: 18,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              lineHeight: 1.6,
              textTransform: 'uppercase',
              color: inkA(0.42),
            }}
          >
            What We Tell AI © 2026
          </motion.div>
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
            ? `${barH + 24}px 16px 56px`
            : `112px 48px 64px ${FILTER_SIDEBAR_LEFT + FILTER_SIDEBAR_W + FILTER_SIDEBAR_GAP}px`,
          // Lightbox open → the whole grid recedes into its inactive image
          // state (desaturated + softened + dimmed) so the focused note reads
          // as the only live thing. Eased so it settles as the Lightbox fades in.
          ...recede(lightboxOpen),
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
            {/* Count header — "N Confessions" aligned to the first tile's
                number (GRID_TILE_NUM_INSET), floating in the band just above
                the first row. Absolutely placed inside grid-stack so it never
                shifts the tiles. Fades in with the tile labels once the
                entrance settles, and out with the grid when a note opens. */}
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
                left: GRID_TILE_NUM_INSET,
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
            <GridLattice
              ref={latticeRef}
              lines={latticeLines}
              crosses={latticeCrosses}
              cols={gridCols}
              rows={latticeRows}
              drawn={latticeDrawn}
              noteOpen={noteOpen}
              reduceMotion={reduceMotion}
              skipEntrance={skipEntrance}
              disableChurn={compact}
            />
            <div className={`confession-grid${hoverArmed ? ' is-live' : ''}`}>
            {visible.map((c, i) => {
              const d = offsetsRef.current.get(c.id) || GRID_TILE_REST;
              // Once the entrance has settled, the tile's motion is owned by the
              // exit/dissolve (driven by noteOpen); before that the fly-in
              // variants run. exitDelay ripples the fade out from the clicked tile.
              const settled = hoverArmed;
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
                  // Mobile: always open the vertical note-scroll view — the note
                  // enlarges with its metadata and you swipe up/down through the
                  // rest (NoteOpenView → VerticalConfessionStack). It's handed
                  // the currently visible notes, so "the rest" means the rest of
                  // what the filters left standing, not the whole archive.
                  // Desktop (or a missing handler) keeps the Lightbox, a quicker
                  // zoom for the search / compare task a pointer is doing.
                  if (!compact || !onOpenNote) {
                    setSelected(c);
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  computeExitDelays(rect);
                  onOpenNote(c, rect, visible);
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
                  // Unbound until the entrance settles, and never bound at all on
                  // a touchscreen (hoverLive). Handing back `undefined` rather
                  // than checking inside means a note that lands under a resting
                  // cursor stays at rest until the pointer actually moves,
                  // instead of jumping to a lean it was never given.
                  onMouseEnter={
                    !hoverLive
                      ? undefined
                      : (e) => {
                          // The note lifts off the grid and starts leaning toward the
                          // cursor. The noise + displacement warp switches on here (and
                          // only here) to focus the hovered note — it's a static filter
                          // swap, so it stays on under reduced motion; the lift doesn't.
                          e.currentTarget.style.filter = GRID_IMAGE_FILTER;
                          // Tiles flow in order, so the index IS the cell — that's what
                          // the lattice needs to box this note in.
                          latticeRef.current?.hoverCell({
                            row: Math.floor(i / gridCols),
                            col: i % gridCols,
                          });
                          if (!reduceMotion) applyGridFloat(e, paperRotate, CURSOR_FLOAT.settleMs);
                        }
                  }
                  onMouseMove={
                    reduceMotion || !hoverLive
                      ? undefined
                      : (e) => applyGridFloat(e, paperRotate, CURSOR_FLOAT.trackMs)
                  }
                  onMouseLeave={
                    !hoverLive
                      ? undefined
                      : (e) => {
                          const el = e.currentTarget;
                          el.style.setProperty('--float-ms', `${CURSOR_FLOAT.settleMs}ms`);
                          el.style.transform = '';
                          el.style.filter = 'none';
                          latticeRef.current?.hoverCell(null);
                        }
                  }
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

/** Gap between the metadata / image / transcript in the preview column. */
const PREVIEW_STACK_GAP = 10;

/**
 * The transcript slot is a fixed height for the same reason the frame is fixed:
 * the column is vertically centred, so anything that changes its total height
 * moves the metadata and the image as you page through notes. Transcripts run
 * from one line to eight, which was swinging the block by ~40px a note.
 *
 * Sized to four lines, which covers all but two notes in the corpus; the longest
 * ones overflow the slot instead of growing it, so the layout stays put.
 */
const PREVIEW_TRANSCRIPT_LINES = 4;

/** Prev/next arrow button size, and how far outside the frame's edge they sit. */
const LB_NAV_SIZE = 52;
const LB_NAV_GAP = 16;
/** Half of PREVIEW_FRAME.w — what the arrows are offset from the centre by. */
const LB_NAV_FRAME_HALF = 'min(45vw, 360px)';

function Lightbox({ confession, onClose, onPrev, onNext, onExplore }) {
  const reduceMotion = useReducedMotion();
  const open = !!confession;
  const canNav = !!(onPrev || onNext);

  const runNav = useCallback(
    (id) => {
      if (id === 'esc') onClose?.();
      else if (id === 'left') onPrev?.();
      else if (id === 'right') onNext?.();
    },
    [onClose, onPrev, onNext]
  );

  // ESC closes; ← / → (or A / D) step through notes. Unlike the full-screen
  // note view this carries no on-screen legend — the preview is a quick look at
  // one note, and a key chart over it competes with the thing being looked at.
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
      runNav(id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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

  // Detail metadata above the note, wearing EXPLORE's block (NOTE_META_STYLE):
  // DATE and LOCATION, plus a THEME row that links into that category.
  //
  // Every label renders even when the sheet has no value for it — most notes are
  // missing at least one field, and dropping the row shortened the block, which
  // moved the metadata and the image as you paged through notes. Theme falls
  // back to N/A (not blank) so the row still reads as filled.
  const meta = confession?.metadata || {};
  const themeValue = confession?.category
    ? confession.category.toUpperCase()
    : 'N/A';
  const metaRows = [
    ['DATE', meta.date || ''],
    ['LOCATION', meta.location || ''],
    ['THEME', themeValue, 'theme'],
  ];

  // Portalled to the body, not left inside GridView. The view root is
  // `position: absolute; z-index: 1`, which makes it a stacking context — so
  // whatever this sheet asked for only ever outranked GridView's own children,
  // and the archive's top edge wash (z 150, a sibling of the view) painted
  // straight over it. The metadata block lands at y≈58, where that gradient is
  // still ~0.54 black: the DATE / LOCATION rows were being scrimmed, not
  // under-coloured. On the body the layer means what it says.
  return createPortal(
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
            // The same layer the EXPLORE tab rides, so a note is lit identically
            // whichever way you reached it. Deliberately UNDER the nav chrome
            // (z 200) — the bar fades to 0.22 while this is open, which only
            // reads as receding if it's still painting on top.
            zIndex: NOTE_SURFACE_Z,
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
              gap: PREVIEW_STACK_GAP,
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
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease: easeOut, delay: 0.04 }}
              style={{
                ...NOTE_META_STYLE.block,
                width: '100%',
                // Match the transcription block's width below.
                maxWidth: 'min(88vw, 560px)',
                // EXPLORE holds 24px between the divider and the image; here the
                // column's own gap supplies part of that.
                marginBottom: NOTE_META_STYLE.block.marginBottom - PREVIEW_STACK_GAP,
              }}
            >
              {metaRows.map(([label, value, kind]) => (
                <div key={label} style={NOTE_META_STYLE.row}>
                  <span style={NOTE_META_STYLE.label}>{label}</span>
                  {kind === 'theme' && confession?.category && onExplore ? (
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
                      <span style={{ ...NOTE_META_STYLE.value, ...LINK_UNDERLINE }}>{value}</span>
                    </button>
                  ) : (
                    <span style={NOTE_META_STYLE.value}>{value}</span>
                  )}
                </div>
              ))}
            </motion.div>

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

            {/* Rendered even when a note has no transcription, so the slot can't
                collapse and take the layout with it. */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease: easeOut, delay: 0.05 }}
              style={{
                width: '100%',
                maxWidth: 'min(88vw, 560px)',
                textAlign: 'center',
                // Constant height (see PREVIEW_TRANSCRIPT_LINES) — the text hangs
                // from the top of the slot so its first line always sits the same
                // distance below the note.
                height:
                  PREVIEW_TRANSCRIPT_LINES *
                  TRANSCRIPTION_FONT_SIZE *
                  TRANSCRIPTION_TEXT.lineHeight,
                flexShrink: 0,
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
                  width: ${LB_NAV_SIZE}px;
                  height: ${LB_NAV_SIZE}px;
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
                /* Flank the note rather than the window. Offsetting from the
                   centre by half the frame puts each arrow just outside the
                   image's edge; the frame is a constant box (PREVIEW_FRAME), so
                   they hold that position from note to note instead of tracking
                   each image's own width.

                   min() clamps them back inside the viewport on narrow screens,
                   where the frame is 90vw and there's no room outside it. */
                .lb-nav--left {
                  right: min(
                    calc(50% + ${LB_NAV_FRAME_HALF} + ${LB_NAV_GAP}px),
                    calc(100% - ${LB_NAV_SIZE + 12}px)
                  );
                }
                .lb-nav--right {
                  left: min(
                    calc(50% + ${LB_NAV_FRAME_HALF} + ${LB_NAV_GAP}px),
                    calc(100% - ${LB_NAV_SIZE + 12}px)
                  );
                }
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
    </AnimatePresence>,
    document.body
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
        // Sits between ENTER and the index — one step lighter here would read as
        // a flash on the way in.
        background: PAGE_BG,
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
    ['THEME', note.category ? formatCategoryLabel(note.category) : 'N/A'],
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
  // (NoteOpenView). `{ confession, rect, list }`, where `list` is the grid's
  // currently visible notes so the overlay scrolls through the filtered set;
  // null when closed. Desktop grid taps use the Lightbox instead (see GridView
  // tile onClick).
  const [openNote, setOpenNote] = useState(null);
  // Straight to the dial with no flight behind it — so the dial introduces
  // itself normally rather than cutting in under words that were never drawn.
  const handleExplore = useCallback(() => {
    cameByFlight.current = false;
    setView('explore');
  }, []);
  // Grid fly-in runs once per session; returning from dial → grid stays settled.
  const gridEntranceDoneRef = useRef(false);
  // The drawer's peek is a once-per-session arrival, and this is what says so.
  // The index replays its own entrance every time you come back from EXPLORE, and
  // the drawer used to be remounted to slide in alongside it — which took the
  // ABOUT tab off the screen for the length of the entrance delay (measured at
  // 1.83s) on a page that had it a moment earlier. The tab is the only way into
  // the section from the index, so once it has landed it stays landed.
  const aboutPeekIsSpent = useRef(false);
  const compactNav = useArchiveNavCompact();
  const reduceMotion = useReducedMotion();

  // Seeded from the landing selection so the dial spins to the chosen
  // category on entry; falls back to the first emotion when entered directly.
  // Declared up here because the rail's ordering and the category flight both
  // hang off wherever the wheel is currently pointing.
  const [activeEmotion, setActiveEmotion] = useState(initialEmotion);
  const [activeIndex, setActiveIndex] = useState(0);
  // The category the dial is showing, and therefore the rail's middle row.
  const dialCenterLabel =
    emotions.find((e) => e.id === activeEmotion)?.label ?? emotions[0]?.label ?? null;

  /* ── INDEX ⇄ EXPLORE: the category flight ──────────────────────────
     The index rail's category rows and the explore dial's wordmarks are the
     same list — both come from deriveEmotions — so switching tabs flies the
     words from one to the other instead of cross-fading two unrelated screens.
     The rail lives inside GridView and the dial inside NoteOpenView, and
     mode="wait" means the two are never mounted at the same time. So we
     measure the side we are leaving here, on the click, while it is still
     standing, and hand the words to an overlay that outlives both views.
     CategoryFlight carries the storyboard. */
  const railLabelEls = useRef(new Map());
  const registerCategoryLabel = useCallback(
    (label) => (el) => {
      if (el) railLabelEls.current.set(label, el);
      else railLabelEls.current.delete(label);
    },
    []
  );
  const dialSlotEls = useRef(new Map());
  const registerDialSlot = useCallback(
    (label) => (el) => {
      if (el) dialSlotEls.current.set(label, el);
      else dialSlotEls.current.delete(label);
    },
    []
  );
  const [flightPhase, setFlightPhase] = useState(null); // null | 'fading' | 'flying' | 'returning'
  const [flight, setFlight] = useState(null); // { direction, items, refined? }
  const flightTimer = useRef(null);
  // True from the moment words set off for the dial until we leave explore.
  // The dial reads it to know it is inheriting wordmarks that were just drawn
  // on screen for it, so it has to appear under them rather than introduce
  // itself. Outlives the flight: the dial can mount either side of the landing
  // depending on how long the index takes to clear, and it must cut in either
  // way — fading up after the words have gone reads as the dial arriving late.
  const cameByFlight = useRef(false);
  // Last known geometry of the rail's category rows, kept from whenever it was
  // last on screen. A flight home needs somewhere to aim on the frame it
  // launches, long before the rail has mounted to be measured. Rows only move
  // on a resize or an accordion toggle, so this is nearly always exact — and
  // the flight re-aims off the real thing the moment it appears.
  //
  // Held as rows and boxes rather than finished points: the rows are fixed
  // slots down the rail, and which label sits in which one depends on where
  // the wheel is pointing when you come back. See `railPose`.
  const railRects = useRef(null); // { rows: number[], box: Map(label -> { left, width, color }) }
  const measureRail = useCallback(() => {
    if (!railLabelEls.current.size) return null;
    const box = new Map();
    const seen = [];
    railLabelEls.current.forEach((el, label) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      box.set(label, { left: r.left, width: r.width, color: railInk(el) });
      seen.push([label, r.top + r.height / 2]);
    });
    if (!box.size) return null;
    // Ref callbacks fire in mount order, which is only the visual order on a
    // first render. Sort so row 0 is always the top of the list.
    seen.sort((a, b) => a[1] - b[1]);
    railRects.current = {
      rows: seen.map(([, cy]) => cy),
      order: seen.map(([label]) => label),
      box,
    };
    return railRects.current;
  }, []);

  const endFlight = useCallback(() => {
    clearTimeout(flightTimer.current);
    setFlight(null);
    setFlightPhase(null);
  }, []);

  useEffect(() => () => clearTimeout(flightTimer.current), []);

  const flyToExplore = useCallback(() => {
    cameByFlight.current = true;
    setFlightPhase('fading'); //                        checkboxes let go
    flightTimer.current = setTimeout(() => {
      // The slot the whole fan resolves around: wherever the wheel is already
      // pointing. The rail is rotated to match it (see `centreOn`), so this is
      // also the label sitting in the rail's middle row — which is what makes
      // the fan open without any two words crossing.
      const n = emotions.length;
      const activeIndex = Math.max(
        0,
        emotions.findIndex((e) => e.label === dialCenterLabel)
      );
      const vis = wheelVisible(n);
      const midY = window.innerHeight / 2;
      const geom = measureRail();
      const items = [];
      geom?.box.forEach((_box, label) => {
        const dialIndex = emotions.findIndex((e) => e.label === label);
        // A label the dial doesn't carry has nowhere to land. Happens when a
        // grid image fails after load and drops its category from the rail's
        // list but not the dial's; that word just doesn't fly.
        if (dialIndex < 0) return;
        const k = wheelOffset(dialIndex, activeIndex, n);
        const slot = wheelSlot(k, vis);
        items.push({
          id: label,
          label,
          delayS: Math.abs(k) * FLIGHT_STAGGER_S,
          from: railPoseAt(geom, label),
          to: {
            cx: WHEEL.baseX + slot.x,
            cy: midY + slot.y,
            rotate: slot.rotate,
            opacity: slot.opacity,
            ...DIAL_POSE,
          },
        });
      });
      if (!items.length) {
        endFlight();
        setView('explore');
        return;
      }
      setFlight({ direction: 'toDial', items });
      setFlightPhase('flying');
      setView('explore');
    }, FLIGHT_FADE_MS);
  }, [emotions, dialCenterLabel, measureRail, endFlight]);

  const flyToIndex = useCallback(() => {
    // Read each word's pose off the wheel as it actually stands. The visitor
    // may have scrolled the stack round to any category, so where the arc is
    // pointing is a fact about the DOM, not something we can recompute.
    //
    // The rail we are heading for will be rotated around wherever the wheel
    // ended up, which is not how we last saw it. Work out that arrangement now
    // so the remembered rows are still the right rows.
    const geom = railRects.current;
    const homeOrder = geom
      ? centreOn(
          emotions.map((e) => e.label).filter((label) => geom.box.has(label)),
          dialCenterLabel
        )
      : null;
    const items = [];
    dialSlotEls.current.forEach((el, label) => {
      if (!el) return;
      // A zero-size anchor: its rect collapses onto the point the word is
      // centred on, transform and all.
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
      const rotate = (Math.atan2(m.b, m.a) * 180) / Math.PI;
      items.push({
        id: label,
        label,
        delayS: (Math.abs(rotate) / WHEEL.stepDeg) * FLIGHT_STAGGER_S,
        from: {
          cx: r.left,
          cy: r.top,
          rotate,
          opacity: Number(cs.opacity),
          ...DIAL_POSE,
        },
        // Remembered rows, so the words are already moving on the next frame.
        // Mounting the grid can hold the main thread for a couple hundred ms;
        // waiting for it to finish before setting off reads as a stall.
        to: railPoseAt(geom, label, homeOrder),
      });
    });
    if (!items.length) {
      setView('grid');
      return;
    }
    setFlight({ direction: 'toRail', items });
    setFlightPhase('returning');
    setView('grid');
  }, [emotions, dialCenterLabel]);

  // Second half of a flight home: re-aim at the rail's rows as soon as they
  // actually exist. Usually they are exactly where we remembered and this
  // changes nothing; after a resize, or on a first visit with nothing
  // remembered at all, it is what makes the words land on their rows.
  useEffect(() => {
    if (flightPhase !== 'returning' || !flight || flight.refined) return undefined;
    let raf = 0;
    let tries = 0;
    const tick = () => {
      const geom = measureRail();
      if (!geom) {
        // ~a third of a second of frames. The rail mounts on the next one or
        // two in practice; this only catches a view that never arrives, and
        // then only matters for words with nowhere to aim.
        if (++tries <= 20) raf = requestAnimationFrame(tick);
        else if (!flight.items.some((it) => it.to)) endFlight();
        return;
      }
      setFlight((f) =>
        f && !f.refined
          ? {
              ...f,
              refined: true,
              items: f.items.map((it) => {
                // No row to fall into: let the copy fade out where it hangs.
                const to = railPoseAt(geom, it.label);
                return { ...it, to: to ?? { ...it.from, opacity: 0 } };
              }),
            }
          : f
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flightPhase, flight, measureRail, endFlight]);

  // A tab switch only flies when the side being left is actually on screen to
  // be measured. Every other route — a deep link, the grid's own CTA, the
  // mobile note overlay, compact layouts with no dial at all — just switches.
  const requestView = useCallback(
    (next) => {
      // Coming back from the dial, the index is built again rather than
      // uncovered: the EXPLORE tab clears itself off the screen first (see the
      // storyboard in NoteOpenView), so there is nothing behind it to reveal
      // and an index that cut in fully formed would land on an empty frame.
      // The index rebuilds itself, but the About drawer does not go with it — see
      // `aboutPeekIsSpent`.
      if (next === 'grid' && view === 'explore') {
        gridEntranceDoneRef.current = false;
      }
      if (next !== 'explore') cameByFlight.current = false;
      // Mid-flight, clicking the tab we are already flying to changes nothing;
      // clicking the other one abandons the flight, since those words were
      // addressed to a view that is no longer coming and finishing the journey
      // would fly them across whichever one arrived instead.
      if (flightPhase) {
        const heading = flightPhase === 'returning' ? 'grid' : 'explore';
        if (next !== heading) {
          endFlight();
          setView(next);
        }
        return;
      }
      const ready = !compactNav && !reduceMotion && emotions.length > 2;
      if (ready && next === 'explore' && view === 'grid' && railLabelEls.current.size > 0)
        flyToExplore();
      else if (
        FLY_HOME &&
        ready &&
        next === 'grid' &&
        view === 'explore' &&
        dialSlotEls.current.size > 0
      )
        flyToIndex();
      else setView(next);
    },
    [
      view,
      flightPhase,
      compactNav,
      reduceMotion,
      emotions.length,
      flyToExplore,
      flyToIndex,
      endFlight,
    ]
  );

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
      style={{
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        // The views fade in over this base, so it has to be the page colour too
        // — at #111 the index visibly lightened for the length of its own fade.
        background: PAGE_BG,
      }}
    >
      {/* Edge washes stay under the About drawer (z 1001) so the open panel
          covers them. Nav chrome still elevates above both when About is open. */}
      <ArchiveEdgeGradientWash edge="top" zIndex={ARCHIVE_EDGE_WASH_Z} />
      <ArchiveEdgeGradientWash edge="bottom" zIndex={ARCHIVE_EDGE_WASH_Z} />
      {/* Top chrome. Wordmark stays above the About drawer (close target); INDEX /
          EXPLORE sink under the backdrop while About is open. Recedes while the
          grid Lightbox is open. */}
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
          onViewChange={requestView}
          aboutOpen={aboutOpen}
          onAboutOpen={() => setAboutOpen(true)}
          onAboutClose={() => setAboutOpen(false)}
        />
      </motion.div>
      {/* Deliberately unkeyed, and deliberately outside the view swap below: the
          drawer belongs to the archive rather than to either view, so crossing
          between INDEX and EXPLORE leaves the peeking ABOUT tab where it is. */}
      <AboutModal
        open={aboutOpen}
        onOpen={() => setAboutOpen(true)}
        onClose={() => setAboutOpen(false)}
        skipPeekEntrance={reduceMotion || view !== 'grid' || aboutPeekIsSpent.current}
        onPeekLanded={() => {
          aboutPeekIsSpent.current = true;
        }}
      />

      {/* Everything the About drawer opens over. No recede here — the drawer's
          own backdrop (`rgba(8, 8, 10, 0.55)`) is the dim, and the index
          categories / grid should read through it at full strength. Nav chrome
          stays above (rendered outside this box) so INDEX / EXPLORE and the
          wordmark close target stay crisp. */}
      <div style={{ position: 'absolute', inset: 0 }}>
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
               the first note, sits it below the nav chrome, and hides its own BACK
               (the nav bar's INDEX leads out instead). */
            <NoteOpenView
              key="explore"
              standalone
              confessions={confessions}
              emotions={emotions}
              onExit={() => requestView('grid')}
              onIndex={() => requestView('grid')}
              dialHidden={flightPhase === 'flying'}
              dialHandoff={cameByFlight.current}
              registerDialSlot={registerDialSlot}
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
              onOpenNote={(c, rect, list) => setOpenNote({ confession: c, rect, list })}
              noteOpen={!!openNote}
              onLightboxOpenChange={setGridLightboxOpen}
              skipEntrance={gridEntranceDoneRef.current}
              onEntranceSettled={() => {
                gridEntranceDoneRef.current = true;
              }}
              onExplore={handleExplore}
              registerCategoryLabel={registerCategoryLabel}
              flightPhase={flightPhase}
              dialCenterLabel={dialCenterLabel}
            />
          )}
        </AnimatePresence>
      </div>

      {/* The category words, in transit between the rail and the dial.
          Rendered outside the AnimatePresence above on purpose: it is the one
          thing that has to survive one view unmounting and the other
          mounting. */}
      {flight && (
        <CategoryFlight
          items={flight.items}
          direction={flight.direction}
          reduceMotion={reduceMotion}
          onDone={endFlight}
        />
      )}

      {/* Mobile grid tap → full-screen vertical note-scroll view (up/down through
          the notes). Keyed by note id so a fresh open remounts the stack seeded
          to the tapped note. Desktop grid taps use the Lightbox instead. */}
      <AnimatePresence>
        {openNote && (
          <NoteOpenView
            key={openNote.confession.id}
            confession={openNote.confession}
            originRect={openNote.rect}
            confessions={openNote.list ?? confessions}
            emotions={emotions}
            onExit={() => setOpenNote(null)}
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
        <OnboardingBeats
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
