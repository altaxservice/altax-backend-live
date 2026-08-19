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
        // /public/contracts/*/pdf and /public/invoices/*/print are real binary downloads,
        // not app routes — a client tapping "View PDF"/"Download PDF" (a plain <a href>,
        // same request.mode:'navigate' as any other link) on a device that has this PWA
        // installed would otherwise get the cached login-page shell instead of their PDF.
        // Mirrors the identical carve-out in src/server.ts's own SPA-vs-API catch-all.
        //
        // Each pattern allows an optional "?..." suffix: Workbox tests these against
        // pathname + search combined (NavigationRoute._matchCallback), not pathname alone,
        // so a bare `$` anchor silently stops matching the moment a real link carries a
        // query string. Confirmed live: /manage-appointment?token=... (every appointment
        // email's link) fell through to the cached app shell and showed the admin login
        // screen instead of the public manage page, because the old `/^\/manage-appointment$/`
        // pattern never matched once `?token=...` was appended.
        navigateFallbackDenylist: [
          /^\/(\?.*)?$/, /^\/about(\?.*)?$/, /^\/services(\?.*)?$/, /^\/resources(\?.*)?$/, /^\/tools(\/.*)?(\?.*)?$/, /^\/news(\/.*)?(\?.*)?$/, /^\/contact(\?.*)?$/, /^\/book(\?.*)?$/, /^\/manage-appointment(\?.*)?$/, /^\/privacy(\?.*)?$/, /^\/sms-terms(\?.*)?$/, /^\/accessibility(\?.*)?$/,
          /^\/public\/contracts\//, /^\/public\/invoices\//,
        ],
        // Workbox's precache route matching defaults to treating "/" as an alias for
        // "/index.html" (directoryIndex, default 'index.html') — that alias is a direct
        // precache-route match, so it runs BEFORE navigateFallback/navigateFallbackDenylist
        // even get consulted, silently overriding the denylist above for "/" specifically.
        // Confirmed live: after a correct precache of index.html, "/" still served the app
        // shell instead of the marketing homepage, with no cache entry for "/" itself —
        // exactly this aliasing. Disabling it is required for the denylist to mean anything.
        directoryIndex: null,
        // Loads the hand-written push/notificationclick listeners (public/push-sw.js)
        // into the generated service worker — those are plain self.addEventListener
        // calls independent of Workbox's own routing, so they don't need to be
        // "generated" the way navigateFallback/runtimeCaching above do. Keeping them
        // in a separate importScripts file means switching to injectManifest mode
        // (which would require hand-reimplementing every rule above from scratch,
        // including the hard-won navigateFallbackDenylist/directoryIndex fixes) isn't
        // needed just to add push support.
        importScripts: ['push-sw.js'],
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
