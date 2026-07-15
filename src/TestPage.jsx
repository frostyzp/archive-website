import { useMemo, useState, useEffect, useRef } from 'react';
import art from './wwtaArt.txt?raw';
import { AsciiTextureBackground } from './AsciiTexture';

/*
 * /test — a scratch playground for the "What We Tell AI" block render.
 *
 * On load the picture doesn't wipe in top-to-bottom; instead random scattered
 * blocks fade in together in overlapping waves, so the image self-assembles out
 * of noise. On hover, whichever block the pointer is over gets "disturbed" — its
 * shade characters (░▒▓█) shuffle up and down the density ramp, inking darker.
 */

// Density ramp, lightest → heaviest. Index doubles as the "density level".
const RAMP = [' ', '░', '▒', '▓', '█'];
const DENSITY = { ' ': 0, '░': 1, '▒': 2, '▓': 3, '█': 4 };

// Palette — monochrome (grayscale) letterpress: ink on paper.
const PAPER = '#e8e6e1';
const INK = '#242220';
const INK_DARK = '#050505';

// A "block" for reveal + hover is a small rectangle of the character grid.
const TILE_W = 8; // columns per block
const TILE_H = 3; // rows per block

// Reveal choreography.
const WAVE_COUNT = 10;
const WAVE_GAP_MS = 130;
const REVEAL_START_MS = 160;
const FADE_MS = 720;

// Hover shimmer cadence.
const SHIMMER_MS = 90;

// Tiny deterministic RNG so a given (block, tick) always scrambles the same way.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Push a chunk of shade characters up/down the density ramp. Spaces stay empty
// so the silhouette holds; everything else drifts (and biases denser on hover).
function scrambleSegment(seg, seed) {
  const rnd = mulberry32(seed);
  let out = '';
  for (const ch of seg) {
    if (ch === ' ') {
      out += ' ';
      continue;
    }
    const lvl = DENSITY[ch] || 1;
    const r = rnd();
    let next;
    if (r < 0.18) {
      // Full swap to a random shade.
      next = 1 + Math.floor(rnd() * 4);
    } else {
      // Nudge density, biased heavier.
      const delta = [-1, 0, 1, 1, 2][Math.floor(rnd() * 5)];
      next = Math.min(4, Math.max(1, lvl + delta));
    }
    out += RAMP[next];
  }
  return out;
}

