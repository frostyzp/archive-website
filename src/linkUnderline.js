/* ─────────────────────────────────────────────────────────────────────
 * DOTTED LINK UNDERLINE
 *
 * The rule every text hyperlink on the site wears — archive nav, About
 * contacts, the explore rail's active category, onboarding Skip / Enter. Each
 * used to declare its own copy, which is how they drift apart.
 *
 * Painted as a repeating background rather than with
 * `text-decoration-style: dotted`, because CSS gives no control over the gap
 * between native dots: a dot comes out one thickness wide with a gap the same
 * size, and the only lever — `text-decoration-thickness` — fattens the dots and
 * the gaps together. Drawing the rule ourselves separates the two.
 *
 * The cost is that a background sits against the bottom of the em box instead
 * of at the font's own underline position, so the rule can't follow a change of
 * typeface the way `text-underline-offset` would. Everything using this is mono
 * at 11–16px, which one position covers.
 * ───────────────────────────────────────────────────────────────────── */

/** px — dot width and rule thickness. Square dots: a radial-gradient would
 *  round them, but at 1px there is nothing to round. */
const DOT = 1;
/** px, dot to dot. Chrome's native dotted works out at 2 for a 1px rule, which
 *  is dense enough to read as a broken line rather than as dots. */
const PERIOD = 3;

/** For `style` props. currentColor, so it follows whatever colour the link is. */
export const LINK_UNDERLINE = {
  backgroundImage: `linear-gradient(to right, currentColor ${DOT}px, transparent ${DOT}px)`,
  backgroundRepeat: 'repeat-x',
  backgroundSize: `${PERIOD}px ${DOT}px`,
  backgroundPosition: '0 100%',
};

/**
 * The rule lands at the bottom of the background positioning area — the padding
 * box — so on a padded element with leading it ends up well under the baseline:
 * the font's descent, the half-leading and the padding all stack below the
 * glyphs. This pulls it back up toward them.
 *
 * The offset is in em so it tracks font-size instead of drifting at another size.
 */
export const linkUnderlineRaised = (em) => ({
  ...LINK_UNDERLINE,
  backgroundPosition: `0 calc(100% - ${em}em)`,
});

/* Anything setting `background` shorthand alongside this — the reset buttons
   carry `background: none` — has to declare it BEFORE, or the shorthand blanks
   the image back out. */
/** The same declarations for a <style> block. */
export const LINK_UNDERLINE_CSS = Object.entries(LINK_UNDERLINE)
  .map(([prop, value]) => `${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`)
  .join(' ');
