# PRD — CivicGuard PWA

**Sistema de Gestión de Emergencias e Incidencias en Infraestructura Urbana**
Proyecto Integrador 2 · Ingeniería en Desarrollo y Gestión de Software
Versión 1.2 · 14/11/2026 · Duración: 4 semanas

---

## 1. Resumen ejecutivo

CivicGuard PWA es una Aplicación Web Progresiva que permite a operadores de campo reportar incidencias de infraestructura urbana (baches, fugas, alumbrado, cables caídos, etc.) con **ubicación GPS** y **foto de evidencia**, incluso **sin conexión**. Los reportes se guardan localmente, se sincronizan solos al recuperar la red y los coordinadores pueden cambiar su estatus, lo que dispara una **notificación push** al reportante.

**Principio rector:** *offline-first*. La red es una mejora, no un requisito.

### 1.1 Objetivos medibles

| # | Objetivo | Métrica de éxito |
|---|----------|------------------|
| O1 | Operar sin red | Arrancar, capturar GPS + foto y guardar un reporte en Modo Avión |
| O2 | Sincronizar sin intervención | 100 % de reportes en cola llegan al servidor al volver la red, sin duplicados |
| O3 | Certificación PWA | Lighthouse **PWA ≥ 90/100** con throttling 3G (ver riesgo R1) |
| O4 | Calidad | Performance ≥ 90 y Accesibilidad ≥ 95 en Lighthouse |
| O5 | Producción | URL pública con HTTPS activo, instalable en Android y escritorio |
| O6 | Notificaciones | Push entregado al cambiar el estatus de un reporte |

### 1.2 Fuera de alcance

Mapas en tiempo real con clustering, analítica avanzada, multi-idioma, app nativa en tiendas, pagos, moderación con IA.

---

## 2. Usuarios y casos de uso

| Rol | Descripción | Autenticación |
|-----|-------------|---------------|
| **Operador de campo** | Reporta incidencias, muchas veces en zonas sin cobertura | Identidad anónima de dispositivo (UUID generado en el primer arranque; no requiere login offline) |
| **Coordinador** | Revisa reportes y cambia su estatus | Login con JWT (panel `/panel`, requiere red) |

### 2.1 Historias de usuario principales

| ID | Historia | Prioridad |
|----|----------|-----------|
| HU-01 | Como operador quiero abrir la app sin red y ver el cascarón completo | Must |
| HU-02 | Como operador quiero capturar mi ubicación automáticamente al crear un reporte | Must |
| HU-03 | Como operador quiero tomar una foto de evidencia con la cámara | Must |
| HU-04 | Como operador quiero guardar el reporte aunque esté en Modo Avión | Must |
| HU-05 | Como operador quiero que mis reportes se envíen solos al volver la red | Must |
| HU-06 | Como operador quiero ver el estado de sincronización de cada reporte (pendiente / enviado) | Must |
| HU-07 | Como operador quiero recibir una notificación cuando mi reporte cambie de estatus | Must |
| HU-08 | Como operador quiero instalar la app en mi pantalla de inicio | Must |
| HU-09 | Como coordinador quiero listar reportes y cambiar su estatus | Must |
| HU-10 | Como operador quiero que me avisen cuando haya una nueva versión de la app | Should |
| HU-11 | Como operador quiero indicar la ubicación manualmente si el GPS falla | Should |

### 2.2 Ciclo de vida del reporte

`Pendiente (local)` → `Recibido` → `En revisión` → `En atención` → `Resuelto`
Cada transición hecha por el coordinador dispara un push al dispositivo que lo creó.

---

## 3. Requerimientos funcionales

### RF-1 · Application Shell
- Cascarón inmutable (header, navegación, contenedor principal) servido desde caché, con *skeleton placeholders* **pre-renderizados de forma estática** en `index.html` (la parte "SSR/inyección estática" del modelo de renderizado mixto).
- Todo el contenido dinámico se renderiza en cliente (CSR).

### RF-2 · Manifest e instalación
- `manifest.json` con `name`, `short_name`, `start_url`, `scope`, `display: standalone`, `theme_color`, `background_color`, `lang: es`.
- Íconos 192×192 y 512×512 en versiones `any` y **`maskable`** (splash-screen y home-screen automáticos).
- Prompt de instalación propio (`beforeinstallprompt`) con botón visible.

### RF-3 · Service Worker (`sw.js` en la raíz, scope `/`)
- Eventos `install` (precaché del shell), `activate` (limpieza de cachés antiguas + `clients.claim()`), `fetch` (estrategias), `sync` (Background Sync), `push` y `notificationclick`.
- **`skipWaiting` seguro:** el SW nuevo queda en espera y **no** se activa solo; la app muestra "Nueva versión disponible · Actualizar" y envía `postMessage({type:'SKIP_WAITING'})`, entonces el SW llama `self.skipWaiting()` y la página recarga. Así nunca se cambia el SW bajo una captura a medias.

