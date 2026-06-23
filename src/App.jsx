import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Text } from './text';
import LandingReveal from './LandingReveal';
import { Sidebar, SIDEBAR_WIDTH } from './Sidebar';
import {
  BOTTOM_DIAL_SIZE,
  BottomCompassDial,
  getCategoryBreadcrumbInfo,
  HorizontalConfessionStack,
} from './SideDial';
import { CONFESSIONS as FALLBACK_CONFESSIONS } from './confessions';
import { deriveEmotions, sortConfessionsByEmotions } from './themes';
import { useConfessions } from './useConfessions';
import { TunableGrainBackground } from './noise';
const ease = [0.22, 1, 0.36, 1];

/** Onboarding stills (`public/confession_notes_2` WebP). */
const LANDING_REVEAL_IMAGE_IDS = ['AC_185', 'AC_171', 'AC_190'];

/** Unique image URLs for landing background slideshow (live sheet or fallback). */
function useLandingBackgroundSrcs(liveConfessions) {
  return useMemo(() => {
    const pool = liveConfessions.length > 0 ? liveConfessions : FALLBACK_CONFESSIONS;
    const seen = new Set();
    const urls = [];
    for (const c of pool) {
      if (c.image && !seen.has(c.image)) {
        seen.add(c.image);
        urls.push(c.image);
      }
    }
    return urls.length > 0 ? urls : ['/notes/AC_006.png'];
  }, [liveConfessions]);
}

/**
 * The dial categories for the landing, mirroring exactly what the archive shows
 * (live sheet themes, or the bundled fallback while offline / loading). Each
 * category is paired with the first real confession in that bucket as a teaser.
 */
function useLandingCategories({ confessions: liveConfessions, emotions: liveEmotions, error }) {
  return useMemo(() => {
    // Use the bundled set until live data arrives so the dial is never empty.
    const useFallback = error || liveConfessions.length === 0;
    const emotions = useFallback ? deriveEmotions(FALLBACK_CONFESSIONS) : liveEmotions;
    const pool = useFallback ? FALLBACK_CONFESSIONS : liveConfessions;

    const firstByLabel = new Map();
    for (const c of pool) {
      const t = c.transcription?.trim();
      if (c.category && t && !firstByLabel.has(c.category)) {
        firstByLabel.set(c.category, c);
      }
    }

    return emotions.map((e) => {
      const c = firstByLabel.get(e.label);
      return {
        key: e.id,
        label: e.label,
        teaser: c?.transcription?.trim() || '',
        image: c?.image || null,
      };
    });
  }, [liveConfessions, liveEmotions, error]);
}

/**
 * The onboarding carousel notes — pinned to three hand-picked confessions
 * (LANDING_REVEAL_IMAGE_IDS), shown in that exact order. Each note carries the
 * emotion id of its theme so the EXPLORE CTA label + archive dial still seed to
 * the right category on entry. Falls back to the per-category notes if those
 * specific IDs aren't present in the loaded corpus yet.
 */
