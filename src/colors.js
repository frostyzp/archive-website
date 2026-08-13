/** Site ink — warm off-white for text, borders, and hairlines. */
export const INK = '#CFCAB7';
export const INK_RGB = '207, 202, 183';

/** rgba() helper for the site ink at a given alpha. */
export function inkA(alpha) {
  return `rgba(${INK_RGB}, ${alpha})`;
}

/**
 * Site accent — the onboarding hero's yellow-white. Brighter and warmer than
 * INK, so type wearing it reads as called out rather than as more body copy.
 */
export const ACCENT = '#DDDDAE';
export const ACCENT_RGB = '221, 221, 174';

/** rgba() helper for the accent at a given alpha. */
export function accentA(alpha) {
  return `rgba(${ACCENT_RGB}, ${alpha})`;
}

/**
 * Ink for type fine enough that the nav grain eats its edges — the dial's
 * legend labels and its ESC / arrow key glyphs.
 *
 * Pure white rather than INK, and near-opaque, because the grain filter (see
 * NAV_GRAIN in SideDial) chews the edges of strokes that thin and takes real
 * brightness with them: at INK these read as grey mush rather than as parchment.
 * It is deliberately off the INK ladder, so anything wearing it should be small
 * enough and grained enough to need the compensation — otherwise it will simply
 * look colder than the rest of the page, which is the thing this palette is
 * mostly trying to avoid.
 */
export const INK_ON_GRAIN = 'rgba(255, 255, 255, 0.96)';
