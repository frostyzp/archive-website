import { useEffect, useState } from 'react';
import { loadConfessions } from './loadConfessions';
import { deriveEmotions, sortConfessionsByEmotions } from './themes';

/**
 * One-shot fetch of the published Google Sheet. Returns:
 *   { confessions, emotions, loading, error }
 *
 * If the network fails we surface the error and let App.jsx render the
 * bundled fallback data so the prototype keeps working offline.
 */
export function useConfessions() {
  const [state, setState] = useState({
    confessions: [],
    emotions: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    loadConfessions()
      .then((confessions) => {
        if (cancelled) return;
        const emotions = deriveEmotions(confessions);
        const sorted = sortConfessionsByEmotions(confessions, emotions);
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
