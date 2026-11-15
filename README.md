# CivicGuard PWA

Sistema de Gestión de Emergencias e Incidencias en Infraestructura Urbana — Proyecto Integrador 2 (Ingeniería en Desarrollo y Gestión de Software).

PWA _offline-first_ para reportar incidencias con ubicación GPS y foto de evidencia, incluso sin conexión; los reportes se sincronizan solos al volver la red y los cambios de estatus llegan como notificación push.

## Documentación

- [PRD](docs/PRD.md) — definición del proyecto, requerimientos, decisiones de arquitectura, plan de trabajo y cumplimiento del enunciado.
- [Tabla comparativa de arquitecturas](docs/tabla-comparativa-arquitecturas.md) — evaluación de las 5 arquitecturas y justificación de la PWA.
- [Mapeo del ciclo de vida del Service Worker](docs/mapeo-ciclo-de-vida-sw.md) — el código de `install`, `activate` y `skipWaiting` explicado, la evidencia de las pruebas y cómo repetirlas.
- [Enunciado del proyecto](docs/awp.pdf)

## Entorno con Docker

Requiere Docker con Compose v2. Primer arranque: `cp .env.example .env` (ajusta `DB_PASSWORD`) y `docker compose up --build`.

| Servicio    | Puerto del host              | Qué hace                                                         |
| ----------- | ---------------------------- | ---------------------------------------------------------------- |
| `db`        | `127.0.0.1:5432` (`DB_PORT`) | PostgreSQL 16 con volumen `pgdata` y healthcheck                 |
| `liquibase` | —                            | Aplica `db/changelog/` y termina; si falla, `backend` no arranca |
| `backend`   | `3000`                       | API NestJS (`api/`, target `dev`)                                |
| `frontend`  | `5173`                       | PWA con Vite (`web/`, target `dev`)                              |

- **Orden de arranque:** `db` (healthy) → `liquibase` (terminó con éxito) → `backend` → `frontend`. Si `liquibase` falla: `docker compose logs liquibase`.
- **Reinicio limpio:** `docker compose down -v && docker compose up --build` (borra la BD local).
- **Imágenes de producción:** `docker build --target prod ./api` y `docker build --target prod ./web` (Nginx en el puerto 8080, `no-cache` para `sw.js` e `index.html`).

## PWA (React + Vite)

Proyecto en `web/` (React 18, TypeScript, Vite y React Router). Con el entorno de Docker arriba: `http://localhost:5173` (recarga en caliente al editar `web/`).

