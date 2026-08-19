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
 * What the wordmark is actually drawn in — the white of `wordmark-line-96.png`,
 * at the 0.92 its button holds it at.
 *
 * Named because chrome that wants to read as the logo's peer rather than as body
 * copy has no other way to say so: the logo is an image, so its colour lives in
 * a PNG and nothing in the stylesheet can be told to match it. Anything using
 * this is claiming to sit at the wordmark's level in the page — the About tab
 * does, being the only other permanent thing in the frame — and should be
 * changed if the asset ever is.
 */
export const WORDMARK_INK = 'rgba(255, 255, 255, 0.92)';
