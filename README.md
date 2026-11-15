# CivicGuard PWA

Sistema de Gestión de Emergencias e Incidencias en Infraestructura Urbana — Proyecto Integrador 2 (Ingeniería en Desarrollo y Gestión de Software).

PWA _offline-first_ para reportar incidencias con ubicación GPS y foto de evidencia, incluso sin conexión; los reportes se sincronizan solos al volver la red y los cambios de estatus llegan como notificación push.

## Documentación

- [PRD](docs/PRD.md) — definición del proyecto, requerimientos, decisiones de arquitectura, plan de trabajo y cumplimiento del enunciado.
- [Tabla comparativa de arquitecturas](docs/tabla-comparativa-arquitecturas.md) — evaluación de las 5 arquitecturas y justificación de la PWA.
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
- **Manifest (RF-2):** `web/public/manifest.json`, enlazado desde `index.html`. Los íconos _maskable_ y el prompt de instalación llegan en el Sprint 2.
- **Comandos** (`cd web && npm ci`): `npm run dev`, `npm run build` (comprueba tipos y genera `dist/`) y `npm test` (Vitest + Testing Library).

## Base de datos y migraciones

Liquibase es el único dueño del esquema (el backend nunca crea ni altera tablas). El changelog vive en `db/changelog/`: `db.changelog-root.yaml` hace `includeAll` de `migrations/`, donde cada changeset es un `.sql` con formato Liquibase (`--liquibase formatted sql`), numerado (`0001-…`) y con su `--rollback`.

- **Aplicar:** `docker compose up db liquibase` (el servicio `liquibase` aplica los changesets y termina).
- **Cambiar el esquema:** crea un changeset nuevo con el siguiente número en el mismo PR que el código que lo usa. Nunca edites uno ya aplicado: rompe su checksum y el job `liquibase-validate` del CI falla. Si te pasa en local, recrea la BD con `docker compose down -v`.
- **Revertir el último changeset:** `docker compose run --rm liquibase rollback-count --count=1`.

## API (NestJS)

Proyecto ESM en `api/` (NestJS 12, TypeORM, PostgreSQL). Con el entorno de Docker arriba: `GET http://localhost:3000/api/health` y Swagger en `http://localhost:3000/api/docs`.

- **`GET /api/health`:** `200 {"status":"ok","database":"up"}`; si la BD no responde, `503 {"status":"error","database":"down"}` (el motivo solo va al log).
- **Variables** (las inyecta `docker-compose.yml`): `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (obligatorias, sin valores por defecto: la API no arranca sin ellas), `DB_PORT` (5432), `PORT` (3000) y `CORS_ORIGINS` (lista separada por comas; vacía = ningún origen cruzado). Compose la fija a `http://localhost:5173` y, si defines `NGROK_DOMAIN`, a su dominio.
- **Seguridad desde el arranque:** TypeORM con `synchronize: false` (el esquema es solo de Liquibase), CORS con allowlist, cabeceras de seguridad (`app.useSecurityHeaders()` de Nest 12.1+: mismos valores que Helmet 8, sin el paquete) y `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted` (400 ante campos inválidos o no declarados). El _rate limiting_ llega con el módulo `auth`.
- **Módulo nuevo:** copia `api/src/health/` (su comentario en `health.module.ts` explica los pasos: DTOs validados y documentados, servicio, controlador y registro en `AppModule`).
- **Pruebas** (Vitest, sin BD): `cd api && npm ci && npm test`. Las e2e levantan la app con la misma `configureApp` que `main.ts`.

## Calidad de código y flujo Git

Requiere Node.js 22.12 o superior. Tras clonar: `npm ci` (instala también los hooks de Husky).

| Comando                | Qué hace                                                      |
| ---------------------- | ------------------------------------------------------------- |
| `npm run lint`         | ESLint sobre todo el repo (`web/`, `api/`, configuración)     |
| `npm run format:check` | Verifica el formato con Prettier (`npm run format` lo aplica) |
| `npm test`             | Pruebas de las reglas de calidad (ESLint y commitlint)        |

- **Sin `localStorage`/`sessionStorage` (RF-5):** ESLint falla ante cualquier uso, incluido `window.`, `globalThis.` o `self.`. Usa IndexedDB (`idb`).
- **Commits convencionales:** `tipo(SCRUM-N): descripción` (por ejemplo `feat(SCRUM-122): agregar CI`). Husky + commitlint rechazan cualquier otro formato.
- **Ramas:** se trabaja en una rama por ticket y se integra con PR a `develop`; `prod` es la rama de producción (equivale a la `main` del PRD). Ninguna admite push directo: ambas exigen PR y que pase el check `lint-and-test`, y `prod` además exige 1 aprobación.
- **CI:** el workflow `.github/workflows/ci.yml` corre lint, formato y pruebas (`lint-and-test`) en cada PR y en cada push a `develop`/`prod`. En cada PR, además, `liquibase-validate` aplica el changelog de la rama base a un Postgres temporal, valida el de la PR (detecta changesets editados por diferencia de checksum) y comprueba que el rollback seguido de update deja el esquema íntegro.
