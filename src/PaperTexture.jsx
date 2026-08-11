/**
 * PaperTexture — the "rough paper" SVG filter, plus a layer that wears it.
 *
 * The filter is two stages and takes no input from the page:
 *   1. feTurbulence lays down a field of fractal noise,
 *   2. feDiffuseLighting reads that noise as a height map and lights it from a
 *      single distant lamp, so the peaks catch the light and the troughs fall
 *      into shadow — a sheet of paper with tooth rather than a flat grey.
 *
 * Because stage 2 reads `in="noise"` and never touches SourceGraphic, the output
 * REPLACES whatever it is applied to instead of texturing it. Never hang this
 * filter on a container that holds copy — the copy will vanish and the texture
 * will be all that is left. Use <PaperTextureLayer /> instead: an empty layer
 * that generates the paper and blends it down onto the surface behind it, so the
 * surface keeps its own colour and only gains the grain.
 *
 *     import { PaperTextureLayer } from './PaperTexture';
 *     ...
 *     <div style={{ position: 'relative', background: '#2e2e2e' }}>
 *       <PaperTextureLayer />
 *       <div style={{ position: 'relative', zIndex: 1 }}>…copy…</div>
 *     </div>
 *
 * The lit sheet comes out near-white, which is the whole difficulty of laying it
 * on a dark surface: multiplied down it barely registers (measured on the About
 * drawer's #2e2e2e panel: ±1 value level, invisible), and any of the lightening
 * blends drags the surface several levels brighter. So the layer parks the sheet
 * low on the value scale with `brightness(level)` first and lets `contrast` set
 * how far the fibre swings either side of it, blending the result with `overlay`.
 * At `level` 0.5 that blend is neutral and the surface keeps its exact value; the
 * shipped sheet sits under it at 0.33, which deliberately banks the panel down as
 * well as texturing it (46 flat → a mean of 44.7) — see `strength`.
 *
 * Every knob is live-tunable: see the "Paper Stock" DialKit panel at the bottom
 * of this file, which the About drawer drives all of its stock from.
 */

import { useDialKit } from 'dialkit';

/** Filter id + ready-made `url(#…)` string. */
export const ROUGH_PAPER_FILTER_ID = 'roughpaper';
export const ROUGH_PAPER_FILTER = `url(#${ROUGH_PAPER_FILTER_ID})`;

/**
 * The stock itself, declared once: the components below default from it and the
 * "Paper Stock" DialKit panel at the foot of the file opens on it. One place, so
 * a sheet dialled in through the panel can be made permanent by editing these
 * numbers and nothing else — and so the panel can never disagree with what the
 * page renders without it.
 *
 * These are the values the project ships, dialled in on the About drawer: a fine,
 * gentle sheet lit from the west and parked below overlay's neutral point, so it
 * banks the surface down a little as well as texturing it.
 */
const PAPER_STOCK = {
  // Grain size. Higher = finer, tighter fibre; lower = a coarse, cloudy stock.
  baseFrequency: 0.034,
  // Octaves of detail folded into the noise — the difference between a smooth
  // swell and paper that has actual fibre in it. Six is the ceiling: at this
  // grain the seventh octave lands inside a pixel and changes nothing.
  numOctaves: 6,
  // Which patch of the field a sheet is cut from. The noise starts at each
  // element's own top-left corner, so anything sharing an id shows the same crop
  // — give neighbouring surfaces different seeds (and ids) to break the repeat.
  seed: 0,
  // How tall the noise stands up under the light, i.e. how deep the shadow in
  // each trough — this is the texture's own contrast, before any blending. A
  // flatter sheet (the SVG reference value is 2) is fine on white stock but has
  // nothing left to show once it is blended onto a dark panel.
  surfaceScale: 7.5,
  // The lamp. Azimuth is the compass bearing it sits at, elevation how high
  // above the sheet — a low elevation rakes across and deepens every shadow.
  // Lit from just south of due west, so the fibre lies the other way to the
  // light the rest of the page is built around.
  azimuth: 173,
  elevation: 62,
  // White, spelled the way a colour control wants it.
  lightingColor: '#ffffff',
  // Where the lit sheet is parked on the value scale before blending. 0.5 is the
  // neutral point for `overlay`, where the surface keeps its exact value; below
  // that the sheet darkens the surface as well as texturing it, above it lifts.
  level: 0.33,
  // Spread of the fibre around `level`. Works with `strength`, but this one
  // widens the extremes rather than fading the whole texture in and out.
  contrast: 1.75,
  // Reads the sheet against mid-grey, so the grain lands as light and shadow on
  // the surface rather than as a wash over it — which is what makes `level` the
  // knob that decides whether the surface holds its value, darkens, or lifts.
  blendMode: 'overlay',
  // How much of the sheet reaches the surface. Unlike everything above, this one
  // belongs to the surface rather than to the stock: a panel and a caption cut
  // from the same paper can reasonably wear different amounts of it, so callers
  // own their own value (the About drawer keeps its in `ABOUT_DRAWER
  // .paperStrength`) and this is only the fallback for one that says nothing.
  //
  // Measured on that drawer's #2e2e2e panel, which is dead flat at value 46
  // before the stock goes on. Because the sheet is parked under overlay's neutral
  // point, raising this deepens the fill as well as the fibre:
  //   0.09 → grain across 4 levels (σ 1.2), fill at 44.7 — what the drawer ships
  //   0.12 → 6 levels (σ 1.7), fill 44.2
  //   0.20 → 9 levels (σ 2.6), fill 43.0 — tooth you notice without looking
  //   0.40 → 17 levels (σ 5.1), fill 39.9 — a real sheet of paper, and darker
  strength: 0.12,
};

