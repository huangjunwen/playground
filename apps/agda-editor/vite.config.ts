import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export default defineConfig(({ command }) => {
  // Deployed under https://<owner>.github.io/playground/agda-editor/ — the
  // absolute base is required for correct service-worker scope and manifest
  // URLs (a relative base would break precache). In dev, serve at /agda-editor/
  // so the site dev gateway (site/dev.mjs) can proxy the app without rewrites.
  const base = command === 'build' ? '/playground/agda-editor/' : '/agda-editor/';
  return {
  base,
  worker: { format: 'es' },
  server: {
    // Pinned so the site dev gateway knows where to proxy /agda-editor/.
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'agda-editor',
        short_name: 'agda-editor',
        start_url: base,
        display: 'standalone',
        background_color: '#1e1e1e',
        theme_color: '#1e1e1e',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,webmanifest,png,svg,ico}'],
        // Default cap is 2 MiB — the 29 MB ALS wasm must be precached or
        // offline pages boot but ALS fails to load.
        maximumFileSizeToCacheInBytes: 35 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  };
});
