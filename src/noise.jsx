/**
 * Shared noise/grain utilities.
 *
 * `noiseUrl()` builds a CSS background-image URL containing an SVG
 * <feTurbulence> patch. `<GrainOverlay>` is a drop-in absolute-positioned
 * layer that animates the noise (translates an oversized inner div in random
 * steps) for a continuous film-grain shimmer.
 *
 * `<TunableGrainBackground>` is a DialKit-driven version with live controls
 * for every grain parameter — drop it into a relatively-positioned parent
 * and tune in the top-right panel (`?dial=1`). Optional `opacityScale`
 * multiplies layer opacities (e.g. softer grain on the landing only).
 */
import { useDialKit } from 'dialkit';

export const GRAIN_KEYFRAMES = `
@keyframes lab-grain {
  0%   { transform: translate(0%, 0%); }
  10%  { transform: translate(-7%, -4%); }
  20%  { transform: translate(-13%, 3%); }
  30%  { transform: translate(5%, -10%); }
  40%  { transform: translate(-8%, 8%); }
  50%  { transform: translate(11%, 4%); }
  60%  { transform: translate(2%, -7%); }
  70%  { transform: translate(-6%, -2%); }
  80%  { transform: translate(8%, 6%); }
  90%  { transform: translate(-4%, -8%); }
  100% { transform: translate(0%, 0%); }
}
`;

