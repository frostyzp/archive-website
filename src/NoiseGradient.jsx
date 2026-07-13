/**
 * NoiseGradient — the site's shared "noise gradient" surface.
 *
 * A charcoal radial backdrop (`NOISE_GRADIENT`) with the animated film grain
 * (`TunableGrainBackground`, tunable live in the DialKit "Grain" panel via
 * `?dial=1`) layered on top. Drop it into any relatively/absolutely positioned
 * parent — it fills `inset: 0`. Anything passed as `children` renders between the
 * gradient and the grain, so the grain textures it (same layering as the
 * landing page).
 *
 * This is the single source of truth for the backdrop across the site: tweak the
 * gradient stops here (or the grain in the DialKit panel) and every surface that
 * imports it updates together.
 */
import { TunableGrainBackground, GRAIN_OPACITY_SCALE } from './noise';

export const NOISE_GRADIENT =
  'radial-gradient(ellipse 100% 85% at 50% 40%, #161515 0%, #0B0A0A 45%, #040303 78%, #010000 100%)';

export function NoiseGradient({
  gradient = NOISE_GRADIENT,
  grain = true,
  opacityScale = GRAIN_OPACITY_SCALE,
  style,
  children,
  ...rest
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: gradient,
        ...style,
      }}
      {...rest}
    >
      {children}
      {grain && (
        <div
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, isolation: 'isolate', pointerEvents: 'none' }}
        >
          <TunableGrainBackground opacityScale={opacityScale} />
        </div>
      )}
    </div>
  );
}
