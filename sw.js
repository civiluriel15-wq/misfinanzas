/* sw.js — Service Worker: hace que la app funcione sin internet.
   Al publicar una nueva versión, cambia VERSION para que el celular la actualice. */
const VERSION = 'misfinanzas-v1.0.0';
const ARCHIVOS = [
  './', 'index.html', 'app.js', 'db.js', 'xlsx.full.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Estrategia: primero caché (rápido y offline); actualiza en segundo plano.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(enCache => {
      const red = fetch(e.request).then(resp => {
        if (resp && resp.ok) { const copia = resp.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); }
        return resp;
      }).catch(() => enCache || caches.match('index.html'));
      return enCache || red;
    })
  );
});
