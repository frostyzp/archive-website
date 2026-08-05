import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { DialStore, useDialKit } from 'dialkit';
import * as THREE from 'three';
import { INK, inkA } from './colors';
import { GLYPH_GLSL, RAMPS, buildGlyphAtlas } from './asciiAtlas';

/**
 * ASCII on 3D — a side-by-side of the two ways to do it, because they are not
 * variations on one technique, they are different pictures.
 *
 *   SCREEN — the scene is rendered to a texture, then a fullscreen pass carves
 *   it into a character grid locked to the viewport. Glyphs never rotate or
 *   deform; the object turns "underneath" a fixed sheet of text. This is the
 *   classic ASCII-renderer look, and the only one that can describe a whole
 *   scene (many objects, depth, shadow) at once.
 *
 *   SURFACE — the character grid lives in the mesh's own UV space, so it is
 *   painted ON the object: glyphs wrap it, bunch toward the poles, and
 *   foreshorten at glancing angles. The text becomes a material rather than a
 *   filter, which is the one that reads as "ASCII animation on a 3D surface".
 *
 * Both share one glyph atlas (see asciiAtlas.js) — that shared atlas is the
 * actual answer to "what's the best method": rasterize the characters once,
 * then let a shader index them. It is what lets either mode run tens of
 * thousands of cells per frame instead of the ~6k that a DOM-based approach
 * like three's AsciiEffect tops out at.
 *
 * Open with ?dial=1 to get the tuning panel.
 */

const BG = '#0B0B0C';
const PANEL = 'ASCII 3D';

/**
 * Ordered so 1–9 and the [ ] cycle have a stable mapping. The last two are
 * polyhedra, whose UVs are per-face islands rather than one continuous sheet —
 * in SURFACE mode that shows up as each facet carrying its own little grid,
 * which is a good way to see how much that mode depends on the unwrap.
 */
const SHAPES = [
  { id: 'knot', label: 'Knot', geometry: () => <torusKnotGeometry args={[1.15, 0.36, 260, 36]} /> },
  { id: 'sphere', label: 'Sphere', geometry: () => <sphereGeometry args={[1.7, 128, 80]} /> },
  { id: 'torus', label: 'Torus', geometry: () => <torusGeometry args={[1.35, 0.52, 64, 160]} /> },
  { id: 'box', label: 'Box', geometry: () => <boxGeometry args={[2.4, 2.4, 2.4, 8, 8, 8]} /> },
  { id: 'cone', label: 'Cone', geometry: () => <coneGeometry args={[1.5, 2.8, 96, 24]} /> },
  { id: 'cylinder', label: 'Cylinder', geometry: () => <cylinderGeometry args={[1.2, 1.2, 2.6, 96, 24]} /> },
  { id: 'capsule', label: 'Capsule', geometry: () => <capsuleGeometry args={[1.0, 1.6, 32, 96]} /> },
  { id: 'ico', label: 'Ico', geometry: () => <icosahedronGeometry args={[1.8, 0]} /> },
  { id: 'dodec', label: 'Dodec', geometry: () => <dodecahedronGeometry args={[1.8, 0]} /> },
];

/** Animated fields available to SURFACE mode. Index must match the shader. */
const FIELDS = ['drift', 'rings', 'scan', 'pulse', 'weave'];

/**
 * The panel, kept as a constant so Reset can flatten it back into DialStore and
 * Randomize can walk the registered controls.
 */
const DIALS = {
  spin: [0.35, 0, 2, 0.05],
  glyphs: {
    charset: { type: 'select', options: Object.keys(RAMPS).concat('custom'), default: 'classic' },
    custom: { type: 'text', default: '', placeholder: 'light → heavy, e.g.  .oO@' },
    glyphScale: [0.72, 0.3, 0.95, 0.01],
  },
  screen: {
    cell: [11, 4, 40, 1],
    edge: [1.6, 0, 6, 0.1],
    tint: [0, 0, 1, 0.05],
  },
  surface: {
    cols: [140, 20, 400, 4],
    rows: [70, 10, 200, 2],
    field: { type: 'select', options: FIELDS, default: 'drift' },
    speed: [0.35, 0, 2, 0.05],
    noiseMix: [0.55, 0, 1, 0.05],
    noiseScale: [4, 0.5, 16, 0.5],
    cutout: true,
  },
  look: {
    contrast: [1.15, 0.2, 3, 0.05],
    invert: false,
    ink: { type: 'color', default: INK },
    bg: { type: 'color', default: BG },
  },
  randomize: { type: 'action', label: '⚄ Randomize' },
  reset: { type: 'action', label: '↺ Reset' },
};

