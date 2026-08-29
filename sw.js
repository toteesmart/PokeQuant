const CACHE_NAME = 'pokequant-offline-v1';
const ASSETS = [
  './',
  './index.html',
  './app.py',
  './card_tool.py',
  './mobile_catalog.db',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@stlite/browser@0.76.0/build/stlite.js',
  'https://cdn.jsdelivr.net/npm/@stlite/browser@0.76.0/build/stlite.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});