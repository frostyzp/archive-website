/**
 * Derives a pen centerline for each of the wordmark's 22 brush strokes, so the
 * hero can be written on by TRACING each stroke rather than wiping a rect over
 * it.
 *
 * The art has no centerlines to animate: every stroke is a filled silhouette
 * with the brush grain baked into ~178 subpaths, so `pathLength` on the artwork
 * traces the outline of every speck. This recovers the line the pen actually
 * travelled by skeletonizing the filled shape:
 *
 *   rasterize one stroke  →  binary mask
 *   distance transform    →  how thick the stroke is at each pixel
 *   Zhang-Suen thinning   →  1px skeleton
 *   longest path in it    →  the pen's route, tip to tip
 *   Ramer-Douglas-Peucker →  a handful of points instead of hundreds
 *
 * The result feeds a mask in WordmarkDraw: a fat round-capped stroke swept
 * along the centerline uncovers the real artwork underneath, so the grain
 * survives and a W gets revealed down-up-down-up the way it was drawn.
 *
 * Re-run after changing the wordmark art:
 *   npm i --no-save @resvg/resvg-js && node scripts/wordmark-centerlines.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

/* The art this reads, and its own user space. Swapping the lockup means
   changing these three numbers and re-running — everything below is measured
   off the raster, so nothing else is tied to a particular set of letterforms. */
const ART = { file: 'wwtai_2.svg', w: 2461, h: 456, rows: 1 };

const VIEW_W = ART.w;
const VIEW_H = ART.h;

/* Raster scale for the skeletonization. Thinning peels one pixel off the shape
   per pass, so cost climbs with stroke thickness — half scale keeps the whole
   run to a few seconds, and a centerline is only ever seen through a mask tens
   of units wide, so sub-2-unit precision buys nothing. */
const SCALE = 0.5;
const W = Math.round(VIEW_W * SCALE);
const H = Math.round(VIEW_H * SCALE);

/** RDP tolerance, in raster px. */
const SIMPLIFY = 2.5;

/* Shortest branch worth detouring into, in raster px. Below this the only
   branches left are the frizz thinning leaves along a brush edge, and routing
   into those makes the pen jitter on its way down a straight stem.
 *
 * Both of these are in raster px, so both scale with how large the letters come
 * out at SCALE — a taller export has proportionally longer frizz, and the same
 * numbers would silently stop suppressing it. This art's letters are about 215
 * raster px tall; a floor of a tenth of that is what stops the pen darting
 * sideways at the foot of every stem while still letting it turn the corner of
 * an L, which is a genuine branch about three times longer. */
const BRANCH_MIN = 27;

const svg = readFileSync(new URL(`../public/${ART.file}`, import.meta.url), 'utf8');
const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]*)"/g)].map((m) => m[1]);
if (!paths.length) throw new Error(`no <path d> found in ${ART.file}`);

/** Renders one stroke alone and returns it as a 0/1 mask. */
function rasterize(d) {
  const one = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${W}" height="${H}"><path d="${d}" fill="#fff"/></svg>`;
  const { pixels } = new Resvg(one, { fitTo: { mode: 'width', value: W } }).render();
  const bits = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) bits[i] = pixels[i * 4 + 3] > 128 ? 1 : 0;
  return bits;
}

/**
 * Chamfer 3-4 distance transform — for every set pixel, how far to the nearest
 * clear one. Two sweeps, so it's linear; the 3-4 weights approximate Euclidean
 * to within a few percent, far tighter than the mask width needs.
 */
