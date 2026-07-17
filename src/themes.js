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

// Monochrome: the per-category colour tints were removed by request — every
// theme now shares one neutral grey glow so the archive stays black-and-white.
// (Swap this back to per-theme `radial('#xxxxxx')` values to restore colour.)
// Exported so non-dial views (e.g. the grid) can share the exact same backdrop
// glow the dial uses, keeping the film-grain reading consistent across views.
export const NEUTRAL_GRADIENT = radial('#2a2a2a');

// THEME_META locks ordering + gradient for known themes (object key order =
// dial order). Any new theme that appears in the sheet is appended at the end
// with the neutral fallback gradient so the app keeps working without a code change.
export const THEME_META = {
  Therapist:        { id: 'therapist',   gradient: NEUTRAL_GRADIENT },
  Harm:             { id: 'harm',        gradient: NEUTRAL_GRADIENT },
  Refusal:          { id: 'refusal',     gradient: NEUTRAL_GRADIENT },
  'In Love (w/AI)': { id: 'in-love',     gradient: NEUTRAL_GRADIENT },
  Exes:             { id: 'exes',        gradient: NEUTRAL_GRADIENT },
  Family:           { id: 'family',      gradient: NEUTRAL_GRADIENT },
  Ghostwriter:      { id: 'ghostwriter', gradient: NEUTRAL_GRADIENT },
};

const FALLBACK_GRADIENT = NEUTRAL_GRADIENT;

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
      emotions.push({
        id: meta.id,
        label,
        gradient: meta.gradient,
      });
      present.delete(label);
    }
  });

  [...present].sort().forEach((label) => {
    emotions.push({
      id: slug(label),
      label,
      gradient: FALLBACK_GRADIENT,
    });
  });

  return emotions;
}

/**
 * Stats for one category label — currently just the note count, used by the
 * note-open view's left theme dial ("N NOTES"). Kept separate from
 * `deriveEmotions` so it can be recomputed cheaply as the confession set
 * changes without rebuilding the whole emotion list.
 */
/** Display format for a theme/category label — e.g. `[ THERAPIST ]`. */
export function formatCategoryLabel(label) {
  const s = String(label ?? '').trim();
  if (!s) return '';
  return `[ ${s.toUpperCase()} ]`;
}

export function themeStats(confessions, label) {
  const count = confessions.reduce(
    (n, c) => (c.category === label ? n + 1 : n),
    0
  );
  return { count };
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
