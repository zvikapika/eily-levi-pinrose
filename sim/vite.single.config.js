import { defineConfig } from 'vite';
// Single-file build for sharing: every asset (unit.glb) inlined as a data URL, then tools/inline_html.py
// folds the JS/CSS into dist-single/pinrose_gallery_sim.html (opens from disk, no server).
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-single', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 5000,
    cssCodeSplit: false, modulePreload: false,
  },
});
