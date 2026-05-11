import Papa from 'papaparse';
import { HIDDEN_THEMES } from './themes';

/**
 * Live Google-Sheet CSV. Republishing the sheet is enough to update the app —
 * no code change needed.
 */
export const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSWmqlXlkSkmqTYF3c7dkvdK0fPHE4TESolAwBqtjeXzC0nb57tuOHjNCRV5w2kAHNpemTzUHunrpDJ/pub?gid=1216878281&single=true&output=csv';

const cleanString = (v) => (v == null ? '' : String(v).trim());

const numericId = (globalId) => {
  const m = String(globalId || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

/**
 * Map one CSV row → confession object the UI consumes.
 *
 * Columns referenced (sheet header → field):
 *   Global ID     → image filename + numeric id
 *   Session ID    → metadata.session
 *   Item ID       → metadata.itemId
 *   Transcription → transcription
 *   Tags1, Tags2  → metadata.tags
 *   Theme         → category (drives dial bucket)
 *   Corpus?       → "yes" required to include the row
 */
function rowToConfession(r) {
  const globalId = cleanString(r['Global ID']);
  const theme = cleanString(r['Theme']);

  return {
    globalId,
    id: numericId(globalId) ?? globalId,
    image: globalId ? `/confession_notes/${globalId}.png` : null,
    transcription: cleanString(r['Transcription']),
    category: theme,
    metadata: {
      // Location and Collected aren't in the sheet yet; left blank so the
      // sidebar metadata panel can still render the labels later.
      location: '',
      session: cleanString(r['Session ID']),
      collected: '',
      itemId: cleanString(r['Item ID']),
      tags: [r['Tags1'], r['Tags2']]
        .map(cleanString)
        .filter(Boolean)
        .flatMap((s) => s.split(',').map((t) => t.trim()))
        .filter(Boolean),
    },
  };
}

function isUsable(c) {
  // Grid view wants every confession with a backing image + transcription,
  // even if it hasn't been themed yet. Theme/dial view filters further on
  // its own (only themed rows get bucketed). HIDDEN_THEMES (e.g. Misc) are
  // still dropped entirely since they're explicit "don't surface" signals.
  return (
    c.globalId &&
    c.transcription &&
    !HIDDEN_THEMES.has(c.category)
  );
}

/**
 * Fetch + parse the CSV. Resolves with an array of confession objects,
 * filtered to rows that have Corpus?=yes, a Theme, and a Transcription.
 *
 * Rejects on network failure so the caller can fall back to the bundled
 * legacy data (see App.jsx).
 */
export async function loadConfessions({ url = CSV_URL } = {}) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = (results.data || [])
            .filter((r) => cleanString(r['Corpus?']).toLowerCase() === 'yes')
            .map(rowToConfession)
            .filter(isUsable);
          resolve(rows);
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}
