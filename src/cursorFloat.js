/**
 * Cursor-follow "float" for note images — shared by the INDEX grid (App.jsx) and
 * the EXPLORE coverflow (SideDial.jsx) so a note feels identical to hover in
 * either view.
 *
 * The note leans toward the pointer (rotateX / rotateY), rises a few px, and
 * scales up a touch: the corner under the cursor comes forward while the far
 * corner recedes, which reads as a loose sheet of paper lifting off the page and
 * pivoting around wherever you're pointing.
 *
 * The two surfaces drive it differently because they own their transforms
 * differently:
 *  - INDEX writes the transform straight onto the <img> and lets a CSS
 *    transition do the smoothing. Tracking uses a short duration (trackMs) so
 *    the lean stays glued to the pointer; enter/leave use the longer settleMs so
 *    the lift and the drop back both breathe.
 *  - EXPLORE folds yaw/pitch/scale into the rAF tilt loop that already writes
 *    each card's coverflow transform every frame (a CSS transition there would
 *    double-damp the loop), easing on `tau`. Its local perspective is prepended
 *    only while a card is actually leaning — see the loop for why that's safe.
 *
 * Both surfaces put `perspective()` INSIDE the leaning element's own transform
 * rather than leaning on an ancestor's perspective. That matters more than it
 * sounds: an ancestor perspective has ONE vanishing point (the coverflow pins its
 * own to the viewport centre), so a card offset from that point gets its lean
 * sheared by the offset — the note appears to warp and stretch rather than pivot.
 * A perspective inside the element's own transform gives it a vanishing point at
 * its own centre, so the lean is symmetric wherever the element happens to sit.
 *
 * Magnitudes stay deliberately small. These are photographs of handwriting — past
 * ~10° the text skews enough to be harder to read, which defeats the point.
 */
export const CURSOR_FLOAT = {
  maxYaw: 9, //      deg — rotateY when the pointer is at the left / right edge
  maxPitch: 7, //    deg — rotateX when the pointer is at the top / bottom edge
  lift: 0.06, //     extra scale while hovered — hovered note goes to 1.06x
  rise: 6, //        px toward the viewer (translateZ) while hovered
  perspective: 900, // px — applied per-element in BOTH views (see above)
  trackMs: 110, //   ms transform transition while following the pointer (INDEX)
  settleMs: 300, //  ms transform transition on enter / leave (INDEX)
  tau: 0.05, //      s — rAF easing time constant (EXPLORE); ~matches trackMs
};

/**
 * Pointer position inside `el`, normalised to -0.5..0.5 on both axes (0,0 is the
 * element's centre). Returns nulls for a zero-sized box so callers can bail.
 */
export function cursorOffset(el, clientX, clientY) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    nx: (clientX - r.left) / r.width - 0.5,
    ny: (clientY - r.top) / r.height - 0.5,
  };
}

/**
 * Yaw / pitch (deg) for a normalised pointer offset. Signs are what make the
 * corner UNDER the cursor come toward the viewer: CSS rotateY(+) swings the right
 * edge away, so the pointer's x drives it negative; rotateX(+) swings the bottom
 * edge toward the viewer, so the pointer's y drives it positive.
 */
export function floatAngles(nx, ny) {
  return {
    yaw: -nx * 2 * CURSOR_FLOAT.maxYaw,
    pitch: ny * 2 * CURSOR_FLOAT.maxPitch,
  };
}
