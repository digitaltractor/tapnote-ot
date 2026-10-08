import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from GitHub Pages at https://tapnoteot.com/wardnote/ (see .github/workflows/pages.yml).
const base = process.env.BASE ?? '/wardnote/';

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.png'],
      manifest: {
        name: 'WardNote (demo)',
        short_name: 'WardNote',
        description: 'Mental Health Act deadlines, discharge tracking and note drafts for an inpatient team. Sample data; codes only.',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#F4F5F1',
        theme_color: '#1F6B66',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: `${base}index.html`
      }
    })
  ],
  test: { environment: 'node' }
});