/** Flatten DIALS into the dotted paths DialStore addresses values by. */
function dialDefaults(config, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) out[path] = value[0];
    else if (value === null || typeof value !== 'object') out[path] = value;
    else if (value.type === 'action') continue;
    else if (value.type) out[path] = value.default;
    else dialDefaults(value, path, out);
  }
  return out;
}

const DEFAULTS = dialDefaults(DIALS);

/** DialKit namespaces panels by instance, so find ours by name rather than id. */
function panelId() {
  return DialStore.getPanels().find((p) => p.name === PANEL)?.id ?? null;
}

function writeDials(values) {
  const id = panelId();
  if (!id) return;
  Object.entries(values).forEach(([path, value]) => DialStore.updateValue(id, path, value));
}

/**
 * Randomize by walking the controls DialKit actually registered, so every dial
 * is respected on its own declared range and nothing has to be listed twice.
 * Colours are left alone — random ink/bg pairs are usually unreadable.
 */
function randomizeDials() {
  const id = panelId();
  const panel = id && DialStore.getPanel(id);
  if (!panel) return;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const walk = (controls) =>
    controls.forEach((c) => {
      if (c.type === 'folder') return walk(c.children || []);
      if (c.type === 'slider') {
        const { min = 0, max = 1, step = 0.01 } = c;
        const raw = min + Math.random() * (max - min);
        DialStore.updateValue(id, c.path, +(Math.round(raw / step) * step).toFixed(4));
      } else if (c.type === 'toggle') {
        DialStore.updateValue(id, c.path, Math.random() < 0.5);
      } else if (c.type === 'select' && c.options?.length) {
        const options = c.options.map((o) => (typeof o === 'string' ? o : o.value)).filter((o) => o !== 'custom');
        DialStore.updateValue(id, c.path, pick(options));
      }
    });
  walk(panel.controls);
}

/* ------------------------------------------------------------------ subject */

/** The geometry both modes look at. Material is supplied by the mode. */
function Subject({ shape, spin, children }) {
  const ref = useRef();
  useFrame((_, dt) => {
    if (!ref.current) return;
    // dt is clamped by R3F, so a backgrounded tab doesn't snap the rotation.
    ref.current.rotation.y += dt * spin;
    ref.current.rotation.x += dt * spin * 0.34;
  });
  return (
    <mesh ref={ref}>
      {shape.geometry()}
      {children}
    </mesh>
  );
}

/* ----------------------------------------------------------- screen-space */

const SCREEN_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uScene;
  uniform vec2 uResolution;
  uniform float uCell;      // px per character cell
  uniform float uEdge;      // edge sensitivity; 0 disables stroke glyphs
  uniform float uContrast;
  uniform float uTint;      // 0 = flat ink, 1 = take the scene's hue
  uniform float uInvert;
  uniform vec3 uInk;
  uniform vec3 uBg;

  ${GLYPH_GLSL}

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    // One sample per cell, taken at the cell's centre, so every fragment inside
    // a cell agrees on which character it is drawing.
    vec2 cellId = floor(gl_FragCoord.xy / uCell);
    vec2 centre = (cellId + 0.5) * uCell / uResolution;
    vec3 src = texture2D(uScene, centre).rgb;
    float l = clamp(lum(src) * uContrast, 0.0, 1.0);
    if (uInvert > 0.5) l = 1.0 - l;

    // Sobel across neighbouring CELLS (not pixels) — the gradient we care about
    // is the one visible at character resolution.
    vec2 o = uCell / uResolution;
    float tl = lum(texture2D(uScene, centre + vec2(-o.x,  o.y)).rgb);
    float tc = lum(texture2D(uScene, centre + vec2( 0.0,  o.y)).rgb);
    float tr = lum(texture2D(uScene, centre + vec2( o.x,  o.y)).rgb);
    float ml = lum(texture2D(uScene, centre + vec2(-o.x,  0.0)).rgb);
    float mr = lum(texture2D(uScene, centre + vec2( o.x,  0.0)).rgb);
    float bl = lum(texture2D(uScene, centre + vec2(-o.x, -o.y)).rgb);
    float bc = lum(texture2D(uScene, centre + vec2( 0.0, -o.y)).rgb);
    float br = lum(texture2D(uScene, centre + vec2( o.x, -o.y)).rgb);
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
    float mag = length(vec2(gx, gy));

    // Contours get a stroke glyph aligned to the edge, interiors get the ramp.
    // This split is the single biggest quality difference between ASCII that
    // describes a shape and ASCII that just dithers it.
    float idx;
    if (uEdge > 0.0 && mag * uEdge > 1.0) {
      float ang = atan(gy, gx) + 1.5707963;          // edge ⟂ gradient
      float bin = mod(floor(ang / 0.7853982 + 0.5), 4.0);
      idx = uRampCount + bin;
    } else {
      idx = rampIndex(l);
    }

    float mask = glyph(idx, fract(gl_FragCoord.xy / uCell));
    vec3 tint = src / max(lum(src), 0.001);
    vec3 ink = mix(uInk, uInk * tint, uTint);
    gl_FragColor = vec4(mix(uBg, ink, mask), 1.0);
  }
