const CACHE_NAME = 'pokequant-offline-v10';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.py',
  './card_tool.py',
  './manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
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
    // SAFARI BUG FIX: Catch stream errors to guarantee Safari receives a fallback response instead of 'null'
    event.respondWith(serveDatabaseStream().catch(err => {
      return new Response("Stream Error: " + err.message, { status: 500 });
    }));
    return;
  }
  
  // 2. Bypass Service Worker for external CDN links (GitHub)
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
    }).catch(err => {
       return new Response("Offline Mode Error: " + err.message, { status: 503 });
    })
  );
});

async function serveDatabaseStream() {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('PokeQuantDB', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // SAFARI BUG FIX: Check if the store actually exists before querying it. 
  // If we query a missing store, Safari throws a synchronous error and causes the 'null' crash.
  if (!db.objectStoreNames.contains('chunks')) {
    return new Response("Database chunks store not found.", { status: 404 });
  }

  const getChunk = (key) => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('chunks', 'readonly');
      const req = tx.objectStore('chunks').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch(e) {
      reject(e);
    }
  });

  const metadata = await getChunk('metadata');
  if (!metadata) return new Response("Metadata not found", { status: 404 });

  let currentIndex = 0;
  
  // The exact ReadableStream logic from your tunnel deployment
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        if (currentIndex >= metadata.totalChunks) {
          controller.close();
          return;
        }
        const chunk = await getChunk(currentIndex++);
        if (chunk) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      } catch (e) {
        controller.error(e);
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream'
    }
  });
}