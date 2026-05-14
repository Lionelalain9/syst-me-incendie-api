const CACHE = 'fireguard-v1';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // IGNORER LA CAMÉRA (ne pas intercepter, ne pas cacher)
  if (e.request.url.includes('10.76.24.100') || e.request.url.includes('/api/camera-proxy')) {
    // Laisser le navigateur gérer normalement
    return;
  }

  // Pour l'API → réseau d'abord, fallback cache
  if (e.request.url.includes('onrender.com') && !e.request.url.includes('/api/camera-proxy')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Pour les assets → cache d'abord
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Notifications push (si supporté)
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: '🔥 Alerte FireGuard', body: 'Vérifiez le système !' };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './manifest.json',
      badge: './manifest.json',
      vibrate: [200, 100, 200, 100, 400],
      tag: 'fireguard-alert',
      requireInteraction: true
    })
  );
});