function distanceTransform(bits) {
  const INF = 1e9;
  const dist = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = bits[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? INF : dist[y * W + x]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!bits[i]) continue;
      dist[i] = Math.min(dist[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!bits[i]) continue;
      dist[i] = Math.min(dist[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < W * H; i++) dist[i] /= 3;
  return dist;
}

/* Neighbours P2..P9, clockwise from north — the ordering Zhang-Suen is defined in. */
const N8 = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

/** Zhang-Suen thinning: erodes the shape to a 1px skeleton, preserving topology. */
function skeletonize(src) {
  const bits = Uint8Array.from(src);
  const get = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : bits[y * W + x]);
  const doomed = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      doomed.length = 0;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          if (!bits[y * W + x]) continue;
          const p = N8.map(([dx, dy]) => get(x + dx, y + dy));
          const filled = p.reduce((a, b) => a + b, 0);
          if (filled < 2 || filled > 6) continue;
          // Transitions 0→1 around the ring; exactly one means removing this
          // pixel won't break the skeleton into two pieces.
          let transitions = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) transitions++;
          if (transitions !== 1) continue;
          const [p2, p3, p4, p5, p6, p7, p8, p9] = p;
          void p3;
          void p5;
          void p7;
          void p9;
          const a = step === 0 ? p2 * p4 * p6 : p2 * p4 * p8;
          const b = step === 0 ? p4 * p6 * p8 : p2 * p6 * p8;
          if (a || b) continue;
          doomed.push(y * W + x);
        }
      }
      if (doomed.length) changed = true;
      for (const i of doomed) bits[i] = 0;
    }
  }
  return bits;
}

/**
 * The route the pen took: the skeleton's longest tip-to-tip run, with its
 * deeper side branches spliced back in where they leave it.
 *
 * The spine is found the way a tree's diameter is — walk to the farthest pixel
 * from anywhere, then to the farthest pixel from there.
 *
 * On its own that spine cuts every sharp corner. Thinning turns a V into a Y:
 * the two limbs merge above the vertex and a stem carries on down into it, so
 * a tip-to-tip run crosses the junction and never visits the point of the V.
 * On this wordmark's Ws that left the route ~100 units clear of both vertices,
 * far enough that no sane mask width could uncover the corners without
 * uncovering half the letter at once.
 *
 * Splicing the stem back in reads as what a hand actually does anyway: down one
 * limb, into the point, back out along the other. The doubled-back part is only
 * as long as the stem, a few units, so it lands as a turn rather than a pause.
 *
 * Runs on the largest connected component only. The brush grain sprays detached
 * specks around every stroke and each one skeletonizes to its own island, so
 * starting the walk from an arbitrary pixel can land on a speck and return a
 * two-pixel "stroke".
 */
function penRoute(skel) {
  const nodes = [];
  for (let i = 0; i < W * H; i++) if (skel[i]) nodes.push(i);
  if (!nodes.length) return [];

  const neighbours = (i) => {
    const x = i % W;
    const y = (i / W) | 0;
    const out = [];
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (skel[j]) out.push(j);
    }
    return out;
  };

  const bfs = (from) => {
    const prev = new Int32Array(W * H).fill(-1);
    const seen = new Uint8Array(W * H);
    let queue = [from];
    seen[from] = 1;
    let last = from;
    while (queue.length) {
      const next = [];
      for (const i of queue) {
        last = i;
        for (const j of neighbours(i)) {
          if (seen[j]) continue;
          seen[j] = 1;
          prev[j] = i;
          next.push(j);
        }
      }
      queue = next;
    }
    return { last, prev };
  };

  const claimed = new Uint8Array(W * H);
  let biggest = null;
  for (const start of nodes) {
    if (claimed[start]) continue;
    const component = [];
    const stack = [start];
    claimed[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      component.push(i);
      for (const j of neighbours(i)) {
        if (claimed[j]) continue;
        claimed[j] = 1;
        stack.push(j);
      }
    }
    if (!biggest || component.length > biggest.length) biggest = component;
  }

  const a = bfs(biggest[0]).last;
  const { last: b, prev } = bfs(a);
  const spine = [];
  for (let i = b; i !== -1; i = prev[i]) spine.push(i);
  spine.reverse();

  // Splice in each branch that runs more than BRANCH_MIN pixels clear of the
  // route, deepest first, as an out-and-back from where it meets the route.
  const route = [...spine];
  const onRoute = new Set(route);
  for (;;) {
    // How far every unvisited pixel sits from the route, and by which way out.
    const depth = new Int32Array(W * H).fill(-1);
    const from = new Int32Array(W * H).fill(-1);
    let frontier = [...onRoute];
    for (const i of frontier) depth[i] = 0;
    let deepest = -1;
    while (frontier.length) {
      const next = [];
      for (const i of frontier) {
        for (const j of neighbours(i)) {
          if (depth[j] !== -1) continue;
          depth[j] = depth[i] + 1;
          from[j] = i;
          if (deepest === -1 || depth[j] > depth[deepest]) deepest = j;
          next.push(j);
        }
      }
      frontier = next;
    }
    if (deepest === -1 || depth[deepest] < BRANCH_MIN) break;

    const detour = [];
    for (let i = deepest; depth[i] > 0; i = from[i]) detour.push(i);
    const anchor = from[detour[detour.length - 1]];
    detour.reverse(); // anchor → tip
    for (const i of detour) onRoute.add(i);
    // Out to the tip and then straight on to wherever the route was headed,
    // rather than back the way it came. Retracing the branch pixel for pixel
    // would uncover nothing on the way back, and the pen would look like it had
    // stalled at the bottom of every V.
    route.splice(route.lastIndexOf(anchor) + 1, 0, ...detour);
  }

  return route.map((i) => [i % W, (i / W) | 0]);
}

