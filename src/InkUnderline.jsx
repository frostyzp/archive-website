import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { inkA } from './colors';

/* ─────────────────────────────────────────────────────────────────────
 * INK UNDERLINE — a hand-drawn stroke that trim-path draws itself under a
 * phrase, roughened by an SVG displacement filter so it reads as pen on paper
 * rather than a CSS border.
 *
 * Used by the onboarding storyboard to mark the few phrases the whole project
 * turns on ("relationship with AI", "human relationships", …). The gesture is
 * deliberately sequential: the sentence finishes revealing itself, THEN a hand
 * goes back and underlines it — so the mark reads as emphasis, not decoration.
 *
 * Three things make it feel drawn rather than rendered:
 *
 *   1. PER-WORD, MEASURED. Each word carries its own stroke sized to its own
 *      measured px width, so a phrase that wraps across two lines still gets a
 *      correct underline on both — and the wobble amplitude stays constant
 *      instead of stretching with the word (the trap of one stretched viewBox).
 *   2. TRIM PATH. `pathLength` 0 → 1 (motion normalizes the dash math), so the
 *      line is drawn left-to-right at a constant pen speed rather than wiped.
 *   3. ROUGHENED. feTurbulence + feDisplacementMap breaks the stroke's edge up,
 *      so it has the uneven weight of a real pen rather than a vector's.
 * ───────────────────────────────────────────────────────────────────── */

export const INK_UNDERLINE = {
  // ─ timing
  afterPhraseS: 0.24, //  beat after the phrase's LAST word has finished fading
  segS: 0.4, //           per-word draw duration (the pen's speed)
  overlapS: 0.12, //      next word starts before the previous ends → one gesture
  ease: [0.33, 0.9, 0.35, 1], // pen-like: quick to speed, eased to a stop

  // ─ geometry (em-relative so it tracks the clamp()ed display sizes)
  //
  // Every one of these was raised off an initial "safe" value because the safe
  // values rendered a 1px straight line — i.e. exactly the CSS underline this is
  // meant not to be. At display sizes a stroke needs real weight and real
  // amplitude before the eye reads it as drawn rather than applied.
  baselineEm: 0.11, //    how far BELOW the baseline the stroke sits
  bandPx: 16, //          svg coordinate-box height; the stroke rides its centre
  strokeEm: 0.07, //      stroke weight (≈3.9px at a 56px fragment)
  ampEm: 0.05, //         vertical wobble amplitude (≈2.8px at 56px)
  segPx: 22, //           one wobble control point per this many px of word

  // ─ texture
  color: inkA(0.62), //   dimmer than the ink so it supports the word, not competes
  roughEm: 0.05, //       displacement distance — the pen's unevenness
  roughFreq: 0.09, //     noise frequency along the stroke (lower = longer waves)
};

