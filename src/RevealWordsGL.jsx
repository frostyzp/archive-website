import { createElement, useMemo, useRef } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { HANDOFF_S, K_IN, MAX_BLUR, useTextDissolve } from './textDissolve';

/**
 * A display copy block that materializes ONCE through the WebGL mask dissolve
 * (see textDissolve.js / revealGL.js) instead of cascading in word-by-word.
 * Same role as RevealWords in OnboardingReveal, same markup — but the whole line
 * blooms out of a cloudy fbm field, each part un-blurring as the front uncovers
 * it, and then it is done. It never loops.
 *
 * The dissolve rasterizes the live layout and cross-fades back to it, so after
 * the beat the copy is real selectable text again.
 *
 * Embed `\n` in `text` for authored line breaks — each line is a block, words
 * within it stay inline, and the dissolve rasterizes whatever the browser laid
 * out. Pass `justify` to spread each line edge-to-edge.
 */

const IN_VIEW = { once: true, margin: '0px 0px -24% 0px' };

export default function RevealWordsGL({
  text,
  as = 'h2',
  hold = false,
  maxBlur = MAX_BLUR,
  // Per-block override for the dissolve speed — see K_IN.
  stiffness = K_IN,
  // Spread each authored line edge-to-edge (flex space-between per line).
  justify = false,
  style,
}) {
  const hostRef = useRef(null);
  const textRef = useRef(null);
  const inView = useInView(hostRef, IN_VIEW);
  const reduce = useReducedMotion();

  const show = inView && !hold;

  const lines = useMemo(
    () => text.split('\n').map((line) => line.split(/\s+/).filter(Boolean)),
    [text]
  );
  const ariaText = useMemo(() => text.replace(/\n/g, ' '), [text]);

  const { live } = useTextDissolve({
    hostRef,
    textRef,
    seedText: ariaText,
    run: show,
    maxBlur,
    stiffness,
    disabled: reduce,
  });

  return (
    <div
      ref={hostRef}
      style={{ position: 'relative', width: '100%', display: 'block' }}
    >
      {createElement(
        as,
        {
          ref: textRef,
          'aria-label': ariaText,
          style: {
            ...style,
            margin: '0 auto',
            opacity: live ? 1 : 0,
            transition: reduce ? undefined : `opacity ${HANDOFF_S}s linear`,
          },
        },
        lines.map((lineWords, li) => (
          <span
            key={li}
            data-line=""
            style={
              justify
                ? { display: 'flex', justifyContent: 'space-between', width: '100%' }
                : { display: 'block' }
            }
          >
            {lineWords.map((w, i) => (
              <span
                key={i}
                data-word=""
                aria-hidden="true"
                style={{ display: 'inline-block', ...(justify ? null : { marginRight: '0.28em' }) }}
              >
                {w}
              </span>
            ))}
          </span>
        ))
      )}
    </div>
  );
}
