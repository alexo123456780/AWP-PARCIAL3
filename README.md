# CivicGuard PWA

Sistema de Gestión de Emergencias e Incidencias en Infraestructura Urbana — Proyecto Integrador 2 (Ingeniería en Desarrollo y Gestión de Software).

PWA _offline-first_ para reportar incidencias con ubicación GPS y foto de evidencia, incluso sin conexión; los reportes se sincronizan solos al volver la red y los cambios de estatus llegan como notificación push.

## Documentación

- [PRD](docs/PRD.md) — definición del proyecto, requerimientos, decisiones de arquitectura, plan de trabajo y cumplimiento del enunciado.
- [Tabla comparativa de arquitecturas](docs/tabla-comparativa-arquitecturas.md) — evaluación de las 5 arquitecturas y justificación de la PWA.
- [Enunciado del proyecto](docs/awp.pdf)

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
- **CI:** el workflow `.github/workflows/ci.yml` corre lint, formato y pruebas en cada PR y en cada push a `develop`/`prod`.
