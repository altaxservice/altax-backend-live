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
        start_url: '/dashboard',
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
        // The public marketing site (marketing-site/, served separately by src/server.ts)
        // owns these exact paths — never let the app's offline shell hijack them.
        navigateFallbackDenylist: [/^\/$/, /^\/about$/, /^\/services$/, /^\/resources$/, /^\/news(\/.*)?$/, /^\/contact$/, /^\/privacy$/, /^\/sms-terms$/, /^\/accessibility$/],
        // Workbox's precache route matching defaults to treating "/" as an alias for
        // "/index.html" (directoryIndex, default 'index.html') — that alias is a direct
        // precache-route match, so it runs BEFORE navigateFallback/navigateFallbackDenylist
        // even get consulted, silently overriding the denylist above for "/" specifically.
        // Confirmed live: after a correct precache of index.html, "/" still served the app
        // shell instead of the marketing homepage, with no cache entry for "/" itself —
        // exactly this aliasing. Disabling it is required for the denylist to mean anything.
        directoryIndex: null,
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
