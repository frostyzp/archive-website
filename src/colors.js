/** Site ink — warm off-white for text, borders, and hairlines. */
export const INK = '#CFCAB7';
export const INK_RGB = '207, 202, 183';

/** rgba() helper for the site ink at a given alpha. */
export function inkA(alpha) {
  return `rgba(${INK_RGB}, ${alpha})`;
}
