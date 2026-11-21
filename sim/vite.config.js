import { defineConfig } from 'vite';

// base './' so `npm run build` output (dist/) works from any static path or file share
export default defineConfig({
  base: './',
  publicDir: false,
  server: { port: 5178, host: '127.0.0.1' },
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
});
