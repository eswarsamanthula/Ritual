const CACHE = 'ritual-v1';
const ASSETS = [
  '/', '/index.html',
  '/js/app.js', '/js/db.js', '/js/config.js', '/js/notifications.js',
  '/css/style.css',
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400;1,500&family=DM+Mono:wght@300;400;500&display=swap',
];

self.addEventListener('install', e => {
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
    )
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Supabase API — network only
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  // Google Fonts stylesheet — cache-first
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

  // Static assets — cache-first
  if (url.hostname === 'cdn.jsdelivr.net' || url.href.startsWith(self.location.origin)) {
    e.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
        return res;
      }))
    );
    return;
  }
});