export const noiseUrl = ({
  type = 'fractalNoise',
  baseFrequency = 0.65,
  numOctaves = 2,
  seed = 4,
  size = 240,
}) => {
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${size} ${size}'>
      <filter id='n'>
        <feTurbulence type='${type}' baseFrequency='${baseFrequency}' numOctaves='${numOctaves}' seed='${seed}' stitchTiles='stitch'/>
        <feColorMatrix type='saturate' values='0'/>
      </filter>
      <rect width='100%' height='100%' filter='url(#n)'/>
    </svg>
  `.trim().replace(/\s+/g, ' ');
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

/**
 * Animated grain overlay. Pass an array of layers to stack different grains.
 * Each layer: { noise, opacity, blend, tile, duration, steps }.
 *
 * Renders as a single absolutely-positioned div with `inset: 0`. Caller is
 * responsible for placing it inside a relatively-positioned parent.
 */
export function GrainOverlay({ layers, style, ...rest }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        ...style,
      }}
      {...rest}
    >
      <style>{GRAIN_KEYFRAMES}</style>
      {layers.map((layer, i) => {
        const tile = layer.tile ?? 200;
        const duration = layer.duration ?? 0.8;
        const steps = layer.steps ?? 10;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: layer.opacity,
              mixBlendMode: layer.blend,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: '-30%',
                backgroundImage: noiseUrl({ ...layer.noise, size: tile }),
                backgroundSize: `${tile}px ${tile}px`,
                backgroundRepeat: 'repeat',
                animation: `lab-grain ${duration}s steps(${steps}) infinite`,
                willChange: 'transform',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// The noise variant chosen for the archive page background.
export const HEAVY_PAPER = {
  noise: { baseFrequency: 0.85, numOctaves: 2 },
  opacity: 0.9,
  blend: 'overlay',
  tile: 240,
  duration: 1.5,
  steps: 8,
};

/* ─────────────────────────────────────────────────────────
 * GRAIN STORYBOARD (defaults — tweak live in DialKit panel)
 *
 *   Coarse paper:  240px tile, slow 0.8s shimmer, overlay blend
 *                  → carries the "weight" of the grain
 *   Fine grit:     120px tile, fast 0.4s shimmer, soft-light blend
 *                  → high-frequency sparkle, makes the surface feel alive
 *
 *   Both layers translate-step their oversized inner div across the
 *   viewport at different cadences, producing parallax shimmer.
 * ───────────────────────────────────────────────────────── */

const GRAIN_DEFAULTS = {
  coarse: {
    opacity: 0.6,
    blend: 'overlay',
    tile: 240,
    duration: 2.8,
    steps: 2,
    baseFrequency: 0.8,
    numOctaves: 3.8,
    type: 'turbulence',
    seed: 10,
  },
  fine: {
    enabled: true,
    opacity: 0.12,
    blend: 'overlay',
    tile: 120,
    duration: 0.5,
    steps: 37,
    baseFrequency: 2.5,
    numOctaves: 1.8,
  },
};

export function TunableGrainBackground({ opacityScale = 1 } = {}) {
  const scale =
    typeof opacityScale === 'number' && Number.isFinite(opacityScale)
      ? Math.max(0, opacityScale)
      : 1;
  const params = useDialKit('Grain', {
    coarse: {
      opacity: [GRAIN_DEFAULTS.coarse.opacity, 0, 0.7],
      blend: {
        type: 'select',
        options: ['overlay', 'soft-light', 'hard-light', 'screen', 'multiply', 'normal'],
        default: GRAIN_DEFAULTS.coarse.blend,
      },
      tile: [GRAIN_DEFAULTS.coarse.tile, 60, 480],
      duration: [GRAIN_DEFAULTS.coarse.duration, 0.1, 4],
      steps: [GRAIN_DEFAULTS.coarse.steps, 2, 30],
      baseFrequency: [GRAIN_DEFAULTS.coarse.baseFrequency, 0.1, 2.5],
      numOctaves: [GRAIN_DEFAULTS.coarse.numOctaves, 1, 5],
      type: {
        type: 'select',
        options: ['fractalNoise', 'turbulence'],
        default: GRAIN_DEFAULTS.coarse.type,
      },
      seed: [GRAIN_DEFAULTS.coarse.seed, 0, 99],
    },
    fineEnabled: GRAIN_DEFAULTS.fine.enabled,
    fine: {
      opacity: [GRAIN_DEFAULTS.fine.opacity, 0, 0.3],
      blend: {
        type: 'select',
        options: ['overlay', 'soft-light', 'hard-light', 'screen', 'multiply'],
        default: GRAIN_DEFAULTS.fine.blend,
      },
      tile: [GRAIN_DEFAULTS.fine.tile, 40, 300],
      duration: [GRAIN_DEFAULTS.fine.duration, 0.1, 2],
      steps: [GRAIN_DEFAULTS.fine.steps, 2, 40],
      baseFrequency: [GRAIN_DEFAULTS.fine.baseFrequency, 0.5, 3],
      numOctaves: [GRAIN_DEFAULTS.fine.numOctaves, 1, 4],
    },
  });

  const layers = [
    {
      noise: {
        type: params.coarse.type,
        baseFrequency: params.coarse.baseFrequency,
        numOctaves: params.coarse.numOctaves,
        seed: params.coarse.seed,
      },
      opacity: Math.min(1, params.coarse.opacity * scale),
      blend: params.coarse.blend,
      tile: params.coarse.tile,
      duration: params.coarse.duration,
      steps: params.coarse.steps,
    },
  ];
  if (params.fineEnabled) {
    layers.push({
      noise: {
        baseFrequency: params.fine.baseFrequency,
        numOctaves: params.fine.numOctaves,
      },
      opacity: Math.min(1, params.fine.opacity * scale),
      blend: params.fine.blend,
      tile: params.fine.tile,
      duration: params.fine.duration,
      steps: params.fine.steps,
    });
  }

  // Force-remount when timing changes — CSS animation properties don't
  // re-evaluate cleanly mid-flight, so we restart on duration/steps changes.
  const animKey = layers
    .map((l) => `${l.tile}-${l.duration}-${l.steps}-${l.blend}`)
    .join('|');

  return <GrainOverlay key={animKey} layers={layers} />;
}

/* ─────────────────────────────────────────────────────────
 * INACTIVE CARD FILTER
 *
 * Drop <CardNoiseFilterDefs /> once near the root, then apply
 *   filter: url(#card-noise)    →   pixelated noisy displacement
 * to any element you want degraded. Pair with blur()/grayscale()
 * via the regular CSS filter chain.
 *
 * Tuned in the "Inactive Cards" DialKit panel.
 * ───────────────────────────────────────────────────────── */

export const CARD_FILTER_ID = 'card-noise';

const CARD_FILTER_DEFAULTS = {
  blur: 9,
  grayscale: 1,
  opacity: 0.35,
  scale: 0.92,
  displacement: 30,
  baseFrequency: 1.1,
  numOctaves: 1.3,
  seed: 3,
  posterize: 0,
};

export function useInactiveCardParams() {
  return useDialKit('Inactive Cards', {
    opacity: [CARD_FILTER_DEFAULTS.opacity, 0, 1],
    scale: [CARD_FILTER_DEFAULTS.scale, 0.5, 1],
    blur: [CARD_FILTER_DEFAULTS.blur, 0, 16],
    grayscale: [CARD_FILTER_DEFAULTS.grayscale, 0, 1],
    noise: {
      enabled: true,
      displacement: [CARD_FILTER_DEFAULTS.displacement, 0, 40],
      baseFrequency: [CARD_FILTER_DEFAULTS.baseFrequency, 0.1, 3],
      numOctaves: [CARD_FILTER_DEFAULTS.numOctaves, 1, 5],
      seed: [CARD_FILTER_DEFAULTS.seed, 0, 99],
      posterize: [CARD_FILTER_DEFAULTS.posterize, 0, 8],
    },
  });
}

/**
 * Renders the SVG <filter> defs referenced by `filter: url(#card-noise)`.
 * Mount once anywhere in the tree — the filter is global by id.
 *
 * Pipeline:
 *   1. feTurbulence  → generates fractalNoise pattern
 *   2. feDisplacementMap  → smears the source by that pattern (pixelated feel)
 *   3. feComponentTransfer (optional)  → posterize / quantize channels for
 *      a true low-bit-depth look when posterize > 0
 */
export function CardNoiseFilterDefs({ params }) {
  const n = params?.noise ?? {};
  const enabled = n.enabled ?? true;
  const displacement = enabled ? (n.displacement ?? 0) : 0;
  const baseFrequency = n.baseFrequency ?? 0.9;
  const numOctaves = Math.round(n.numOctaves ?? 2);
  const seed = Math.round(n.seed ?? 3);
  const posterize = Math.round(n.posterize ?? 0);

  // posterize=0 → no quantization; >=2 → tableValues of `0, 1/(p-1), 2/(p-1), …, 1`
  const posterizeTable =
    posterize >= 2
      ? Array.from({ length: posterize }, (_, i) => (i / (posterize - 1)).toFixed(3)).join(' ')
      : null;

  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        <filter id={CARD_FILTER_ID} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={baseFrequency}
            numOctaves={numOctaves}
            seed={seed}
            stitchTiles="stitch"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={displacement}
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          {posterizeTable && (
            <feComponentTransfer in="displaced">
              <feFuncR type="discrete" tableValues={posterizeTable} />
              <feFuncG type="discrete" tableValues={posterizeTable} />
              <feFuncB type="discrete" tableValues={posterizeTable} />
            </feComponentTransfer>
          )}
        </filter>
      </defs>
    </svg>
  );
}