function useLandingRevealNotes({ confessions: liveConfessions, emotions: liveEmotions, error }) {
  const categories = useLandingCategories({ confessions: liveConfessions, emotions: liveEmotions, error });
  return useMemo(() => {
    const useFallback = error || liveConfessions.length === 0;
    const emotions = useFallback ? deriveEmotions(FALLBACK_CONFESSIONS) : liveEmotions;
    const pool = useFallback ? FALLBACK_CONFESSIONS : liveConfessions;

    const labelToEmotionId = new Map((emotions || []).map((e) => [e.label, e.id]));
    const byGlobalId = new Map();
    for (const c of pool) {
      const gid = c.globalId || (c.image && String(c.image).match(/AC_\d+/)?.[0]);
      if (gid && !byGlobalId.has(gid)) byGlobalId.set(gid, c);
    }

    const notes = LANDING_REVEAL_IMAGE_IDS.map((gid) => byGlobalId.get(gid))
      .filter(Boolean)
      .map((c) => ({
        key: labelToEmotionId.get(c.category) || c.category,
        label: c.category,
        teaser: c.transcription?.trim() || '',
        image: c.image || null,
        globalId: c.globalId,
      }));

    // If the pinned confessions aren't loaded yet, keep the carousel populated.
    return notes.length ? notes : categories;
  }, [liveConfessions, liveEmotions, error, categories]);
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

// Fixed wash behind archive top chrome (black → transparent) so labels stay
// legible when grid content scrolls underneath.
const ARCHIVE_NAV_GRADIENT_HEIGHT = 152;

/** One vertical rhythm for fixed title / view toggle / ABOUT. */
const ARCHIVE_NAV_CHROME_HEIGHT = 40;

/**
 * Landing→archive handoff. The chosen note fades out FIRST, then the dial
 * spins in to that category (sequential, not overlapping). The dial delay is a
 * touch longer than the note fade so there's a clean beat where only the
 * category's background shows before the spin begins.
 */
const HANDOFF_NOTE_FADE_S = 0.45;
const HANDOFF_DIAL_DELAY_MS = 560;

/** Theme stack entrance — keep in sync with ThemeView `entranceDelay` + SideDial stagger cap. */
const THEME_STACK_ENTRANCE_DELAY = 2.35;
const THEME_STACK_CARD_DURATION = 0.22;
/** Active card + ~2 neighbor rings visible (not the full stagger tail). */
const THEME_NAV_VISIBLE_STAGGER = 0.24;
const ARCHIVE_NAV_CHROME_DELAY_THEME =
  THEME_STACK_ENTRANCE_DELAY + THEME_NAV_VISIBLE_STAGGER + THEME_STACK_CARD_DURATION;

/** Grid tile motion duration (GridView). */
const GRID_TILE_DURATION = 0.55;
/** First handful of tiles — not the full wall stagger. */
const GRID_NAV_VISIBLE_STAGGER = 0.32;
const ARCHIVE_NAV_CHROME_DELAY_GRID = GRID_NAV_VISIBLE_STAGGER + GRID_TILE_DURATION;

/** Same as dial card `metaTranscription` (SideDial.jsx). */
const ARCHIVE_NAV_TEXT = {
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  lineHeight: 1.55,
  letterSpacing: '0.01em',
  color: 'rgba(229,229,229,0.85)',
};

const ARCHIVE_BRAND_MARK_STYLE = {
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 10,
  fontWeight: 500,
  lineHeight: 1.35,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.4)',
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
        <div style={{ width: 1, height: 17, background: 'rgba(255,255,255,0.25)' }} />
      )}
      <ToggleButton active={view === 'theme'} onClick={() => onChange('theme')}>
        DIAL
      </ToggleButton>
    </motion.div>
  );
}

function SiteTitle({ entranceDelay = 0.2 }) {
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
        padding: '0 12px',
        fontFamily: "'Reckless Italic', 'News Plantin', Georgia, serif",
        fontSize: 18,
        fontWeight: 400,
        lineHeight: 1.05,
        letterSpacing: '0.02em',
        color: 'rgba(253,253,253,0.92)',
        textTransform: 'none',
        pointerEvents: 'none',
      }}
    >
      What We Tell AI
    </motion.div>
  );
}

function AboutHeader({ onClick, open, stacked = false, entranceDelay = 0.2 }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: entranceDelay }}
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
        padding: '0 12px',
        minHeight: ARCHIVE_NAV_CHROME_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        ...ARCHIVE_NAV_TEXT,
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

/** Kit (ConvertKit) inline form — script replaces this node with the form UI. */
const ABOUT_KIT_FORM_UID = '4e99802b9e';
const ABOUT_KIT_SCRIPT_SRC = `https://synthetic-wisdom-studio.kit.com/${ABOUT_KIT_FORM_UID}/index.js`;
/** Set true to show the subscribe / email block in the About modal again. */
const ABOUT_KIT_ENABLED = false;

/**
 * Centered about modal. Backdrop + card fade in on open; on close (click-out
 * / ESC) both exit with opacity only — no scale or drift so it reads as a
 * simple dismiss. prefers-reduced-motion skips transforms on enter too.
 */
