import * as THREE from 'three';

/**
 * A character set rasterized once into a single-row texture, so a shader can
 * turn any number into a glyph with one lookup.
 *
 * This is the piece that makes GPU ASCII possible at all. The alternatives both
 * dead-end: three's built-in AsciiEffect rebuilds a DOM <table> of characters
 * every frame (CPU + layout bound, caps out around 100×60 cells, and can only
 * ever be a screen-space post-effect), and re-running canvas `fillText` into a
 * CanvasTexture each frame just moves the same per-frame rasterization cost
 * around. Here the text is drawn exactly once at startup; from then on picking a
 * character is a texture fetch, which costs the same whether there are 500 cells
 * or 50,000 and works identically in screen space and on a surface.
 *
 * Layout is one row, N cells wide, glyph `i` occupying u ∈ [i/N, (i+1)/N]. The
 * type is drawn at ~72% of the cell so ink never reaches a cell border — that
 * padding is what lets the texture stay LINEAR-filtered (soft glyph edges)
 * without neighbouring characters bleeding into each other.
 */

/** Light → heavy. Index 0 must be blank; the shader maps luminance onto this. */
export const RAMP = ' .:-=+*#%@';

/**
 * Swappable ramps. Every one has to start with a space so the darkest step
 * draws nothing — that empty cell is what gives ASCII its air.
 */
export const RAMPS = {
  classic: RAMP,
  minimal: ' .oO@',
  blocks: ' ░▒▓█',
  dots: ' .·:;o●',
  typed: ' ,-~:;=!*#$@',
  binary: ' 01',
  slashes: ' ./|\\#',
};

/**
 * Stroke glyphs for edges, in gradient-bin order: 0° 45° 90° 135°. Kept after
 * the ramp in the atlas so the shader can address them as rampCount + bin.
 */
export const EDGES = ['-', '/', '|', '\\'];

/**
 * Rasterize a ramp (plus the edge strokes) into a THREE texture. Async only
 * because webfonts load async. Cheap enough to re-run when the ramp changes —
 * it is one ~900×64 canvas and a single upload.
 */
export async function buildGlyphAtlas({
  ramp = RAMP,
  fontFamily = 'OT Brut Mono',
  cell = 64,
  glyphScale = 0.72,
} = {}) {
  const chars = ramp.split('').concat(EDGES);
  // Without this the first paint silently falls back to the system monospace
  // and bakes the wrong shapes into the texture for the life of the page.
  try {
    await document.fonts.load(`${cell}px "${fontFamily}"`);
    await document.fonts.ready;
  } catch {
    /* fall through to the generic monospace below */
  }

  const canvas = document.createElement('canvas');
  canvas.width = cell * chars.length;
  canvas.height = cell;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Past ~0.95 the ink starts reaching the cell border and neighbours bleed
  // into each other under LINEAR filtering, so the dial stops short of that.
  ctx.font = `${Math.round(cell * glyphScale)}px "${fontFamily}", monospace`;
  chars.forEach((ch, i) => ctx.fillText(ch, (i + 0.5) * cell, cell * 0.52));

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  // A coverage mask, not colour — must not be sRGB-decoded on sample.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  return { texture, count: chars.length, rampCount: ramp.length, cell };
}

/**
 * Shared GLSL: given a 0..1 value and the position within a cell, return the
 * glyph's coverage. Both modes include this so the ramp reads identically
 * whether it's being driven by a rendered pixel or by a point on a surface.
 */
export const GLYPH_GLSL = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uCount;     // glyphs in the atlas
  uniform float uRampCount; // how many of them are the ramp

  // idx is an atlas index, g is the 0..1 position inside the cell.
  float glyph(float idx, vec2 g) {
    vec2 uv = vec2((idx + g.x) / uCount, g.y);
    return texture2D(uAtlas, uv).a;
  }

  // Map 0..1 → an index into the ramp portion of the atlas.
  float rampIndex(float v) {
    return floor(clamp(v, 0.0, 1.0) * (uRampCount - 0.001));
  }
`;
