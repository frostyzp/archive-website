import { useSound } from '@web-kits/audio/react';

// Physical post-it "peel + place" — a recorded sample. Played whenever a note
// is opened (INDEX grid) or brought to focus (EXPLORE coverflow). Gain is pushed
// past unity to make the peel the loud, foreground sound (engine applies no
// clamp; master bus sits at 0.8).
const NOTE_SOUND = {
  source: { type: 'sample', url: '/sounds/postit.wav' },
  gain: 1.6,
};

/** Post-it sample fired when a note is opened / focused. */
export const useNoteSound = () => useSound(NOTE_SOUND);
