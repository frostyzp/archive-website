/**
 * Bakes public/wwtai_2.svg down to the small transparent PNG the archive chrome
 * uses.
 *
 * The source is 1.6MB of path data — ~178 grain subpaths across each of its 31
 * strokes — because it has to hold up as the onboarding hero at full width, and
 * because WordmarkDraw needs every one of those strokes separable to trace
 * them. None of that survives at a nav mark a couple of dozen pixels tall, and
 * making the archive parse and rasterize all of it just to draw a logo is a bad
 * trade, so the chrome gets a bitmap baked at 3x the size it renders at.
 *
 * Re-run after changing the wordmark art:
 *   npm i --no-save @resvg/resvg-js && node scripts/wordmark-logo.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync(new URL('../public/wwtai_2.svg', import.meta.url), 'utf8');

/** 3x the CSS height of each place the mark appears. */
const SIZES = [
  96, // nav logo, renders at 26px on desktop and 20px on a phone
];

for (const height of SIZES) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'height', value: height },
    background: 'rgba(0,0,0,0)',
  });
  const rendered = resvg.render();
  const png = rendered.asPng();
  const name = `wordmark-line-${height}.png`;
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png);
  console.log(`${name}  ${rendered.width}×${rendered.height}  ${(png.length / 1024).toFixed(1)}kB`);
}
