const DV_CACHE = 'dv-suite-copyout-v1';
const DV_SHELL = ['./', './index.html', './styles.css', './scripts.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(DV_CACHE).then((cache) => cache.addAll(DV_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(DV_CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
