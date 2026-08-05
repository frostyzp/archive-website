/**
 * WebGL1 mask-reveal core — framework-free.
 *
 * Two small text blocks are drawn to ONE offscreen 2D canvas (monochrome ink on
 * a transparent plate) and uploaded as a single texture. A fragment shader then
 * materializes that texture through a cloudy dissolve:
 *
 *   MASK      a purely 2D field — a soft diagonal bias, domain-warped fbm, and a
 *             fine stipple — with no column wipe anywhere. A per-cycle seed
 *             offsets the noise so no two reveals dissolve the same way.
 *   FRONT     `progress` sweeps a feathered threshold across that field, so the
 *             text blooms in as wispy tendrils rather than sliding.
 *   UN-BLUR   where the front is passing, the texture is sampled with a 17-tap
 *             ring blur whose radius decays to zero BEHIND the front — each part
 *             comes into focus as it is uncovered — plus a small drift + grow so
 *             emerging type settles into place.
 *   FLARE     a thin band at the front picks up chromatic split + a halo glow,
 *             which fades out as the reveal completes.
 *
 * The plate leans toward the cursor via ONE shared texture-space offset per
 * corner (`uParTL` / `uParBR`, blended across the diagonal) — a whole-plate
 * parallax, never per-letter.
 *
 * This file owns no timing. The caller drives `progress` (a spring), `seed`,
 * `reverse`, and the parallax/cursor uniforms each frame — see TextRevealCard.
 */

