/**
 * Note image URLs.
 *
 * Grid / onboarding / explore strips use 900px thumbs (`/note-thumbs/…`).
 * Lightbox (and anything that really needs the scan) uses the 1600px original.
 *
 * Set `VITE_IMAGE_BASE` (no trailing slash) to serve both from another host
 * — Cloudflare R2, Bunny, etc. — and those bytes leave the Vercel Fast Data
 * Transfer bill. Same path layout on that host:
 *   {BASE}/note-thumbs/AC_001.webp
 *   {BASE}/confession_notes_2/AC_001.webp
 */
const IMAGE_BASE = String(import.meta.env.VITE_IMAGE_BASE || '').replace(/\/$/, '');

function asset(path) {
  return IMAGE_BASE ? `${IMAGE_BASE}${path}` : path;
}

export function noteImageUrl(globalId, variant = 'full') {
  if (!globalId) return null;
  const id = String(globalId).trim();
  if (variant === 'thumb') return asset(`/note-thumbs/${id}.webp`);
  return asset(`/confession_notes_2/${id}.webp`);
}

/** Display src for tiles, strips, and the intro pile. */
export function noteThumbSrc(confession) {
  if (!confession) return null;
  return confession.thumb || confession.image || null;
}

/** Full-resolution src — lightbox / “open this note large”. */
export function noteFullSrc(confession) {
  if (!confession) return null;
  return confession.image || confession.thumb || null;
}
