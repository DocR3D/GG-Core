import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The built front is served by NestJS (same origin as the API: the session cookie just works).
// In development, Vite serves the front on :5173 and forwards everything else to the backend on :8081.
const BACKEND = process.env.GG_BACKEND ?? 'http://localhost:8081';
const toBackend = { target: BACKEND, changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // /assets is already taken by the backend (CSS and fonts of the server-rendered pages)
    assetsDir: 'static',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': toBackend,
      '/auth': toBackend,
      '/login': toBackend,
      '/view': toBackend,
      '/veto': toBackend,
      '/sandbox': toBackend,
      '/assets': toBackend,
      '/socket.io': { ...toBackend, ws: true },
    },
  },
});
