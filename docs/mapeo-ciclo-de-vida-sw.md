# Mapeo del ciclo de vida del Service Worker

Entregable de la Semana 2 (PRD §10.1) y mitigación del riesgo R7 (conocimiento del SW concentrado en una sola persona). Describe, con el código real de `web/public/sw.js`, qué hace cada fase del ciclo de vida del Service Worker de CivicGuard, cómo la app lo dirige y cómo se comprobó.

> **Estado de la verificación:** las pruebas del §5 se hicieron con **Chromium en el perfil Pixel 7 emulado**, no en un teléfono físico. Los pasos para repetirlas en un Android real están en el §6 y siguen **pendientes de ejecutar** en un dispositivo.

## 1. Resumen

El SW está escrito a mano (sin Workbox), con scope `/`, y hace tres cosas:

1. **Precachear** el cascarón de la app al instalarse (`install`).
2. **Limpiar** las cachés de versiones anteriores y tomar el control al activarse (`activate`).
3. **Servir** los `GET`: desde la caché del shell (con Stale-While-Revalidate para imágenes y fuentes estáticas), Network-First con respaldo local para las lecturas de la API, y `offline.html` como respaldo de las navegaciones sin red (`fetch`).

Además carga `public/sync.js` con `importScripts` (envío de los reportes pendientes, RF-6); no forma parte del ciclo de vida y se documenta en el README.

Un SW nuevo **nunca se activa solo**: se queda esperando (_waiting_) hasta que la app le envía `{type: 'SKIP_WAITING'}` porque el usuario pulsó «Actualizar». Así ninguna pestaña cambia de versión a mitad de un reporte.

## 2. Estados y quién provoca cada transición

```text
 registrar sw.js                  (no hay SW previo)   (hay SW previo en uso)
   installing ──install OK──▶ installed (= waiting) ─┬─ no había SW previo ─────────▶ activating ──▶ activated
   (listener `install`)                              │                                 (listener `activate`)
                                                      └─ había SW previo: espera hasta recibir
                                                         {type:'SKIP_WAITING'} → skipWaiting() ─▶ activating
```

| Estado (DevTools)     | Qué significa                                           | Listener que corre | Quién lo provoca                                                             |
| --------------------- | ------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `installing`          | El navegador descargó un `sw.js` distinto y lo ejecuta  | `install`          | `navigator.serviceWorker.register('/sw.js')` o una comprobación de update    |
| `installed` (waiting) | Precaché completo; espera su turno                      | —                  | Termina `install`. Con una versión previa en uso se queda aquí               |
| `activating`          | Toma el relevo de la versión anterior                   | `activate`         | Primera instalación (sin SW previo) o mensaje `SKIP_WAITING` (con SW previo) |
| `activated`           | Es el SW activo y controla las páginas (`clients.claim`) | —                  | Termina `activate`                                                           |
| `redundant`           | Sustituido por otro, o su instalación falló             | —                  | La versión nueva se activó, o `install` rechazó                              |

## 3. El código, listener por listener

Los bloques de este apartado son **copia literal** de `web/public/sw.js`; la prueba `web/src/sw-doc.test.ts` falla si dejan de coincidir.

### 3.1 Constantes: versión y precaché

```js sw.js
const VERSION = '1';
const PRECACHE = ['/', '/offline.html', '/manifest.json'];

const CACHE_PREFIX = 'civicguard-shell-v';
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const OFFLINE_URL = '/offline.html';
```

`VERSION` y `PRECACHE` valen lo mínimo en desarrollo. `npm run build` ejecuta `web/scripts/inject-sw.mjs`, que reescribe esas dos líneas en `dist/sw.js` con un hash de 12 caracteres de todo `dist/` (excepto `sw.js`) y la lista de todos sus archivos. **Otro contenido → otro nombre de caché**, y así `activate` sabe cuál conservar. Las dos líneas deben seguir siendo una sola línea cada una o el script falla.

### 3.2 `install` — precachear todo o nada

```js sw.js
// `cache: 'reload'` salta la caché HTTP (Nginx da max-age largo a los archivos sin hash) y `addAll` falla si
// falta un solo archivo: la instalación no termina con un precaché incompleto. Aquí no se llama a skipWaiting.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});
```

