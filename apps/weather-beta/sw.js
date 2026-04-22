const CACHE_NAME = 'storm-tracker-beta-v2';
const ASSETS_TO_CACHE = [
  '/apps/weather-beta/index.html',
  '/apps/weather-beta/style.css',
  '/apps/weather-beta/app.js',
  '/apps/weather-beta/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Shields Up: Core assets cached.');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('api.weather.gov') || event.request.url.includes('api.open-meteo.com')) return;
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).catch(() => console.warn("Network lost. Serving cache."));
    })
  );
});
