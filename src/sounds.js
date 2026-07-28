import { useSound } from '@web-kits/audio/react';

// Central sound palette for the archive. Definitions are declarative
// @web-kits/audio patches; the hooks below read the shared SoundProvider
// (enabled / master volume) set up in main.jsx and stay referentially stable
// so they're safe to call inside handlers.

// Physical post-it "peel + place" — a recorded sample. Played whenever a note
// is opened (INDEX grid) or brought to focus (EXPLORE coverflow). Gain is pushed
// past unity to make the peel the loud, foreground sound (engine applies no
// clamp; master bus sits at 0.8).
export const NOTE_SOUND = {
  source: { type: 'sample', url: '/sounds/postit.wav' },
  gain: 1.6,
};

// Mechanical hover tick — a soft, high, near-instant brush of a keyswitch.
// Kept very quiet so it stays a subtle whisper under the post-it sample.
export const TAB_HOVER_SOUND = {
  source: { type: 'triangle', frequency: 1800 },
  envelope: { attack: 0.001, decay: 0.028, sustain: 0, release: 0.02 },
  gain: 0.024,
};

// Mechanical click "clack" — a filtered noise tick (the actuation) stacked on a
// short low body (the bottom-out) for a satisfying keyboard-switch feel. Levels
// are dialed back so the tabs read as a gentle click, not a loud snap.
export const TAB_CLICK_SOUND = {
  layers: [
    {
      source: { type: 'noise', color: 'white' },
      filter: { type: 'bandpass', frequency: 2400, resonance: 6 },
      envelope: { attack: 0.0004, decay: 0.018, sustain: 0, release: 0.01 },
      gain: 0.07,
    },
    {
      source: { type: 'square', frequency: 180 },
      filter: { type: 'lowpass', frequency: 900 },
      envelope: { attack: 0.0004, decay: 0.05, sustain: 0, release: 0.03 },
      gain: 0.045,
    },
  ],
};

/** Post-it sample fired when a note is opened / focused. */
export const useNoteSound = () => useSound(NOTE_SOUND);

/** Soft mechanical tick for hovering a nav tab. */
export const useTabHoverSound = () => useSound(TAB_HOVER_SOUND);

/** Mechanical clack for clicking a nav tab. */
export const useTabClickSound = () => useSound(TAB_CLICK_SOUND);
