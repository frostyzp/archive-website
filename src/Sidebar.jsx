import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Text } from './text';
import { subscribeToKit } from './kit';

const ease = [0.22, 1, 0.36, 1];

export const SIDEBAR_WIDTH = 'max(260px, 25vw)';
// How much of the sidebar peeks past the left edge when collapsed. Acts as
// the visible affordance/handle and the inset the main content respects.
export const SIDEBAR_PEEK = '28px';

/**
 * Sidebar can be controlled (pass `collapsed` + `onToggle`) or uncontrolled
 * (omit them — falls back to internal state, defaulting to collapsed). When
 * controlled the parent typically wants to know so the main content can
 * reclaim the freed-up width.
 */
export function Sidebar({
  metadata,
  currentImage,
  transcription,
  onNavigate,
  activePage,
  collapsed: collapsedProp,
  onToggle,
}) {
  const [internalCollapsed, setInternalCollapsed] = useState(true);
  const collapsed = collapsedProp ?? internalCollapsed;
  const toggle = () => {
    if (onToggle) onToggle(!collapsed);
    else setInternalCollapsed((c) => !c);
  };

  return (
    <motion.aside
      // Slide the panel almost fully off-screen, leaving SIDEBAR_PEEK visible
      // on the left edge to act as the handle. Mixing % + px requires calc;
      // motion v12 interpolates calc strings cleanly when both endpoints use
      // the same shape.
      initial={false}
      animate={{
        x: collapsed ? `calc(-100% + ${SIDEBAR_PEEK})` : 'calc(0% + 0px)',
      }}
      transition={{ duration: 0.45, ease }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: SIDEBAR_WIDTH,
        height: '100vh',
        padding: '32px 28px',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
        background: 'rgba(10,10,10,0.95)',
        borderRight: '1px solid rgba(207,202,183,0.06)',
        // Hide the peek's interior content from screen readers / tab focus
        // when collapsed so users don't trip over invisible buttons.
        pointerEvents: collapsed ? 'none' : 'auto',
      }}
      aria-hidden={collapsed}
    >
      {/* Edge tab — sits on the right border of the panel so it's always the
          first thing a user sees on the visible peek. Re-enables pointer
          events because the panel disables them while collapsed. */}
      <button
        onClick={toggle}
        aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
        aria-expanded={!collapsed}
        style={{
          position: 'absolute',
          top: '50%',
          right: 0,
          transform: 'translate(50%, -50%)',
          width: 22,
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(20,20,20,0.95)',
          border: '1px solid rgba(207,202,183,0.12)',
          borderRadius: 4,
          color: 'rgba(207,202,183,0.85)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 11,
          lineHeight: 1,
          padding: 0,
          pointerEvents: 'auto',
          zIndex: 2,
          transition: 'background 0.2s ease, color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(40,40,40,0.95)';
          e.currentTarget.style.color = '#CFCAB7';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(20,20,20,0.95)';
          e.currentTarget.style.color = 'rgba(207,202,183,0.85)';
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>

      {/* Logo */}
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(22px, 2vw, 28px)',
          fontWeight: 400,
          lineHeight: 1,
          letterSpacing: '0.01em',
          color: '#CFCAB7',
          margin: 0,
          marginBottom: 40,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        AI Confessions
      </h2>

      {/* Navigation */}
      <nav
        style={{
          display: 'flex',
          gap: 24,
          marginBottom: 48,
          fontFamily: 'var(--font-mono)',
        }}
      >
        <NavLink active={activePage === 'about'} onClick={() => onNavigate?.('about')}>
          ABOUT
        </NavLink>
        <NavLink active={activePage === 'submit'} onClick={() => onNavigate?.('submit')}>
          SUBMIT
        </NavLink>
      </nav>

      {/* Scrollable content panel — content swaps based on activePage */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          marginRight: -12,
          paddingRight: 12,
          marginBottom: 16,
        }}
      >
        <AnimatePresence mode="wait">
          {activePage === 'submit' ? (
            <SubmitPanel key="submit" />
          ) : activePage === 'about' ? (
            <AboutPanel key="about" />
          ) : (
            <MetadataPanel
              key="metadata"
              metadata={metadata}
              transcription={transcription}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}

function NavLink({ children, onClick, active }) {
  const baseOpacity = active ? 1 : 0.5;
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        color: '#CFCAB7',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 400,
        letterSpacing: '0.04em',
        fontFamily: 'var(--font-mono)',
        padding: 0,
        opacity: baseOpacity,
        textDecoration: active ? 'underline' : 'none',
        textUnderlineOffset: 4,
        transition: 'opacity 0.2s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = baseOpacity)}
    >
      {children}
    </button>
  );
}

function MetadataRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
      <Text variant="caption" mono style={{ fontSize: 10, opacity: 0.4, letterSpacing: '0.08em' }}>
        {label}
      </Text>
      <Text variant="label" mono style={{ fontSize: 11, fontWeight: 400, letterSpacing: '0.04em' }}>
        {value}
      </Text>
    </div>
  );
}

const panelMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.3, ease },
};

