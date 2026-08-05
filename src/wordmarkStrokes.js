/* Generated from public/wordmark.svg — see WordmarkDraw.
 *
 * The art is 22 separate filled paths, one per pen stroke (stems, crossbars,
 * bowls), which is what lets the lockup be written on one stroke at a time.
 *
 * This file is the AUTHORED half of that: the order a hand would lay the
 * strokes down, which is a judgement call and not derivable from the art. The
 * route the pen takes across each one is the derived half, and lives in
 * wordmarkCenterlines.js.
 *
 * `i` indexes the path list as it appears in the file, `row` is 0 for "WHAT WE"
 * and 1 for "TELL AI" (so the write can take a breath between lines), and
 * x/y/w/h is the stroke's bounding box in viewBox units — used to size each
 * stroke's mask so it covers that letter and nothing else.
 */
export const WORDMARK_VIEWBOX = '0 0 852 607';

export const WORDMARK_STROKES = [
  { i: 0, row: 0, x: -0.4, y: 44.2, w: 166.3, h: 250.7 },
  { i: 1, row: 0, x: 173.7, y: 39.2, w: 31.6, h: 233.2 },
  { i: 2, row: 0, x: 185.9, y: 124.6, w: 104.6, h: 52.3 },
  { i: 3, row: 0, x: 241.2, y: 24.2, w: 31.5, h: 260.1 },
  { i: 4, row: 0, x: 273.3, y: 27.6, w: 160.7, h: 241.2 },
  { i: 5, row: 0, x: 314.3, y: 131.9, w: 110.5, h: 45.7 },
  { i: 18, row: 0, x: 390.7, y: -0.1, w: 155.1, h: 65.7 },
  { i: 19, row: 0, x: 447.3, y: 30.7, w: 58.0, h: 217.5 },
  { i: 6, row: 0, x: 628.5, y: 4.5, w: 113.5, h: 262.6 },
  { i: 16, row: 0, x: 748.7, y: 1.9, w: 103.0, h: 261.0 },
  { i: 17, row: 0, x: 758.2, y: 106.2, w: 72.3, h: 32.5 },
  { i: 7, row: 1, x: 77.3, y: 314.8, w: 154.2, h: 67.1 },
  { i: 8, row: 1, x: 139.2, y: 333.7, w: 50.9, h: 269.2 },
  { i: 9, row: 1, x: 211.8, y: 307.3, w: 107.3, h: 259.8 },
  { i: 10, row: 1, x: 255.2, y: 396.4, w: 48.5, h: 42.0 },
  { i: 20, row: 1, x: 332.6, y: 320.7, w: 73.9, h: 243.8 },
  { i: 21, row: 1, x: 407.7, y: 328.5, w: 64.4, h: 264.0 },
  { i: 14, row: 1, x: 573.1, y: 332.7, w: 144.1, h: 271.7 },
  { i: 15, row: 1, x: 592.3, y: 443.8, w: 133.5, h: 61.7 },
  { i: 11, row: 1, x: 705.1, y: 328.0, w: 140.6, h: 35.2 },
  { i: 13, row: 1, x: 725.7, y: 504.4, w: 117.9, h: 41.0 },
  { i: 12, row: 1, x: 764.9, y: 342.9, w: 36.9, h: 180.2 },
];
