import { useEffect, useRef, useState } from 'react';
import { RevealGL, hexToRgb, springStep } from './revealGL';

/**
 * The WebGL mask dissolve (see revealGL.js) run over a block of copy that is
 * already laid out in the DOM: the live layout is rasterized to a texture, the
 * texture blooms in out of a cloudy fbm field — each part un-blurring as the
 * front uncovers it — and then the canvas cross-fades out and the real text
 * takes over. It plays once.
 *
 * Handing back to the DOM is the point. After the beat the copy is genuine
 * selectable text at native crispness, it reflows on resize with no stale
 * raster to maintain, and anything a raster can't carry (ink underline strokes,
 * per-word motion) picks up from there. The text is in the DOM the whole time,
 * so it is in the accessibility tree and in the page's text content regardless
 * of phase.
 *
 * Consumers: TranscriptReveal (the active note's transcription) and WordmarkGL
 * (the 'gl' hero title mode). The onboarding display copy used to run through
 * here too; it cascades in word by word now, so nothing on that page touches
 * WebGL.
 */

/** px of un-blur at the dissolve front. Scale it to the type size — a radius
 *  tuned for 40px display copy smears 12px body copy into a glow. */
export const MAX_BLUR = 14;

/** Entrance spring stiffness — the one knob for how slow the dissolve is. Lower
 *  is slower, by roughly 1/√k: at k=9 the front takes ~1.5s to clear the block,
 *  where k=16 takes ~1.1s. */
export const K_IN = 9;

/** Canvas → live DOM cross-fade. */
export const HANDOFF_S = 0.24;

/** Warm flare riding the front, matched to the onboarding hero fill. */
export const GLOW = '#DDDDAE';

/**
 * Frames per second the dissolve is allowed to draw at (0 = uncapped rAF).
 *
 * Held at film rate on purpose. Run uncapped and the cloudy fbm field resolves
 * as smooth video, which reads as slick rather than as the developing/degrading
 * material the rest of the archive is made of — the grain filters are already
 * stepped this way (NoiseDisplaceFilter's grainFps, SideDial's NAV_GRAIN.fps).
 * The cap also stops a 120Hz display spending twice the GPU on a one-shot beat.
 *
 * The beat's DURATION is unaffected: the spring integrates on real elapsed time,
 * so this changes how finely the dissolve is sampled, not how long it takes.
 *
 * Frames can only be drawn on a rAF tick, so the rate actually achieved is the
 * fastest whole division of the display's refresh that doesn't exceed this. 24
 * is exact on a 120Hz panel and falls to 20 on a 60Hz one; 30 and 20 are the
 * values that hold across both, if an identical cadence everywhere matters more
 * than the film rate.
 */
export const DISSOLVE_FPS = 24;

const DAMP = 1.12; // just past critical — no overshoot

/**
 * Hand off at 0.94 rather than at the spring's true rest. The shader runs the
 * mask front at `progress * 1.3`, so the plane is fully uncovered by ~0.90 and
 * everything past that is a tail the eye can't see — but the spring needs a
 * further 0.6s to crawl from 0.94 to 0.995, which is 0.6s of whatever follows
 * the reveal waiting on nothing.
 *
 * Ending later than the dissolve needs also hurts: a canvas raster of type is
 * not the browser's rendering of that type — no hinting, grayscale AA — and at
 * body sizes the difference reads as coarse, "pixelated" letterforms. Hand off
 * BEFORE the raster is asked to stand in for finished text (see the `doneAt`
 * option) and the cross-fade does the last of the resolve, from a canvas that
 * still has some blur left to the real thing. The eye never gets a clean look
 * at the raster, and the beat lands on the DOM's own crisp rendering.
 */
const DONE_AT = 0.94;

/**
 * A zero-size baseline probe, to be rendered inside a word span.
 *
 * An empty inline-block with no height sits with its bottom margin edge — which
 * is also its top edge, and its own baseline — exactly on the text baseline of
 * its line, and contributes nothing to the line box. So its rect reports where
 * the browser actually put that line's baseline, which beats deriving it from
 * font metrics the engine may not have used: for body copy a 1px error in the
 * raster is a visible pop at the hand-off. Spans without a probe fall back to
 * the derivation, which is accurate enough for large display type.
 *
 * It must sit directly after the word's text and before any trailing space: a
 * space at a line end hangs there, but an atomic inline after it would be
 * pushed onto the next line and report that line's baseline instead.
 */
export const BASELINE_PROBE_STYLE = {
  display: 'inline-block',
  width: 0,
  height: 0,
  verticalAlign: 'baseline',
};

/** Stable per-block seed, so a given sentence always dissolves its own way. */
function seedFor(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return 0.3 + ((h % 1000) / 1000) * 6;
}

