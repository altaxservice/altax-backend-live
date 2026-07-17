import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'AL TAX Nexus',
        short_name: 'AL TAX Nexus',
        description: 'AL Tax Service client and staff portal',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#202833',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Full-page navigations (not API fetches) fall back to the cached shell when offline.
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // GET-only, read-mostly API prefixes safe to serve stale-while-offline.
            // Never includes /auth (session state must always be live) or anything
            // sensitive (vault, payment-methods) — those aren't matched, so they go
            // straight to the network as normal, untouched by the service worker.
            // NOTE: this array must be inlined here, not a module-level const — Workbox's
            // generateSW stringifies urlPattern and re-evaluates it standalone inside the
            // built service worker, so any outer-scope reference is undefined at runtime.
            urlPattern: ({ request, url }) =>
              request.method === 'GET' &&
              request.mode !== 'navigate' &&
              [
                '/clients', '/tasks', '/documents', '/billing', '/communications', '/search',
                '/accounting', '/reports', '/users', '/templates', '/rules', '/firm-settings', '/products',
              ].some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`)),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-read-cache',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