### RF-4 · Captura de incidencia
- Formulario: tipo, severidad, descripción, ubicación, foto.
- **Geolocalización:** `getCurrentPosition` con `enableHighAccuracy: true`, `timeout: 10 s`; guarda `lat`, `lng`, `accuracy`. Si se deniega o falla: mensaje claro + captura manual (HU-11).
- **Cámara:** `getUserMedia({ video: { facingMode: 'environment' } })` como vía principal; *fallback* a `<input type="file" accept="image/*" capture="environment">`.
- La foto se **comprime en cliente** (canvas, lado mayor 1280 px, JPEG 0.7) antes de guardarla, para que ocupe ~200–400 KB y no sature IndexedDB ni el ancho de banda.

### RF-5 · Persistencia local (sin `localStorage`)
- **Cache API:** únicamente recursos inmutables del cascarón y estáticos.
- **IndexedDB** (vía la librería `idb`): reportes JSON, fotos como `Blob`, cola de envío (*outbox*) y metadatos del dispositivo (incluido el UUID de identidad).
- Prohibido `localStorage`/`sessionStorage`; se verifica con una regla de ESLint (`no-restricted-globals`) en CI.

### RF-6 · Sincronización resiliente
- Al guardar, el reporte entra al *outbox* con estado `pending` y se registra `registration.sync.register('sync-incidents')`.
- El SW, en el evento `sync`, vacía el outbox enviando cada reporte; ante fallo, el navegador reintenta con *backoff*.
- **Idempotencia:** el `id` (UUID v4) lo genera el cliente; el servidor hace `INSERT … ON CONFLICT (id) DO NOTHING`, así un reintento nunca duplica.
- **Fallback sin Background Sync** (Safari/Firefox): la app vacía el outbox en el evento `online`, al abrirse y al volver a primer plano (`visibilitychange`).

### RF-7 · Estrategias de red

| Recurso | Estrategia | Detalle |
|---------|-----------|---------|
| Shell (HTML, JS, CSS, íconos) | **Cache-First** (precaché) | Versionado `civicguard-shell-vN` |
| Imágenes estáticas / fuentes | Stale-While-Revalidate | |
| `GET /api/*` | **Network-First** con *timeout* de 3 s | Fallback a IndexedDB / caché |
| `POST /api/incidents` | Solo red, nunca caché | Si falla → outbox + Background Sync |
| Navegación sin red | Página `offline.html` precacheada | |

### RF-8 · Notificaciones Push
- Web Push con **VAPID** (`web-push` en el backend).
- Suscripción solicitada tras una acción del usuario (nunca al cargar) y ligada al UUID del dispositivo.
- Al cambiar el estatus, el backend envía el push; `notificationclick` abre el detalle del reporte.
- Suscripciones caducadas (HTTP 404/410) se eliminan automáticamente.

### RF-9 · Panel del coordinador
- Ruta `/panel` en la misma PWA: login, lista filtrable por estatus, detalle con foto y mapa estático, cambio de estatus.

---

## 4. Requerimientos no funcionales

| Categoría | Requisito |
|-----------|-----------|
| **Rendimiento** | LCP < 2.5 s en 3G simulada; JS inicial < 150 KB gzip; sin librerías de UI pesadas; rutas con *lazy loading* |
| **Accesibilidad** | Contraste AA, navegación por teclado, `alt`, etiquetas en formularios, objetivos táctiles ≥ 44 px |
| **Seguridad** | HTTPS obligatorio, CORS con *allowlist*, validación de entrada (`ValidationPipe` + `class-validator`), *rate limiting* (`@nestjs/throttler`), límite de 5 MB por foto, cabeceras con Helmet, contraseñas con bcrypt/argon2 |
| **Privacidad** | Ubicación solo se pide al crear un reporte; sin rastreo continuo |
| **Compatibilidad** | Chrome/Edge Android (objetivo principal), Chrome/Edge escritorio; iOS 16.4+ con degradación elegante |
| **Mantenibilidad** | ESLint + Prettier, commits convencionales, README reproducible |

---

## 5. Decisiones de arquitectura

### 5.1 Decisión: PWA con arquitectura desacoplada (Headless)

| Arquitectura | Offline | Hardware (GPS/cámara) | Push | Costo / tiempo | Veredicto |
|--------------|:------:|:---------------------:|:----:|:--------------:|-----------|
| Web tradicional | ✗ | Parcial | ✗ | Bajo | Sin soporte offline → descartada |
| Orientada a servicios (SOA/SPA + API) | ✗ por sí sola | Parcial | ✗ | Medio | Útil como *backend*, no basta como cliente |
| Móvil nativa | ✓ | ✓ | ✓ | Alto (2 bases de código, tiendas) | Excede 4 semanas |
| Multiplataforma (Flutter/RN) | ✓ | ✓ | ✓ | Medio-alto | Curva de aprendizaje, publicación en tiendas |
| **PWA** | **✓** | **✓** | **✓** (iOS limitado) | **Bajo** | **Elegida** |

