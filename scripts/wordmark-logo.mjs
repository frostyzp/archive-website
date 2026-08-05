/**
 * Bakes public/wordmark.svg down to the small transparent PNGs the archive
 * chrome uses.
 *
 * The source is 1.19MB of path data — ~178 grain subpaths across each of its 22
 * strokes — because it has to hold up as the onboarding hero at ~575px. None of
 * that detail survives at a 48px nav mark, and making the archive parse and
 * rasterize all of it just to draw a logo is a bad trade, so the chrome gets
 * bitmaps baked at 3x the size each one actually renders at.
 *
 * Re-run after changing the wordmark art:
 *   npm i --no-save @resvg/resvg-js && node scripts/wordmark-logo.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync(new URL('../public/wordmark.svg', import.meta.url), 'utf8');

/** 3x the CSS height of each place the mark appears. */
const SIZES = [
  144, // nav logo, renders at 48px
  420, // About sign-off, renders at up to 140px
];

for (const height of SIZES) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'height', value: height },
    background: 'rgba(0,0,0,0)',
  });
  const rendered = resvg.render();
  const png = rendered.asPng();
  const name = `wordmark-${height}.png`;
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png);
  console.log(`${name}  ${rendered.width}×${rendered.height}  ${(png.length / 1024).toFixed(1)}kB`);
}