const VERT = `
  attribute vec2 aPosition;
  attribute vec2 aUV;
  varying vec2 vUV;
  void main(){
    vUV = aUV;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

// highp is not guaranteed in fragment shaders on older mobile GPUs; fall back to
// mediump rather than failing to compile.
const FRAG = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  uniform sampler2D uTex;
  uniform vec2  uTexel;
  uniform float uProgress;
  uniform float uMaxBlur;
  uniform vec3  uEdge;
  uniform float uTime;
  uniform float uAspect;
  uniform float uSeed;
  uniform vec2  uParTL;
  uniform vec2  uParBR;
  uniform vec2  uCursor;
  uniform float uHover;
  uniform float uReverse;
  uniform float uChroma;
  varying vec2 vUV;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }

  // 17-tap ring blur: centre + two rings of 8. Cheap enough to run per-pixel and
  // wide enough to read as an out-of-focus glyph rather than a smudge.
  vec4 blurTex(vec2 uv, float radius){
    if (radius < 0.35) return texture2D(uTex, uv);
    vec2 r1 = uTexel * radius;
    vec2 r2 = uTexel * radius * 2.0;
    vec4 sum = texture2D(uTex, uv) * 1.0;
    float wsum = 1.0;
    for (int i = 0; i < 8; i++){
      float a = float(i) * 0.785398;
      vec2 dir = vec2(cos(a), sin(a));
      sum += texture2D(uTex, uv + dir * r1) * 0.75; wsum += 0.75;
      sum += texture2D(uTex, uv + dir * r2) * 0.5;  wsum += 0.5;
    }
    return sum / wsum;
  }

  float fbm(vec2 p){
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++){
      v += amp * noise(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return v;
  }

  void main(){
    // ONE shared parallax offset, blended from the top-left corner's to the
    // bottom-right corner's across the diagonal — the plate leans, not the type.
    float region = smoothstep(0.35, 0.65, (vUV.x + vUV.y) * 0.5);
    vec2 par = mix(uParTL, uParBR, region);
    vec2 baseUV = vUV + par;

    // Fully resolved: skip the whole dissolve and sample straight through.
    if (uProgress >= 0.999) { gl_FragColor = texture2D(uTex, baseUV); return; }

    float p = uProgress * 1.3;

    vec2 sd = vec2(uSeed * 1.7, uSeed * -1.3);
    vec2 rc = (vUV - 0.5) * vec2(uAspect, 1.0);

    // Soft radial/diagonal bias so the dissolve has a direction to it. Reversed
    // on the way out, so clearing doesn't just replay the entrance backwards.
    float diag = (vUV.x + vUV.y) * 0.5;
    diag = smoothstep(0.18, 0.82, diag);
    diag = mix(diag, 1.0 - diag, uReverse);
    diag += (fbm(vUV * 1.3 + sd) - 0.5) * 0.08;

    // Domain-warped fbm: the cloudy tendrils.
    vec2 warp = vec2(fbm(vUV * 3.2 + sd + uTime * 0.05 + 11.0),
                     fbm(vUV * 3.2 - sd - uTime * 0.04 - 7.0)) - 0.5;
    float turb = fbm(vUV * 5.5 + warp * 1.7 + sd + uTime * 0.06);

    float stipple = noise(vUV * vec2(uAspect, 1.0) * 46.0 + sd * 3.0);

    float mask = mix(diag, turb, 0.28);
    mask = mix(mask, stipple, 0.14);

    // The cursor pulls its neighbourhood forward a little, so the plate resolves
    // first wherever you happen to be looking.
    vec2 cur = (vUV - uCursor) * vec2(uAspect, 1.0);
    float near = 1.0 - smoothstep(0.0, 0.32, length(cur));
    mask -= near * uHover * 0.28;

    float reveal = smoothstep(p + 0.22, p - 0.22, mask);
    if (reveal <= 0.0) discard;

    // 1 just ahead of the front, 0 behind it — drives blur, drift and grow, so
    // everything settles as the front passes rather than on a global clock.
    float blurAmt = smoothstep(p - 0.34, p + 0.22, mask);

    vec2 drift = (-rc * 0.010 + vec2(0.0, 0.006)) * blurAmt;
    float grow = 1.0 + 0.03 * blurAmt;
    vec2 suv = (baseUV - 0.5) / grow + 0.5 + drift;

    float radius = blurAmt * uMaxBlur;
    vec4 tex = blurTex(suv, radius);

    // Thin band riding the front: chromatic split + glow, gone by the time the
    // reveal lands.
    float fw = 0.30;
    float flare = smoothstep(p - fw, p, mask) * smoothstep(p + fw, p, mask);
    flare *= 1.0 - smoothstep(0.8, 1.0, uProgress);

    // The split is 2x the blur radius, so R and B are pulled clean off a glyph
    // whose strokes are thinner than that — which leaves the green channel
    // alone on the stroke and the type reads green rather than fringed. Fine on
    // display type, fatal on body copy, hence uChroma: scale it to the stroke
    // weight, or take it to 0.
    float ab = flare * 2.0 * uTexel.x * uMaxBlur * uChroma;
    if (ab > 0.0001) {
      tex.r = blurTex(suv + vec2(ab, 0.0), radius).r;
      tex.b = blurTex(suv - vec2(ab, 0.0), radius).b;
    }

    vec4 wide = blurTex(suv, uMaxBlur * 1.3);
    float halo = wide.a;

    vec3 rgb = tex.rgb;
    vec3 glow = mix(uEdge, vec3(1.0), 0.3);
    rgb += glow * flare * (tex.a * 0.6 + halo * 0.5);
    float alpha = max(tex.a * reveal, halo * flare * 0.5);

    gl_FragColor = vec4(rgb, alpha);
  }
`;

const UNIFORMS = [
  'uTex',
  'uTexel',
  'uProgress',
  'uMaxBlur',
  'uEdge',
  'uTime',
  'uAspect',
  'uSeed',
  'uParTL',
  'uParBR',
  'uCursor',
  'uHover',
  'uReverse',
  'uChroma',
];

