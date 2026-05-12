/**
 * Theme palette + dial-emotion derivation.
 *
 * The Google Sheet's `Theme` column drives both:
 *   1. the dial categories (each unique theme becomes one dial label)
 *   2. the gradient that crossfades behind the active confession
 *
 * THEME_META locks ordering and visual treatment for known themes (object
 * key order = dial order); any new theme that appears in the sheet is appended
 * at the end with a neutral fallback gradient so the app keeps working without a code change.
 */

// Each theme uses a radial glow centered at the bottom-middle of the
// viewport — same place the dial lives — fading out into the page's neutral
// `#111` backdrop. `ellipse 90% 80%` shapes the glow into a wide dome
// (wider than tall) so the color spreads horizontally along the dial rather
// than reaching all the way to the top of long screens.
const radial = (color) =>
  `radial-gradient(ellipse 90% 80% at 50% 100%, ${color} 0%, #111 70%)`;

export const THEME_META = {
  Therapist:        { id: 'therapist',   gradient: radial('#2a1a4a') },
  Harm:             { id: 'harm',        gradient: radial('#4a1a1a') },
  Refusal:          { id: 'refusal',     gradient: radial('#1a1a1a') },
  'In Love (w/AI)': { id: 'in-love',     gradient: radial('#4a1a2e') },
  Exes:             { id: 'exes',        gradient: radial('#3a1a4a') },
  Family:           { id: 'family',      gradient: radial('#1a3a3a') },
  Ghostwriter:      { id: 'ghostwriter', gradient: radial('#4a3a1a') },
};

const FALLBACK_GRADIENT = radial('#2a2a2a');

// Catch-all buckets we never want surfaced as a dial slot.
export const HIDDEN_THEMES = new Set(['Misc', 'misc']);

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Build the EMOTIONS array (id/label/gradient) the dial expects, from the
 * themes actually present in the loaded confessions. Preserves THEME_META
 * ordering for known themes; appends unknowns alphabetically.
 */
export function deriveEmotions(confessions) {
  const present = new Set(
    confessions.map((c) => c.category).filter((c) => c && !HIDDEN_THEMES.has(c))
  );

  const emotions = [];
  Object.entries(THEME_META).forEach(([label, meta]) => {
    if (present.has(label)) {
      emotions.push({ id: meta.id, label, gradient: meta.gradient });
      present.delete(label);
    }
  });

  [...present].sort().forEach((label) => {
    emotions.push({ id: slug(label), label, gradient: FALLBACK_GRADIENT });
  });

  return emotions;
}

/**
 * Sort confessions so all rows of the same theme cluster together, in the
 * same order the dial shows them. The vertical stack relies on this — when
 * the user clicks a dial label we jump to the first confession with that
 * category, and scrolling through the stack should walk the dial in order.
 */
export function sortConfessionsByEmotions(confessions, emotions) {
  const order = new Map(emotions.map((e, i) => [e.label, i]));
  return [...confessions].sort((a, b) => {
    const ai = order.has(a.category) ? order.get(a.category) : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b.category) ? order.get(b.category) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return 0;
  });
}
