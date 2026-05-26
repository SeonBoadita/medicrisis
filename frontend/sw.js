const CACHE_NAME = 'medicrisis-v7';
const STATIC_ASSETS = [
  '/medicrisis/frontend/leaderboard.html',
  '/medicrisis/frontend/index.html',
  '/medicrisis/frontend/surgeon-profile.html',
  '/medicrisis/frontend/admin.html',
  '/medicrisis/frontend/manifest.json',
  'https://fonts.googleapis.com/css2?family=Doto:wght@100..900&family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/gsap@3.15/dist/gsap.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // API calls — always network first
  if (event.request.url.includes('/api/') || event.request.url.includes('localhost:3000')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline' }), { headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Static assets — network first, fall back to cache
  event.respondWith(
    fetch(event.request).then(res => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return res;
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});
