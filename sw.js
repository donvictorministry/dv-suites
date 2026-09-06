/* DV-SUITE Service Worker — offline-first cache, no external dependencies */
const DV_CACHE_NAME = 'dv-suite-cache-v2';
const DV_CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './scripts.js',
  './manifest.json'
];

self.addEventListener('install', (dvEvent) => {
  dvEvent.waitUntil(
    caches.open(DV_CACHE_NAME).then((dvCache) => dvCache.addAll(DV_CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (dvEvent) => {
  dvEvent.waitUntil(
    caches.keys().then((dvKeys) => Promise.all(
      dvKeys.filter((dvKey) => dvKey !== DV_CACHE_NAME).map((dvKey) => caches.delete(dvKey))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (dvEvent) => {
  if (dvEvent.request.method !== 'GET') return;

  dvEvent.respondWith(
    caches.match(dvEvent.request).then((dvCached) => {
      if (dvCached) return dvCached;

      return fetch(dvEvent.request)
        .then((dvResponse) => {
          if (!dvResponse || dvResponse.status !== 200 || dvResponse.type !== 'basic') {
            return dvResponse;
          }
          const dvResponseClone = dvResponse.clone();
          caches.open(DV_CACHE_NAME).then((dvCache) => {
            dvCache.put(dvEvent.request, dvResponseClone);
          });
          return dvResponse;
        })
        .catch(() => {
          if (dvEvent.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