/**
 * The <filter> itself, parked in a 0×0 <svg> that paints nothing. Render it
 * once per document; <PaperTextureLayer /> already does that for you.
 *
 * Note the region: x/y at 0% with width/height at 100% pin the filter to the
 * element's own box (the default is a 120% box, which would bleed the texture
 * past the edges of the layer).
 */
export function RoughPaperFilter({
  id = ROUGH_PAPER_FILTER_ID,
  // Every knob is described where it is declared, in PAPER_STOCK above.
  baseFrequency = PAPER_STOCK.baseFrequency,
  numOctaves = PAPER_STOCK.numOctaves,
  seed = PAPER_STOCK.seed,
  surfaceScale = PAPER_STOCK.surfaceScale,
  azimuth = PAPER_STOCK.azimuth,
  elevation = PAPER_STOCK.elevation,
  lightingColor = PAPER_STOCK.lightingColor,
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      // Kept in flow-but-invisible (0×0, not display:none) so browsers reliably
      // resolve the filter reference from CSS.
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      <defs>
        <filter id={id} x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={baseFrequency}
            numOctaves={numOctaves}
            seed={seed}
            result="noise"
          />
          <feDiffuseLighting in="noise" lightingColor={lightingColor} surfaceScale={surfaceScale}>
            <feDistantLight azimuth={azimuth} elevation={elevation} />
          </feDiffuseLighting>
        </filter>
      </defs>
    </svg>
  );
}

/**
 * A drop-in paper surface: absolutely positioned, inert to the pointer, and
 * blended into whatever it is laid over. Give the parent `position: relative`
 * and keep the content above it (`position: relative; z-index: 1`) — this layer
 * sits at z-index 0, which is over the parent's background fill and under any
 * positioned child.
 */
