import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { DialRoot } from 'dialkit';
import 'dialkit/styles.css';

const path = window.location.pathname;
const loadRoot =
  path === '/onboarding'
    ? () => import('./OnboardingReveal')
    : path === '/onboarding-beats'
      ? () => import('./OnboardingBeats')
      : path === '/ascii'
        ? () => import('./AsciiExperiment')
        : path === '/rows'
          ? () => import('./CategoryRows')
          : path === '/entrance'
            ? () => import('./NoteEntranceLab')
            : () => import('./App');

const Root = lazy(loadRoot);

const showDial = new URLSearchParams(window.location.search).get('dial') === '1';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
    <Analytics />
    {showDial && <DialRoot position="top-right" />}
  </React.StrictMode>
);