function AboutModal({ open, onClose }) {
  const reduceMotion = useReducedMotion();
  const kitMountRef = useRef(null);

  useEffect(() => {
    if (!open || !ABOUT_KIT_ENABLED) return;
    const root = kitMountRef.current;
    if (!root) return;

    root.replaceChildren();
    const script = document.createElement('script');
    script.async = true;
    script.dataset.uid = ABOUT_KIT_FORM_UID;
    script.src = ABOUT_KIT_SCRIPT_SRC;
    root.appendChild(script);

    return () => {
      root.replaceChildren();
    };
  }, [open]);

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
        animate: { opacity: 1, backdropFilter: 'blur(22px)' },
        exit: { opacity: 0, backdropFilter: 'blur(0px)' },
      };

  const cardMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.96, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 1, y: 0 },
      };

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
            exit: { duration: 0.22, ease: easeOut },
          }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            // Frosted dim: let blur carry the separation; avoid near-opaque black.
            background: reduceMotion
              ? 'rgba(10, 10, 14, 0.72)'
              : 'rgba(10, 10, 14, 0.38)',
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
            transition={{
              duration: 0.32,
              ease: easeOut,
              exit: { duration: 0.2, ease: easeOut },
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: 560,
              width: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '36px 40px 32px',
              background: '#ebe9e4',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 8,
              cursor: 'default',
              color: '#121212',
              boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
            }}
          >
            <Text
              variant="bodySmall"
              mono={false}
              style={{
                display: 'block',
                lineHeight: 1.7,
                fontSize: 15,
                marginBottom: 16,
                fontFamily: "'Reckless Italic', 'News Plantin', Georgia, serif",
                color: 'rgba(15,15,15,0.9)',
              }}
            >
              What We Tell AI is a collection of anonymous notes people have written about their relationship with artificial intelligence.
            </Text>

            <Text
              variant="bodySmall"
              mono={false}
              style={{
                display: 'block',
                lineHeight: 1.7,
                fontSize: 15,
                marginBottom: 18,
                fontFamily: "'Reckless Italic', 'News Plantin', Georgia, serif",
                color: 'rgba(15,15,15,0.8)',
              }}
            >
              This anthropological art project documents AI&rsquo;s growing presence in the most intimate details of
              our lives. Each handwritten note is collected in public parks, on street corners, and even at AI
              conferences.
            </Text>

            <Text
              variant="bodySmall"
              mono={false}
              style={{
                display: 'block',
                fontFamily: "'Reckless Italic', 'News Plantin', Georgia, serif",
                fontSize: 15,
                fontWeight: 400,
                lineHeight: 1.55,
                letterSpacing: '0.02em',
                color: 'rgba(15,15,15,0.58)',
              }}
            >
              Collection is ongoing —{' '}
              <a
                href="https://linktr.ee/whatwetellai"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'inherit',
                  textDecoration: 'underline',
                  textDecorationColor: 'rgba(15,15,15,0.35)',
                  textUnderlineOffset: '3px',
                }}
              >
                get in touch
              </a>
              !
            </Text>

            {ABOUT_KIT_ENABLED && (
              <>
                <style>{`
                  .about-kit-mount .formkit-powered-by-convertkit-container {
                    display: none !important;
                  }
                  .about-kit-mount .formkit-submit {
                    background-color: #111 !important;
                    color: #fafafa !important;
                    border: 1px solid #111 !important;
                    border-radius: 4px !important;
                  }
                  .about-kit-mount .formkit-submit:hover,
                  .about-kit-mount .formkit-submit:focus {
                    background-color: #000 !important;
                    color: #fff !important;
                    border-color: #000 !important;
                  }
                  .about-kit-mount .formkit-submit span {
                    color: #fafafa !important;
                  }
                `}</style>
                <div
                  ref={kitMountRef}
                  className="about-kit-mount"
                  style={{
                    marginTop: 22,
                    width: '100%',
                    minHeight: 1,
                  }}
                />
              </>
            )}

            <Text
              variant="caption"
              mono
              style={{
                display: 'block',
                marginTop: ABOUT_KIT_ENABLED ? 24 : 20,
                paddingTop: 16,
                borderTop: '1px solid rgba(0,0,0,0.08)',
                fontSize: 10,
                letterSpacing: '0.1em',
                color: 'rgba(15,15,15,0.45)',
              }}
            >
              © What We Tell AI 2026
            </Text>
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
        ...ARCHIVE_NAV_TEXT,
        opacity: active ? 1 : 0.5,
        cursor: 'pointer',
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
        overflow: 'hidden',
        zIndex: 1,
      }}
    >
      {/* Same grain as landing / theme: `TunableGrainBackground` → DialKit "Grain". */}
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
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '88px 32px 48px',
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

  const transcription = confession?.transcription?.trim();

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
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 20,
              width: '100%',
              maxWidth: 'min(94vw, 900px)',
              margin: 'auto',
              cursor: 'default',
            }}
          >
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
                    ...ARCHIVE_NAV_TEXT,
                  }}
                >
                  {transcription}
                </Text>
              </motion.div>
            ) : null}
          </div>
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
  // Landing→archive handoff: delay the dial's fade-in (s) and its intro spin
  // (ms) so the bridge note fades out first, then the dial spins in.
  dialEntranceDelay = 0.15,
  dialSpinDelayMs = 0,
}) {
  const [lightboxConfession, setLightboxConfession] = useState(null);
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
        <HorizontalConfessionStack
          confessions={confessions}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          onImageClick={setLightboxConfession}
          entranceDelay={THEME_STACK_ENTRANCE_DELAY}
        />
      </div>

      <Lightbox
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

function ArchivePage({ confessionQuery, initialEmotion = null }) {
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
      <SiteTitle entranceDelay={navChromeEntranceDelay} />
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
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
            <ViewToggle
              view={view}
              onChange={setView}
              sidebarInset={sidebarInset}
              embedded
              entranceDelay={navChromeEntranceDelay}
            />
          </div>
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
            <AboutHeader
              onClick={() => setAboutOpen(true)}
              open={aboutOpen}
              stacked
              entranceDelay={navChromeEntranceDelay}
            />
          </div>
        </div>
      ) : (
        <>
          <ViewToggle
            view={view}
            onChange={setView}
            sidebarInset={sidebarInset}
            entranceDelay={navChromeEntranceDelay}
          />
          <AboutHeader
            onClick={() => setAboutOpen(true)}
            open={aboutOpen}
            entranceDelay={navChromeEntranceDelay}
          />
        </>
      )}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <ArchiveBrandMark
        sidebarInset={sidebarInset}
        entranceDelay={view === 'theme' ? navChromeEntranceDelay : 0.2}
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
            sidebarInset={sidebarInset}
            dialSize={dialSize}
            dialLabelInset={dialLabelInset}
            dialEntranceDelay={dialEntranceDelay}
            dialSpinDelayMs={dialSpinDelayMs}
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
  // Category (emotion id) the visitor selected on the landing dial; seeds the
  // archive dial so it spins to that category on entry.
  const [entryEmotion, setEntryEmotion] = useState(null);
  // The selected note's image, kept mounted across the landing→archive swap so
  // it visually "stays on screen" while the rest of the archive (other notes +
  // dial) fades in around it. Cleared once it has handed off to the live card.
  const [bridgeNote, setBridgeNote] = useState(null);
  // The featured note's exact on-screen rect at the moment of entry, so the
  // bridge image can hold its precise size/position (no jump) while the archive
  // dial rises underneath it.
  const [bridgeRect, setBridgeRect] = useState(null);
  const reduceMotion = useReducedMotion();
  const confessionQuery = useConfessions();
  const landingBgSrcs = useLandingBackgroundSrcs(confessionQuery.confessions);
  const landingNotes = useLandingRevealNotes(confessionQuery);

  return (
    <>
      <AnimatePresence mode="wait">
        {page === 'landing' && (
          <LandingReveal
            onEnter={(emotionId, noteImage, noteRect) => {
              setEntryEmotion(emotionId ?? null);
              setBridgeNote(noteImage ?? null);
              setBridgeRect(noteRect ?? null);
              setPage('archive');
            }}
            backgroundImageSrcs={landingBgSrcs}
            categories={landingNotes}
          />
        )}
        {page === 'archive' && (
          <ArchivePage confessionQuery={confessionQuery} initialEmotion={entryEmotion} />
        )}
      </AnimatePresence>

      {/* Bridge note: the chosen confession holds its exact landing position +
          size through the page swap (no jump, no double-fade), then crossfades
          out once the archive's dial + cards have risen underneath it. */}
      {bridgeNote && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: bridgeRect ? 'block' : 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <motion.img
            key={bridgeNote}
            src={bridgeNote}
            alt=""
            draggable={false}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{
              duration: reduceMotion ? 0 : HANDOFF_NOTE_FADE_S,
              ease: 'easeIn',
            }}
            onAnimationComplete={() => {
              setBridgeNote(null);
              setBridgeRect(null);
            }}
            style={
              bridgeRect
                ? {
                    position: 'absolute',
                    top: bridgeRect.top,
                    left: bridgeRect.left,
                    width: bridgeRect.width,
                    height: 'auto',
                    borderRadius: 2,
                    filter: 'drop-shadow(0 14px 34px rgba(0, 0, 0, 0.55))',
                  }
                : {
                    width: 'clamp(160px, 25vw, 220px)',
                    height: 'auto',
                    borderRadius: 2,
                    filter: 'drop-shadow(0 14px 34px rgba(0, 0, 0, 0.55))',
                  }
            }
          />
        </div>
      )}
    </>
  );
}
