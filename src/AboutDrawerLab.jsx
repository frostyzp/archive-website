import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * ABOUT DRAWER LAB  —  /entrance?tab=about-drawer | about-peek
 *
 * Low-fi studies for a right-side About drawer with file-folder tabs.
 * Two interaction sketches share one panel:
 *
 *   nav     ABOUT in the top chrome opens the drawer. All three tabs
 *           (ABOUT / PROCESS / THE WHY) are visible once it is open.
 *           Switching tabs fades the panel content.
 *
 *   peek    Only the ABOUT tab peeks from the right edge while closed.
 *           Clicking it slides the drawer in and reveals PROCESS + THE WHY.
 *
 * Placeholders only — no real copy. Esc / backdrop closes.
 * ───────────────────────────────────────────────────────────────────── */

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const EASE_OUT = [0.165, 0.84, 0.44, 1];

const TABS = [
  { id: 'about', label: 'ABOUT' },
  { id: 'process', label: 'PROCESS' },
  { id: 'why', label: 'THE WHY' },
];

const DRAWER = {
  w: '33vw',
  bg: '#2e2e2e',
  // Idle tabs sit slightly darker; active uses `bg` so it blends into the panel.
  tabIdle: '#1f1f1f',
  tabOutline: 'rgba(255,255,255,0.12)',
  block: '#555555',
  tabW: 40,
  tabH: 100,
  // How far down from the drawer top the tab cluster sits.
  tabTop: 0,
  // Few px of panel body beyond the hanging tab — peek isn't tab-only.
  peekSliver: 8,
  slideS: 0.48,
  fadeS: 0.22,
};

/** Wireframe blocks that stand in for section copy / media. */
function PlaceholderContent({ sectionId }) {
  // Slightly different block layouts so the fade reads as a real swap.
  const layouts = {
    about: [
      { h: 160, w: '100%' },
      { h: 220, w: '100%' },
    ],
    process: [
      { h: 100, w: '72%' },
      { h: 180, w: '100%' },
      { h: 120, w: '88%' },
    ],
    why: [
      { h: 200, w: '100%' },
      { h: 90, w: '55%' },
    ],
  };
  const blocks = layouts[sectionId] || layouts.about;
  const title = TABS.find((t) => t.id === sectionId)?.label ?? 'ABOUT';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h2
        style={{
          margin: 0,
          fontFamily: MONO,
          fontSize: 18,
          fontWeight: 400,
          letterSpacing: '0.14em',
          color: '#fff',
        }}
      >
        {title}
      </h2>
      {blocks.map((b, i) => (
        <div
          key={`${sectionId}-${i}`}
          style={{
            height: b.h,
            width: b.w,
            background: DRAWER.block,
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

function SideTabs({ active, onSelect, visibleIds, reduceMotion }) {
  return (
    <div
      role="tablist"
      style={{
        position: 'absolute',
        left: 0,
        top: DRAWER.tabTop,
        transform: 'translateX(-100%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        // One outlined cluster on the drawer's left edge.
        border: `1px solid ${DRAWER.tabOutline}`,
        borderRight: 'none',
        borderRadius: '0 0 0 10px',
        overflow: 'hidden',
        background: DRAWER.tabIdle,
        zIndex: 2,
      }}
    >
      {TABS.map((tab, i) => {
        const shown = visibleIds.includes(tab.id);
        const isActive = active === tab.id;
        const nextShown = TABS.slice(i + 1).some((t) => visibleIds.includes(t.id));
        return (
          <motion.button
            key={tab.id}
            type="button"
            role="tab"
            aria-label={tab.label}
            aria-selected={isActive}
            disabled={!shown}
            onClick={() => shown && onSelect(tab.id)}
            initial={false}
            animate={{
              opacity: shown ? 1 : 0,
              height: shown ? DRAWER.tabH : 0,
              pointerEvents: shown ? 'auto' : 'none',
            }}
            transition={{
              duration: reduceMotion ? 0 : DRAWER.fadeS,
              ease: EASE_OUT,
            }}
            style={{
              width: DRAWER.tabW,
              padding: 0,
              margin: 0,
              border: 'none',
              borderBottom:
                shown && nextShown ? `1px solid ${DRAWER.tabOutline}` : 'none',
              borderRadius: 0,
              // Active matches the drawer so the tab reads as part of the panel.
              background: isActive ? DRAWER.bg : DRAWER.tabIdle,
              color: isActive ? '#fff' : inkA(0.48),
              cursor: shown ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: '0.18em',
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
  );
}

function DrawerPanel({
  open,
  section,
  onSelect,
  onClose,
  /** When true, closed state peeks the ABOUT tab instead of hiding entirely. */
  peek,
  reduceMotion,
}) {
  // Peek closed: a few px of panel body + the hanging ABOUT tab. Nav closed:
  // park the whole unit (panel + tabs) past the right edge.
  const closedX = peek
    ? `calc(100% - ${DRAWER.peekSliver}px)`
    : `calc(100% + ${DRAWER.tabW}px)`;
  const visibleIds = !open && peek ? ['about'] : TABS.map((t) => t.id);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.button
            key="backdrop"
            type="button"
            aria-label="Close about drawer"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: EASE_OUT }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 40,
              border: 'none',
              padding: 0,
              margin: 0,
              background: 'rgba(0,0,0,0.55)',
              cursor: 'pointer',
            }}
          />
        )}
      </AnimatePresence>

      <motion.aside
        role="dialog"
        aria-modal={open}
        aria-label="About drawer"
        initial={false}
        animate={{ x: open ? '0%' : closedX }}
        transition={{
          duration: reduceMotion ? 0 : DRAWER.slideS,
          ease: EASE_OUT,
        }}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: DRAWER.w,
          zIndex: 50,
          background: DRAWER.bg,
          overflow: 'visible',
          boxShadow: open ? '-24px 0 60px rgba(0,0,0,0.45)' : 'none',
        }}
      >
        <SideTabs
          active={section}
          onSelect={(id) => {
            if (!open) {
              // Peek: first click on ABOUT opens + lands on that section.
              onSelect(id, { open: true });
              return;
            }
            onSelect(id);
          }}
          visibleIds={visibleIds}
          reduceMotion={reduceMotion}
        />

        <div
          style={{
            height: '100%',
            overflowY: 'auto',
            padding: '48px 40px 56px',
            boxSizing: 'border-box',
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: DRAWER.fadeS, ease: EASE_OUT }}
            >
              <PlaceholderContent sectionId={section} />
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.aside>
    </>
  );
}

function FakeSiteChrome({ onAbout, aboutOpen }) {
  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 60,
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 36px',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.2em',
          color: inkA(0.35),
          textTransform: 'uppercase',
        }}
      >
        WWTAI
      </span>
      <button
        type="button"
        onClick={onAbout}
        aria-expanded={aboutOpen}
        style={{
          pointerEvents: 'auto',
          background: 'none',
          border: 'none',
          padding: '8px 4px',
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: aboutOpen ? '#fff' : inkA(0.75),
          cursor: 'pointer',
          borderBottom: aboutOpen
            ? `1px solid ${inkA(0.55)}`
            : `1px dotted ${inkA(0.28)}`,
        }}
      >
        About
      </button>
    </header>
  );
}

function BenchNote({ title, lines }) {
  return (
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
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: inkA(0.8) }}>{title}</div>
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

function useDrawerState() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('about');

  const openDrawer = useCallback((id = 'about') => {
    setSection(id);
    setOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setOpen(false);
    setSection('about');
  }, []);

  const selectSection = useCallback((id, opts) => {
    setSection(id);
    if (opts?.open) setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeDrawer]);

  return { open, section, openDrawer, closeDrawer, selectSection };
}

