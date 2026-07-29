/**
 * NoiseDisplaceFilter — a reusable SVG filter: light noise + displacement map.
 *
 * Two stacked effects, tuned to sit gently on scanned confession notes:
 *   1. Displacement — soft, large-scale fractal noise drives an feDisplacementMap
 *      that warps the source a few pixels. Reads like paper that never lies
 *      perfectly flat (organic wobble, not a filter you can "see").
 *   2. Light noise — fine, high-frequency fractal noise, desaturated to a
 *      translucent gray speckle and clipped to the source's silhouette so it
 *      textures the note without dirtying the transparent gaps around it.
 *
 * Both layers animate: the turbulence noise itself evolves over time via SMIL
 * <animate> (declarative, no JS/rAF), so the warp slowly breathes and the grain
 * shimmers like film. Pass `animate={false}` to freeze it (e.g. reduced motion).
 *
 * Render <NoiseDisplaceFilter /> ONCE anywhere in the tree (it paints nothing —
 * a 0×0 <svg> that only holds the <filter> in <defs>). Then reference it from
 * any element's CSS `filter`, e.g.
 *
 *     import { NoiseDisplaceFilter, GRID_IMAGE_FILTER } from './NoiseDisplaceFilter';
 *     ...
 *     <NoiseDisplaceFilter />
 *     <img style={{ filter: `grayscale(0.2) ${GRID_IMAGE_FILTER}` }} />
 *
 * Every knob is a prop, so the same component can back several ids (pass a
 * unique `id`) at different strengths if a surface ever needs its own flavor.
 */

import { useDialKit } from 'dialkit';

/** Default filter id + ready-made `url(#…)` string for the shared grid effect. */
const GRID_IMAGE_FILTER_ID = 'archive-noise-displace';
export const GRID_IMAGE_FILTER = `url(#${GRID_IMAGE_FILTER_ID})`;

