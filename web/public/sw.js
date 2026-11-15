/* global self, caches, fetch, Request, URL, importScripts */
// Service Worker de CivicGuard (RF-3, RF-7): escrito a mano, sin Workbox, con scope `/`.

// `scripts/inject-sw.mjs` sustituye estas dos líneas tras `vite build` (archivos de dist/ con hash y versión del
// build): deben seguir siendo `const VERSION = ...;` y `const PRECACHE = ...;` en una sola línea cada una.
// Los valores de partida cubren el cascarón sin hash para que el SW funcione tal cual en desarrollo.
const VERSION = '1';
const PRECACHE = ['/', '/offline.html', '/manifest.json'];

const CACHE_PREFIX = 'civicguard-shell-v';
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const OFFLINE_URL = '/offline.html';

// Envío de reportes pendientes (RF-6): registra sus propios listeners `sync` y `message` (public/sync.js).
importScripts('/sync.js');

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

// Imágenes y fuentes del propio origen (RF-7). `/api/*` queda fuera aunque devuelva una imagen: la Cache API no
// guarda datos de reportes. Las fotos de los reportes viven en IndexedDB y se muestran con blob:, que no pasa por aquí.
function isStaticAsset(request, url) {
  return (
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    (request.destination === 'image' || request.destination === 'font')
  );
}

// Stale-While-Revalidate: responde con la copia guardada (o con la red si no hay) y, a la vez, pide una copia nueva
// para la próxima visita. Va en la caché de esta versión, así `activate` la borra con las demás copias del build.
// shortcut: sin tope de entradas; es una copia por URL de imagen o fuente, acotar si aparecen imágenes dinámicas.
async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  // `no-cache` obliga a validar contra el servidor: Nginx da max-age de un año a los archivos sin hash y, sin esto,
  // la «revalidación» saldría de la caché HTTP del navegador.
  const refresh = fetch(request, { cache: 'no-cache' }).then(async (response) => {
    // Solo 200: `put` rechaza un 206 y un 404 no debe pisar una copia buena. Si guardar falla (cuota), la imagen
    // igualmente se muestra.
    if (response.status === 200) await cache.put(request, response.clone()).catch(() => undefined);
    return response;
  });
  if (!cached) return refresh;
  event.waitUntil(refresh.catch(() => undefined)); // sin red, la copia guardada ya se entregó
  return cached;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // POST /api/incidents y demás escrituras van solo a la red: ni se interceptan ni se guardan.
  if (request.method !== 'GET') return;

  if (isStaticAsset(request, new URL(request.url))) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

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
