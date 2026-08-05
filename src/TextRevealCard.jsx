import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { INK, inkA } from './colors';
import { noiseUrl } from './noise';
import { RevealGL, hexToRgb, renderCornerText, springStep } from './revealGL';

/**
 * Display-only plate: two small serif text blocks in OPPOSITE CORNERS
 * (top-left + bottom-right) that materialize through the WebGL mask reveal in
 * revealGL.js — a cloudy fbm dissolve with a localized un-blur, so each part of
 * a line comes into focus as the front uncovers it.
 *
 * Cycle: reveal → hold → clear → swap to the next phrase pair → repeat, with a
 * fresh noise seed each time so no two dissolves look alike. Progress is one
 * critically-damped spring toward a target (1 in, 0 out); the exit spring is
 * stiffer, so the plate clears quicker than it arrives.
 *
 * The card is decorative — it reads as ambient texture, not as a control. It
 * pauses offscreen and when the tab is hidden, caps DPR at 2, renders a single
 * resolved frame under `prefers-reduced-motion`, and falls back to plain DOM
 * corner text if WebGL is unavailable.
 */

const DEFAULT_PAIRS = [
  {
    top: ['Type can arrive like weather,', 'gathering at an edge.'],
    bottom: ['It holds for a beat,', 'then clears again.'],
  },
  {
    top: ['Small things, done well,', 'read as calm.'],
    bottom: ['Motion with a direction', 'feels intentional.'],
  },
];

/* Timing / feel. The hold is long enough to actually read both blocks — the
   dissolve itself takes roughly a second at K_IN, so a short hold would clear
   the words before they land. */
const HOLD_MS = 2600;
const OUT_HOLD_MS = 260;
const MAX_BLUR = 16;
const K_IN = 16; //   entrance spring stiffness
const K_OUT = 22; //  exit is stiffer — clears quicker than it arrives
const DAMP = 1.12; // just past critical, so it never overshoots into a wobble

const REVEALED_AT = 0.95;
const GONE_AT = 0.02;
const PARALLAX_AMP = 0.006;

// Where each corner block sits in UV space — the parallax offset is measured
// from these anchors so the two blocks lean by slightly different amounts.
const TL_ANCHOR = [0.16, 0.18];
const BR_ANCHOR = [0.84, 0.82];

const PLATE_GRAIN = noiseUrl({ baseFrequency: 1.1, numOctaves: 2, seed: 7, size: 200 });

// Soft off-centre pools of light so the plate isn't a flat rectangle — the dark
// counterpart of a paper wash.
const PLATE_WASH = [
  'radial-gradient(58% 78% at 18% 12%, rgba(207,202,183,0.055), transparent 62%)',
  'radial-gradient(50% 68% at 84% 84%, rgba(207,202,183,0.045), transparent 64%)',
  'radial-gradient(90% 60% at 50% 0%, rgba(221,221,174,0.035), transparent 58%)',
].join(', ');

/** Resolve a CSS font stack (which may contain custom properties) to something
 *  canvas 2D's `font` shorthand can use. */
function resolveFamily(cssFamily) {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden';
  probe.style.fontFamily = cssFamily;
  probe.textContent = 'Ag';
  document.body.appendChild(probe);
  const fam = getComputedStyle(probe).fontFamily || 'serif';
  probe.remove();
  return fam;
}

