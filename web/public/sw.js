/* global self, caches, fetch, Request, Response, Headers, AbortController, setTimeout, clearTimeout, URL, importScripts */
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

// Respaldo local de las lecturas de la API (RF-7). Nombre fijo y sin VERSION: `activate` solo borra civicguard-shell-v*,
// así que un build nuevo no vacía lo último que el usuario vio. Sube el número si cambia la forma de las respuestas.
const API_CACHE = 'civicguard-api-v1';
// Con red lenta (3G) la app no puede quedarse esperando: pasado este tiempo se responde con el respaldo.
const API_TIMEOUT_MS = 3000;

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

// Imágenes y fuentes del propio origen (RF-7). `/api/*` queda fuera aunque devuelva una imagen: tiene su propia
// estrategia (networkFirst). Las fotos de los reportes viven en IndexedDB y se muestran con blob:, que no pasa por aquí.
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

// Lecturas de la API, de cualquier origen (la API vive en otro dominio). Quedan fuera: `/api/health` (un «ok» guardado
// mentiría sobre el estado real), `/api/docs` y todo lo que lleva `Authorization` (datos del coordinador: no se
// guardan en la caché del navegador). Las escrituras ya se descartaron antes: POST /api/incidents solo va a la red.
function isApiRead(request, url) {
  return (
    url.pathname.startsWith('/api/') &&
    url.pathname !== '/api/health' &&
    !url.pathname.startsWith('/api/docs') &&
    !request.headers.has('Authorization')
  );
}

// Network-First: la red manda (dato más reciente) y, si falla, expira a los 3 s o el servidor responde 5xx, se sirve la
// última respuesta buena que se guardó. Sin respaldo, un 503 en JSON que la pantalla sabe leer (sin red no hay nada
// más que mostrar). Las respuestas servidas del respaldo llevan `X-Served-From: cache` para poder avisar al usuario.
// shortcut: una copia por URL (la lista de cada dispositivo y el detalle de cada reporte), sin tope; acotar si crece.
async function networkFirst(event) {
  const { request } = event;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let failure = null;
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.status < 500) {
      // Solo 200 se guarda (un 4xx es una respuesta válida del servidor, no un dato que valga la pena conservar).
      if (response.status === 200) {
        // La copia se hace ANTES de entregar la respuesta: cuando la página empieza a leerla, su cuerpo ya no se puede clonar.
        const copy = response.clone();
        event.waitUntil(
          caches
            .open(API_CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => undefined),
        );
      }
      return response;
    }
    failure = response; // 5xx: si hay respaldo es mejor que el error
  } catch {
    // sin red o abortada a los 3 s
  } finally {
    clearTimeout(timer);
  }
  const cached = await caches.match(request, { cacheName: API_CACHE, ignoreVary: true });
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Served-From', 'cache');
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
  return (
    failure ??
    new Response(JSON.stringify({ message: 'Sin conexión y sin datos guardados' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // POST /api/incidents y demás escrituras van solo a la red: ni se interceptan ni se guardan.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isApiRead(request, url)) {
    event.respondWith(networkFirst(event));
    return;
  }

  if (isStaticAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  event.respondWith(
    caches
      // `ignoreVary`: el precaché se guardó con peticiones sin `Origin`, pero los <script type=module crossorigin> sí lo
      // mandan; si el servidor responde `Vary: Origin` (Vite, CDN con CORS) la copia no coincidiría y sin red fallaría.
      .match(request, { cacheName: CACHE, ignoreVary: true })
      .then((cached) => cached ?? fetch(request))
      .catch((error) => {
        // Sin red, cualquier navegación abre el cascarón precacheado: la SPA (React Router) resuelve la ruta
        // (`/reportes`, `/reportes/:id`…) y lee IndexedDB, igual que hace el servidor con su fallback a index.html.
        // offline.html queda solo para cuando el cascarón no está.
        if (request.mode === 'navigate') {
          return caches
            .match('/', { cacheName: CACHE })
            .then((shell) => shell ?? caches.match(OFFLINE_URL, { cacheName: CACHE }));
        }
        throw error;
      }),
  );
});

// Avisos de cambio de estatus (RF-8). La API manda `{title, body, incident_id, status, url}` (api/src/push/push.service.ts).
// `userVisibleOnly` obliga a mostrar SIEMPRE una notificación por cada push, aunque el contenido no se entienda.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    // contenido que no es JSON: se muestra el aviso genérico
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'CivicGuard', {
      body: data.body || 'Tu reporte tiene novedades.',
      icon: '/icons/icon-192.png',
      // Una notificación por reporte: la nueva reemplaza a la anterior del mismo reporte y vuelve a sonar.
      tag: data.incident_id,
      renotify: Boolean(data.incident_id), // `renotify` sin `tag` lanza un TypeError
      data: { url: data.url, incident_id: data.incident_id },
    }),
  );
});

// El destino viene en la notificación, pero solo se abre si es de este mismo origen: nunca una dirección externa.
function notificationTarget(url) {
  try {
    // `new URL(undefined, base)` no falla: lo convierte en la ruta «/undefined».
    const target = typeof url === 'string' ? new URL(url, self.location.origin) : null;
    if (target?.origin === self.location.origin) return target.href;
  } catch {
    // URL inválida
  }
  return new URL('/reportes', self.location.origin).href;
}

// Al tocar el aviso la app se enfoca (o se abre) en el detalle de ese reporte.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = notificationTarget(event.notification.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(async (windows) => {
      const open = windows[0];
      if (!open) return self.clients.openWindow(target);
      return open.navigate(target).then((client) => client?.focus());
    }),
  );
});
