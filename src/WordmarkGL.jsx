import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { useDialKit } from 'dialkit';
import { HANDOFF_S, K_IN, rasterizeImageBlock, useTextDissolve } from './textDissolve';

/**
 * The hand-drawn wordmark art materialized through the WebGL mask dissolve
 * (see revealGL.js / textDissolve.js) instead of being stroked on as a trim
 * path.
 *
 * WHY THIS RATHER THAN A TRACE PATH
 * A trim path can only animate a centerline, so drawn-on lettering has to be
 * reduced to monoline outlines first and every bit of brush texture — dry edge,
 * speckle, pressure — is lost on the way. It also means authoring a pen path
 * down the spine of each stroke by hand.
 *
 * The dissolve works on PIXELS. It rasterizes the art exactly as the browser
 * laid it out and uncovers that raster speck by speck behind a cloudy fbm
 * front, so the texture survives intact and the source can stay whatever it
 * already is — a drawn SVG, a scan, a photo of ink. Nothing has to be traced.
 *
 * Like the text dissolve it hands back to the DOM at the end: the canvas
 * cross-fades out and the live <img> takes over, so what rests on screen is the
 * real asset (and the real alt text), not a raster standing in for it.
 */

/* The art. Swap this to try a different lettering cut — nothing else needs to
   change, since the effect reads whatever the browser paints. */
const SRC = '/wordmark.svg';
const ASPECT = 852 / 607; // intrinsic size of the current art

const WORDMARK = {
  // Sized like HERO_TITLE: bounded on BOTH axes so the lockup can't overflow a
  // short viewport. Expressing the height cap as a width keeps `height: auto`.
  maxVw: 88,
  maxVh: 56,
  opacity: 1,
  // Dissolve feel. Lower stiffness is slower (~1/√k). The blur radius wants to
  // scale with the art: a radius tuned for a full-bleed lockup smears a small
  // one into a glow.
  stiffness: K_IN,
  maxBlur: 18,
  // The front's chromatic split. Scaled back from 1 because the lettering has
  // thin passages, and a split wider than a stroke leaves them fringed.
  chroma: 0.6,
  // Beat after the hold lifts, so the hero has settled before we rasterize.
  delayS: 0.1,
};

export default function WordmarkGL({ hold = false, onRevealComplete, reduceMotion = false }) {
  const [run, setRun] = useState(0);

  const dials = useDialKit(
    'Hero Wordmark',
    {
      maxVw: [WORDMARK.maxVw, 40, 100, 1],
      maxVh: [WORDMARK.maxVh, 20, 90, 1],
      opacity: [WORDMARK.opacity, 0.1, 1, 0.02],
      stiffness: [WORDMARK.stiffness, 2, 40, 0.5],
      maxBlur: [WORDMARK.maxBlur, 0, 48, 1],
      chroma: [WORDMARK.chroma, 0, 3, 0.05],
      delayS: [WORDMARK.delayS, 0, 2, 0.05],
      replay: { type: 'action', label: '⟳ Replay' },
    },
    { onAction: (action) => action === 'replay' && setRun((n) => n + 1) }
  );

  return <WordmarkGLRun key={run} hold={hold} onRevealComplete={onRevealComplete} reduceMotion={reduceMotion} config={dials} />;
}

const IN_VIEW = { once: true, margin: '0px 0px -24% 0px' };

/** One playthrough. Remounted to replay, since the dissolve runs exactly once. */
function WordmarkGLRun({ hold, onRevealComplete, reduceMotion, config }) {
  const hostRef = useRef(null);
  const imgRef = useRef(null);
  const inView = useInView(hostRef, IN_VIEW);
  const prefersReduce = useReducedMotion();
  const reduce = reduceMotion || prefersReduce;

  // The art has to be decoded before it can be rasterized — an <img> that hasn't
  // loaded draws nothing, which would drop us to the no-WebGL path and skip the
  // effect entirely. A cached image can be complete before this ever mounts.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth) setLoaded(true);
  }, []);

  const show = inView && !hold && loaded;

  const { live } = useTextDissolve({
    hostRef,
    textRef: imgRef,
    rasterize: rasterizeImageBlock,
    seedText: SRC,
    run: show,
    delayS: config.delayS,
    maxBlur: config.maxBlur,
    stiffness: config.stiffness,
    chroma: config.chroma,
    disabled: reduce,
  });

  // Under reduced motion the hook resolves immediately, which would put the
  // wordmark on screen before its beat — gate on the beat instead and let it
  // arrive on the cross-fade alone.
  const revealed = reduce ? show : live;

  const doneRef = useRef(onRevealComplete);
  doneRef.current = onRevealComplete;
  const firedRef = useRef(false);
  useEffect(() => {
    if (!revealed || firedRef.current) return;
    firedRef.current = true;
    doneRef.current?.();
  }, [revealed]);

  return (
    <div
      ref={hostRef}
      style={{
        position: 'relative',
        display: 'block',
        // The lockup is deliberately wider than the 660px copy column it sits in
        // and is centered by the beat's `align-items: center`. It must NOT carry
        // `margin: 0 auto` — an auto margin resolves to zero once free space
        // goes negative, which would pin the art to the column's left edge and
        // hang the rest off the right.
        width: `min(${config.maxVw}vw, calc(${config.maxVh}vh * ${ASPECT}))`,
        opacity: config.opacity,
      }}
    >
      <img
        ref={imgRef}
        src={SRC}
        alt="What We Tell AI"
        decoding="async"
        onLoad={() => setLoaded(true)}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          opacity: revealed ? 1 : 0,
          transition: reduce ? `opacity 0.6s linear` : `opacity ${HANDOFF_S}s linear`,
        }}
      />
    </div>
  );
}
