/**
 * Noise / grain prototyping tab.
 *
 * Each tile = a dark gradient + an animated SVG-turbulence noise overlay.
 * Uses the shared GrainOverlay from ./noise.jsx.
 */

import { GrainOverlay } from './noise.jsx';

// A consistent base so noise reads the same across variants.
const BASE_GRADIENT = 'linear-gradient(to top, #2a1a4a, #111 70%)';

// Animation speeds per tile. `steps` = how many discrete jumps per loop.
// Smaller duration = grain shimmers faster.
const VARIATIONS = [
  {
    name: 'Tight grain · screen',
    sub: 'freq 2.5 / 35% / screen / 120px / 0.6s',
    noise: { baseFrequency: 2.5, numOctaves: 1 },
    opacity: 0.35,
    blend: 'screen',
    tile: 120,
    duration: 0.6,
    steps: 10,
  },
  {
    name: 'Tight grain · LOUD',
    sub: 'freq 2.5 / 70% / screen / 120px / 0.4s',
    noise: { baseFrequency: 2.5, numOctaves: 1 },
    opacity: 0.70,
    blend: 'screen',
    tile: 120,
    duration: 0.4,
    steps: 12,
  },
  {
    name: 'Tight · plus-lighter',
    sub: 'freq 2.5 / 50% / plus-lighter / 0.5s',
    noise: { baseFrequency: 2.5, numOctaves: 1 },
    opacity: 0.50,
    blend: 'plus-lighter',
    tile: 120,
    duration: 0.5,
    steps: 10,
  },
  {
    name: 'Medium · overlay',
    sub: 'freq 0.9 / 60% / overlay / 200px / 1s',
    noise: { baseFrequency: 0.9, numOctaves: 2 },
    opacity: 0.60,
    blend: 'overlay',
    tile: 200,
    duration: 1.0,
    steps: 8,
  },
  {
    name: 'Medium · screen',
    sub: 'freq 0.9 / 45% / screen / 200px / 1.2s',
    noise: { baseFrequency: 0.9, numOctaves: 2 },
    opacity: 0.45,
    blend: 'screen',
    tile: 200,
    duration: 1.2,
    steps: 8,
  },
  {
    name: 'Cloudy turbulence',
    sub: 'turbulence / 0.4 / 40% / screen / 2s',
    noise: { type: 'turbulence', baseFrequency: 0.4, numOctaves: 3 },
    opacity: 0.40,
    blend: 'screen',
    tile: 240,
    duration: 2.0,
    steps: 6,
  },
  {
    name: 'Film grain',
    sub: 'freq 1.8 / 80% / overlay / 100px / 0.3s',
    noise: { baseFrequency: 1.8, numOctaves: 1 },
    opacity: 0.80,
    blend: 'overlay',
    tile: 100,
    duration: 0.3,
    steps: 12,
  },
  {
    name: 'Crushed shadows',
    sub: 'freq 1.2 / 70% / multiply / 0.8s',
    noise: { baseFrequency: 1.2, numOctaves: 2 },
    opacity: 0.70,
    blend: 'multiply',
    tile: 200,
    duration: 0.8,
    steps: 10,
  },
  {
    name: 'Sparkle (high-pass)',
    sub: 'freq 3.5 / 60% / lighten / 80px / 0.25s',
    noise: { baseFrequency: 3.5, numOctaves: 1 },
    opacity: 0.60,
    blend: 'lighten',
    tile: 80,
    duration: 0.25,
    steps: 14,
  },
  {
    name: 'Stacked grain',
    sub: 'fine 50% screen 0.4s + coarse 25% overlay 1.5s',
    layers: [
      { noise: { baseFrequency: 2.5, numOctaves: 1 }, opacity: 0.50, blend: 'screen', tile: 100, duration: 0.4, steps: 12 },
      { noise: { baseFrequency: 0.5, numOctaves: 2 }, opacity: 0.25, blend: 'overlay', tile: 240, duration: 1.5, steps: 6 },
    ],
  },
  {
    name: 'Heavy paper',
    sub: 'freq 0.85 / 90% / overlay / 1.5s slow',
    noise: { baseFrequency: 0.85, numOctaves: 2 },
    opacity: 0.90,
    blend: 'overlay',
    tile: 240,
    duration: 1.5,
    steps: 8,
  },
  {
    name: 'Whisper · 15%',
    sub: 'freq 3.0 / 15% / overlay / 0.5s subtle shimmer',
    noise: { baseFrequency: 3.0, numOctaves: 1 },
    opacity: 0.15,
    blend: 'overlay',
    tile: 150,
    duration: 0.5,
    steps: 10,
  },
];

function NoiseSquare({ variant }) {
  const layers = variant.layers || [
    {
      noise: variant.noise,
      opacity: variant.opacity,
      blend: variant.blend,
      tile: variant.tile ?? 200,
      duration: variant.duration ?? 0.8,
      steps: variant.steps ?? 10,
    },
  ];

  return (
    <div style={st.cell}>
      <div style={st.square}>
        <div style={{ ...st.layer, background: BASE_GRADIENT }} />
        <GrainOverlay layers={layers} />
      </div>
      <div style={st.labels}>
        <div style={st.name}>{variant.name}</div>
        <div style={st.sub}>{variant.sub}</div>
      </div>
    </div>
  );
}

export default function NoiseLab() {
  return (
    <div style={st.root}>
      <div style={st.intro}>
        <h2 style={st.title}>Noise / Grain Lab</h2>
        <p style={st.blurb}>
          Each tile = same dark gradient + an animated noise overlay (oversized,
          translated in random steps so the grain shimmers). Slower duration =
          calmer; smaller steps = chunkier jitter.
        </p>
      </div>
      <div style={st.grid}>
        {VARIATIONS.map((v) => (
          <NoiseSquare key={v.name} variant={v} />
        ))}
      </div>
    </div>
  );
}

const st = {
  root: {
    width: '100%',
    minHeight: '100vh',
    padding: '80px 40px 80px',
    background: '#0a0a0a',
    color: '#e5e5e5',
    fontFamily: 'var(--font-primary, system-ui, sans-serif)',
  },
  intro: {
    maxWidth: 720,
    margin: '0 auto 40px',
    textAlign: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    marginBottom: 8,
  },
  blurb: {
    fontSize: 13,
    fontFamily: 'var(--font-mono)',
    opacity: 0.5,
    lineHeight: 1.5,
  },
  grid: {
    maxWidth: 1100,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 24,
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  square: {
    position: 'relative',
    width: '100%',
    aspectRatio: '1 / 1',
    borderRadius: 4,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  layer: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  },
  labels: {
    paddingLeft: 2,
  },
  name: {
    fontSize: 12,
    fontWeight: 500,
    color: '#e5e5e5',
    fontFamily: 'var(--font-mono)',
  },
  sub: {
    marginTop: 3,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'var(--font-mono)',
    lineHeight: 1.4,
  },
};
