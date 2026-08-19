// Web Push handlers, loaded into the Workbox-generated service worker via
// vite.config.ts's workbox.importScripts. Kept as a small standalone file
// (not part of the generated sw.js source) so this never has to be
// re-derived from the vite-plugin-pwa `workbox` config — Workbox's
// generateSW mode only builds precaching/routing from that config; anything
// else the service worker needs to do (like this) has to already exist as
// plain code it can importScripts() at the top of the file it generates.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload — fall back to defaults below */ }
  const title = data.title || 'AL TAX Nexus';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

// Focuses an already-open tab on the target page instead of always opening a
// new one — an admin tapping the notification while the app is already open
// in the background should land back on it, not pile up duplicate tabs.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
