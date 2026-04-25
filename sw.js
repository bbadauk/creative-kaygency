// Creative Kaygency Service Worker v2 — aggressive caching for fast repeat visits
const CACHE_NAME = 'ck-v2';
const CDN_CACHE = 'ck-cdn-v2';

// App shell to cache immediately
const APP_SHELL = ['/app.html'];

// CDN resources to cache on first use (cache-first — versioned/immutable)
const CDN_URLS = [
  'https://unpkg.com/react@18.2.0/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1',
  'https://unpkg.com/dompurify@3.0.8/dist/purify.min.js'
];

// Install: cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== CDN_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: stale-while-revalidate for app and CDN, network-first for API
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET requests
  if (e.request.method !== 'GET') return;

  // API calls: always network
  if (url.pathname.startsWith('/api/')) return;

  // Supabase calls: always network
  if (url.hostname.includes('supabase')) return;

  // Stripe: always network (required by Stripe TOS)
  if (url.hostname.includes('stripe.com')) return;

  // Search engine bots should always get fresh content
  if (/bot|crawl|spider|slurp|googlebot|bingbot/i.test(navigator.userAgent)) return;

  // CDN scripts: cache-first (they're versioned/immutable)
  if (CDN_URLS.some(u => e.request.url.startsWith(u))) {
    e.respondWith(
      caches.open(CDN_CACHE).then(c =>
        c.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(resp => {
            if (resp.ok) c.put(e.request, resp.clone());
            return resp;
          });
        })
      )
    );
    return;
  }

  // Google Fonts: cache-first
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(CDN_CACHE).then(c =>
        c.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(resp => {
            if (resp.ok) c.put(e.request, resp.clone());
            return resp;
          });
        })
      )
    );
    return;
  }

  // App shell (HTML): network-first with cache fallback
  if (url.pathname === '/' || url.pathname === '/app.html' || !url.pathname.includes('.')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put('/app.html', clone));
        }
        return resp;
      }).catch(() => caches.open(CACHE_NAME).then(c => c.match('/app.html')))
    );
    return;
  }
});
