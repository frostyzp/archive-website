import { useState } from 'react';
import { motion } from 'motion/react';

const NOTES = [
  '/notes/AC_006.png',
  '/notes/AC_007%201.png',
  '/notes/AC_063.png',
  '/notes/AC_141.png',
];

const CARD_COUNT = NOTES.length;
const CENTER = Math.floor(CARD_COUNT / 2);
const CARD_W = 180;
const CARD_GAP = 40;
const Y_OFFSET_PER_STEP = 8;
const ROTATION_SPREAD = 6;

function getSpreadPosition(i) {
  const distFromCenter = i - CENTER;
  return {
    x: distFromCenter * (CARD_W + CARD_GAP),
    y: 0,
    rotate: distFromCenter * ROTATION_SPREAD,
  };
}

function getCompressedPosition(i) {
  const distFromCenter = i - CENTER;
  const absD = Math.abs(distFromCenter);
  return {
    x: 0,
    y: -absD * Y_OFFSET_PER_STEP,
    rotate: distFromCenter * 1.5,
  };
}

export default function DialDemoV2() {
  const [compressed, setCompressed] = useState(false);

  return (
    <div style={st.root}>
      <div style={st.cardsArea}>
        <div style={st.cardsAnchor}>
          {Array.from({ length: CARD_COUNT }, (_, i) => {
            const distFromCenter = i - CENTER;
            const absD = Math.abs(distFromCenter);
            const isCenter = i === CENTER;
            const pos = compressed
              ? getCompressedPosition(i)
              : getSpreadPosition(i);

            const staggerDelay = absD * 0.06;

            return (
              <motion.div
                key={i}
                animate={{
                  x: pos.x,
                  y: pos.y,
                  rotate: pos.rotate,
                  scale: compressed && !isCenter ? 0.92 - absD * 0.02 : 1,
                }}
                transition={{
                  type: 'spring',
                  stiffness: 180,
                  damping: 22,
                  mass: 0.8 + absD * 0.15,
                  delay: staggerDelay,
                }}
                style={{
                  ...st.card,
                  zIndex: CARD_COUNT - absD,
                }}
              >
                <img
                  src={NOTES[i % NOTES.length]}
                  alt="confession"
                  style={{
                    ...st.cardImg,
                    opacity: isCenter ? 1 : 0.5,
                    mixBlendMode: 'lighten',
                  }}
                />
              </motion.div>
            );
          })}
        </div>
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
  cardsArea: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cardsAnchor: {
    position: 'relative',
    width: CARD_W,
    height: CARD_W * 0.55,
  },
  card: {
    position: 'absolute',
    width: CARD_W,
    top: 0,
    left: 0,
    transformOrigin: 'center center',
  },
  cardImg: {
    width: '100%',
    height: 'auto',
    display: 'block',
    borderRadius: 4,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    transition: 'opacity 0.4s ease',
    pointerEvents: 'none',
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
