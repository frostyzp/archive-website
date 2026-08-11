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
