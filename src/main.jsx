import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { DialRoot } from 'dialkit';
import 'dialkit/styles.css';
import { SoundProvider } from '@web-kits/audio/react';
import App from './App';
import OnboardingReveal from './OnboardingReveal';
import AsciiExperiment from './AsciiExperiment';

const path = window.location.pathname;
const ROUTES = {
  '/onboarding': OnboardingReveal,
  '/ascii': AsciiExperiment,
};
const Root = ROUTES[path] || App;

// DialKit panels (Grain, Inactive Cards) are hidden by default so visitors
// don't see the dev controls. Append `?dial=1` to the URL to reveal the
// floating panel and tweak values in real time. Tweaks persist in localStorage
// regardless of whether the panel is visible, so the current "dialed" look is
// preserved.
const showDial = new URLSearchParams(window.location.search).get('dial') === '1';

// Global audio context (declarative synth via @web-kits/audio). Controlled
// enabled/volume state so any page can trigger UI sounds through useSound /
// usePatch while respecting a single shared mute + master-volume state.
function SoundRoot({ children }) {
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(0.8);
  return (
    <SoundProvider
      enabled={enabled}
      volume={volume}
      onEnabledChange={setEnabled}
      onVolumeChange={setVolume}
    >
      {children}
    </SoundProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SoundRoot>
      <Root />
    </SoundRoot>
    {showDial && <DialRoot position="top-right" />}
  </React.StrictMode>
);