// Size the monospace grid to fill the viewport without overflowing either axis.
function useFitFontSize(cols, rows) {
  const read = () => {
    if (typeof window === 'undefined') return 11;
    const byWidth = (Math.min(window.innerWidth, 1500) * 0.94) / (cols * 0.6);
    const byHeight = (window.innerHeight * 0.9) / (rows * 0.92);
    return Math.max(4, Math.min(14, byWidth, byHeight));
  };
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows]);
  return size;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export default function TestPage() {
  const reducedMotion = usePrefersReducedMotion();

  // Parse the art into a fixed-width character grid, split into blocks, and
  // assign every non-empty block a random reveal wave.
  const { rows, cols, blockRows, blockCols, waveOf, structure } = useMemo(() => {
    const raw = art.replace(/\r/g, '').split('\n');
    const width = raw.reduce((m, r) => Math.max(m, r.length), 0);
    const padded = raw.map((r) => r.padEnd(width, ' '));

    const bRows = Math.ceil(padded.length / TILE_H);
    const bCols = Math.ceil(width / TILE_W);

    // Which blocks actually have ink (skip the blank ones when choreographing).
    const inked = [];
    for (let br = 0; br < bRows; br++) {
      for (let bc = 0; bc < bCols; bc++) {
        let hasInk = false;
        for (let r = br * TILE_H; r < Math.min((br + 1) * TILE_H, padded.length) && !hasInk; r++) {
          const slice = padded[r].slice(bc * TILE_W, (bc + 1) * TILE_W);
          if (/\S/.test(slice)) hasInk = true;
        }
        if (hasInk) inked.push(br * bCols + bc);
      }
    }

    const rnd = mulberry32(0x9e3779b9);
    shuffleInPlace(inked, rnd);
    const perWave = Math.ceil(inked.length / WAVE_COUNT);
    const wave = new Map();
    inked.forEach((id, i) => wave.set(id, Math.floor(i / perWave)));

    // Precompute per-row segments so render is just styling, no string slicing.
    const rowStructure = padded.map((line, r) => {
      const br = Math.floor(r / TILE_H);
      const segs = [];
      for (let bc = 0; bc < bCols; bc++) {
        segs.push({
          bc,
          blockId: br * bCols + bc,
          text: line.slice(bc * TILE_W, (bc + 1) * TILE_W),
        });
      }
      return { r, segs };
    });

    return {
      rows: padded,
      cols: width,
      blockRows: bRows,
      blockCols: bCols,
      waveOf: wave,
      structure: rowStructure,
    };
  }, []);

  const fontSize = useFitFontSize(cols, rows.length);

  // Reveal state: how many waves have landed so far.
  const [wave, setWave] = useState(reducedMotion ? WAVE_COUNT : -1);
  useEffect(() => {
    if (reducedMotion) {
      setWave(WAVE_COUNT);
      return;
    }
    setWave(-1);
    const timers = [];
    for (let i = 0; i <= WAVE_COUNT; i++) {
      timers.push(setTimeout(() => setWave(i), REVEAL_START_MS + i * WAVE_GAP_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  const revealed = reducedMotion || wave >= WAVE_COUNT;

  // Hover state: which block is being disturbed + a shimmer tick.
  const [hoverBlock, setHoverBlock] = useState(null);
  const [tick, setTick] = useState(0);
  const hoverRef = useRef(null);
  hoverRef.current = hoverBlock;

  useEffect(() => {
    if (hoverBlock === null || reducedMotion) return;
    const id = setInterval(() => setTick((t) => (t + 1) % 100000), SHIMMER_MS);
    return () => clearInterval(id);
  }, [hoverBlock, reducedMotion]);

  const onPointerOver = (e) => {
    const raw = e.target?.dataset?.block;
    if (raw == null) return;
    const id = Number(raw);
    if (id !== hoverRef.current) setHoverBlock(id);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: PAPER,
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        padding: '4vh 2vw',
      }}
    >
      <AsciiTextureBackground />

      <pre
        onMouseOver={onPointerOver}
        onMouseLeave={() => setHoverBlock(null)}
        style={{
          position: 'relative',
          zIndex: 1,
          margin: 0,
          fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
          fontSize,
          lineHeight: 0.92,
          letterSpacing: 0,
          color: INK,
          textShadow: '0 0 0.4px currentColor',
          cursor: 'crosshair',
          userSelect: 'none',
          whiteSpace: 'pre',
        }}
      >
        {structure.map(({ r, segs }) => (
          <span key={r}>
            {segs.map((seg) => {
              const isHovered = seg.blockId === hoverBlock;
              const blockWave = waveOf.get(seg.blockId);
              // Blank blocks have no wave — they're always "present" (invisible anyway).
              const isRevealed =
                reducedMotion || blockWave === undefined || wave >= blockWave;
              const text = isHovered
                ? scrambleSegment(seg.text, (seg.blockId * 2654435761) ^ (r * 40503) ^ (tick * 668265263))
                : seg.text;
              return (
                <span
                  key={seg.bc}
                  data-block={seg.blockId}
                  style={{
                    opacity: isRevealed ? 1 : 0,
                    color: isHovered ? INK_DARK : undefined,
                    transition: reducedMotion
                      ? undefined
                      : `opacity ${FADE_MS}ms cubic-bezier(0.22,1,0.36,1)`,
                  }}
                >
                  {text}
                </span>
              );
            })}
            {'\n'}
          </span>
        ))}
      </pre>

      <div
        aria-hidden
        style={{
          position: 'fixed',
          bottom: 18,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: INK,
          opacity: revealed ? 0.32 : 0,
          transition: 'opacity 900ms ease',
          pointerEvents: 'none',
        }}
      >
        hover to disturb the field
      </div>
    </div>
  );
}
