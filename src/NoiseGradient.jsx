/** The site's shared charcoal radial backdrop. */
export const NOISE_GRADIENT =
  'radial-gradient(ellipse 100% 85% at 50% 40%, #161515 0%, #0B0A0A 45%, #040303 78%, #010000 100%)';

/**
 * The page backdrop: near-black, with the only lift at the TOP of the viewport.
 * The onboarding established it and the archive follows, so entering the index
 * doesn't change the colour of the room.
 *
 * Kept as a pair. `PAGE_BG` is the flat base a layer sits on (and what the
 * gradient bottoms out at); `PAGE_GRADIENT` is the lift painted over it, which
 * also gives the film grain something to blend against — on flat black the
 * overlay blend has nothing to bite into and the noise washes out.
 */
export const PAGE_BG = '#010000';
export const PAGE_GRADIENT =
  'radial-gradient(ellipse 120% 80% at 50% 0%, #161515 0%, #0B0A0A 42%, #050404 74%, #010000 100%)';