function MetadataPanel({ metadata, transcription }) {
  if (!metadata && !transcription) return null;
  return (
    <motion.div {...panelMotion}>
      {metadata && (
        <div style={{ marginBottom: 24 }}>
          <MetadataRow label="LOCATION" value={metadata.location} />
          <MetadataRow label="SESSION" value={metadata.session} />
          <MetadataRow label="COLLECTED" value={metadata.collected} />
        </div>
      )}
      {transcription && (
        <div
          style={{
            padding: '12px 14px',
            background: 'rgba(207,202,183,0.05)',
            borderRadius: 4,
            border: '1px solid rgba(207,202,183,0.08)',
          }}
        >
          <Text variant="bodySmall" style={{ lineHeight: 1.6, opacity: 0.85 }}>
            {transcription}
          </Text>
        </div>
      )}
    </motion.div>
  );
}

function AboutPanel() {
  const [email, setEmail] = useState('');
  // 'idle' | 'submitting' | 'success' | 'error'
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const submitting = status === 'submitting';
  const submitted = status === 'success';

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || submitting) return;

    setStatus('submitting');
    setErrorMsg('');
    try {
      await subscribeToKit(email);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  }

  return (
    <motion.div {...panelMotion} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Placeholder image */}
      <div
        style={{
          width: '100%',
          aspectRatio: '4 / 3',
          border: '1px solid rgba(207,202,183,0.1)',
          background: '#0a0a0a',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <img
          src="/box-bg.png"
          alt="AI Confessions installation"
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.55,
            filter: 'grayscale(0.3)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: 'rgba(207,202,183,0.55)',
            textTransform: 'uppercase',
          }}
        >
          Fig. 01 — 2026
        </div>
      </div>

      <Text variant="bodySmall" style={{ lineHeight: 1.7, opacity: 0.85, fontSize: 13 }}>
        What We Tell AI is a collection of anonymous notes people have written
        about their relationship with artificial intelligence.
      </Text>
      

      <Text variant="bodySmall" style={{ lineHeight: 1.7, opacity: 0.75, fontSize: 13 }}>
        This anthropological art project documents AI&rsquo;s growing presence in
        the most intimate details of our lives.
      </Text>

      <Text variant="bodySmall" style={{ lineHeight: 1.7, opacity: 0.65, fontSize: 13 }}>
        Each handwritten note is collected in public parks, on street corners,
        and even at AI conferences.
      </Text>

      {/* Email signup */}
      <div
        style={{
          marginTop: 4,
          paddingTop: 16,
          borderTop: '1px solid rgba(207,202,183,0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <Text
          variant="caption"
          mono
          style={{ fontSize: 10, opacity: 0.55, letterSpacing: '0.12em' }}
        >
          Collection is ongoing — get in touch!
        </Text>

        {!submitted ? (
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@somewhere.com"
              required
              disabled={submitting}
              autoComplete="email"
              style={{
                background: 'rgba(207,202,183,0.04)',
                border: '1px solid rgba(207,202,183,0.15)',
                color: '#CFCAB7',
                padding: '9px 10px',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.02em',
                outline: 'none',
                borderRadius: 3,
                width: '100%',
                opacity: submitting ? 0.6 : 1,
              }}
              onFocus={(e) =>
                (e.currentTarget.style.borderColor = 'rgba(207,202,183,0.4)')
              }
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = 'rgba(207,202,183,0.15)')
              }
            />
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: '#e5e5e5',
                color: '#0a0a0a',
                border: 'none',
                padding: '9px 12px',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.14em',
                cursor: submitting ? 'default' : 'pointer',
                borderRadius: 3,
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? 'SUBSCRIBING…' : 'SUBSCRIBE'}
            </button>
            {status === 'error' && (
              <Text
                variant="caption"
                mono
                style={{
                  fontSize: 10,
                  letterSpacing: '0.04em',
                  lineHeight: 1.5,
                  color: 'rgba(255,130,130,0.9)',
                }}
              >
                {errorMsg}
              </Text>
            )}
          </form>
        ) : (
          <div
            style={{
              padding: '9px 10px',
              background: 'rgba(207,202,183,0.04)',
              border: '1px solid rgba(207,202,183,0.15)',
              borderRadius: 3,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              color: 'rgba(207,202,183,0.85)',
              lineHeight: 1.5,
            }}
          >
            Thanks — check your inbox to confirm your subscription.
          </div>
        )}
      </div>

      {/* Credits */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 16,
          borderTop: '1px solid rgba(207,202,183,0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'rgba(207,202,183,0.45)',
        }}
      >
        <div>Project by Olivia</div>
        <div>Website by Arin</div>
        <div style={{ marginTop: 8 }}>© What We Tell AI 2026</div>
      </div>
    </motion.div>
  );
}

function SubmitPanel() {
  return (
    <motion.div {...panelMotion} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Text variant="bodySmall" style={{ lineHeight: 1.7, opacity: 0.85, fontSize: 13 }}>
        Want to share a confession? Drop a note in any collection box, or write
        one here.
      </Text>
      <Text
        variant="caption"
        mono
        style={{ fontSize: 10, opacity: 0.5, letterSpacing: '0.18em' }}
      >
        Submission flow — coming soon
      </Text>
    </motion.div>
  );
}