export default function TextRevealCard({
  pairs = DEFAULT_PAIRS,
  font = "'Faktory', Georgia, serif",
  ink = INK,
  glow = '#DDDDAE',
  plate = '#0E0D0C',
  border = inkA(0.1),
  aspectRatio = '1344 / 620',
  holdMs = HOLD_MS,
  maxBlur = MAX_BLUR,
  style,
}) {
  const hostRef = useRef(null);
  const reduce = useReducedMotion();
  // Flipped on when WebGL can't run, which swaps in real DOM corner text.
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let W = host.clientWidth || 1;
    let H = host.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let family = resolveFamily(font);
    const edge = hexToRgb(glow);

    const gl = new RevealGL();
    if (!gl.available) {
      setFallback(true);
      gl.destroy();
      return undefined;
    }
    setFallback(false);
    gl.canvas.style.zIndex = '1';
    gl.resize(W, H, dpr);
    host.appendChild(gl.canvas);

    let index = 0;
    let seed = 1.7;

    const mount = () => {
      const pair = pairs[index % pairs.length];
      gl.setTexture(
        renderCornerText({
          top: pair.top,
          bottom: pair.bottom,
          font: family,
          fill: ink,
          cardW: W,
          cardH: H,
          dpr,
        })
      );
    };
    mount();

    /* ── Pointer parallax — mouse only, so a touch drag doesn't jerk the plate
          and a visitor with no cursor gets a plate at rest. ────────────────── */
    let pTgtX = 0.5;
    let pTgtY = 0.5;
    let pCurX = 0.5;
    let pCurY = 0.5;
    let cursorUV = [-1, -1];
    let hoverTgt = 0;
    let hoverCur = 0;

    const onMove = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const b = host.getBoundingClientRect();
      const ux = (e.clientX - b.left) / b.width;
      const uy = (e.clientY - b.top) / b.height;
      pTgtX = ux;
      pTgtY = uy;
      cursorUV = [ux, uy];
      hoverTgt = 1;
    };
    const onLeave = () => {
      pTgtX = 0.5;
      pTgtY = 0.5;
      hoverTgt = 0;
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);

    /* ── Phase machine + spring ─────────────────────────────────────────────
          in → hold → out → (swap pair, new seed) → in … */
    let phase = 'in';
    let phaseStart = 0;
    let progress = 0;
    let vel = 0;
    let target = 1;
    let clock = 0;
    let last = 0;
    let raf = 0;
    let running = false;
    let held = 0;

    const frame = () => {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      clock += dt;

      const k = target > 0.5 ? K_IN : K_OUT;
      [progress, vel] = springStep(progress, vel, target, k, DAMP, dt);

      if (phase === 'in') {
        if (progress >= REVEALED_AT) {
          phase = 'hold';
          phaseStart = now;
        }
      } else if (phase === 'hold') {
        if (now - phaseStart >= holdMs) {
          phase = 'out';
          phaseStart = now;
          target = 0;
        }
      } else if (progress <= GONE_AT && now - phaseStart >= OUT_HOLD_MS) {
        index = (index + 1) % pairs.length;
        // Irrational-ish walk so the seed never revisits the same value.
        seed = ((seed * 1.618) % 7) + 0.3;
        mount();
        phase = 'in';
        phaseStart = now;
        progress = 0;
        vel = 0;
        target = 1;
      }

      // Frame-rate independent easing toward the pointer (and toward rest when
      // the cursor leaves).
      const pk = 1 - Math.pow(0.0009, dt);
      pCurX += (pTgtX - pCurX) * pk;
      pCurY += (pTgtY - pCurY) * pk;
      hoverCur += (hoverTgt - hoverCur) * (1 - Math.pow(0.002, dt));

      const amp = PARALLAX_AMP * hoverCur;
      const parTL = [(pCurX - TL_ANCHOR[0]) * amp, (pCurY - TL_ANCHOR[1]) * amp];
      const parBR = [(pCurX - BR_ANCHOR[0]) * amp, (pCurY - BR_ANCHOR[1]) * amp];

      const p = Math.max(0, Math.min(1, progress));
      const reverse = phase === 'out' ? 1 : 0;
      gl.draw(p, maxBlur, edge, clock, W / Math.max(1, H), seed, parTL, parBR, cursorUV, hoverCur, reverse);

      // While the plate is held, it breathes — a fraction of a percent of scale
      // and brightness, enough to keep it from reading as a frozen image.
      held += ((phase === 'hold' ? 1 : 0) - held) * (1 - Math.pow(0.02, dt));
      const breathe = Math.sin(clock * 0.45) * 0.5 + 0.5;
      const s = 1 + held * breathe * 0.0015;
      const b = 1 + held * (breathe - 0.5) * 0.012;
      gl.canvas.style.transform = `scale(${s.toFixed(4)})`;
      gl.canvas.style.filter = `brightness(${b.toFixed(3)})`;

      raf = requestAnimationFrame(frame);
    };

    const renderStill = () => {
      gl.draw(1, 0, edge, 0, W / Math.max(1, H), seed, [0, 0], [0, 0], [-1, -1], 0, 0);
    };

    const start = () => {
      if (running) return;
      running = true;
      phase = 'in';
      phaseStart = performance.now();
      last = phaseStart;
      progress = 0;
      vel = 0;
      target = 1;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    /* ── Only run when it can actually be seen ──────────────────────────── */
    let onScreen = false;
    let hidden = document.hidden;
    const sync = () => {
      if (reduce) return;
      if (onScreen && !hidden) start();
      else stop();
    };

    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? false;
        sync();
      },
      { threshold: 0.15 }
    );
    io.observe(host);

    const onVis = () => {
      hidden = document.hidden;
      sync();
    };
    document.addEventListener('visibilitychange', onVis);

    let resizeT = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeT);
      resizeT = window.setTimeout(() => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        if (w < 2 || h < 2 || (w === W && h === H)) return;
        W = w;
        H = h;
        gl.resize(W, H, dpr);
        mount();
        // Paused (reduced motion, or scrolled away): repaint the still frame,
        // otherwise the resized canvas stays blank until the loop resumes.
        if (!running) renderStill();
      }, 120);
    });
    ro.observe(host);

    // The plate is rasterized with whatever face is available at mount, so
    // redraw it once webfonts have settled.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (cancelled) return;
      family = resolveFamily(font);
      mount();
      if (!running) renderStill();
    });

    if (reduce) renderStill();

    return () => {
      cancelled = true;
      stop();
      io.disconnect();
      ro.disconnect();
      window.clearTimeout(resizeT);
      document.removeEventListener('visibilitychange', onVis);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      gl.destroy();
    };
  }, [pairs, font, ink, glow, holdMs, maxBlur, reduce]);

  const cornerText = {
    position: 'absolute',
    maxWidth: '52%',
    margin: 0,
    fontFamily: font,
    fontWeight: 500,
    fontSize: 'clamp(15px, 2.4vw, 24px)',
    lineHeight: 1.42,
    color: ink,
  };

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio,
        overflow: 'hidden',
        borderRadius: 12,
        border: `1px solid ${border}`,
        background: plate,
        userSelect: 'none',
        ...style,
      }}
    >
      <div
        style={{ position: 'absolute', inset: '-8%', zIndex: 0, backgroundImage: PLATE_WASH }}
      />

      {/* No WebGL — the same two blocks, statically, in the same corners. */}
      {fallback && (
        <>
          <p style={{ ...cornerText, top: '3.5%', left: '3.5%', textAlign: 'left' }}>
            {pairs[0].top.join(' ')}
          </p>
          <p style={{ ...cornerText, bottom: '3.5%', right: '3.5%', textAlign: 'right' }}>
            {pairs[0].bottom.join(' ')}
          </p>
        </>
      )}

      {/* Grain sits ABOVE the type so the words pick up the page's film texture
          instead of reading as clean glyphs floating over it. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          pointerEvents: 'none',
          backgroundImage: PLATE_GRAIN,
          backgroundSize: '200px 200px',
          backgroundRepeat: 'repeat',
          mixBlendMode: 'overlay',
          opacity: 0.5,
        }}
      />
    </div>
  );
}
