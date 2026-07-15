import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { createNoise3D } from 'simplex-noise';

/*
 * AsciiTextureBackground — a living field of ░▒▓█ blocks, the character-grid
 * cousin of the SVG grain. A single <pre> is repainted on a rAF clock (throttled
 * to `fps`); every cell picks a shade off the ░▒▓█ ramp from an evolving field.
 *
 * Three fields, switchable live:
 *   flow   — smooth simplex noise drifting in 3D (x, y, time)  → organic dither
 *   static — per-cell random every frame                       → TV static
 *   rain   — falling comet trails, brightest at the head       → matrix-ish
 *
 * A static frame is painted synchronously whenever a knob (or the viewport)
 * changes, so there's never a blank flash before the first animation frame and
 * the field still shows under prefers-reduced-motion (where the rAF loop idles).
 *
 * Everything is exposed in the "ASCII Texture" DialKit panel — append ?dial=1
 * to the URL to reveal it. Renders as an absolute inset:0 layer; drop it into a
 * relatively/fixed-positioned parent behind your content.
 */

const RAMP = ' \u2591\u2592\u2593\u2588'; // space ░ ▒ ▓ █
const MAX = RAMP.length - 1; // 4
// Monospace glyph advance ≈ 0.6em; used to pitch columns so blocks tile tight.
const CHAR_ASPECT = 0.6;
// Safety rail so a tiny cell size on a huge display can't wedge the main thread.
const MAX_CELLS = 60000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function useViewport() {
  const read = () => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export function AsciiTextureBackground() {
  const reduce = useReducedMotion();
  const { w, h } = useViewport();

  const p = useDialKit('ASCII Texture', {
    enabled: true,
    mode: { type: 'select', options: ['flow', 'static', 'rain'], default: 'flow' },
    cell: [12, 6, 32, 1], // px — glyph size ≈ texture resolution
    fps: [16, 1, 60, 1], // repaint cadence (lower = chunkier/more digital)
    flow: [0.5, 0, 4, 0.05], // time speed
    scale: [0.03, 0.004, 0.16, 0.002], // spatial frequency (flow)
    contrast: [1.6, 0.2, 4, 0.1], // pushes shades toward empty/full
    density: [-0.15, -0.6, 0.6, 0.02], // fill bias (also tail length for rain)
    color: { type: 'color', default: '#242220' },
    opacity: [0.16, 0, 1, 0.01],
    blend: {
      type: 'select',
      options: ['normal', 'multiply', 'overlay', 'soft-light', 'screen'],
      default: 'multiply',
    },
    seed: [7, 0, 99, 1],
  });

  const noise3D = useMemo(
    () => createNoise3D(mulberry32(Math.round(p.seed) * 2654435761)),
    [p.seed]
  );

  const preRef = useRef(null);
  const rainRef = useRef({ cols: 0, speeds: null, offsets: null });

  // Build one frame at the given time (seconds) and write it into the <pre>.
  // Reassigned every render so it always closes over the latest params/size.
  const paintRef = useRef(() => {});
  paintRef.current = (time) => {
    const pre = preRef.current;
    if (!pre) return;
    if (!p.enabled) {
      if (pre.textContent) pre.textContent = '';
      return;
    }

    let cell = Math.max(4, p.cell);
    let colPitch = cell * CHAR_ASPECT;
    let cols = Math.ceil(w / colPitch) + 2;
    let rows = Math.ceil(h / cell) + 1;
    while (cols * rows > MAX_CELLS) {
      cell += 1;
      colPitch = cell * CHAR_ASPECT;
      cols = Math.ceil(w / colPitch) + 2;
      rows = Math.ceil(h / cell) + 1;
    }

    const contrast = p.contrast;
    const bias = p.density;
    let out = '';

    if (p.mode === 'static') {
      for (let r = 0; r < rows; r++) {
        for (let cx = 0; cx < cols; cx++) {
          let v = Math.random();
          v = (v - 0.5) * contrast + 0.5 + bias;
          out += RAMP[Math.round(clamp01(v) * MAX)];
        }
        out += '\n';
      }
    } else if (p.mode === 'rain') {
      const rain = rainRef.current;
      if (rain.cols !== cols) {
        const rng = mulberry32(1337 + cols);
        rain.cols = cols;
        rain.speeds = Array.from({ length: cols }, () => 0.5 + rng() * 1.5);
        rain.offsets = Array.from({ length: cols }, () => rng());
      }
      const tail = Math.max(2, clamp01(bias + 0.6) * rows * 0.9);
      const heads = new Array(cols);
      for (let cx = 0; cx < cols; cx++) {
        heads[cx] = (time * 6 * rain.speeds[cx] + rain.offsets[cx] * rows) % rows;
      }
      for (let r = 0; r < rows; r++) {
        for (let cx = 0; cx < cols; cx++) {
          let d = heads[cx] - r;
          if (d < 0) d += rows;
          if (d <= tail) {
            const intensity = 1 - d / tail;
            out += RAMP[1 + Math.round(intensity * (MAX - 1))];
          } else {
            out += ' ';
          }
        }
        out += '\n';
      }
    } else {
      // flow (default)
      const sx = colPitch * p.scale;
      const sy = cell * p.scale;
      for (let r = 0; r < rows; r++) {
        const ny = r * sy;
        for (let cx = 0; cx < cols; cx++) {
          let v = (noise3D(cx * sx, ny, time) + 1) / 2;
          v = (v - 0.5) * contrast + 0.5 + bias;
          out += RAMP[Math.round(clamp01(v) * MAX)];
        }
        out += '\n';
      }
    }

    pre.style.fontSize = `${cell}px`;
    pre.textContent = out;
  };

  // Config the rAF loop needs for scheduling (params it doesn't repaint on).
  const cfgRef = useRef();
  cfgRef.current = { enabled: p.enabled, fps: p.fps, flow: p.flow, reduce };

  // Animation loop. Advances a wall clock and repaints at `fps`. Frame-starved
  // or hidden tabs simply stop animating; the static paint below keeps a frame.
  useEffect(() => {
    let raf;
    let start = null;
    let lastDraw = -Infinity;
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      const cfg = cfgRef.current;
      if (!cfg.enabled || cfg.reduce) return;
      const fps = Math.max(1, cfg.fps);
      if (now - lastDraw < 1000 / fps) return;
      lastDraw = now;
      if (start == null) start = now;
      paintRef.current(((now - start) / 1000) * cfg.flow);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Paint a static frame immediately on mount and whenever the field or the
  // viewport changes — no blank flash, and it works without rAF.
  useEffect(() => {
    paintRef.current(0);
  }, [p.enabled, p.mode, p.cell, p.scale, p.contrast, p.density, p.seed, reduce, w, h, noise3D]);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: p.opacity,
        mixBlendMode: p.blend,
        color: p.color,
      }}
    >
      <pre
        ref={preRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          margin: 0,
          fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1,
          letterSpacing: 0,
          whiteSpace: 'pre',
          userSelect: 'none',
        }}
      />
    </div>
  );
}

export default AsciiTextureBackground;
