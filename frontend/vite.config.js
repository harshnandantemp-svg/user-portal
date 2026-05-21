import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Required when Cloudflare Tunnel forwards portal.demoopwr.in to Vite dev.
    allowedHosts: ['portal.demoopwr.in', 'localhost', '127.0.0.1', '192.168.1.33'],
  },
});