**Justificación:** una sola base de código, instalable, sin tiendas, cumple todos los requisitos del enunciado (offline, SW, GPS, cámara, push, Lighthouse) y se despliega con un `git push`. La PWA consume una API REST propia (SOA ligera), cumpliendo el requisito *headless*: el front-end **nunca** habla directo con la base de datos.

### 5.2 Diagrama lógico

```
┌──────────────────────────── Dispositivo ────────────────────────────┐
│  UI (CSR)  ──►  Módulos: geo · cámara · reports · sync · push       │
│     │                         │                                     │
│     ▼                         ▼                                     │
│  Cache API (shell)      IndexedDB (reportes, fotos, outbox)         │
│     ▲                         ▲                                     │
│     └────────── Service Worker (sw.js, scope "/") ──────────────────┤
│        fetch strategies · sync · push · notificationclick           │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS (REST + Web Push)
┌───────────────────────────────▼─────────────────────────────────────┐
│  API REST (NestJS)  ──►  PostgreSQL  ◄──  Liquibase (migraciones)   │
│  Auth JWT · class-validator · web-push (VAPID) · Storage de fotos   │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 Stack tecnológico

| Capa | Decisión | Por qué |
|------|----------|---------|
| Front-end | **React 18 + TypeScript + Vite** (React Router con rutas *lazy*) | Estado reactivo (cola de envío, estado de sincronización, formularios), componentes reutilizables, mismo lenguaje que el backend (TypeScript) y habilidad muy demandada. Ver justificación abajo |
| Estado y UI | Hooks propios + Context (sin Redux); CSS Modules propio, **sin** MUI/Bootstrap | Mantiene el bundle bajo para Lighthouse 3G |
| Service Worker | **Escrito a mano** (`public/sw.js`), sin Workbox | El enunciado evalúa el ciclo de vida del SW; hay que demostrar dominio, no ocultarlo |
| Versionado del precaché | Script `scripts/inject-sw.mjs` post-build que inserta lista de archivos y hash en `sw.js` | Cada despliegue invalida cachés viejas sin mantener listas a mano |
| IndexedDB | Librería `idb` (≈1 KB) | API con *promises*, sin sorpresas |
| Estilos | CSS propio con variables, *mobile-first* | Sin peso extra |
| Backend | **NestJS (TypeScript) sobre Node.js 20** | Módulos, inyección de dependencias, validación (`class-validator`), Swagger y pruebas con Jest incluidos; estructura que escala y que 2+ personas pueden tocar sin pisarse |
| ORM / acceso a datos | **TypeORM con `synchronize: false`** | Solo lee/escribe datos; **nunca** crea ni altera tablas (eso es de Liquibase) |
| Base de datos | **PostgreSQL 16** (contenedor en local, Neon en producción) | Relacional, persistente (los discos de Render gratuito son efímeros, por eso no SQLite) |
| Migraciones | **Liquibase** (imagen oficial `liquibase/liquibase`, versión fijada) | Único dueño del esquema; historial auditable, *rollback* y `validate` en CI |
| Contenedores | **Docker + Docker Compose** | Obligatorio: servicios `db`, `liquibase`, `backend` y `frontend` |
| Fotos | Supabase Storage o Cloudflare R2 (solo accedido por la API) | La BD guarda solo la URL |
| Push | `web-push` + claves VAPID | Estándar W3C, sin depender de Firebase |
| Pruebas | Vitest + React Testing Library (front), Jest (API, viene con NestJS), Playwright (E2E offline), Lighthouse | Cubre el plan de pruebas |
| Calidad | ESLint, Prettier, Husky + commitlint | Historial de commits limpio |

**¿Por qué React y no JavaScript vanilla?** Esta app tiene bastante estado que cambia en pantalla: lista de reportes con su estado de sincronización (pendiente/enviado/error), conexión online/offline, aviso de nueva versión, botón de instalación, formulario con GPS y foto, y un panel de coordinador con login. En vanilla, mantener la UI sincronizada con ese estado entre 4 personas termina en código manipulando el DOM a mano, difícil de revisar. React lo resuelve con componentes y hooks, y TypeScript en front y back permite compartir los tipos de los contratos de la API.
- **Costo real:** React + ReactDOM ≈ 45 KB gzip; con React Router y el código propio el JS inicial sigue por debajo del presupuesto de 150 KB. Lighthouse PWA mide manifest, SW, HTTPS y offline, **no** el framework; y para Rendimiento basta con *lazy loading* (el panel del coordinador y la cámara se cargan bajo demanda), sin librerías de UI pesadas.
- **Lo que NO cambia:** el `sw.js` sigue escrito a mano en `public/` (sin Workbox ni `vite-plugin-pwa`), porque el ciclo de vida del SW es lo que se evalúa. `scripts/inject-sw.mjs` lee `dist/` después del build y mete la lista de archivos (con *hash*) y la versión en el SW.
- **Shell y renderizado mixto:** el cascarón y los *skeletons* viven como HTML estático en `index.html` (se ven antes de que cargue JS); React se monta encima (CSR).
- **Alternativa considerada:** Preact (3 KB, misma API) si el bundle se pasara del presupuesto; el cambio es casi transparente. Vanilla se descartó solo por mantenibilidad en equipo, no por rendimiento.

**¿Por qué NestJS y no Fastify/Express puro?** Con un equipo de 4 y 4 semanas, la estructura impuesta (módulos `incidents`, `push`, `auth`, `admin`) evita que cada quien invente su organización, y la validación por DTOs, Swagger (`/api/docs`) y las pruebas ya vienen resueltas. El costo es una curva de aprendizaje mayor y algo más de arranque en frío, aceptable porque el *offline-first* oculta esa latencia al usuario. Se usa el adaptador Express por defecto (Multer para la subida de fotos con `FileInterceptor`).

### 5.4 Entorno de desarrollo con Docker (Semana 1)

El entorno completo corre con **un solo comando** (`docker compose up --build`) y cuatro contenedores obligatorios:

| Servicio | Imagen / build | Puerto | Responsabilidad |
|----------|----------------|:------:|-----------------|
| `db` | `postgres:16-alpine` | `5432` | Base de datos con volumen persistente y *healthcheck* (`pg_isready`) |
| `liquibase` | `liquibase/liquibase:<versión fija>` | — | Contenedor de **ejecución única**: aplica los *changelogs* y termina |
| `backend` | `./api` (Dockerfile multi-stage: `dev` / `prod`) | `3000` | API NestJS; CORS solo para `localhost:5173` y el dominio ngrok |
| `frontend` | `./web` (Dockerfile multi-stage: `dev` con Vite / `prod` con Nginx) | `5173` (dev) · `8080` (prod) | PWA; en dev `Cache-Control: no-store` y `server.allowedHosts` con el dominio de ngrok |
| ngrok (en el host) | — | → `5173` | HTTPS público para probar cámara/GPS/SW en un teléfono real |

**Orden de arranque garantizado** (`depends_on` con condiciones):

```
db (healthy)  ──►  liquibase (completed_successfully)  ──►  backend  ──►  frontend
```

```yaml
# docker-compose.yml (esqueleto)
services:
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_DB: civicguard, POSTGRES_USER: ${DB_USER}, POSTGRES_PASSWORD: ${DB_PASSWORD} }
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d civicguard"], interval: 5s, retries: 10 }
  liquibase:
    image: liquibase/liquibase:4.29   # fijar versión
    volumes: [./db/changelog:/liquibase/changelog]
    command: >
      --url=jdbc:postgresql://db:5432/civicguard
      --username=${DB_USER} --password=${DB_PASSWORD}
      --changelog-file=changelog/db.changelog-root.yaml update
    depends_on: { db: { condition: service_healthy } }
  backend:
    build: { context: ./api, target: dev }
    ports: ["3000:3000"]
    depends_on: { liquibase: { condition: service_completed_successfully } }
  frontend:
    build: { context: ./web, target: dev }
    ports: ["5173:5173"]
    depends_on: [backend]