export class RevealGL {
  constructor() {
    this.loc = {};
    this.aPos = 0;
    this.aUV = 0;
    this.tex = null;
    this.texW = 1;
    this.texH = 1;
    this.ok = false;

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
    });

    let gl = null;
    try {
      gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    } catch {
      gl = null;
    }
    // No WebGL (old browser, blocklisted driver, context limit) — `available`
    // stays false and the caller renders its DOM fallback instead.
    if (!gl) return;
    this.gl = gl;

    try {
      this.prog = this.build(VERT, FRAG);
    } catch (err) {
      console.warn('[revealGL] shader failed, falling back to DOM:', err);
      return;
    }

    this.aPos = gl.getAttribLocation(this.prog, 'aPosition');
    this.aUV = gl.getAttribLocation(this.prog, 'aUV');
    UNIFORMS.forEach((u) => {
      this.loc[u] = gl.getUniformLocation(this.prog, u);
    });

    // Fullscreen triangle strip: xy clip space + uv, interleaved.
    const data = new Float32Array([
      -1, -1, 0, 1,
      1, -1, 1, 1,
      -1, 1, 0, 0,
      1, 1, 1, 0,
    ]);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.ok = true;
  }

  get available() {
    return this.ok;
  }

  build(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
      }
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
    }
    return p;
  }

  /** Upload the offscreen text plate (see renderCornerText) as the source texture. */
  setTexture(art) {
    if (!this.ok) return;
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Non-power-of-two source, so no mips and clamped wrapping.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art);
    this.tex = tex;
    this.texW = art.width;
    this.texH = art.height;
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    if (this.ok) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** `chroma` scales the front's chromatic split (1 = as authored, 0 = off). */
  draw(progress, maxBlur, edge, time, aspect, seed, parTL, parBR, cursor, hover, reverse, chroma = 1) {
    if (!this.ok || !this.tex) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 16, 8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.loc.uTex, 0);
    gl.uniform2f(this.loc.uTexel, 1 / this.texW, 1 / this.texH);
    gl.uniform1f(this.loc.uProgress, progress);
    gl.uniform1f(this.loc.uMaxBlur, maxBlur);
    gl.uniform3f(this.loc.uEdge, edge[0], edge[1], edge[2]);
    gl.uniform1f(this.loc.uTime, time);
    gl.uniform1f(this.loc.uAspect, aspect);
    gl.uniform1f(this.loc.uSeed, seed);
    gl.uniform2f(this.loc.uParTL, parTL[0], parTL[1]);
    gl.uniform2f(this.loc.uParBR, parBR[0], parBR[1]);
    gl.uniform2f(this.loc.uCursor, cursor[0], cursor[1]);
    gl.uniform1f(this.loc.uHover, hover);
    gl.uniform1f(this.loc.uReverse, reverse);
    gl.uniform1f(this.loc.uChroma, chroma);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    this.canvas.remove();
    if (!this.ok) return;
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.ok = false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** One semi-implicit Euler step of a damped spring. Returns [pos, vel]. */
export function springStep(pos, vel, target, k, damp, dt) {
  const c = 2 * Math.sqrt(k) * damp;
  const accel = -k * (pos - target) - c * vel;
  const v = vel + accel * dt;
  return [pos + v * dt, v];
}

/** '#rgb' | '#rrggbb' → [r, g, b] in 0..1, for uniform3f. */
export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Draw both corner blocks to one transparent offscreen canvas: `top` flush to
 * the top-left, `bottom` flush to the bottom-right. Lines are laid out as
 * given — no auto-wrap — but the type size shrinks until the widest line fits
 * the column, so a long phrase can't run into the opposite corner.
 */
export function renderCornerText(o) {
  const dpr = o.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.max(1, Math.round(o.cardW));
  const cssH = Math.max(1, Math.round(o.cardH));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = o.fill;
  ctx.textBaseline = 'top';

  const pad = Math.round(cssW * (o.padFrac ?? 0.035));
  const maxLineW = cssW * (o.columnFrac ?? 0.52);
  const top = o.top ?? [];
  const bottom = o.bottom ?? [];
  const allLines = [...top, ...bottom];
  if (allLines.length === 0) return canvas;

  const minFont = o.minFont ?? 15;
  let fontSize = Math.max(o.baseFont ?? 24, Math.min(o.maxFont ?? 40, cssW * (o.fontFrac ?? 0.03)));
  for (let i = 0; i < 24; i++) {
    ctx.font = `${o.weight ?? 500} ${fontSize}px ${o.font}`;
    const widest = Math.max(...allLines.map((l) => ctx.measureText(l).width));
    if (widest <= maxLineW || fontSize <= minFont) break;
    fontSize -= 1;
  }
  const lineH = fontSize * (o.lineHeight ?? 1.42);
  ctx.font = `${o.weight ?? 500} ${fontSize}px ${o.font}`;

  ctx.textAlign = 'left';
  top.forEach((line, i) => {
    ctx.fillText(line, pad, pad + i * lineH);
  });

  ctx.textAlign = 'right';
  const bottomBlockH = bottom.length * lineH;
  const startY = cssH - pad - bottomBlockH;
  bottom.forEach((line, i) => {
    ctx.fillText(line, cssW - pad, startY + i * lineH);
  });

  return canvas;
}