export function NoiseDisplaceFilter({
  id = GRID_IMAGE_FILTER_ID,
  // Displacement: low frequency = broad, gentle warp. Slightly higher on Y so
  // notes ripple more top-to-bottom than side-to-side. `scale` is the max push
  // in px at full noise deflection.
  displaceFrequency = '0.012 0.016',
  scale = 6,
  // Light noise: high frequency = fine grain. `grainOpacity` caps the speckle
  // alpha (keep it low — this is a veil, not a texture).
  grainFrequency = 0.75,
  grainOpacity = 0.12,
  seed = 4,
  // Animation — the noise field itself evolves over time, driven declaratively
  // by SMIL <animate> (no JS/rAF, so it keeps running off the main thread):
  //   • the warp "breathes" as its baseFrequency drifts (slow, eased loop),
  //   • the grain "shimmers" as its seed steps through a short cycle (film grain).
  // Pass animate={false} (e.g. prefers-reduced-motion) to freeze the field.
  animate = true,
  warpDur = 16, // seconds per breathe loop
  grainFps = 10, // grain reseed rate (frames/sec)
  grainSteps = 8, // distinct grain frames before the shimmer cycle repeats
}) {
  // Breathe the displacement noise between 80%–135% of its base frequency so
  // the ripple slowly tightens and loosens rather than sitting frozen.
  const [fx, fyRaw] = String(displaceFrequency).trim().split(/\s+/).map(Number);
  const fy = Number.isFinite(fyRaw) ? fyRaw : fx;
  const freqPair = (kx, ky) => `${+(fx * kx).toFixed(4)} ${+(fy * ky).toFixed(4)}`;
  const warpLo = freqPair(0.8, 0.8);
  const warpHi = freqPair(1.35, 1.35);
  const warpValues = `${warpLo}; ${warpHi}; ${warpLo}`;

  // Grain shimmer: a short ring of seeds swapped discretely (crisp flicker, not
  // a smooth morph — that's what makes it read as film grain).
  const grainSeedBase = seed + 11;
  const grainValues = Array.from({ length: grainSteps }, (_, i) => grainSeedBase + i).join(';');
  const grainDur = grainSteps / Math.max(1, grainFps);

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      // Kept in flow-but-invisible (0×0, not display:none) so browsers reliably
      // resolve the filter reference from CSS.
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      <defs>
        <filter
          id={id}
          // Grow the region so displaced edges aren't clipped by the filter box.
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          {/* 1a. Soft fractal noise → displacement source. Its baseFrequency
                  breathes so the warp is alive rather than a static emboss. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency={displaceFrequency}
            numOctaves="2"
            seed={seed}
            stitchTiles="stitch"
            result="warp"
          >
            {animate ? (
              <animate
                attributeName="baseFrequency"
                values={warpValues}
                keyTimes="0;0.5;1"
                dur={`${warpDur}s`}
                calcMode="spline"
                keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                repeatCount="indefinite"
              />
            ) : null}
          </feTurbulence>
          {/* 1b. Warp the image: R channel pushes X, G channel pushes Y. */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="warp"
            scale={scale}
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />

          {/* 2a. Fine fractal noise → grain source. Its seed steps through a
                  short cycle so the speckle field boils like real film grain. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency={grainFrequency}
            numOctaves="2"
            seed={grainSeedBase}
            stitchTiles="stitch"
            result="grainNoise"
          >
            {animate ? (
              <animate
                attributeName="seed"
                values={grainValues}
                dur={`${grainDur}s`}
                calcMode="discrete"
                repeatCount="indefinite"
              />
            ) : null}
          </feTurbulence>
          {/* 2b. Flatten to mid-gray, then let the noisy alpha through at up to
                  `grainOpacity` → a translucent gray speckle. */}
          <feColorMatrix
            in="grainNoise"
            type="matrix"
            values={`0 0 0 0 0.5
                     0 0 0 0 0.5
                     0 0 0 0 0.5
                     0 0 0 ${grainOpacity} 0`}
            result="grain"
          />
          {/* 2c. Clip the grain to the (warped) image so transparent areas stay clean. */}
          <feComposite in="grain" in2="displaced" operator="in" result="grainClipped" />

          {/* 3. Lay the light noise over the warped image. */}
          <feMerge>
            <feMergeNode in="displaced" />
            <feMergeNode in="grainClipped" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
 * GRID IMAGE HOVER FILTER — DialKit
 *
 * The warp + film-grain that switches on while a note image is
 * hovered in the index grid (filter id `archive-noise-displace`).
 * Exposed as a live "Note Hover Filter" panel so the exact
 * strength can be tuned in real time: append `?dial=1` to the URL,
 * open the panel (top-right), then hover a tile to preview.
 *
 * The DEFAULTS below MUST match the values the grid shipped with,
 * so simply opening the panel never shifts the look. Tweaks persist
 * in localStorage (DialKit), so a dialed-in look survives reloads.
 * ───────────────────────────────────────────────────────── */
const GRID_IMAGE_FILTER_DEFAULTS = {
  displaceFreqX: 0.065, // higher freq = fine, tight warp (dialed-in look)
  displaceFreqY: 0.077, // a touch tighter vertically so notes ripple top-to-bottom
  scale: 3, //            px — max displacement push at full noise deflection
  grainFrequency: 0.85, // fine film-grain frequency (higher = finer speckle)
  grainOpacity: 0, //     0 = grain layer off; the hover treatment is warp-only
  seed: 4,
  warpDur: 16, //         s per "breathe" loop of the warp
  grainFps: 10, //        grain reseed rate (frames/sec)
  grainSteps: 8, //       distinct grain frames before the shimmer repeats
};

/**
 * Live-tunable params for the grid hover filter. Returns an object ready to
 * spread straight into `<NoiseDisplaceFilter {...} />`. Pass `animate: false`
 * (e.g. prefers-reduced-motion) to force-freeze regardless of the panel toggle.
 *
 * NOTE: SVG `baseFrequency` wants an "x y" pair, so we expose two numeric
 * sliders (freqX / freqY) and recompose the string here.
 */
function useGridImageFilterParams({ animate = true } = {}) {
  const D = GRID_IMAGE_FILTER_DEFAULTS;
  // Sliders carry an explicit step (4th tuple element) so the defaults land
  // exactly on their shipped values — otherwise DialKit's inferred step snaps
  // e.g. 0.012 → 0.01 the moment the panel mounts, nudging the resting look.
  const p = useDialKit('Note Hover Filter', {
    displace: {
      freqX: [D.displaceFreqX, 0.001, 0.08, 0.001],
      freqY: [D.displaceFreqY, 0.001, 0.08, 0.001],
      scale: [D.scale, 0, 30, 0.5],
    },
    grain: {
      frequency: [D.grainFrequency, 0.1, 2.5, 0.05],
      opacity: [D.grainOpacity, 0, 1, 0.01],
    },
    seed: [D.seed, 0, 99, 1],
    motion: {
      animate: true, //  toggle off to freeze the warp/grain (static def)
      warpDur: [D.warpDur, 1, 40, 0.5],
      grainFps: [D.grainFps, 1, 30, 1],
      grainSteps: [D.grainSteps, 2, 30, 1],
    },
  });
  return {
    displaceFrequency: `${p.displace.freqX} ${p.displace.freqY}`,
    scale: p.displace.scale,
    grainFrequency: p.grain.frequency,
    grainOpacity: p.grain.opacity,
    seed: Math.round(p.seed),
    animate: animate && p.motion.animate,
    warpDur: p.motion.warpDur,
    grainFps: p.motion.grainFps,
    grainSteps: Math.max(2, Math.round(p.motion.grainSteps)),
  };
}

/**
 * Convenience wrapper: the shared grid hover-filter def, wired to the "Note
 * Hover Filter" DialKit panel. Keeping the `useDialKit` subscription in this
 * tiny component (instead of inside GridView) means dragging a slider only
 * re-renders the filter def — not the 100+ tiles in the grid.
 */
export function GridImageFilter({ animate = true }) {
  const params = useGridImageFilterParams({ animate });
  return <NoiseDisplaceFilter {...params} />;
}

export default NoiseDisplaceFilter;