export function PaperTextureLayer({
  id = ROUGH_PAPER_FILTER_ID,
  // The one dial worth reaching for, and the one a surface should own rather
  // than inherit — see `strength` in PAPER_STOCK, and the numbers it measures on
  // the About drawer's panel in the DialKit block at the foot of this file.
  strength = PAPER_STOCK.strength,
  blendMode = PAPER_STOCK.blendMode,
  level = PAPER_STOCK.level,
  contrast = PAPER_STOCK.contrast,
  // Match the corner of the surface being textured, or the texture will square
  // off a rounded panel.
  radius = 0,
  // The filter travels with the layer, so one of these is enough on its own. Pass
  // defs={false} for every layer after the first that shares an id — several
  // copies of the same <filter> in one document is a reference waiting to break.
  defs = true,
  style,
  // The filter's own knobs pass straight through, e.g.
  // <PaperTextureLayer baseFrequency={0.09} surfaceScale={4} />.
  ...filterProps
}) {
  return (
    <>
      {defs ? <RoughPaperFilter id={id} {...filterProps} /> : null}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          borderRadius: radius,
          opacity: strength,
          mixBlendMode: blendMode,
          filter: `url(#${id}) brightness(${level}) contrast(${contrast})`,
          ...style,
        }}
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────
 * PAPER STOCK — DialKit
 *
 * The whole sheet on one panel: the filter that generates the lit
 * paper, and the blend that lays it down on a surface. Titled "Paper
 * Stock", and reached the way every panel in this project is —
 * append `?dial=1` to the URL (DialRoot is gated on that flag in
 * main.jsx), then open the About drawer and drag.
 *
 * The bounds sit where the render still answers rather than at the
 * spec limits, swept on the drawer's #2e2e2e panel — flat it reads
 * value 46 with no spread at all — with the sheet laid on at full
 * contrast so each knob's own limit shows. Quoted as the standard
 * deviation the grain gives that panel:
 *   baseFrequency  0.01 → 0.7, 0.04 → 2.6, 0.16 → 3.4, and from
 *                  there to 0.5 it stops moving: the fibre is finer
 *                  than the pixels it has to land on.
 *   numOctaves     1 → 1.2, 5 → 2.6, and 6 is already the same sheet
 *                  as 8.
 *   surfaceScale   0 is dead flat, 20 → 3.4, past that it saturates.
 *   contrast       0.5 → 0.4, 5 → 3.4, past that it saturates.
 * Elevation is the exception that keeps its full range: it moves the
 * sheet's own value as much as its texture (mean 40 at 0°, 48 at 90°).
 *
 * Every dial opens on PAPER_STOCK, the same constant the components
 * default from, so opening the panel never shifts the look. A surface
 * that owns a value passes it in — the About drawer hands over its
 * `paperStrength` — and that dial starts there instead.
 *
 * To keep a setting: Copy in the panel toolbar puts the whole set on
 * the clipboard as JSON, keyed by paths that are the prop names, so
 * `sheet.baseFrequency` goes straight back into source as
 * `baseFrequency`. Presets (the "+" beside it) hold a few candidates
 * side by side while you choose between them, but they live only as
 * long as the tab does — nothing here is written to disk.
 * ───────────────────────────────────────────────────────── */
/**
 * Live-tunable paper stock. Returns an object ready to spread straight into
 * `<PaperTextureLayer {...} />`; pass `shipped` for any prop whose surface ships
 * a value of its own, so the dial opens on what is already on screen.
 *
 * `seed` comes back as the base crop of the noise field. A neighbour that needs
 * a different patch of it adds its own offset on top (`seed={paper.seed + 7}`),
 * which keeps the offsets between neighbouring surfaces intact while the dial
 * moves all of their crops together.
 *
 * Every slider carries an explicit step so the defaults land exactly on their
 * shipped values — DialKit's inferred step would otherwise snap e.g. 0.034 to
 * 0.03 the moment the panel mounts, nudging the resting look.
 */
export function usePaperStockDials(shipped) {
  const D = { ...PAPER_STOCK, ...shipped };
  const p = useDialKit(
    'Paper Stock',
    {
      // The filter — the sheet itself, before it is laid on anything.
      sheet: {
        baseFrequency: [D.baseFrequency, 0.01, 0.16, 0.002],
        numOctaves: [D.numOctaves, 1, 6, 1],
        surfaceScale: [D.surfaceScale, 0, 20, 0.5],
        azimuth: [D.azimuth, 0, 360, 1],
        elevation: [D.elevation, 0, 90, 1],
        lightingColor: { type: 'color', default: D.lightingColor },
        // The field is indexed rather than interpolated, so whole numbers are
        // the only meaningful values. On S+Scroll as well as the slider, which
        // is the difference between flipping through crops and hunting for one.
        seed: [D.seed, 0, 40, 1],
      },
      // The layer — how much of that sheet reaches the surface underneath.
      blend: {
        strength: [D.strength, 0, 1, 0.01],
        blendMode: {
          type: 'select',
          options: ['overlay', 'multiply', 'soft-light', 'screen', 'normal'],
          default: D.blendMode,
        },
        level: [D.level, 0, 1, 0.01],
        contrast: [D.contrast, 0.5, 5, 0.05],
      },
    },
    { shortcuts: { 'sheet.seed': { key: 's' } } }
  );

  return {
    baseFrequency: p.sheet.baseFrequency,
    numOctaves: Math.round(p.sheet.numOctaves),
    surfaceScale: p.sheet.surfaceScale,
    azimuth: p.sheet.azimuth,
    elevation: p.sheet.elevation,
    lightingColor: p.sheet.lightingColor,
    seed: Math.round(p.sheet.seed),
    strength: p.blend.strength,
    blendMode: p.blend.blendMode,
    level: p.blend.level,
    contrast: p.blend.contrast,
  };
}

export default PaperTextureLayer;