`;

const QUAD_VERT = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Renders the scene into an offscreen target, then draws a fullscreen quad that
 * reads it back as characters. Returns null — it contributes no scene content,
 * it only takes over the render loop (useFrame priority ≥ 1 stops R3F's
 * automatic render, so we own both passes from here).
 */
function ScreenPass({ atlas, cfg }) {
  const { gl, scene, camera, size } = useThree();
  const dpr = gl.getPixelRatio();

  const target = useMemo(
    () =>
      new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        samples: 4, // MSAA the source so edges are clean before we quantize
      }),
    []
  );

  const { quadScene, quadCamera, material } = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SCREEN_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uScene: { value: null },
        uAtlas: { value: atlas.texture },
        uCount: { value: atlas.count },
        uRampCount: { value: atlas.rampCount },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCell: { value: 12 },
        uEdge: { value: 1 },
        uContrast: { value: 1 },
        uTint: { value: 0 },
        uInvert: { value: 0 },
        uInk: { value: new THREE.Color(INK) },
        uBg: { value: new THREE.Color(BG) },
      },
    });
    const quadScene = new THREE.Scene();
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    return { quadScene, quadCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), material };
  }, [atlas]);

  useEffect(() => {
    const w = Math.max(1, Math.floor(size.width * dpr));
    const h = Math.max(1, Math.floor(size.height * dpr));
    target.setSize(w, h);
    material.uniforms.uResolution.value.set(w, h);
  }, [size, dpr, target, material]);

  useEffect(() => () => target.dispose(), [target]);

  useFrame(() => {
    const u = material.uniforms;
    u.uScene.value = target.texture;
    u.uCell.value = Math.max(2, cfg.cell * dpr);
    u.uEdge.value = cfg.edge;
    u.uContrast.value = cfg.contrast;
    u.uTint.value = cfg.tint;
    u.uInvert.value = cfg.invert ? 1 : 0;
    u.uInk.value.set(cfg.ink);
    u.uBg.value.set(cfg.bg);

    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.render(quadScene, quadCamera);
  }, 1);

  return null;
}

/* ---------------------------------------------------------- surface-space */

const SURFACE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SURFACE_FRAG = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vNormal;

  uniform vec2 uGrid;        // character cells across the UV square
  uniform float uTime;
  uniform float uSpeed;
  uniform float uNoiseMix;   // 0 = pure lighting, 1 = pure animated field
  uniform float uNoiseScale;
  uniform float uContrast;
  uniform float uCutout;     // 1 = discard blank cells, 0 = fill them with bg
  uniform float uInvert;
  uniform float uField;      // index into the field list, see FIELDS
  uniform vec3 uInk;
  uniform vec3 uBg;

  ${GLYPH_GLSL}

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  }

  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return s;
  }

  // All of these read the CELL's uv, never the fragment's, so a cell resolves to
  // exactly one character instead of tearing across a ramp step.
  float fieldValue(vec2 c, float t) {
    if (uField < 0.5) return fbm(vec3(c * uNoiseScale, t));                        // drift
    if (uField < 1.5) return 0.5 + 0.5 * sin(distance(c, vec2(0.5)) * uNoiseScale * 3.0 - t * 3.0); // rings
    if (uField < 2.5) {                                                            // scan
      float p = fract(c.y - t * 0.35);
      return smoothstep(0.0, 0.3, p) * smoothstep(0.6, 0.3, p);
    }
    if (uField < 3.5) return 0.5 + 0.5 * sin(t * 2.0 + c.x * uNoiseScale);         // pulse
    return 0.5 + 0.5 * sin(c.x * uNoiseScale * 2.0 + t) * cos(c.y * uNoiseScale * 2.0 - t); // weave
  }

  void main() {
    // The grid is defined in UV space, so it travels with the surface — this is
    // the whole difference from the screen pass.
    vec2 cellId = floor(vUv * uGrid);
    vec2 cellUv = (cellId + 0.5) / uGrid;

    // Lighting is still per-fragment (see the note in the page comment) — it
    // varies slowly enough to be stable at these grid densities.
    float light = clamp(dot(normalize(vNormal), normalize(vec3(0.4, 0.7, 0.65))) * 0.5 + 0.5, 0.0, 1.0);
    float field = fieldValue(cellUv, uTime * uSpeed);
    float v = clamp(mix(light, field, uNoiseMix) * uContrast, 0.0, 1.0);
    if (uInvert > 0.5) v = 1.0 - v;

    float mask = glyph(rampIndex(v), fract(vUv * uGrid));
    if (uCutout > 0.5 && mask < 0.4) discard;
    gl_FragColor = vec4(mix(uBg, uInk, mask), 1.0);
  }
`;

