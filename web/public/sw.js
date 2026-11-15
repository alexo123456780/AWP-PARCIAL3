/* global self, caches, fetch, Request */
// Service Worker de CivicGuard (RF-3, RF-7): escrito a mano, sin Workbox, con scope `/`.

// SCRUM-150 sustituye estas dos constantes tras `vite build` (archivos de dist/ con hash y versión del build).
// Los valores de partida cubren el cascarón sin hash para que el SW funcione tal cual en desarrollo.
const VERSION = '1';
const PRECACHE = ['/', '/offline.html', '/manifest.json'];

const CACHE_PREFIX = 'civicguard-shell-v';
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const OFFLINE_URL = '/offline.html';

// `cache: 'reload'` salta la caché HTTP (Nginx da max-age largo a los archivos sin hash) y `addAll` falla si
// falta un solo archivo: la instalación no termina con un precaché incompleto. Aquí no se llama a skipWaiting.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

// Solo se borran las cachés del shell de otras versiones; cualquier otra caché se respeta.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Único camino a skipWaiting: la app lo pide cuando el usuario pulsa «Actualizar».
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // POST /api/incidents y demás escrituras van solo a la red: ni se interceptan ni se guardan.
  if (request.method !== 'GET') return;

  event.respondWith(
    caches
      .match(request, { cacheName: CACHE })
      .then((cached) => cached ?? fetch(request))
      .catch((error) => {
        if (request.mode === 'navigate') return caches.match(OFFLINE_URL, { cacheName: CACHE });
        throw error;
      }),
  );
});
