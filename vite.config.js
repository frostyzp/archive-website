import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to 0.0.0.0 so the dev server is reachable from other devices on the
    // same Wi-Fi (e.g. your phone at http://<your-mac-LAN-IP>:5190).
    host: true,
    historyApiFallback: true,
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'],
  },
  appType: 'spa',
});