function SurfaceMaterial({ atlas, cfg }) {
  const ref = useRef();

  const uniforms = useMemo(
    () => ({
      uAtlas: { value: atlas.texture },
      uCount: { value: atlas.count },
      uRampCount: { value: atlas.rampCount },
      uGrid: { value: new THREE.Vector2(120, 60) },
      uTime: { value: 0 },
      uSpeed: { value: 0.3 },
      uNoiseMix: { value: 0.5 },
      uNoiseScale: { value: 4 },
      uContrast: { value: 1 },
      uCutout: { value: 1 },
      uInvert: { value: 0 },
      uField: { value: 0 },
      uInk: { value: new THREE.Color(INK) },
      uBg: { value: new THREE.Color(BG) },
    }),
    [atlas]
  );

  useFrame((_, dt) => {
    const u = ref.current?.uniforms;
    if (!u) return;
    u.uTime.value += dt;
    u.uGrid.value.set(cfg.cols, cfg.rows);
    u.uSpeed.value = cfg.speed;
    u.uNoiseMix.value = cfg.noiseMix;
    u.uNoiseScale.value = cfg.noiseScale;
    u.uContrast.value = cfg.contrast;
    u.uCutout.value = cfg.cutout ? 1 : 0;
    u.uInvert.value = cfg.invert ? 1 : 0;
    u.uField.value = Math.max(0, FIELDS.indexOf(cfg.field));
    u.uInk.value.set(cfg.ink);
    u.uBg.value.set(cfg.bg);
  });

  return (
    <shaderMaterial
      ref={ref}
      vertexShader={SURFACE_VERT}
      fragmentShader={SURFACE_FRAG}
      uniforms={uniforms}
      side={THREE.DoubleSide}
    />
  );
}

/* -------------------------------------------------------------------- page */