/**
 * Rasterize the live text layout onto a transparent canvas.
 *
 * Rather than re-implementing wrapping, centering and letter-spacing, this
 * reads the position of every word span the browser already laid out and draws
 * each word at its measured spot — so the raster and the DOM text are the same
 * picture, which is what makes the hand-off at the end invisible.
 */
export function rasterizeTextBlock(host, textEl, dpr) {
  const hostRect = host.getBoundingClientRect();
  const spans = textEl.querySelectorAll('[data-word]');
  if (!spans.length || hostRect.width < 2 || hostRect.height < 2) return null;

  const cs = getComputedStyle(textEl);
  const canvas = document.createElement('canvas');
  // Sized by the same round(cssSize * dpr) rule RevealGL.resize uses, off the
  // same unrounded rect — if the two disagree even by a pixel, the texture is
  // resampled across the plane and the hand-off to the DOM text shifts visibly.
  canvas.width = Math.round(hostRect.width * dpr);
  canvas.height = Math.round(hostRect.height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  // Not in every engine yet; where it is missing the raster is a hair narrower
  // per word, which the per-word positioning keeps from accumulating.
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
  }
  ctx.fillStyle = cs.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const px = parseFloat(cs.fontSize) || 16;
  const m = ctx.measureText('Hg');
  const ascent = m.fontBoundingBoxAscent || px * 0.8;
  const descent = m.fontBoundingBoxDescent || px * 0.2;

  spans.forEach((span) => {
    const word = span.textContent;
    if (!word) return;
    // First fragment, not the union: a span carrying a trailing space can end a
    // line, and the union's left edge would then be the wrong line's.
    const r = span.getClientRects()[0] || span.getBoundingClientRect();
    const probe = span.querySelector('[data-baseline]');
    let baseline = null;
    if (probe) {
      const y = probe.getBoundingClientRect().top - hostRect.top;
      // A probe reporting outside the block (a collapsed rect, or one pushed onto
      // the next line) is worse than no probe at all.
      if (y > 0 && y <= hostRect.height + 2) baseline = y;
    }
    if (baseline === null) {
      // Derive it: back the half-leading out of the span's box to land on the
      // baseline the browser used. Exact for an inline span, whose box is the
      // font's content area; for an inline-block, whose box is the whole line
      // box, it depends on the engine having used these same font metrics.
      baseline = r.top - hostRect.top + (r.height - (ascent + descent)) / 2 + ascent;
    }
    ctx.fillText(word, r.left - hostRect.left, baseline);
  });

  return canvas;
}

/**
 * Rasterize a laid-out <img> onto a transparent canvas.
 *
 * The same contract as rasterizeTextBlock, for art instead of type: the image is
 * drawn into the exact box the browser gave it, so the texture and the live
 * <img> are the same picture and the hand-off stays invisible.
 *
 * Because this samples pixels it carries whatever texture the source was drawn
 * with — brush grain, dry-edge, torn contours — through the dissolve untouched.
 * That is the reason art goes through here rather than through a stroke-drawn
 * outline: a trim path can only animate a centerline, so it has to throw the
 * texture away, while the mask front can uncover it speck by speck.
 */