/** Variant 1 — ABOUT in the nav bar slides the drawer in. */
export function AboutDrawerNavLab() {
  const reduceMotion = useReducedMotion();
  const { open, section, openDrawer, closeDrawer, selectSection } = useDrawerState();

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        overflow: 'hidden',
      }}
    >
      <FakeSiteChrome
        aboutOpen={open}
        onAbout={() => (open ? closeDrawer() : openDrawer('about'))}
      />

      {/* Stand-in page body so the drawer has something to cover. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: 'min(70vw, 840px)',
            height: '52vh',
            border: `1px dashed ${inkA(0.14)}`,
            borderRadius: 2,
          }}
        />
      </div>

      <BenchNote
        title="About — nav drawer"
        lines={[
          'press ABOUT in the top bar',
          'tabs fade the panel content',
          'Esc / backdrop closes',
        ]}
      />

      <DrawerPanel
        open={open}
        section={section}
        onSelect={selectSection}
        onClose={closeDrawer}
        peek={false}
        reduceMotion={reduceMotion}
      />
    </div>
  );
}

/** Variant 2 — ABOUT tab peeks; other tabs appear only after open. */
export function AboutDrawerPeekLab() {
  const reduceMotion = useReducedMotion();
  const { open, section, closeDrawer, selectSection } = useDrawerState();

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: 'min(70vw, 840px)',
            height: '52vh',
            border: `1px dashed ${inkA(0.14)}`,
            borderRadius: 2,
          }}
        />
      </div>

      <BenchNote
        title="About — side peek"
        lines={[
          'ABOUT peeks from the right',
          'open → PROCESS + THE WHY appear',
          'Esc / backdrop closes',
        ]}
      />

      <DrawerPanel
        open={open}
        section={section}
        onSelect={selectSection}
        onClose={closeDrawer}
        peek
        reduceMotion={reduceMotion}
      />
    </div>
  );
}

export default AboutDrawerNavLab;