- Abre la caché `civicguard-shell-v<VERSION>` y guarda ahí todo `PRECACHE`.
- `cache: 'reload'` salta la caché HTTP: Nginx da `max-age` largo a los archivos sin hash, y sin esto el precaché podría guardar una copia vieja.
- `addAll` es atómico: si falta un solo archivo, rechaza, la instalación **no termina** y el SW viejo sigue en uso. Nunca queda un precaché incompleto.
- **No llama a `skipWaiting()`.** Ese es el motivo de que la versión nueva espere.

### 3.3 `activate` — limpiar y tomar el control

```js sw.js
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
```

- Borra solo las cachés que empiezan con `civicguard-shell-v` y no son la actual; cualquier otra caché del origen se respeta.
- `self.clients.claim()` hace que las pestañas ya abiertas pasen a estar controladas por esta versión sin esperar a recargar.
- Mientras la versión nueva espera, la caché de la anterior sigue intacta: solo se borra aquí, cuando la nueva ya es la activa.

### 3.4 `message` — el único camino a `skipWaiting`

```js sw.js
// Único camino a skipWaiting: la app lo pide cuando el usuario pulsa «Actualizar».
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
```

- `skipWaiting()` salta la espera: el worker en _waiting_ pasa a `activating` sin esperar a que se cierren las pestañas que usan la versión anterior.
- Solo se ejecuta con ese mensaje exacto; cualquier otro (`{type: 'OTRO'}`, `undefined`…) se ignora.
- Quien lo envía es `UpdateNotice` (§4); no hay otro llamador.

### 3.5 `fetch` — Network-First para la API, caché primero para el shell, Stale-While-Revalidate para imágenes y fuentes, `offline.html` de respaldo

Primero se decide qué recurso es una imagen o fuente estática y cómo se refresca su copia:

```js sw.js
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
```

Las lecturas de la API (RF-7) tienen su propio respaldo local y un tiempo máximo de espera:

```js sw.js
// Respaldo local de las lecturas de la API (RF-7). Nombre fijo y sin VERSION: `activate` solo borra civicguard-shell-v*,
// así que un build nuevo no vacía lo último que el usuario vio. Sube el número si cambia la forma de las respuestas.
const API_CACHE = 'civicguard-api-v1';
// Con red lenta (3G) la app no puede quedarse esperando: pasado este tiempo se responde con el respaldo.
const API_TIMEOUT_MS = 3000;
```

Y se resuelven con Network-First: la red manda (dato más reciente) y, si falla, expira o el servidor responde 5xx, se sirve la última respuesta buena guardada:

```js sw.js
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
  const cached = await caches.match(request, { cacheName: API_CACHE });
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
```

Y el listener elige la estrategia:

```js sw.js
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
      .match(request, { cacheName: CACHE })
      .then((cached) => cached ?? fetch(request))
      .catch((error) => {
        if (request.mode === 'navigate') return caches.match(OFFLINE_URL, { cacheName: CACHE });
        throw error;
      }),
  );
});
```