export function rasterizeImageBlock(host, imgEl, dpr) {
  const hostRect = host.getBoundingClientRect();
  if (hostRect.width < 2 || hostRect.height < 2) return null;
  // A decoded image with real intrinsic size, or drawImage paints nothing. SVG
  // sources must carry width/height (or a viewBox) for naturalWidth to be set.
  if (!imgEl || !imgEl.complete || !imgEl.naturalWidth) return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(hostRect.width * dpr);
  canvas.height = Math.round(hostRect.height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  const r = imgEl.getBoundingClientRect();
  ctx.drawImage(
    imgEl,
    r.left - hostRect.left,
    r.top - hostRect.top,
    r.width,
    r.height
  );
  return canvas;
}

/**
 * Play the dissolve over `textRef`'s laid-out words, painting into a canvas
 * appended to `hostRef` (which must be positioned).
 *
 * Returns:
 *   live     the DOM text should now be visible — either the dissolve finished,
 *            or it never ran and the text has to arrive some other way.
 *   engaged  the dissolve actually ran, so `live` means "cross-fade from the
 *            canvas" rather than "reveal this yourself". Lets a caller keep its
 *            own entrance as the no-WebGL fallback.
 */
export function useTextDissolve({
  hostRef,
  textRef,
  /** Seeds the noise field, so the same copy always dissolves the same way. */
  seedText = '',
  /** Play once this is true. */
  run = true,
  /** Beat to wait after `run` before rasterizing — also the caller's chance to
   *  let an entrance settle, since a mid-transform host rasterizes at the
   *  wrong size. */
  delayS = 0,
  maxBlur = MAX_BLUR,
  stiffness = K_IN,
  glow = GLOW,
  /** Strength of the front's chromatic split. Scale it down for light strokes —
   *  a split wider than a stroke leaves the green channel alone on it. */
  chroma = 1,
  /** Progress at which the DOM takes over. See DONE_AT. */
  doneAt = DONE_AT,
  /** Canvas → DOM cross-fade. Callers animating their own text in must use the
   *  same duration, so pass it in rather than reading HANDOFF_S. */
  handoffS = HANDOFF_S,
  /** Reduced motion, or any other reason to skip straight to resolved text. */
  disabled = false,
  /** How `textRef`'s content becomes the dissolve's texture. Swap in
   *  rasterizeImageBlock to run the effect over art rather than type. */
  rasterize = rasterizeTextBlock,
}) {
  // 'idle' → 'gl' → 'live'. Reduced motion starts resolved; so does a visitor
  // whose browser can't give us a WebGL context.
  const [phase, setPhase] = useState(disabled ? 'live' : 'idle');
  const [engaged, setEngaged] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (disabled) {
      setPhase('live');
      return undefined;
    }
    if (!run || phaseRef.current !== 'idle') return undefined;

    let gl = null;
    let raf = 0;
    let handoff = 0;
    let cancelled = false;

    const play = () => {
      if (cancelled) return;
      const host = hostRef.current;
      const textEl = textRef.current;
      if (!host || !textEl) {
        setPhase('live');
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      gl = new RevealGL();
      const art = gl.available ? rasterize(host, textEl, dpr) : null;
      if (!art) {
        // No WebGL, or nothing measurable to draw — the caller reveals the text.
        gl.destroy();
        gl = null;
        setPhase('live');
        return;
      }

      const rect = host.getBoundingClientRect();
      const W = Math.max(1, rect.width);
      const H = Math.max(1, rect.height);
      gl.setTexture(art);
      gl.resize(W, H, dpr);
      Object.assign(gl.canvas.style, {
        zIndex: '1',
        pointerEvents: 'none',
        transition: `opacity ${handoffS}s linear`,
      });
      host.appendChild(gl.canvas);
      setEngaged(true);
      setPhase('gl');

      const edge = hexToRgb(glow);
      const seed = seedFor(seedText);
      const aspect = W / H;
      let progress = 0;
      let vel = 0;
      let clock = 0;
      let last = performance.now();

      // No parallax here: this is copy, not an interactive plate, and a zero
      // offset keeps the resolved frame sampling the texture 1:1 (i.e. crisp).
      const draw = (p) =>
        gl.draw(p, maxBlur, edge, clock, aspect, seed, [0, 0], [0, 0], [-1, -1], 0, 0, chroma);

      // 1ms of slack: the gate can only open on a rAF tick, and without the
      // tolerance a tick landing a rounding error early (41.66ms against a
      // 41.667ms budget) gets rejected and costs a whole extra frame.
      const frameMs = DISSOLVE_FPS > 0 ? 1000 / DISSOLVE_FPS - 1 : 0;
      // A tab-switch stall would otherwise dump one huge dt into the spring and
      // snap the front across the block. Two capped frames of headroom, but
      // never below the cap's own interval or a low DISSOLVE_FPS would throttle
      // the spring itself and stretch the beat.
      const maxDt = Math.max(0.05, (2 * frameMs) / 1000);

      const step = () => {
        const now = performance.now();
        if (now - last < frameMs) {
          // Too early for the next frame — hold the one on screen.
          raf = requestAnimationFrame(step);
          return;
        }
        const dt = Math.min(maxDt, Math.max(0.001, (now - last) / 1000));
        last = now;
        clock += dt;
        [progress, vel] = springStep(progress, vel, 1, stiffness, DAMP, dt);

        if (progress >= doneAt) {
          // Hold the frame we reached — drawing a resolved one here would put a
          // clean raster on screen for the length of the cross-fade, which is
          // exactly what we're avoiding when doneAt is early.
          draw(Math.max(0, Math.min(1, progress)));
          setPhase('live');
          gl.canvas.style.opacity = '0';
          // Outlives the loop but not the effect: unmounting mid-cross-fade
          // clears this timer and the cleanup below drops the context instead.
          handoff = window.setTimeout(() => {
            if (gl) gl.destroy();
            gl = null;
          }, handoffS * 1000 + 60);
          return;
        }

        draw(Math.max(0, Math.min(1, progress)));
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    const startT = window.setTimeout(play, Math.max(0, delayS * 1000));

    return () => {
      cancelled = true;
      window.clearTimeout(startT);
      window.clearTimeout(handoff);
      if (raf) cancelAnimationFrame(raf);
      if (gl) gl.destroy();
    };
  }, [
    run,
    disabled,
    delayS,
    seedText,
    maxBlur,
    stiffness,
    glow,
    chroma,
    doneAt,
    handoffS,
    rasterize,
    hostRef,
    textRef,
  ]);

  return { live: phase === 'live', engaged, phase };
}
