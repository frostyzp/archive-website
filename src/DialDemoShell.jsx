import { useState } from 'react';
import { motion } from 'motion/react';
import DialDemo from './DialDemo';
import DialDemoV2 from './DialDemoV2';
import DialDemoV3 from './DialDemoV3';
import DialDemoV4 from './DialDemoV4';
import NoiseLab from './NoiseLab';

const TABS = [
  { id: 'v1', label: 'Dial Swap' },
  { id: 'v2', label: 'Compress' },
  { id: 'v3', label: 'Radio Compress' },
  { id: 'v4', label: 'Side Dial' },
  { id: 'noise', label: 'Noise Lab' },
];

export default function DialDemoShell() {
  const [tab, setTab] = useState('v1');

  return (
    <div style={st.root}>
      <nav style={st.tabBar}>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                ...st.tab,
                color: active ? '#e5e5e5' : 'rgba(255,255,255,0.3)',
              }}
            >
              {t.label}
              {active && (
                <motion.div
                  layoutId="tab-underline"
                  style={st.underline}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </nav>

      <div style={st.content}>
        {tab === 'v1' && <DialDemo />}
        {tab === 'v2' && <DialDemoV2 />}
        {tab === 'v3' && <DialDemoV3 />}
        {tab === 'v4' && <DialDemoV4 />}
        {tab === 'noise' && <NoiseLab />}
      </div>
    </div>
  );
}

const st = {
  root: {
    width: '100%',
    minHeight: '100vh',
    background: '#0a0a0a',
    display: 'flex',
    flexDirection: 'column',
  },
  tabBar: {
    display: 'flex',
    justifyContent: 'center',
    gap: 32,
    padding: '20px 0 0',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    background: 'linear-gradient(to bottom, #0a0a0a 60%, transparent)',
    paddingBottom: 16,
  },
  tab: {
    position: 'relative',
    background: 'none',
    border: 'none',
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    padding: '8px 4px',
    fontFamily: 'var(--font-primary, system-ui, sans-serif)',
    transition: 'color 0.2s',
  },
  underline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1.5,
    background: '#e5e5e5',
    borderRadius: 1,
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
};
