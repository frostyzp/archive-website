import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

/**
 * A rotating 3D cube whose six faces are mosaics of confession notes.
 *
 * The note set is split evenly across the six faces (total / 6 per face), and
 * each face lays its slice out in a grid. Every note is its own mesh so R3F's
 * raycaster can report exactly which one was clicked — the parent turns that
 * into the same close-up Lightbox the INDEX grid uses.
 *
 * The source note images (`/confession_notes_2/*.webp`) are torn-paper cutouts
 * with a real alpha channel (transparent around the paper). We honor that: each
 * plane is sized to the note's own aspect ratio ("contain", never cropped) and
 * the material alpha-tests, so the notes read as paper cutouts sitting on the
 * dark cube — exactly like the grid on the rest of the site — rather than solid
 * white tiles. Images are same-origin, so they upload to WebGL without CORS.
 */

const CUBE_HALF = 2.4; //   half the cube's edge length, in world units

// Notes are drawn LARGER than their grid slot so their edges overlap neighbours
// (a negative-margin collage). A per-note forward z-stagger keeps those overlaps
// cleanly layered instead of z-fighting on the coplanar face, and a little
// tilt + jitter make the face read as a pinned paper pile rather than a grid.
const OVERLAP_X = 0.7; //  max horizontal spill beyond a cell (side overlap)
const OVERLAP_Y = 0.5; //  vertical spill — notes fill + overlap the row height
const CELL_ASPECT = 1.4; // slots lean landscape to match the (wide) note photos
const MAX_TILT = 0.05; //  rad — random resting rotation per note (~2.9°)
const JITTER = 0.05; //    fraction of a cell of positional wobble
const Z_STEP = 0.003; //   per-note forward stagger (shingle by reading order)