/**
 * Deterministic PRNG (mulberry32). The wobble has to be stable across renders —
 * Math.random would redraw a different squiggle on every re-render, and the path
 * would visibly jump mid-animation.
 */
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, so a given word always draws the same line. */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A smooth wobbling line across `w` px, centred in a `band`-tall box.
 *
 * Control points are jittered vertically and then smoothed with the standard
 * quadratic-through-midpoints trick, which keeps the curve C1-continuous — a
 * polyline would show visible corners at this stroke weight. The two ends are
 * damped toward the centre line so the stroke starts and stops level (a real
 * underline is anchored at the word's edges) and a slight overall tilt is added
 * so it isn't perfectly horizontal.
 */
function wobblePath(w, band, amp, seed, segPx) {
  const rnd = mulberry32(seed);
  const mid = band / 2;
  const n = Math.max(2, Math.round(w / segPx));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const damp = i === 0 || i === n ? 0.3 : 1;
    pts.push([(w * i) / n, mid + (rnd() * 2 - 1) * amp * damp]);
  }
  const tilt = (rnd() * 2 - 1) * amp * 0.55;
  for (let i = 0; i <= n; i++) pts[i][1] += (tilt * i) / n;

  const f = (v) => v.toFixed(2);
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < n; i++) {
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q ${f(cx)} ${f(cy)} ${f((cx + nx) / 2)} ${f((cy + ny) / 2)}`;
  }
  d += ` L ${f(pts[n][0])} ${f(pts[n][1])}`;
  return d;
}

/**
 * Wraps one word (or a phrase fragment) and draws the stroke beneath it.
 *
 * `show` gates the draw on the parent's scroll-into-view, `instant` (reduced
 * motion) paints the finished line with no animation. Width is measured rather
 * than assumed so the stroke can't over- or undershoot the word: the em-based
 * config is resolved against the host's own computed font size, which is how it
 * tracks a `clamp()`ed responsive type scale for free.
 */
export function InkUnderline({
  children,
  show = true,
  instant = false,
  delayS = 0,
  durS = INK_UNDERLINE.segS,
  seedKey = '',
  cfg = INK_UNDERLINE,
}) {
  const ref = useRef(null);
  const rawId = useId();
  const filterId = `ink-ul-${rawId.replace(/:/g, '')}`;
  // `em` is the host's resolved font size in px — the basis for every geometry
  // value below, so one config works across the clamp()ed display sizes.
  const [{ w, em }, setBox] = useState({ w: 0, em: 16 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
      // Width of the text itself, not the padded box.
      const rect = el.getBoundingClientRect();
      setBox((prev) =>
        Math.abs(prev.w - rect.width) < 0.5 && Math.abs(prev.em - fs) < 0.5
          ? prev
          : { w: rect.width, em: fs }
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  // Webfonts land after first paint; the pre-swap width is the fallback face's,
  // which is usually wider. Re-measure once the real face is in.
  useEffect(() => {
    if (!document.fonts?.ready) return undefined;
    let alive = true;
    document.fonts.ready.then(() => {
      if (!alive || !ref.current) return;
      const el = ref.current;
      const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
      setBox({ w: el.getBoundingClientRect().width, em: fs });
    });
    return () => {
      alive = false;
    };
  }, []);

  const amp = cfg.ampEm * em;
  const band = cfg.bandPx;
  const d = useMemo(
    () => (w > 0 ? wobblePath(w, band, amp, hashStr(`${seedKey}${children}`), cfg.segPx) : ''),
    [w, band, amp, seedKey, children, cfg.segPx]
  );

  return (
    <span
      ref={ref}
      style={{
        position: 'relative',
        display: 'inline-block',
        // Collapse the inline box to the type's own height so the stroke can be
        // placed off the BASELINE (via `bottom`) instead of off a line-height
        // box that varies per beat. Baseline alignment is unaffected, so the
        // glyphs don't shift relative to their neighbours.
        lineHeight: 1,
      }}
    >
      {children}
      {d ? (
        <svg
          aria-hidden="true"
          width={w}
          height={band}
          viewBox={`0 0 ${w} ${band}`}
          style={{
            position: 'absolute',
            left: 0,
            // The inline box bottom sits at the font's descent; back up to the
            // baseline and then drop by `baselineEm`.
            bottom: `calc(${(0.2 - cfg.baselineEm).toFixed(3)}em - ${band / 2}px)`,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <defs>
            {/* Generous region: the displacement pushes ink outside the band. */}
            <filter
              id={filterId}
              x="-4%"
              y="-150%"
              width="108%"
              height="400%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency={cfg.roughFreq}
                numOctaves="2"
                seed={hashStr(`${children}`) % 100}
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={cfg.roughEm * em}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
          <motion.path
            d={d}
            fill="none"
            stroke={cfg.color}
            strokeWidth={cfg.strokeEm * em}
            strokeLinecap="round"
            filter={`url(#${filterId})`}
            initial={instant ? { pathLength: 1 } : { pathLength: 0 }}
            animate={show || instant ? { pathLength: 1 } : { pathLength: 0 }}
            transition={
              instant ? { duration: 0 } : { duration: durS, ease: cfg.ease, delay: delayS }
            }
          />
        </svg>
      ) : null}
    </span>
  );
}

/** Strip leading / trailing punctuation so the stroke runs under the letters
 *  only — an underline that swallows the comma after "story," looks like a typo. */
export function splitWordCore(word) {
  const m = word.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  if (!m) return ['', word, ''];
  return [m[1], m[2], m[3]];
}

const norm = (w) => splitWordCore(w)[1].toLowerCase();

/**
 * Map each phrase in `phrases` onto the word indices of `words`.
 *
 * Matching is on punctuation-stripped, lower-cased cores, so a phrase written
 * as "real person" still matches the sentence's "person," — the copy stays
 * readable prose at the callsite instead of having to mirror punctuation.
 *
 * Returns Map<wordIndex, { seq, lastIdx }> where `seq` is the word's position
 * within its phrase (used to sequence the pen) and `lastIdx` is the phrase's
 * final word index (used to wait for the phrase to finish revealing).
 */
export function markPhrases(words, phrases) {
  const marks = new Map();
  if (!phrases?.length) return marks;
  const cores = words.map(norm);

  phrases.forEach((phrase) => {
    const want = phrase.split(/\s+/).map(norm).filter(Boolean);
    if (!want.length) return;
    for (let i = 0; i + want.length <= cores.length; i++) {
      let hit = true;
      for (let k = 0; k < want.length; k++) {
        if (cores[i + k] !== want[k]) {
          hit = false;
          break;
        }
      }
      if (!hit) continue;
      const lastIdx = i + want.length - 1;
      // First occurrence only — underlining every repeat of "real person" would
      // turn an emphasis mark into a pattern.
      for (let k = 0; k < want.length; k++) {
        if (!marks.has(i + k)) marks.set(i + k, { seq: k, lastIdx });
      }
      return;
    }
  });

  return marks;
}

/** When the stroke under word `seq` of a phrase should start drawing. */
export function underlineDelay({ mark, delayStart, cfg, wordCfg }) {
  const phraseRevealed = delayStart + mark.lastIdx * wordCfg.staggerS + wordCfg.durS;
  return phraseRevealed + cfg.afterPhraseS + mark.seq * (cfg.segS - cfg.overlapS);
}
