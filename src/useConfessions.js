import { useEffect, useState } from 'react';
import { loadConfessionsOnce } from './loadConfessions';
import { deriveEmotions, sortConfessionsByEmotions } from './themes';

/**
 * One-shot fetch of the published Google Sheet. Returns:
 *   { confessions, emotions, loading, error }
 *
 * If the network fails we surface the error and let App.jsx render the
 * bundled fallback data so the prototype keeps working offline.
 */

// Per-image HEAD timeout + how many probes run at once. HEAD is header-only, so
// this never downloads image bodies (those stream in lazily at display time).
const IMG_PROBE_TIMEOUT = 6000;
const IMG_PROBE_CONCURRENCY = 16;

/**
 * Does this image actually exist? The sheet's corpus can reference notes whose
 * `.webp` hasn't been added to /public yet; a Vite dev server answers those with
 * the SPA fallback (200 text/html) and a static host with a 404. Either way the
 * <img> can't decode it, so the tile would later pop out of the grid — which
 * causes the "filter glitch" (the grid reflows as lazily-loaded missing images
 * fail one by one). We detect it up front via a header-only HEAD and keep only
 * responses that are OK *and* an image/* content-type.
 *
 * On a network error / timeout we assume the image is present (return true):
 * genuinely-missing files fail fast with 404 / text/html, so a timeout almost
 * always means a slow-but-real image, and we'd rather not hide real notes.
 */
async function imageExists(url) {
  if (!url) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMG_PROBE_TIMEOUT);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    return type.startsWith('image/');
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Filter confessions down to the ones whose image is actually servable, probing
 * in small concurrent batches so we don't fire hundreds of requests at once.
 */
async function keepConfessionsWithImages(confessions, isCancelled) {
  const kept = [];
  for (let i = 0; i < confessions.length; i += IMG_PROBE_CONCURRENCY) {
    if (isCancelled()) return kept;
    const batch = confessions.slice(i, i + IMG_PROBE_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const flags = await Promise.all(batch.map((c) => imageExists(c.image)));
    batch.forEach((c, j) => {
      if (flags[j]) kept.push(c);
    });
  }
  return kept;
}

export function useConfessions() {
  const [state, setState] = useState({
    confessions: [],
    emotions: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    loadConfessionsOnce()
      .then(async (confessions) => {
        if (cancelled) return;
        // Drop notes whose image can't be served before anything renders, so the
        // grid/theme/explore all show a stable, accurate set (no tiles popping
        // out — and the count is right — when filtering or scrolling).
        const present = await keepConfessionsWithImages(confessions, isCancelled);
        if (cancelled) return;
        const emotions = deriveEmotions(present);
        const sorted = sortConfessionsByEmotions(present, emotions);
        setState({ confessions: sorted, emotions, loading: false, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        // Keep loading=false so the UI moves on; App.jsx decides how to handle
        // the empty-confession + error case.
        // eslint-disable-next-line no-console
        console.warn('[confessions] CSV load failed, falling back', error);
        setState({ confessions: [], emotions: [], loading: false, error });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