volumes: { pgdata: {} }
```

#### Migraciones con Liquibase
- **Ubicación:** `db/changelog/`. El archivo raíz `db.changelog-root.yaml` hace `includeAll` de `migrations/`.
- **Formato:** *changesets* en **SQL con formato Liquibase** (`--liquibase formatted sql`), uno por archivo y con numeración (`0001-create-enums.sql`, `0002-create-incidents.sql`, `0003-create-push-subscriptions.sql`, `0004-create-users.sql`). Cada uno lleva su `--rollback`.
- **Reglas:** nunca se edita un *changeset* ya aplicado (se crea uno nuevo); todo cambio de esquema entra por PR; el backend jamás usa `synchronize`.
- **Producción:** Neon no corre el contenedor de Liquibase, así que un *job* de GitHub Actions ejecuta la misma imagen contra Neon **antes** de desplegar el backend. En cada PR, otro *job* corre `liquibase validate` contra un Postgres temporal.

- **Contexto seguro:** `localhost` y ngrok (HTTPS) lo cumplen; se valida con `window.isSecureContext === true`.
- **Supresión de caché HTTP clásica:** `no-store` en dev, "Disable cache" + "Update on reload" en DevTools, y `Cache-Control: no-cache` para `sw.js` y `index.html` en producción (los assets estáticos sí con `max-age` largo).
- Comandos: `docker compose up --build` (todo el entorno) y `ngrok http 5173` (túnel). En producción, el Nginx del contenedor `frontend` sirve `sw.js` e `index.html` con `no-cache` y los demás *assets* con `max-age` largo.
- El repositorio vive en el sistema de archivos de WSL (no en `/mnt/c`) para que el *hot reload* de Vite dentro del contenedor funcione sin *polling*.

### 5.5 Modelo de datos

**`incidents`**

| Campo | Tipo | Nota |
|-------|------|------|
| `id` | UUID (PK) | Generado en el cliente → idempotencia |
| `reporter_id` | UUID | Identidad del dispositivo |
| `type` | enum | bache, fuga, alumbrado, cableado, otro |
| `severity` | enum | baja, media, alta, crítica |
| `description` | text | ≤ 500 caracteres |
| `lat`, `lng`, `accuracy` | float | |
| `photo_url` | text | |
| `status` | enum | recibido, en_revision, en_atencion, resuelto |
| `created_at` | timestamptz | Hora real de captura (cliente) |
| `synced_at` | timestamptz | Hora de recepción (servidor) |

**`push_subscriptions`**: `id`, `reporter_id`, `endpoint` (único), `p256dh`, `auth`, `created_at`.
**`users`** (coordinadores): `id`, `email`, `password_hash`, `role`.

### 5.6 Contrato de API

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| `POST` | `/api/incidents` | Crea reporte (`multipart/form-data`: JSON + foto). Idempotente por `id` | Device |
| `GET` | `/api/incidents?reporter_id=` | Reportes del dispositivo | Device |
| `GET` | `/api/incidents/:id` | Detalle | Device/JWT |
| `GET` | `/api/admin/incidents` | Lista con filtros | JWT |
| `PATCH` | `/api/admin/incidents/:id/status` | Cambia estatus y dispara push | JWT |
| `POST` | `/api/push/subscribe` | Registra suscripción | Device |
| `POST` | `/api/auth/login` | Login de coordinador | — |
| `GET` | `/api/health` | Verificación de despliegue | — |

### 5.7 Estructura del repositorio

```
awp-integrador2/
├── docs/                 # PRD, tabla comparativa, reportes, evidencia Lighthouse
├── web/                  # PWA
│   ├── public/           # sw.js, manifest.json, icons/, offline.html
│   ├── src/
│   │   ├── app/          # main.tsx, App.tsx, shell, rutas (lazy)
│   │   ├── pages/        # Nuevo reporte, Mis reportes, Detalle, Panel
│   │   ├── components/   # UI reutilizable
│   │   ├── hooks/        # useOnline, useGeolocation, useOutbox…
│   │   ├── modules/      # geo.ts, camera.ts, reports.ts, sync.ts, push.ts
│   │   └── db/           # idb.ts (stores: incidents, outbox, meta)
│   ├── Dockerfile        # multi-stage: dev (Vite) / prod (Nginx)
│   └── nginx.conf        # cabeceras de caché para producción
├── api/                  # NestJS
│   ├── Dockerfile        # multi-stage: dev / prod
│   └── src/              # modules: incidents, push, auth, admin, health
├── db/
│   └── changelog/        # Liquibase
│       ├── db.changelog-root.yaml
│       └── migrations/   # 0001-*.sql, 0002-*.sql …
├── scripts/              # inject-sw.mjs
├── .github/workflows/    # CI: lint, pruebas, liquibase validate, despliegue
├── .env.example
└── docker-compose.yml    # db · liquibase · backend · frontend
```

### 5.8 Despliegue

| Pieza | Plataforma | Motivo |
|-------|-----------|--------|
| PWA (`frontend`) | **Render** (servicio Docker, imagen `prod` con Nginx) | HTTPS automático; mismas imágenes que en desarrollo; Nginx controla la caché de `sw.js` |
| API (`backend`) | **Render** (servicio Docker, imagen `prod`) | HTTPS automático, despliegue desde GitHub |
| BD | **Neon** (Postgres administrado) | Persistente y gratuito |
| Migraciones | **GitHub Actions** ejecutando la imagen de Liquibase contra Neon | Corre antes del despliegue del backend |

CI/CD con GitHub Actions: lint + pruebas + `liquibase validate` en cada PR; al fusionar a `main` se migra la BD y se despliega.

> Si el arranque en frío del plan gratuito de Render afecta las mediciones de Lighthouse, la imagen `prod` del frontend es solo Nginx con archivos estáticos y puede moverse a Netlify/Cloudflare Pages sin cambiar código. Las auditorías se corren siempre con el servicio ya "despierto".

---

## 6. Equipo y asignación de responsabilidades

> Equipo de **4 integrantes** (el enunciado permite de 4 a 5). Las tareas de DevOps, QA y documentación se reparten entre los cuatro según la tabla.

| Integrante | Rol | Responsabilidades principales | Entregables que firma |
|------------|-----|-------------------------------|----------------------|
| **Alejandro Magaña Lopez** | **Líder técnico · Arquitectura, Docker, Service Worker y Frontend** | **Semanas 1 y 2 completas.** S1: documentos, repo, Docker Compose, Liquibase, esqueletos de API y shell, `manifest.json`. S2: `sw.js` (ciclo de vida, `skipWaiting` seguro), script de precaché, Application Shell y renderizado mixto, íconos *maskable*, splash/home-screen, prompt de instalación, módulo `incidents` de NestJS, módulos `geo.ts` y `camera.ts`. Además, durante todo el proyecto: decisiones de arquitectura, revisión de PRs y **CI/CD y despliegue** (Render, Neon, *job* de Liquibase en GitHub Actions, HTTPS, variables de entorno) | Tabla comparativa · Reporte de configuración del entorno · Mapeo del ciclo de vida del SW · Shell final + Manifest · API desplegada · Sección de despliegue del reporte final |
| **Jose Ariel Martines Llanes** | **Backend y Push** | Desde la Semana 3, sobre la API base de Alejandro: subida multipart con idempotencia, almacenamiento de fotos, módulos `auth` (JWT) y `admin`, *changesets* de Liquibase de cada nueva tabla, *Background Sync* en el SW (con Mario en el *outbox*), servidor Web Push (VAPID), suscripciones | Push extremo a extremo |
| **Hector Enrique Mendoza Nava** | **Frontend, UX y Calidad** | Desde la Semana 3: pantalla de lista con estado de sincronización, estrategia Network-First con *fallback* local, panel del coordinador, accesibilidad; **auditorías Lighthouse** y redacción del reporte final | Panel del coordinador · Reporte del plan de pruebas y despliegue (métricas Lighthouse) |
| **Mario Rafael Solis Suarez** | **Persistencia local, Push en cliente y Pruebas E2E** | Desde la Semana 3, sobre `geo.ts`/`camera.ts` de Alejandro: compresión de imagen y flujo de captura, capa IndexedDB (`idb`), *outbox*, Cache API del cascarón; suscripción Push en cliente y `push`/`notificationclick` en el SW; **pruebas E2E con Playwright** (Modo Avión) y optimización de rendimiento | Captura GPS + foto en disco local · Suite E2E offline · Módulo operativo offline |

> **Semanas 1 y 2:** las ejecuta íntegramente Alejandro. El resto del equipo solo hace *onboarding* (clonar el repo, configurar `.env`, lograr que `docker compose up --build` funcione en su máquina) y se pone al día leyendo el código (NestJS, React, `idb`, `sw.js`) para arrancar la Semana 3 sin fricción.

**Regla de colaboración:** cada integrante es responsable de su área pero **todos** deben tener commits propios en el repositorio (el historial de commits se evalúa). Se hace *pair programming* en las integraciones críticas (SW ↔ IndexedDB ↔ API).

### 6.1 Flujo de trabajo Git

- GitHub público; rama `main` protegida (sin *push* directo).
- Ramas cortas `feat/…`, `fix/…`, `docs/…`; *Pull Request* con al menos **1 aprobación**.
- Commits convencionales (`feat(sw): add sync handler`).
- Todo cambio de base de datos se hace con un **nuevo *changeset* de Liquibase** en el mismo PR que el código que lo usa; jamás se edita uno ya fusionado.
- Tablero Kanban en GitHub Projects (Backlog · En curso · Revisión · Hecho).
- Reunión corta (15 min) 2–3 veces por semana y una revisión al cierre de cada semana.

---

## 7. Plan de trabajo por semana

### Semana 1 — Arquitectura, entorno y base (Unidades I y II) · **100 % Alejandro**

| Tarea | Responsable |
|-------|-------------|
| Documento de definición del proyecto y justificación de arquitectura (este PRD) | Alejandro |
| Tabla comparativa oficial de 5 arquitecturas (versión inicial en §5.1) | Alejandro |
| Repositorio, ramas protegidas, plantilla de PR, ESLint/Prettier, CI básica | Alejandro |
| `docker-compose.yml` con `db`, `liquibase`, `backend`, `frontend`; Dockerfiles multi-stage; `.env.example` | Alejandro |
| Liquibase: `db.changelog-root.yaml` + changesets iniciales (enums, `incidents`, `push_subscriptions`, `users`) | Alejandro |
| Esqueleto NestJS: módulo `health` (`/api/health`), conexión a Postgres con TypeORM (`synchronize: false`), Swagger | Alejandro |
| Entorno local: puertos, no-cache en dev, validación de contexto seguro, ngrok y prueba en teléfono real | Alejandro |
| Proyecto React + Vite + TypeScript, `manifest.json` y Application Shell con *skeletons* estáticos en `index.html` | Alejandro |
| Prototipo del esquema de IndexedDB (stores `incidents`, `outbox`, `meta`) | Alejandro |
| *Onboarding* del equipo: `docker compose up --build` funcionando en cada máquina | Todos (solo esto) |
| **Entregables:** Tabla comparativa · Reporte de configuración del entorno | Alejandro |

### Semana 2 — Service Worker y renderizado · **100 % Alejandro**

| Tarea | Responsable |
|-------|-------------|
| `sw.js`: `install`, `activate`, `fetch` básico, `skipWaiting` por mensaje | Alejandro |
| Script de inyección de versión/precaché post-build | Alejandro |
| Íconos *maskable*, splash y home-screen, prompt de instalación | Alejandro |
| Renderizado mixto: placeholders estáticos + CSR | Alejandro |
| Módulo `incidents` de NestJS (`POST/GET`), DTOs de validación y *changesets* nuevos si hacen falta | Alejandro |
| Módulos `geo.ts` y `camera.ts` (versión funcional) | Alejandro |
| Pruebas del ciclo de vida del SW en DevTools y teléfono real; verificación de instalación y splash | Alejandro |
| **Entregable:** Mapeo del ciclo de vida del SW (código con `install`, `activate`, `skipWaiting`) | Alejandro |

### Semana 3 — Offline, sincronización y hardware

| Tarea | Responsable |
|-------|-------------|
| Persistencia IndexedDB de reportes y fotos; Cache API del shell | Mario |
| Compresión de imagen y flujo completo de captura | Mario |
| Estrategia Network-First con *fallback* local (lee de IndexedDB) | Hector |
| Background Sync (`sync-incidents`) + *fallback* `online`/`visibilitychange` | Jose Ariel (con Mario en el *outbox*) |
| Subida multipart con idempotencia; almacenamiento de fotos | Jose Ariel |
| Módulos `auth` (JWT, `/api/auth/login`) y `admin` (lista con filtros, `PATCH` de estatus); el panel de la Semana 4 los necesita | Jose Ariel |
| Pantalla de lista con estado de sincronización (pendiente/enviado) | Hector |
| Prueba E2E en **Modo Avión**: arrancar → capturar → guardar → reconectar → sincronizar | Mario |
| **Entregable:** Módulo operativo offline | |

### Semana 4 — Push, auditoría y producción

| Tarea | Responsable |
|-------|-------------|
| Push: suscripción en cliente, `push` y `notificationclick` en SW | Mario |
| Servidor Web Push (VAPID) y disparo al cambiar estatus | Jose Ariel |
| Panel del coordinador y optimización de accesibilidad | Hector |
| Optimización de rendimiento (bundle, imágenes, cabeceras de caché) | Mario |
| Despliegue de imágenes `prod` en Render + Neon, *job* de Liquibase en CI, HTTPS, variables de entorno | Alejandro |
| Auditorías Lighthouse (3G) y reporte final; cada quien corrige los hallazgos de su área | Hector (ejecuta y redacta) + todos |
| Congelamiento de código (*code freeze*) 1 día antes de la entrega; ensayo de demo | Todos |
| **Entregables:** Repositorio público · Reporte del plan de pruebas y despliegue (con métricas Lighthouse y URL HTTPS) | |

---

## 8. Plan de pruebas y criterios de aceptación

| Prueba | Cómo | Criterio de aceptación |
|--------|------|------------------------|
| Arranque offline | DevTools → Offline y teléfono en Modo Avión | La app carga el shell completo |
| Captura offline | Crear reporte con GPS + foto en Modo Avión | Se guarda en IndexedDB y aparece como "pendiente" |
| Sincronización | Reactivar red | Reporte llega al servidor; estado pasa a "enviado"; sin duplicados |
| Reintento idempotente | Enviar el mismo `id` dos veces | Una sola fila en la BD |
| Actualización del SW | Desplegar nueva versión | Aparece aviso; al aceptar, se activa y recarga; cachés viejas eliminadas |
| Push | Coordinador cambia estatus | Notificación nativa en el dispositivo; clic abre el reporte |
| Sin `localStorage` | ESLint + revisión de código | Cero usos |
| Instalabilidad | Chrome Android | Se instala; splash e ícono *maskable* correctos |
| Lighthouse | Perfil móvil con throttling 3G | PWA ≥ 90, Rendimiento ≥ 90, Accesibilidad ≥ 95 |
| Producción | URL pública | HTTPS válido, `/api/health` responde 200 |

**Definition of Done (por historia):** código en `main` vía PR aprobado · prueba manual en teléfono real · sin errores en consola · accesible por teclado · documentado en el README si cambia el uso.

---

## 9. Riesgos y mitigaciones

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|--------|:-----:|:-------:|-----------|
| R1 | **Lighthouse 12 o superior eliminó la categoría "PWA"** como puntaje; el enunciado pide 90/100 en esa sección | Alta | Alto | Auditar con **Lighthouse 11** (`npx lighthouse@11 --only-categories=pwa`) o Chrome anterior y documentar la versión; complementar con el checklist de instalabilidad de DevTools → Application. Confirmar con el docente qué versión espera |
| R2 | Background Sync solo existe en Chromium | Alta | Medio | *Fallback* con eventos `online`/`visibilitychange`; probar principalmente en Chrome Android |
| R3 | Push en iOS exige iOS 16.4+ y app instalada | Media | Medio | Demostrar en Android/escritorio; degradar elegantemente |
| R4 | Fotos grandes saturan IndexedDB y el ancho de banda | Media | Medio | Compresión en cliente, límite de 5 MB en servidor |
| R5 | Render gratuito "duerme" el servicio (arranque en frío de ~30 s) | Alta | Medio | Mostrar estado de carga; *ping* previo a la demo; el offline-first lo oculta al usuario |
| R6 | SW con caché mala deja usuarios en versión vieja | Media | Alto | Versionado automático, `no-cache` en `sw.js`, `skipWaiting` controlado |
| R7 | Cuello de botella en una sola persona (SW) | Media | Alto | Revisión cruzada de PRs; Alejandro documenta el SW en el README |
| R8 | Integración tardía rompe en la Semana 4 | Media | Alto | Integrar a `main` a diario; despliegue continuo desde la Semana 2 |
| R9 | Permisos de GPS/cámara denegados | Media | Medio | Mensajes claros, captura manual de ubicación, *fallback* con `<input capture>` |
| R10 | **Semanas 1 y 2 concentradas en una sola persona** (Docker, Liquibase, NestJS, shell, documentos, SW, API de incidentes, geo/cámara) | Alta | Alto | Priorizar: primero Compose + Liquibase + `/health` + manifest/shell (lo que desbloquea al equipo); en la Semana 2, `sw.js` e `incidents` antes que el pulido visual, porque de ellos dependen las Semanas 3 y 4; los documentos se redactan con lo ya construido; el *onboarding* del equipo valida que todo es reproducible |
| R11 | Un *changeset* editado después de aplicarse rompe el *checksum* de Liquibase | Media | Medio | Regla de "solo agregar" + `liquibase validate` en CI; recrear la BD local con `docker compose down -v` si ocurre |
| R12 | Contenedor `liquibase` falla y el backend no arranca | Media | Medio | `depends_on: service_completed_successfully` hace visible el error; revisar con `docker compose logs liquibase` |
| R13 | Curva de aprendizaje de NestJS (DI, decoradores) | Media | Medio | Alejandro deja en la Semana 1 un módulo de ejemplo (`health`) como plantilla para copiar; Swagger documenta cada endpoint |
| R14 | El bundle de React se infla y baja el Rendimiento de Lighthouse | Media | Medio | Presupuesto de 150 KB gzip vigilado en CI; rutas *lazy*; sin librerías de UI; plan B: Preact |
| R15 | Equipo de solo 4: DevOps, QA y documentación recaen sobre quienes ya tienen carga | Media | Medio | Reparto explícito en §6; CI y Docker quedan hechos en la Semana 1 para que después solo se mantengan |

---

## 10. Cumplimiento de requisitos mínimos obligatorios

| Requisito del enunciado | Cómo se cumple |
|-------------------------|----------------|
| Arquitectura desacoplada (Headless) | PWA independiente consumiendo API REST; el cliente nunca toca la BD (§5.1–5.2) |
| Prohibido `localStorage` | Solo IndexedDB (asíncrona) + Cache API; regla ESLint en CI (RF-5) |
| Lighthouse PWA ≥ 90 con 3G | Bundle mínimo, precaché, SW propio, manifest completo (§4, R1) |
| API de Geolocalización y Cámara | RF-4 |
| Network-First con *fallback* local | RF-7 |
| Background Sync | RF-6 |
| Notificaciones Push | RF-8 |
| Cache API + IndexedDB | RF-5 |
| Splash / Home-screen con *maskable icons* | RF-2 |
| Renderizado mixto CSR + estático | RF-1 |
| Hosting con SSL/TLS | §5.8 |
| Repositorio público con historial de commits | §6.1 |
| *Requisito del equipo:* contenedores `backend`, `frontend`, `db` y `liquibase`; migraciones con Liquibase | §5.3, §5.4 |

---

## 11. Glosario

**PWA** Aplicación Web Progresiva · **SW** Service Worker · **CSR** Client-Side Rendering · **SSR** Server-Side Rendering · **VAPID** Voluntary Application Server Identification, identifica al servidor de push · **Outbox** cola local de reportes pendientes de envío · **Idempotencia** repetir una petición produce el mismo resultado que hacerla una vez · **Liquibase** herramienta de migraciones que versiona el esquema de la BD mediante *changesets* · **NestJS** framework de Node.js con arquitectura modular · **Changeset** unidad atómica y versionada de cambio de esquema · **Maskable icon** ícono adaptable a distintas formas de máscara en Android.
