import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { DialRoot } from 'dialkit';
import 'dialkit/styles.css';
import App from './App';
import OnboardingReveal from './OnboardingReveal';
import OnboardingBeats from './OnboardingBeats';
import AsciiExperiment from './AsciiExperiment';
import CategoryRows from './CategoryRows';
import NoteEntranceLab from './NoteEntranceLab';

const path = window.location.pathname;
const ROUTES = {
  // The scrolled original, kept alongside the beat-stepped telling the site
  // itself now opens with.
  '/onboarding': OnboardingReveal,
  '/onboarding-beats': OnboardingBeats,
  '/ascii': AsciiExperiment,
  '/rows': CategoryRows,
  '/entrance': NoteEntranceLab,
};
const Root = ROUTES[path] || App;

// DialKit panels (Grain, Inactive Cards) are hidden by default so visitors
// don't see the dev controls. Append `?dial=1` to the URL to reveal the
// floating panel and tweak values in real time. Tweaks persist in localStorage
// regardless of whether the panel is visible, so the current "dialed" look is
// preserved.
const showDial = new URLSearchParams(window.location.search).get('dial') === '1';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
    <Analytics />
    {showDial && <DialRoot position="top-right" />}
  </React.StrictMode>
);