export default function AsciiExperiment() {
  const [mode, setMode] = useState('surface');
  const [shapeIndex, setShapeIndex] = useState(0);
  const [atlas, setAtlas] = useState(null);

  // Shape and mode are plain state rather than dials: they have on-screen
  // controls and keyboard shortcuts, and a second source of truth in the panel
  // would only need syncing back the other way.
  const cycleShape = useCallback((step) => {
    setShapeIndex((i) => (i + step + SHAPES.length) % SHAPES.length);
  }, []);

  const cfg = useDialKit(PANEL, DIALS, {
    onAction: (action) => {
      if (action === 'randomize') {
        randomizeDials();
        setShapeIndex(Math.floor(Math.random() * SHAPES.length));
      } else if (action === 'reset') {
        writeDials(DEFAULTS);
        setShapeIndex(0);
      }
    },
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Otherwise typing a custom ramp into the panel would fire shortcuts.
      const el = e.target;
      if (el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName)) return;
      const digit = Number(e.key);
      if (digit >= 1 && digit <= SHAPES.length) return setShapeIndex(digit - 1);
      if (e.key === ']') return cycleShape(1);
      if (e.key === '[') return cycleShape(-1);
      if (e.key.toLowerCase() === 'm') return setMode((m) => (m === 'surface' ? 'screen' : 'surface'));
      if (e.key.toLowerCase() === 'r') {
        randomizeDials();
        setShapeIndex(Math.floor(Math.random() * SHAPES.length));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycleShape]);

  // Rebuilding on charset/scale keeps the atlas a live dial rather than a
  // startup constant. The old texture is released as the new one lands.
  const ramp = (cfg.glyphs.charset === 'custom' ? cfg.glyphs.custom : RAMPS[cfg.glyphs.charset]) || RAMPS.classic;
  const glyphScale = cfg.glyphs.glyphScale;
  useEffect(() => {
    let alive = true;
    const safeRamp = ramp.length >= 2 ? ramp : RAMPS.classic;
    buildGlyphAtlas({ ramp: safeRamp, glyphScale }).then((next) => {
      if (!alive) return next.texture.dispose();
      setAtlas((prev) => {
        if (prev && prev.texture !== next.texture) prev.texture.dispose();
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [ramp, glyphScale]);

  const shape = SHAPES[shapeIndex];
  const screenCfg = { ...cfg.screen, ...cfg.look };
  const surfaceCfg = { ...cfg.surface, ...cfg.look };

  return (
    <div style={{ position: 'fixed', inset: 0, background: cfg.look.bg, color: INK }}>
      {atlas && (
        <Canvas
          camera={{ position: [0, 0, 6], fov: 45 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <color attach="background" args={[mode === 'screen' ? '#000000' : cfg.look.bg]} />
          {mode === 'screen' ? (
            <>
              <ambientLight intensity={0.35} />
              <directionalLight position={[3, 4, 5]} intensity={2.4} />
              <directionalLight position={[-4, -2, -3]} intensity={0.7} color="#6f8cff" />
              <Subject shape={shape} spin={cfg.spin}>
                <meshStandardMaterial color="#ffffff" roughness={0.35} metalness={0.1} />
              </Subject>
              <ScreenPass atlas={atlas} cfg={screenCfg} />
            </>
          ) : (
            <Subject shape={shape} spin={cfg.spin}>
              <SurfaceMaterial atlas={atlas} cfg={surfaceCfg} />
            </Subject>
          )}
          <OrbitControls enablePan={false} minDistance={3} maxDistance={14} />
        </Canvas>
      )}

      <Chrome
        mode={mode}
        onMode={setMode}
        shapeIndex={shapeIndex}
        onShape={setShapeIndex}
        ready={!!atlas}
      />
    </div>
  );
}

const LABEL = {
  fontFamily: "'OT Brut Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
};

function Chip({ active, onClick, children, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        ...LABEL,
        cursor: 'pointer',
        padding: '7px 12px',
        color: active ? BG : INK,
        background: active ? INK : 'transparent',
        border: `1px solid ${inkA(active ? 1 : 0.32)}`,
        borderRadius: 2,
      }}
    >
      {children}
    </button>
  );
}

function Chrome({ mode, onMode, shapeIndex, onShape, ready }) {
  return (
    <>
      <div style={{ position: 'absolute', top: 22, left: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Chip active={mode === 'surface'} onClick={() => onMode('surface')} title="M">
            On surface
          </Chip>
          <Chip active={mode === 'screen'} onClick={() => onMode('screen')} title="M">
            Screen space
          </Chip>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 460 }}>
          {SHAPES.map((s, i) => (
            <Chip key={s.id} active={i === shapeIndex} onClick={() => onShape(i)} title={`${i + 1}`}>
              {s.label}
            </Chip>
          ))}
        </div>
      </div>

      <p
        style={{
          ...LABEL,
          position: 'absolute',
          bottom: 20,
          left: 24,
          margin: 0,
          color: inkA(0.42),
          textTransform: 'none',
          letterSpacing: '0.06em',
        }}
      >
        {ready ? '1–9 shape · [ ] cycle · M mode · R randomize · drag to orbit · ?dial=1 for dials' : 'Building glyph atlas…'}
      </p>

      <p
        style={{
          ...LABEL,
          position: 'absolute',
          bottom: 20,
          right: 24,
          margin: 0,
          maxWidth: 280,
          textAlign: 'right',
          lineHeight: 1.7,
          textTransform: 'none',
          letterSpacing: '0.04em',
          color: inkA(0.42),
        }}
      >
        {mode === 'surface'
          ? 'Grid lives in UV space — glyphs wrap and foreshorten with the mesh.'
          : 'Grid locked to the viewport — scene sampled per cell, edges get stroke glyphs.'}
      </p>
    </>
  );
}