- Solo se interceptan los `GET`: `POST /api/incidents` y demás escrituras van directo a la red, sin pasar por ninguna caché.
- **Lecturas de la API** (`GET /api/*` de cualquier origen: la API vive en otro dominio; sin `/api/health`, `/api/docs` ni peticiones con `Authorization`): **Network-First con tiempo máximo de 3 s** (`AbortController`). Con respuesta `200` del servidor se entrega y, antes de entregarla, se clona y guarda en `civicguard-api-v1` (una copia por URL: la lista de cada dispositivo, el detalle de cada reporte); un `4xx` se entrega tal cual y no se guarda. Si no hay red, pasan 3 s o el servidor responde `5xx`, se entrega la copia guardada con la cabecera `X-Served-From: cache` (para que la pantalla avise que son datos guardados); si no hay copia, un `503` con `{"message":"Sin conexión y sin datos guardados"}` (o el propio `5xx`). Los datos del propio dispositivo (reportes con su foto y su estado de envío) los lee la pantalla directamente de IndexedDB; el SW solo respalda lo que dijo el servidor. `/api/health` queda fuera porque un «ok» guardado mentiría sobre el estado real, y las lecturas con `Authorization` (panel del coordinador) no se guardan en la caché del navegador.
- **Imágenes y fuentes estáticas** (`request.destination` `image` o `font`, del mismo origen y fuera de `/api/*`): Stale-While-Revalidate. Se responde al instante con la copia guardada y, a la vez, se pide una nueva a la red para la próxima visita; sin copia se espera a la red y se guarda. La revalidación usa `cache: 'no-cache'` porque Nginx da `max-age` de un año a los archivos sin hash y, sin eso, saldría de la caché HTTP del navegador. Solo se guardan respuestas `200`: un `404` no pisa una copia buena. Sin red y con copia, se responde la copia y el fallo de la revalidación se ignora; sin red y sin copia, la imagen falla como cualquier error de red.
- Las copias de imágenes y fuentes van en la caché de la versión actual (`civicguard-shell-vN`), así `activate` las borra junto con las demás al cambiar de build. El respaldo de la API (`civicguard-api-v1`, nombre fijo) **sobrevive** a los builds: `activate` solo borra `civicguard-shell-v*`. Las fotos de los reportes viven en IndexedDB y se muestran con URL `blob:`, que no pasan por el SW.
- **El resto de los `GET`** (shell, scripts, estilos, navegaciones): con la caché de la versión **actual** (`cacheName: CACHE`) se responde primero; si no está, se pide a la red.
- Si la red falla y era una **navegación** (`request.mode === 'navigate'`), se responde `offline.html`; un fallo de otro tipo de petición (script, estilo) se propaga como error normal.

## 4. Cómo lo dirige la app

`web/src/app/UpdateNotice.tsx` registra el SW y vigila su estado:

1. `serviceWorker.register('/sw.js', { scope: '/' })` al montar la app.
2. Observa `registration.waiting`, `registration.installing` y `updatefound`. Un worker en `installed` **con la página ya controlada** (`serviceWorker.controller`) es una **actualización**; sin controlador es la primera instalación y **no** muestra nada.
3. Para una actualización muestra «Nueva versión disponible · **Actualizar**».
4. Al pulsarlo envía `waiting.postMessage({ type: 'SKIP_WAITING' })` y espera a que el worker llegue a `activated`; entonces ejecuta `location.reload()`. Se recarga en `activated` y no en `controllerchange` porque en WebKit recargar justo en ese instante deja al SW atascado en `activating`.

## 5. Evidencia de las pruebas

Script de la prueba: Playwright 1.64.1 con Chromium (perfil Pixel 7) dentro de la imagen `mcr.microsoft.com/playwright:v1.64.1-noble`, contra dos _builds_ reales de `web/` servidos con las cabeceras de `web/nginx.conf`. Los estados se leen del dominio `ServiceWorker` del protocolo de DevTools: son los mismos datos que muestra **Application → Service Workers**. Registro completo con tiempos: [`evidencia/sw-ciclo-de-vida.txt`](evidencia/sw-ciclo-de-vida.txt). Resultado: **23 de 23 comprobaciones en verde, sin errores de consola.**

### 5.1 `installing → waiting → activated`, solo tras `SKIP_WAITING`