- **Cascarón estático (RF-1):** `web/index.html` trae encabezado, navegación y _skeletons_ como HTML y CSS propios (`web/src/shell.css`), así que se ven antes de que cargue JavaScript. React solo reemplaza el contenido de `#root`.
- **Rutas lazy:** `/` (Nuevo reporte), `/reportes` (Mis reportes), `/reportes/:id` (Detalle) y `/panel` (Panel). Cada página en `web/src/pages/` es un _chunk_ aparte (`React.lazy` en `web/src/app/App.tsx`); para una página nueva, copia ese patrón.
- **Manifest e instalación (RF-2):** `web/public/manifest.json`, enlazado desde `index.html`, declara los íconos de 192×192 y 512×512 en `any` y `maskable` (`web/public/icons/`) y los colores del splash. Los PNG los dibuja `node web/scripts/generate-icons.mjs` (sin dependencias; se versionan, no se generan en el build): el _maskable_ ocupa todo el lienzo y su escudo queda dentro del 80 % central. `InstallButton` (`web/src/app/InstallButton.tsx`) captura `beforeinstallprompt`, muestra «Instalar CivicGuard» y lo abre al tocarlo; desaparece tras usarlo o con `appinstalled`. En iOS y Firefox no existe ese evento, así que no se muestra nada.
- **Service Worker (RF-3, RF-7):** `web/public/sw.js`, escrito a mano, scope `/`. `install` precachea `PRECACHE` en `civicguard-shell-v<VERSION>` (todo o nada), `activate` borra las demás cachés `civicguard-shell-v*` y reclama clientes, y `fetch` responde los GET desde esa caché primero; una navegación sin red devuelve `web/public/offline.html`, y lo que no es GET ni se intercepta. Un SW nuevo **espera**: solo llama a `self.skipWaiting()` al recibir `{type:'SKIP_WAITING'}`, que envía `UpdateNotice` (`web/src/app/UpdateNotice.tsx`, también registra el SW) al pulsar «Nueva versión disponible · Actualizar». `VERSION` y `PRECACHE` de `public/sw.js` son valores de partida para desarrollo: `npm run build` (`tsc && vite build && node scripts/inject-sw.mjs`, también dentro de la imagen `prod`) ejecuta `web/scripts/inject-sw.mjs`, que recorre `dist/`, calcula un hash global (ruta + contenido de cada archivo, sin contar `sw.js`) y reescribe en `dist/sw.js` esas dos líneas: la caché pasa a `civicguard-shell-v<hash de 12 caracteres>` y el precaché lista `/` y todos los archivos de `dist/` (assets con hash incluidos). Un build con otro contenido da otro nombre, y el SW nuevo borra la caché anterior en `activate`. El script sale con código 1 y un mensaje si falta `dist/`, `dist/sw.js` o alguna de las dos líneas. Los enlaces de la barra del cascarón son `<a href>` reales, así que `/reportes` y `/panel` sin red muestran `offline.html` mientras esas rutas no entren al precaché.
- **Persistencia local (RF-5):** `web/src/db/idb.ts` abre la base `civicguard` con `idb` (`openCivicGuardDB`) y define los stores `incidents`, `outbox` y `meta`. Cambiar stores o índices exige subir `DB_VERSION` y añadir su paso en `upgrade`. `getDeviceId(db)` devuelve el UUID anónimo del dispositivo (lo crea la primera vez y lo reutiliza). Nada de `localStorage`/`sessionStorage`: ESLint lo rechaza.
- **Ubicación (RF-4):** en «Nuevo reporte», el botón «Usar mi ubicación» llama a `useGeolocation` (`web/src/hooks/`), que usa `getPosition` de `web/src/modules/geo.ts`: una sola lectura con `getCurrentPosition` (`enableHighAccuracy: true`, `timeout` de 10 s) que devuelve `lat`, `lng` y `accuracy`. No se pide al cargar la app ni hay `watchPosition` (sin rastreo continuo). Si se deniega el permiso, se agotan los 10 s, el dispositivo no puede ubicarse o el navegador no ofrece la API, se muestra el motivo y `ManualLocationForm` para escribir latitud (−90 a 90) y longitud (−180 a 180; acepta coma decimal); el resultado manual (sin `accuracy`) queda en el mismo estado que el del GPS. Guardar el reporte en IndexedDB es del Sprint 3.
- **Presupuesto de JS inicial (R14):** `npm run check:bundle` (`web/scripts/check-bundle-size.mjs`, lo corre el job `lint-and-test` tras el build) suma el tamaño gzip de los scripts que carga `dist/index.html` (`<script src>` y `modulepreload`; los chunks de cada página con `React.lazy` no cuentan), imprime cada uno y el total, y sale con código 1 si pasa de 150 KB (1 KB = 1000 bytes). También falla si `index.html` no carga ningún script o referencia uno que no existe, para no dar por bueno un total de 0.
- **Comandos** (`cd web && npm ci`): `npm run dev`, `npm run build` (comprueba tipos y genera `dist/`), `npm run check:bundle` (necesita el `dist/` del build) y `npm test` (Vitest + Testing Library).
- **Sin caché y con túnel:** en desarrollo Vite responde `Cache-Control: no-store`. Para probar cámara, GPS y Service Worker en un teléfono real, define `NGROK_DOMAIN` en `.env` (se añade a `server.allowedHosts` y al CORS de la API) y ejecuta `ngrok http 5173`. Pasos, puertos y validación de contexto seguro en [`docs/reporte-configuracion-entorno.md`](docs/reporte-configuracion-entorno.md).

### Service Worker: cómo funciona y cómo depurarlo

Detalle completo, con el código de cada listener, en [`docs/mapeo-ciclo-de-vida-sw.md`](docs/mapeo-ciclo-de-vida-sw.md). En corto, el ciclo de una versión nueva es `installing` → `installed` (_waiting_) → `activating` → `activated`, y **solo pasa de _waiting_ a `activating` cuando la app envía `{type:'SKIP_WAITING'}`** (el botón «Actualizar»); nada más llama a `skipWaiting()`. Si algo no se comporta como esperas:

1. **Prueba con un build, no con `npm run dev`:** `cd web && npm run build && npm run preview` (`http://localhost:4173`). El hash de la caché y el precaché solo existen tras `npm run build`; con `npm run dev` el SW usa los valores de partida (`VERSION = '1'`).
2. **Mira el estado:** DevTools → **Application → Service Workers**. Ahí ves el worker activo (_activated and is running_), el que espera (_waiting to activate_) y los botones **Update**, **skipWaiting** y **Unregister**. Una versión nueva que no se activa **es lo normal**: está esperando el clic en «Actualizar».
3. **Mira las cachés:** **Application → Cache Storage**. Debe haber una sola `civicguard-shell-v<hash>` tras activarse; dos significa que hay una versión esperando.
4. **Empezar de cero:** **Application → Storage → Clear site data** (o **Unregister** y recargar).
5. **Depura el propio `sw.js`:** su consola y depurador son distintos de los de la página; ábrelos desde Application → Service Workers o, con un teléfono por USB, desde `chrome://inspect/#service-workers`.
6. **Casilla _Update on reload_:** instala y activa el SW en cada recarga. Sirve para **desarrollar** `sw.js`; **desmárcala** para probar el ciclo de vida, porque se salta justo la fase _waiting_.
7. **Sin red:** para comprobar `offline.html`, marca **Offline** en Application → Service Workers; para una prueba más fiel, apaga el servidor (así se hizo en la evidencia del documento) o usa Modo Avión en el teléfono.
8. **Si `npm run build` falla en `inject-sw`:** `web/public/sw.js` debe conservar `const VERSION = ...;` y `const PRECACHE = ...;` cada una en una sola línea.

