import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { motion } from 'motion/react';

const NOTES = [
  '/notes/AC_006.png',
  '/notes/AC_007%201.png',
  '/notes/AC_063.png',
  '/notes/AC_141.png',
];

const EASE_OUT_CUBIC = [0.33, 1, 0.68, 1];

export default function DialDemoV3() {
  const [compressed, setCompressed] = useState(false);
  const [origins, setOrigins] = useState([]);
  const containerRef = useRef(null);
  const cardRefs = useRef([]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const positions = cardRefs.current.map((el) => {
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        cx: rect.left + rect.width / 2 - containerRect.left,
        cy: rect.top + rect.height / 2 - containerRect.top,
      };
    });
    setOrigins(positions);
  }, []);

  const targetX = containerRef.current
    ? containerRef.current.offsetWidth / 2
    : typeof window !== 'undefined' ? window.innerWidth / 2 : 500;
  const targetY = containerRef.current
    ? containerRef.current.offsetHeight + 40
    : typeof window !== 'undefined' ? window.innerHeight + 40 : 900;

  return (
    <div ref={containerRef} style={st.root}>
      <div style={st.scrollContainer}>
        {NOTES.map((src, i) => {
          const isCenter = i === Math.floor(NOTES.length / 2);
          const origin = origins[i];

          let dx = 0;
          let dy = 0;
          if (compressed && origin) {
            dx = targetX - origin.cx;
            dy = targetY - origin.cy;
          }

          return (
            <motion.div
              key={i}
              ref={(el) => (cardRefs.current[i] = el)}
              animate={{
                x: compressed ? dx : 0,
                y: compressed ? dy : 0,
                scale: compressed ? 0.6 : 1,
                opacity: compressed ? 0 : 1,
              }}
              transition={{
                duration: 0.7,
                ease: EASE_OUT_CUBIC,
                delay: i * 0.06,
                opacity: {
                  duration: 0.3,
                  delay: i * 0.06 + 0.4,
                  ease: EASE_OUT_CUBIC,
                },
              }}
              style={{
                ...st.cardWrapper,
                zIndex: isCenter ? 2 : 1,
              }}
            >
              <img
                src={src}
                alt="confession"
                style={{
                  ...st.cardImg,
                  opacity: isCenter ? 1 : 0.5,
                  transform: `scale(${isCenter ? 1.12 : 0.9})`,
                  mixBlendMode: 'lighten',
                }}
              />
            </motion.div>
          );
        })}
      </div>

      <div style={st.controls}>
        <motion.button
          onClick={() => setCompressed(!compressed)}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          style={st.btn}
        >
          {compressed ? 'Spread' : 'Compress'}
        </motion.button>
      </div>
    </div>
  );
}

const st = {
  root: {
    width: '100%',
    height: '100%',
    minHeight: '100vh',
    background: '#0a0a0a',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    fontFamily: 'var(--font-primary, system-ui, sans-serif)',
  },
  scrollContainer: {
    display: 'flex',
    gap: 20,
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollSnapType: 'x mandatory',
    width: '100%',
    padding: '40px 0',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    paddingLeft: 'calc(50% - 160px)',
    paddingRight: 'calc(50% - 160px)',
    alignItems: 'center',
  },
  cardWrapper: {
    flexShrink: 0,
    width: 320,
    scrollSnapAlign: 'center',
  },
  cardImg: {
    width: '100%',
    height: 'auto',
    display: 'block',
    borderRadius: 4,
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    pointerEvents: 'none',
    transition: 'opacity 0.35s ease, transform 0.35s ease',
  },
  controls: {
    position: 'absolute',
    bottom: 60,
    zIndex: 20,
  },
  btn: {
    padding: '12px 44px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 6,
    color: '#e5e5e5',
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'var(--font-primary, system-ui, sans-serif)',
    letterSpacing: '0.05em',
  },
};
