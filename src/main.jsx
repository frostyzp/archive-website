import React from 'react';
import ReactDOM from 'react-dom/client';
import { DialRoot } from 'dialkit';
import 'dialkit/styles.css';
import App from './App';
import DialDemoShell from './DialDemoShell';

const path = window.location.pathname;
const Root = path === '/dial-demo' ? DialDemoShell : App;

// DialKit panels (Grain, Inactive Cards) are hidden by default so visitors
// don't see the dev controls. Append `?dial=1` to the URL to reveal the
// floating panel and tweak values in real time. Tweaks persist in localStorage
// regardless of whether the panel is visible, so the current "dialed" look is
// preserved.
const showDial = new URLSearchParams(window.location.search).get('dial') === '1';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
    {showDial && <DialRoot position="top-right" />}
  </React.StrictMode>
);