/** Deterministic 0..1 hash so tilt/jitter stay stable across re-renders. */
function rand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Local XY plane → each cube face. z points out of the face after the rotation,
// so a tile's local +z hover-lift always pops toward the viewer.
const FACES = [
  { key: 'pz', position: [0, 0, CUBE_HALF], rotation: [0, 0, 0] },
  { key: 'nz', position: [0, 0, -CUBE_HALF], rotation: [0, Math.PI, 0] },
  { key: 'px', position: [CUBE_HALF, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { key: 'nx', position: [-CUBE_HALF, 0, 0], rotation: [0, -Math.PI / 2, 0] },
  { key: 'py', position: [0, CUBE_HALF, 0], rotation: [-Math.PI / 2, 0, 0] },
  { key: 'ny', position: [0, -CUBE_HALF, 0], rotation: [Math.PI / 2, 0, 0] },
];

/** Split notes across the six faces; each tile gets a centered cell box. */
function buildLayout(notes) {
  const perFace = Math.max(1, Math.ceil(notes.length / 6));
  return FACES.map((face, fi) => {
    const slice = notes.slice(fi * perFace, (fi + 1) * perFace);
    const n = slice.length;
    if (n === 0) return { ...face, tiles: [] };
    // Landscape-leaning cells (the note photos are mostly wide), so filling the
    // row height doesn't blow the width out and re-open vertical gaps.
    const cols = Math.max(1, Math.ceil(Math.sqrt(n / CELL_ASPECT)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cellW = (2 * CUBE_HALF) / cols;
    const cellH = (2 * CUBE_HALF) / rows;
    const tiles = slice.map((note, k) => {
      const c = k % cols;
      const r = Math.floor(k / cols);
      const seed = fi * 997 + k;
      const jx = (rand(seed + 13) - 0.5) * 2 * JITTER * cellW;
      const jy = (rand(seed + 29) - 0.5) * 2 * JITTER * cellH;
      const x = -CUBE_HALF + cellW * (c + 0.5) + jx;
      const y = CUBE_HALF - cellH * (r + 0.5) + jy;
      const tilt = (rand(seed) - 0.5) * 2 * MAX_TILT;
      const baseZ = k * Z_STEP; // later notes sit slightly in front → shingle
      // `cell` = the slot; NoteTile sizes the note larger than it (filling the
      // row height + spilling sideways) so edges overlap. Also the click catcher.
      return { note, k, position: [x, y, 0], cell: [cellW, cellH], tilt, baseZ };
    });
    return { ...face, tiles };
  });
}

/**
 * Load a note image as a texture, keeping its real aspect ratio. Returns null
 * until the bitmap decodes so tiles pop in as their art arrives.
 */
function useNoteTexture(url) {
  const [state, setState] = useState(null); // { texture, aspect }
  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (t) => {
        if (!alive) {
          t.dispose?.();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        const iw = t.image?.width || 1;
        const ih = t.image?.height || 1;
        setState({ texture: t, aspect: iw / ih });
      },
      undefined,
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => () => state?.texture?.dispose?.(), [state]);
  return state;
}

/** One note cutout on a face: hover lifts + straightens it, a non-drag click selects it. */
function NoteTile({ note, position, cell, tilt, baseZ, onSelect, dragRef }) {
  const paperRef = useRef(null);
  const hovered = useRef(false);
  const [cellW, cellH] = cell;
  const tex = useNoteTexture(note.image);

  useFrame(() => {
    const m = paperRef.current;
    if (!m) return;
    const targetScale = hovered.current ? 1.16 : 1;
    m.scale.x += (targetScale - m.scale.x) * 0.2;
    m.scale.y += (targetScale - m.scale.y) * 0.2;
    // Hover lifts the note clear of the pile (well in front of every stagger step).
    const targetZ = hovered.current ? baseZ + 0.45 : baseZ;
    m.position.z += (targetZ - m.position.z) * 0.2;
    // …and straightens it as it lifts.
    const targetTilt = hovered.current ? 0 : tilt;
    m.rotation.z += (targetTilt - m.rotation.z) * 0.2;
  });

  // Fill the row height (no top/bottom margin → rows overlap), then spill
  // sideways by the aspect, clamped so very wide notes don't run away. This
  // oversizes each note past its cell so its edges overlap its neighbours.
  const aspect = tex?.aspect || 1;
  let h = cellH * (1 + OVERLAP_Y);
  let w = h * aspect;
  const maxW = cellW * (1 + OVERLAP_X);
  if (w > maxW) {
    w = maxW;
    h = w / aspect;
  }

  const handlers = {
    onPointerOver: (e) => {
      e.stopPropagation();
      hovered.current = true;
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      hovered.current = false;
      document.body.style.cursor = '';
    },
    onClick: (e) => {
      e.stopPropagation();
      if (dragRef.current?.dragged) return; // a rotate drag, not a click
      onSelect?.(note);
    },
  };

  return (
    <group position={position}>
      {/* Invisible full-cell catcher behind the pile: fills the gaps between
          overlapping cutouts so selecting a note stays forgiving while the cube
          auto-rotates. The visible paper (in front) wins the raycast when hit,
          so overlaps select whichever note is on top. */}
      <mesh position={[0, 0, -0.05]} {...handlers}>
        <planeGeometry args={[cellW, cellH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Visible paper cutout. alphaTest keeps the transparent margin out of the
          depth buffer, so overlapping papers layer by their z-stagger. */}
      {tex ? (
        <mesh ref={paperRef} position={[0, 0, baseZ]} rotation={[0, 0, tilt]} {...handlers}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={tex.texture} toneMapped={false} transparent alphaTest={0.5} />
        </mesh>
      ) : null}
    </group>
  );
}

function CubeFaces({ notes, onSelect, dragRef }) {
  const faces = useMemo(() => buildLayout(notes), [notes]);
  return (
    <>
      {faces.map((face) => (
        <group key={face.key} position={face.position} rotation={face.rotation}>
          {face.tiles.map((t) => (
            <NoteTile
              key={`${face.key}-${t.k}`}
              note={t.note}
              position={t.position}
              cell={t.cell}
              tilt={t.tilt}
              baseZ={t.baseZ}
              onSelect={onSelect}
              dragRef={dragRef}
            />
          ))}
        </group>
      ))}
    </>
  );
}

/**
 * The <Canvas> scene: a dark core box (the solid cube body the note cutouts sit
 * on), the six note mosaics, and OrbitControls for click-drag rotation with a
 * slow idle auto-spin.
 */
export default function CubeScene({ notes, onSelect }) {
  const dragRef = useRef({ x: 0, y: 0, dragged: false });
  const core = CUBE_HALF * 2 * 0.985;
  return (
    <Canvas
      camera={{ position: [5.66, 3.77, 9.2], fov: 42 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ position: 'absolute', inset: 0 }}
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY, dragged: false };
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.dragged = true;
      }}
    >
      <mesh>
        <boxGeometry args={[core, core, core]} />
        <meshBasicMaterial color="#0b0a08" />
      </mesh>
      <CubeFaces notes={notes} onSelect={onSelect} dragRef={dragRef} />
      <OrbitControls
        enablePan={false}
        minDistance={5.5}
        maxDistance={13}
        autoRotate
        autoRotateSpeed={0.55}
        rotateSpeed={0.65}
        zoomSpeed={0.6}
      />
    </Canvas>
  );
}
