const CACHE = 'ritual-v4';
const ASSETS = [
  '/', '/index.html?v=4',
  '/js/supabase.js?v=4', '/js/app.js?v=4', '/js/db.js?v=4', '/js/config.js?v=4', '/js/notifications.js?v=4',
  '/css/style.css?v=4',
  '/icons/icon-192.png?v=4', '/icons/icon-512.png?v=4',
  '/manifest.json?v=4',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400;1,500&family=DM+Mono:wght@300;400;500&display=swap',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => {
      return Promise.allSettled(ASSETS.map(url =>
        c.add(url).catch(() => {/* skip sw-friendly failures */})
      ));
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  if (url.hostname.includes('supabase.co')) {
    return;
  }

  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
        return res;
      }))
    );
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net' || url.href.startsWith(self.location.origin)) {
    e.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
        return res;
      }).catch(() => caches.match('/index.html')))
    );
    return;
  }
});
