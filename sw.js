const CACHE_NAME = 'pokequant-offline-v8';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.py',
  './card_tool.py',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => { if (k !== CACHE_NAME) return caches.delete(k); })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);

  // 1. Handle our virtual offline database path
  if (url.pathname.endsWith('/offline-db/mobile_catalog.db')) {
    event.respondWith(serveDatabaseStream());
    return;
  }
  
  // 2. IMPORTANT: Bypass Service Worker for external CDN links (like GitHub)
  if (url.origin !== location.origin) {
    return; 
  }
  
  // 3. Standard Cache-First Strategy for local assets
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
       // Fix: Return an actual response instead of undefined to prevent the null error
       return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
    })
  );
});

async function serveDatabaseStream() {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('PokeQuantDB', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const getChunk = (key) => new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const req = tx.objectStore('chunks').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });

  const metadata = await getChunk('metadata');
  if (!metadata) return new Response("Database not found in cache", { status: 404 });

  let currentIndex = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (currentIndex >= metadata.totalChunks) {
        controller.close();
        return;
      }
      const chunk = await getChunk(currentIndex++);
      controller.enqueue(chunk);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream'
    }
  });
}