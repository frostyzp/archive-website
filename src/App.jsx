import { useState, useMemo, useEffect, useRef } from 'react';
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
import { useConfessions } from './useConfessions';
import {
  CARD_FILTER_ID,
  CardNoiseFilterDefs,
  TunableGrainBackground,
  useInactiveCardParams,
} from './noise';

const ease = [0.22, 1, 0.36, 1];

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

function LandingPage({ onEnter, backgroundImageSrcs }) {
  const [slideIdx, setSlideIdx] = useState(0);
  const reduceMotion = useReducedMotion();
  const inactive = useInactiveCardParams();
  const noiseEnabled = inactive.noise?.enabled ?? true;
  const inactiveFilter = [
    inactive.blur > 0 ? `blur(${inactive.blur}px)` : '',
    inactive.grayscale > 0 ? `grayscale(${inactive.grayscale})` : '',
    noiseEnabled ? `url(#${CARD_FILTER_ID})` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const nBg = backgroundImageSrcs.length;
  /** Slightly dimmer than inactive carousel cards so the hero type stays dominant. */
  const slideshowOpacity = inactive.opacity * 0.72;

  useEffect(() => {
    if (reduceMotion || nBg <= 1) return;
    const id = window.setInterval(() => {
      setSlideIdx((i) => (i + 1) % nBg);
    }, 1000);
    return () => window.clearInterval(id);
  }, [nBg, reduceMotion]);

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
        background: '#050505',
      }}
    >
      {/* Centered confession stills — same blur / grayscale / noise as inactive carousel cards. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <CardNoiseFilterDefs params={inactive} />
        <img
          key={slideIdx % nBg}
          src={backgroundImageSrcs[slideIdx % nBg]}
          alt=""
          draggable={false}
          style={{
            maxWidth: 'min(92vw, 820px)',
            maxHeight: '78vh',
            width: 'auto',
            height: 'auto',
            objectFit: 'contain',
            opacity: slideshowOpacity,
            transform: `scale(${inactive.scale})`,
            filter: inactiveFilter || 'none',
          }}
        />
      </div>

      {/* Readability wash over the slideshow. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 85% 75% at 50% 42%, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.72) 55%, rgba(0,0,0,0.88) 100%)',
        }}
      />

      {/* Full-viewport grain backdrop. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2,
          isolation: 'isolate',
          pointerEvents: 'none',
          background: 'transparent',
        }}
      >
        <TunableGrainBackground opacityScale={0.5} />
      </div>

      {/* Hero: title + ENTER → archive (interim reveal step hidden for now). */}
      <AnimatePresence>
        <motion.div
          key="hero-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: easeOut }}
          style={{
            position: 'relative',
            zIndex: 3,
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
                fontFamily: "'Reckless Italic', 'News Plantin', Georgia, serif",
                fontSize: '52px',
                fontWeight: 400,
                lineHeight: 1,
                letterSpacing: '0.01em',
                color: '#e5e5e5',
                margin: 0,
                textShadow:
                  '0 0 28px rgba(255, 255, 255, 0.45), 0 0 56px rgba(255, 255, 255, 0.22), 0 0 96px rgba(255, 255, 255, 0.12)',
              }}
            >
              What We Tell AI
            </h1>
            <p
              style={{
                margin: '18px 0 0',
                maxWidth: 560,
                fontFamily: "'Reckless Italic', 'News Plantin', Georgia, serif",
                fontSize: 22,
                fontWeight: 400,
                lineHeight: 1.45,
                letterSpacing: '0.02em',
                color: 'rgba(229, 229, 229, 0.78)',
              }}
            >
              Anonymous confessions about AI&rsquo;s <br /> presence in our intimate lives
            </p>
          </motion.div>

          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease, delay: 0.5 }}
            whileHover={{ scale: 1.02, opacity: 1 }}
            whileTap={{ scale: 0.98 }}
            onClick={onEnter}
            style={{
              marginTop: 28,
              padding: '8px 20px',
              background: 'transparent',
              border: 'none',
              color: '#e5e5e5',
              fontSize: 11,
              fontWeight: 400,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              letterSpacing: '0.14em',
              opacity: 0.85,
            }}
          >
            ENTER
          </motion.button>
        </motion.div>
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

// Fixed wash behind archive top chrome (black → transparent) so labels stay
// legible when grid content scrolls underneath.
const ARCHIVE_NAV_GRADIENT_HEIGHT = 152;

/** One vertical rhythm for fixed title / view toggle / ABOUT. */
const ARCHIVE_NAV_CHROME_HEIGHT = 40;

/** Same as dial card `metaTranscription` (SideDial.jsx). */
const ARCHIVE_NAV_TEXT = {
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  lineHeight: 1.55,
  letterSpacing: '0.01em',
  color: 'rgba(229,229,229,0.85)',
};

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

            <div
              style={{
                marginTop: 28,
                paddingTop: 18,
                borderTop: '1px solid rgba(0,0,0,0.1)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(0,0,0,0.45)',
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
              maxWidth: 'min(92vw, 720px)',
              margin: 'auto',
              cursor: 'default',
            }}
          >
            <motion.img
              key="lightbox-img"
              src={confession.image}
              alt={`Confession ${confession.id}`}
              draggable={false}
              {...imageMotion}
              transition={{ duration: 0.24, ease: easeOut, exit: { duration: 0.18 } }}
              style={{
                maxWidth: 'min(80vw, 560px)',
                maxHeight: 'min(46vh, 420px)',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block',
                boxShadow: 'none',
                willChange: 'transform, opacity',
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
          bottom: dialLabelInset,
          zIndex: 1,
        }}
      >
        <HorizontalConfessionStack
          confessions={confessions}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          entranceDelay={2.35}
        />
      </div>

      {/* Outer div keeps the centering transform stable; inner motion.div
          owns the opacity fade so Motion doesn't fight the translateX.
          Negative bottom drops the dial below the viewport edge so its
          half-disc reads as rising up from beneath the fold (-24px ≈ 12px
          lower than the previous -12px anchor).
          Within-category ticks are drawn on the dial canvas (active sector). */}
      <div
        style={{
          position: 'absolute',
          bottom: -24,
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

function ArchivePage({ confessionQuery }) {
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
  const [activeEmotion, setActiveEmotion] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Default the dial to the first emotion and align the card stack to the
  // first confession in that category. Otherwise activeIndex stays 0 while
  // the dial shows e.g. "Refusal" — sort order can put another category at
  // index 0, so every card looks inactive until the user scrolls.
  useEffect(() => {
    if (emotions.length === 0 || themedConfessions.length === 0) return;

    const emoId = activeEmotion ?? emotions[0].id;
    if (!activeEmotion) {
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
  const confessionQuery = useConfessions();
  const landingBgSrcs = useLandingBackgroundSrcs(confessionQuery.confessions);

  return (
    <AnimatePresence mode="wait">
      {page === 'landing' && (
        <LandingPage
          onEnter={() => setPage('archive')}
          backgroundImageSrcs={landingBgSrcs}
        />
      )}
      {page === 'archive' && <ArchivePage confessionQuery={confessionQuery} />}
    </AnimatePresence>
  );
}
