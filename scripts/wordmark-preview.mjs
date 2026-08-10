/**
 * Renders a check sheet for the recovered pen routes: the lettering in grey,
 * every centerline drawn over it, numbered in writing order.
 *
 * Run after regenerating the centerlines, to see whether the routes actually
 * follow the letters and whether the order reads as a hand crossing the line:
 *   node scripts/wordmark-preview.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { WORDMARK_CENTERLINES } from '../src/wordmarkCenterlines.js';
import { WORDMARK_STROKES, WORDMARK_VIEWBOX } from '../src/wordmarkStrokes.js';

const ART = 'wwtai_2.svg';
const [, , VIEW_W, VIEW_H] = WORDMARK_VIEWBOX.split(' ').map(Number);
const OUT_W = 2461;

const svg = readFileSync(new URL(`../public/${ART}`, import.meta.url), 'utf8');
const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]*)"/g)].map((m) => m[1]);

const art = paths.map((d) => `<path d="${d}" fill="#3a3a3a"/>`).join('');

const routes = WORDMARK_STROKES.map((s, n) => {
  const line = WORDMARK_CENTERLINES[s.i];
  if (!line) return '';
  const hue = (n * 47) % 360;
  const [x, y] = line.d.slice(1).split('L')[0].split(' ').map(Number);
  return [
    `<path d="${line.d}" fill="none" stroke="hsl(${hue} 90% 55%)" stroke-width="6" stroke-linecap="round"/>`,
    `<circle cx="${x}" cy="${y}" r="11" fill="hsl(${hue} 90% 55%)"/>`,
    `<text x="${x}" y="${y + 7}" font-family="monospace" font-size="20" font-weight="bold" fill="#000" text-anchor="middle">${n + 1}</text>`,
  ].join('');
}).join('');

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}"><rect width="${VIEW_W}" height="${VIEW_H}" fill="#111"/>${art}${routes}</svg>`;

const png = new Resvg(sheet, { fitTo: { mode: 'width', value: OUT_W } }).render().asPng();
writeFileSync(new URL('../wordmark-routes.png', import.meta.url), png);
console.log(`wrote wordmark-routes.png — ${WORDMARK_STROKES.length} routes`);