## Base de datos y migraciones

Liquibase es el único dueño del esquema (el backend nunca crea ni altera tablas). El changelog vive en `db/changelog/`: `db.changelog-root.yaml` hace `includeAll` de `migrations/`, donde cada changeset es un `.sql` con formato Liquibase (`--liquibase formatted sql`), numerado (`0001-…`) y con su `--rollback`.

- **Aplicar:** `docker compose up db liquibase` (el servicio `liquibase` aplica los changesets y termina).
- **Cambiar el esquema:** crea un changeset nuevo con el siguiente número en el mismo PR que el código que lo usa. Nunca edites uno ya aplicado: rompe su checksum y el job `liquibase-validate` del CI falla. Si te pasa en local, recrea la BD con `docker compose down -v`.
- **Revertir el último changeset:** `docker compose run --rm liquibase rollback-count --count=1`.

## API (NestJS)

Proyecto ESM en `api/` (NestJS 12, TypeORM, PostgreSQL). Con el entorno de Docker arriba: `GET http://localhost:3000/api/health` y Swagger en `http://localhost:3000/api/docs`.

- **`GET /api/health`:** `200 {"status":"ok","database":"up"}`; si la BD no responde, `503 {"status":"error","database":"down"}` (el motivo solo va al log).
- **Incidentes** (`api/src/incidents/`, JSON en snake_case como las columnas): `POST /api/incidents` guarda el reporte (`id` UUID v4, `reporter_id` UUID, `type`, `severity`, `description` ≤ 500, `lat`, `lng`; opcionales `accuracy` y `created_at`) con estatus `recibido` y responde `201`; `GET /api/incidents?reporter_id=<uuid>` lista solo los reportes de ese dispositivo, del más reciente al más antiguo; `GET /api/incidents/:id` devuelve el detalle. Un campo inválido o no declarado responde `400` nombrando el campo, un `id` inexistente `404` y un `id` repetido `409`. Sin multipart, fotos ni idempotencia (Sprint 3).
- **Variables** (las inyecta `docker-compose.yml`): `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (obligatorias, sin valores por defecto: la API no arranca sin ellas), `DB_PORT` (5432), `PORT` (3000) y `CORS_ORIGINS` (lista separada por comas; vacía = ningún origen cruzado). Compose la fija a `http://localhost:5173` y, si defines `NGROK_DOMAIN`, a su dominio.
- **Seguridad desde el arranque:** TypeORM con `synchronize: false` (el esquema es solo de Liquibase), CORS con allowlist, cabeceras de seguridad (`app.useSecurityHeaders()` de Nest 12.1+: mismos valores que Helmet 8, sin el paquete) y `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted` (400 ante campos inválidos o no declarados). El _rate limiting_ llega con el módulo `auth`.
- **Módulo nuevo:** copia `api/src/health/` (su comentario en `health.module.ts` explica los pasos: DTOs validados y documentados, servicio, controlador y registro en `AppModule`).
- **Pruebas** (Vitest, sin BD): `cd api && npm ci && npm test`. Las e2e levantan la app con la misma `configureApp` que `main.ts`.

## Despliegue (Vercel + Render)

Solo `prod` despliega; `develop` nunca. Se trabaja en este repositorio (`alexo123456780/AWP-PARCIAL3`) con una rama por ticket → PR a `develop` → PR de _release_ `develop` → `prod`, y cada merge a `prod` que pasa `lint-and-test` despliega solo. El job `deploy-backend` de `.github/workflows/ci.yml` hace, en este orden: **migrar la BD con Liquibase → desplegar la API en Render (deploy hook con el commit exacto) → esperar `/api/health`**. La PWA la construye Vercel por su integración Git al recibir el push a `prod` (rama de producción), en paralelo; es compatible con la versión anterior de la API. Vercel ignora los pushes a cualquier otra rama (`ignoreCommand` de `web/vercel.json`). Mientras la variable `DEPLOY_ENABLED` del repositorio no sea `true`, el job del backend se omite (también sirve para pausarlo).