| Paso                                                              | Estados observados (worker #0 = build 1, #1 = build 2)                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Primera visita (build 1)                                          | #0: `new → installing → installed → activating → activated`              |
| Despliegue del build 2 y `registration.update()`                  | #1: `new → installing → installed` (**se queda en waiting**)             |
| 3 s después                                                       | #1 sigue `installed`, #0 sigue `activated`; conviven las dos cachés      |
| Mensaje `{type: 'OTRO_MENSAJE'}`                                  | #1 sigue `installed` (no se activa)                                      |
| Clic en «Actualizar» (`{type: 'SKIP_WAITING'}`)                   | #0 `redundant`; #1 `activating → activated`; la página se recarga       |
| Tras `activate`                                                   | Solo queda la caché del build 2; el aviso desaparece                     |

Captura del aviso con la versión nueva esperando: [`evidencia/pixel7-sw-actualizacion.png`](evidencia/pixel7-sw-actualizacion.png).

**Control negativo:** al añadir `self.skipWaiting()` dentro de `install` en el build 2, las comprobaciones de espera fallan (la versión nueva se activa sola y reemplaza a la anterior sin aviso). Es decir, la prueba detecta la regresión que debe detectar.

### 5.2 Arranque sin red y `offline.html`

Con el servidor **apagado de verdad** (no el modo _offline_ de DevTools):

- `/` abre desde el precaché con el cascarón completo: [`evidencia/pixel7-sw-sin-red-shell.png`](evidencia/pixel7-sw-sin-red-shell.png).
- `/reportes` (fuera del precaché) muestra `offline.html`, «Sin conexión · CivicGuard»: [`evidencia/pixel7-sw-sin-red-offline.png`](evidencia/pixel7-sw-sin-red-offline.png).

### 5.3 Instalación, ícono _maskable_ y splash

- `Page.getAppManifest` no devuelve errores y `Page.getInstallabilityErrors` está vacío: Chromium considera la app instalable.
- El manifest declara `display: standalone`, `name`, `background_color` `#ffffff` y `theme_color` `#0b5cab` (de ahí sale el splash de Chrome Android: nombre + color de fondo + ícono grande).
- Hay íconos `maskable` de 192 y de 512 px y todos cargan con el tamaño declarado.

### 5.4 Pruebas automatizadas relacionadas

- `web/src/sw.test.ts`: `install`, `activate`, `message` y `fetch` de `sw.js` en un sandbox con Cache API simulada (incluye «`install` no llama a `skipWaiting`», «solo `SKIP_WAITING` lo llama», el Stale-While-Revalidate de imágenes y fuentes y el Network-First de la API: respaldo actualizado, tiempo máximo de 3 s con temporizadores falsos, sin red con y sin copia, `5xx`, `4xx`, `POST`/`Authorization`/`/api/health` fuera, y el respaldo sobreviviendo a `activate`).
- `web/src/app/UpdateNotice.test.tsx`: primera instalación sin aviso, actualización con aviso, `postMessage` y recarga al llegar a `activated`.
- `web/src/inject-sw.test.ts`: versión y precaché inyectados en `dist/sw.js`.
- `web/src/sw-doc.test.ts`: este documento cita el código real de `sw.js`.

### 5.5 Network-First de la API: con red, con red lenta y sin red

Prueba de SCRUM-180 con **Chromium (Pixel 7 emulado)** contra la API real y PostgreSQL. La PWA se compiló apuntando a un proxy propio que el script controla, para que «sin red» y «red lenta» lo sean de verdad también para el Service Worker (el modo _offline_ de Playwright/DevTools no siempre afecta a las peticiones del SW): el proxy se apaga para «sin red» y retrasa 5 s cada conexión para «red lenta». Las lecturas se hacen con `fetch` desde la página, que es exactamente lo que hará «Mis reportes». Registro completo: [`evidencia/network-first-escenarios.txt`](evidencia/network-first-escenarios.txt). Resultado: **10 de 10 comprobaciones en verde, sin errores de consola.**

| Escenario                                      | Resultado observado                                                                                                  | Captura                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Con red                                     | `200` en 10 ms desde el servidor (sin `X-Served-From`); la copia en `civicguard-api-v1` queda actualizada            | [`network-first-1-con-red.png`](evidencia/network-first-1-con-red.png)         |
| 2. Red lenta (el servidor tarda 5 s)           | A los **3007 ms** se aborta la petición y llega `200` con `X-Served-From: cache`: 1 reporte (el servidor ya tenía 2) | [`network-first-2-red-lenta.png`](evidencia/network-first-2-red-lenta.png)     |
| 3. Sin red                                     | `200` en 4 ms con `X-Served-From: cache`; un detalle nunca visto responde `503` con JSON, sin colgarse               | [`network-first-3-sin-red.png`](evidencia/network-first-3-sin-red.png)         |
| Vuelve la red                                  | Responde el servidor (2 reportes) y el respaldo se actualiza                                                         | —                                                                             |
| `POST /api/incidents`                          | `201`; ninguna caché contiene un `POST` ni la URL de la colección                                                    | —                                                                             |

Las capturas son el **resultado de la prueba automatizada volcado sobre la propia app** (no el panel Network de DevTools, que no se puede capturar en modo _headless_). Para ver el panel real, repite la prueba a mano (§6.3).

**Qué reveló esta prueba:** la primera versión clonaba la respuesta *después* de entregarla, cuando la página ya había empezado a leer su cuerpo, así que el respaldo nunca se guardaba; las pruebas unitarias no lo veían porque su caché simulada se abría al instante. Ahora el clon se hace antes de entregar la respuesta y la caché simulada cede un turno, como el navegador, para que ese error se detecte.

## 6. Repetir la prueba

### 6.1 En DevTools (Chrome de escritorio)

1. Sirve un build real (`cd web && npm run build && npm run preview`) en `http://localhost:4173`, o usa el túnel de ngrok (`docs/reporte-configuracion-entorno.md`).
2. Abre **DevTools → Application → Service Workers**. Verás el SW `#N activated and is running`.
3. Haz un cambio visible en `web/` y vuelve a ejecutar `npm run build` (sin parar `preview`). En el panel pulsa **Update**: aparece un segundo worker `#N+1 waiting to activate`.
4. Comprueba que **no** se activa solo y que en **Cache Storage** conviven `civicguard-shell-v<hash viejo>` y `civicguard-shell-v<hash nuevo>`.
5. En la app pulsa **Actualizar** (o, en DevTools, **skipWaiting**, que hace lo mismo que el mensaje): el worker nuevo pasa a `activated`, el viejo desaparece y la caché vieja se borra.
6. Para ver el primer arranque desde cero: **Application → Storage → Clear site data**.

**Update on reload** (casilla del panel Service Workers) fuerza instalar y activar el SW en cada recarga: úsala para **desarrollar** el SW, pero **desmárcala** para probar el ciclo de vida, porque se salta justamente la fase _waiting_ que se quiere ver.

### 6.2 En un teléfono Android real (pendiente de ejecutar)

Con `ngrok http 5173` (o la URL de Vercel) y Chrome Android:

- [ ] Abrir la app, esperar a que el SW quede activo y comprobarlo en `chrome://inspect/#service-workers` desde el escritorio con el teléfono conectado por USB.
- [ ] Activar **Modo Avión**, cerrar la pestaña y abrir de nuevo la app: debe cargar el cascarón; ir a «Mis reportes» debe mostrar `offline.html`.
- [ ] Menú ⋮ → **Instalar app** (o el botón «Instalar CivicGuard»): comprobar que aparece el splash (nombre, fondo blanco e ícono) y que el ícono del lanzador se recorta bien con la máscara del sistema (_maskable_).
- [ ] Desplegar un cambio y comprobar que aparece «Nueva versión disponible» y que no se aplica hasta pulsar «Actualizar».

### 6.3 Network-First de la API en DevTools

1. Con la app abierta y con red, entra a «Mis reportes» (o ejecuta en la consola `fetch('<URL de la API>/api/incidents?reporter_id=<tu deviceId>').then(r => r.headers.get('X-Served-From'))`): `null` = respondió el servidor. En **Application → Cache Storage → `civicguard-api-v1`** aparece la copia.
2. **Network → throttling → Slow 3G** (o una red que tarde más de 3 s): la petición se cancela a los 3 s y llega la copia (`X-Served-From: cache`).
3. **Network → Offline**: llega la copia al instante; con una URL que nunca se visitó, `503`.
4. Vuelve a **No throttling**: responde el servidor otra vez y la copia se actualiza.
5. Un `POST /api/incidents` nunca aparece en **Cache Storage**.

## 7. Límites conocidos

- `/reportes` y `/panel` no están en el precaché (son rutas de la SPA, no archivos): sin red muestran `offline.html` hasta que se decida cómo precachearlas (decisión abierta de SCRUM-150/152).
- Un cambio solo en la lógica de `sw.js` no cambia el nombre de la caché (el hash excluye `sw.js`); el navegador igualmente instala el SW nuevo, pero reutiliza el nombre de caché si los archivos no cambiaron.
- Sin red en WebKit, un JS con hash que no esté en la caché HTTP no carga en una visita en frío; en Chromium sí por la caché HTTP.
- El respaldo de la API guarda una copia por URL (la lista de cada dispositivo, el detalle de cada reporte) y no tiene tope; si el número de reportes crece mucho habría que acotarlo. Si cambia la forma de las respuestas hay que subir el número de `API_CACHE`.
- A los 3 s la petición se **cancela**: con una red lenta pero viva, el usuario ve el respaldo aunque el servidor habría respondido a los 4 s; se prefirió esperar siempre como máximo 3 s.