/** Ramer-Douglas-Peucker. */
function simplify(points, tol) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dev = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
    if (dev > worst) {
      worst = dev;
      at = i;
    }
  }
  if (worst <= tol) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, at + 1), tol).slice(0, -1), ...simplify(points.slice(at), tol)];
}

/**
 * Points the route in the direction a hand would move: along whichever axis the
 * two tips are further apart on. Uprights come out top-to-bottom, crossbars and
 * the diagonals of a W left-to-right.
 */
function orient(points) {
  const [sx, sy] = points[0];
  const [ex, ey] = points[points.length - 1];
  const flip = Math.abs(ex - sx) > Math.abs(ey - sy) ? ex < sx : ey < sy;
  return flip ? [...points].reverse() : points;
}

const round = (n) => Math.round(n * 10) / 10;
const rows = [];

for (let i = 0; i < paths.length; i++) {
  const bits = rasterize(paths[i]);
  const skel = skeletonize(bits);
  const route = penRoute(skel);
  if (route.length < 2) {
    console.warn(`stroke ${i}: no skeleton, skipped`);
    continue;
  }

  // How fat the mask has to be, measured rather than guessed: how far the
  // artwork strays from the route. Sizing it off the stroke's own thickness
  // instead leaves the corners behind, because the route runs up the middle of
  // a limb but a corner's ink sits out at the diagonal.
  //
  // 99.9th percentile, not the maximum — the brush sprays a few specks well
  // clear of the letter, and chasing the last of those would double the width
  // to uncover a handful of pixels nobody can see.
  const offRoute = new Uint8Array(W * H).fill(1);
  for (const [x, y] of route) offRoute[y * W + x] = 0;
  const reach = distanceTransform(offRoute);
  const strays = [];
  for (let p = 0; p < W * H; p++) if (bits[p]) strays.push(reach[p]);
  strays.sort((a, b) => a - b);
  const half = strays[Math.floor(strays.length * 0.999)] ?? 0;

  // Not extended to the stroke's tips on purpose. The route stops about half a
  // stroke-width short of the end of the shape, which is exactly the radius of
  // the mask's round cap — the cap reaches the tip on its own. Pushing the ends
  // out instead sent them off the letter, because the brush flares at the end
  // of a stroke and the route hooks sideways to follow it.
  const points = simplify(orient(route), SIMPLIFY).map(([x, y]) => [round(x / SCALE), round(y / SCALE)]);
  const d = points.map(([x, y], n) => `${n ? 'L' : 'M'}${x} ${y}`).join('');
  let len = 0;
  for (let n = 1; n < points.length; n++) {
    len += Math.hypot(points[n][0] - points[n - 1][0], points[n][1] - points[n - 1][1]);
  }

  // The stroke's own box, so its mask can be given just that patch of canvas
  // instead of the whole lockup.
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;
  for (let p = 0; p < W * H; p++) {
    if (!bits[p]) continue;
    const x = p % W;
    const y = (p / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }

  rows.push({
    i,
    bbox: {
      x: round(x0 / SCALE),
      y: round(y0 / SCALE),
      w: round((x1 - x0 + 1) / SCALE),
      h: round((y1 - y0 + 1) / SCALE),
    },
    d,
    // × 2 for a full width, plus a margin for the chamfer's approximation, for
    // the half-pixel the raster loses, and for the grain filter nudging edge
    // pixels outward at display size.
    width: round((half / SCALE) * 2 * 1.14),
    // Travel distance, so a long stroke can be given longer to draw than a
    // short one instead of every stroke taking the same time regardless.
    len: Math.round(len),
    points: points.length,
  });
  console.log(
    `stroke ${String(i).padStart(2)}  ${String(points.length).padStart(2)} pts  len ${String(rows.at(-1).len).padStart(4)}  width ${rows.at(-1).width}`
  );
}

const file = `/* Generated by scripts/wordmark-centerlines.mjs — do not edit by hand.
 *
 * One entry per brush stroke in public/${ART.file}, recovered by skeletonizing
 * the filled art (see the script).
 *
 *   d      the line the pen travelled, in viewBox units, in writing direction
 *   width  how fat a mask stroke has to be to uncover that stroke completely
 *   len    how far the pen travels, for pacing long strokes against short ones
 *
 * WordmarkDraw sweeps \`d\` as a mask to trace the lettering on.
 */
export const WORDMARK_CENTERLINES = {
${rows.map((r) => `  ${r.i}: { d: '${r.d}', width: ${r.width}, len: ${r.len} },`).join('\n')}
};
`;

writeFileSync(new URL('../src/wordmarkCenterlines.js', import.meta.url), file);
console.log(`\nwrote src/wordmarkCenterlines.js — ${rows.length} centerlines`);

/* WRITING ORDER
 *
 * A hand crossing a single line of lettering goes left to right, so the order
 * is the strokes sorted by where they start. Strokes that begin at roughly the
 * same place are parts of one letter — the stem and the bars of an E — and
 * those go top to bottom, which is the order a hand makes them in.
 *
 * TOGETHER is how close two strokes' left edges have to be to count as the same
 * letter. It is set below the narrowest gap between letters in this lockup and
 * above the widest offset within one, so it separates them cleanly. */
const TOGETHER = 60;
const order = [...rows].sort((a, b) =>
  Math.abs(a.bbox.x - b.bbox.x) > TOGETHER ? a.bbox.x - b.bbox.x : a.bbox.y - b.bbox.y
);

const strokes = `/* Generated by scripts/wordmark-centerlines.mjs — do not edit by hand.
 *
 * One entry per brush stroke in public/${ART.file}, in writing order.
 *
 *   i         which path in the SVG this stroke is, so the art and the
 *             centerline (see wordmarkCenterlines.js) can be paired up
 *   x y w h   the stroke's bounding box in viewBox units, used to size its
 *             mask — a mask that covers the whole canvas per stroke is ${rows.length}x the
 *             fill rate for no gain
 */
export const WORDMARK_VIEWBOX = '0 0 ${ART.w} ${ART.h}';

export const WORDMARK_STROKES = [
${order
  .map((r) => `  { i: ${r.i}, x: ${r.bbox.x}, y: ${r.bbox.y}, w: ${r.bbox.w}, h: ${r.bbox.h} },`)
  .join('\n')}
];
`;

writeFileSync(new URL('../src/wordmarkStrokes.js', import.meta.url), strokes);
console.log(`wrote src/wordmarkStrokes.js — ${order.length} strokes in writing order`);