| Pieza      | Dónde                                                    | Configuración versionada                                                                      |
| ---------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| API NestJS | Render, servicio web Docker (`civicguard-api`)           | `render.yaml` (última etapa de `api/Dockerfile`, health check `/api/health`, sin auto-deploy) |
| PostgreSQL | Render, base `civicguard-db`                             | `render.yaml`; la API lee `DATABASE_URL` (en local sigue usando `DB_*`)                       |
| PWA        | Vercel, proyecto `civicguard-pwa` (Root Directory `web`) | `web/vercel.json` (fallback SPA; `sw.js` e `index.html` con `no-cache`, `/assets/` inmutable) |

**Configuración única** (las cuentas son tuyas; el repositorio no guarda ningún secreto):

1. **Render:** _New → Blueprint_ con este repositorio (público) y la rama `prod`; crea la API y la BD. Copia de la API su **Deploy Hook** (_Settings_) y su URL pública; de la BD, los datos de **conexión externa** (host, usuario, contraseña y base).
2. **Vercel:** proyecto `civicguard-pwa` (el nombre debe coincidir con `CORS_ORIGINS` de `render.yaml`) conectado a este repositorio, con _Root Directory_ `web`, framework Vite, rama de producción `prod` (la rama por defecto del repositorio) y la variable `VITE_API_URL` (entorno _Production_) con la URL pública de la API. No hace falta ningún token en GitHub.
3. **GitHub** (entorno `production`, restringido a la rama `prod`). Los secretos se piden por prompt, no van en la línea de comandos:

   ```bash
   gh secret set RENDER_DEPLOY_HOOK_URL --env production
   gh secret set DB_JDBC_URL --env production   # jdbc:postgresql://<host-externo>:5432/<base>?sslmode=require
   gh secret set DB_USER --env production
   gh secret set DB_PASSWORD --env production
   gh variable set API_URL --env production --body https://<tu-api>.onrender.com
   gh variable set DEPLOY_ENABLED --body true   # el interruptor va en el repositorio, no en el entorno
   ```

4. Haz un merge a `prod` (o reejecuta el último workflow de `prod`) y comprueba `https://<tu-api>.onrender.com/api/health` y la URL de Vercel.

**Límites conocidos:** el Postgres gratis de Render **expira a los 30 días** (14 más de gracia); la API gratis duerme tras 15 min sin tráfico (arranque en frío de ~1 min); el chequeo de salud del job no distingue la versión nueva de la anterior mientras Render construye; las migraciones corren **antes** de la API, así que cada changeset debe ser compatible con la versión anterior en ejecución.

Guía completa y reutilizable de todo el proceso (decisiones, comandos, verificación y errores reales): [`docs/guia-despliegue-vercel-render.md`](docs/guia-despliegue-vercel-render.md).

## Calidad de código y flujo Git

Requiere Node.js 22.12 o superior. Tras clonar: `npm ci` (instala también los hooks de Husky).

| Comando                | Qué hace                                                      |
| ---------------------- | ------------------------------------------------------------- |
| `npm run lint`         | ESLint sobre todo el repo (`web/`, `api/`, configuración)     |
| `npm run format:check` | Verifica el formato con Prettier (`npm run format` lo aplica) |
| `npm test`             | Pruebas de las reglas de calidad (ESLint y commitlint)        |

- **Sin `localStorage`/`sessionStorage` (RF-5):** ESLint falla ante cualquier uso, incluido `window.`, `globalThis.` o `self.`. Usa IndexedDB (`idb`).
- **Commits convencionales:** `tipo(SCRUM-N): descripción` (por ejemplo `feat(SCRUM-122): agregar CI`). Husky + commitlint rechazan cualquier otro formato.
- **Ramas:** se trabaja en una rama por ticket y se integra con PR a `develop`; `prod` es la rama de producción (equivale a la `main` del PRD) y la única que despliega, y recibe `develop` con un PR de _release_. Los PR hacia `develop` se fusionan solos cuando pasan los checks (`.github/workflows/auto-merge.yml`); el release a `prod` es manual. Ninguna admite push directo: ambas exigen PR y que pasen los checks `lint-and-test` y `liquibase-validate` (sin aprobaciones: el repositorio tiene una sola persona; si se suman colaboradores, súbelas en _Settings → Branches_).
- **CI:** el workflow `.github/workflows/ci.yml` corre lint, formato y pruebas (`lint-and-test`) en cada PR y en cada push a `develop`/`prod`. En cada PR, además, `liquibase-validate` aplica el changelog de la rama base a un Postgres temporal, valida el de la PR (detecta changesets editados por diferencia de checksum) y comprueba que el rollback seguido de update deja el esquema íntegro.
