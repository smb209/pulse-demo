import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,   // expose on LAN
    port: 4173,
    strictPort: true,
  },
});
