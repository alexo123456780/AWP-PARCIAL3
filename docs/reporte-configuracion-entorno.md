# Reporte de configuración del entorno

Entregable de la Semana 1 (PRD §5.4). Describe cómo queda el entorno local de CivicGuard PWA: herramientas, puertos, supresión de cachés HTTP, validación de contexto seguro y prueba en móvil (emulado) con ngrok.

> **Estado:** todo está validado con un túnel ngrok real y **móviles emulados** (Pixel 7 en Chromium e iPhone 14 en WebKit). La prueba **no se hizo en un teléfono físico**: fue una decisión del responsable del proyecto y se deja constancia en la sección 6.

## 1. Herramientas y versiones

| Herramienta                  | Versión                     | Uso                                                              |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------- |
| WSL2 (kernel)                | 6.18.58.1-microsoft-standard | Entorno de desarrollo; el repositorio vive en el FS de WSL (no en `/mnt/c`) para que el _hot reload_ funcione sin _polling_ |
| Docker / Docker Compose      | 29.9.0 / v5.6.0             | `docker compose up --build` levanta todo el entorno              |
| Node.js (host)               | 24.21.0 (npm 11.19.0)       | Herramientas de calidad del repo (ESLint, Prettier, commitlint)  |
| Node.js (contenedores)       | 22.23.4 (npm 10.9.9)        | Imagen `node:22-alpine` de `api/` y `web/`; el proyecto exige ≥ 22.12 |
| PostgreSQL                   | 16.16 (`postgres:16-alpine`) | Base de datos local                                             |
| Liquibase                    | 4.29.2                      | Migraciones (`db/changelog/`)                                    |
| Nginx (imagen `prod` de web) | 1.27.5 (`nginx-unprivileged`) | Sirve la PWA compilada en el puerto 8080                       |
| React / React Router         | 18.3.1 / 7.18.5             | PWA (`web/`)                                                     |
| Vite / TypeScript / Vitest   | 8.3.8 / 6.0.3 / 4.1.12      | Servidor de desarrollo, tipos y pruebas de `web/`                |
| NestJS / TypeORM             | 12.5 / 1.1                  | API (`api/`)                                                     |
| Git / GitHub CLI             | 2.56.0 / 2.104.0            | Flujo de ramas y PR                                              |
| ngrok                        | 3.39.13 (`~/.local/bin/ngrok`, cuenta gratuita autenticada) | Túnel HTTPS hacia el puerto 5173 |
| Móviles de prueba            | Pixel 7 (Chromium) e iPhone 14 (WebKit), emulados con Playwright 1.64 | Prueba de la PWA por el túnel; ver sección 6 |

## 2. Puertos

| Puerto | Servicio                                  | Exposición                                  | Notas                                                                 |
| ------ | ----------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| 5432   | PostgreSQL (`db`)                         | Solo `127.0.0.1` (variable `DB_PORT`)       | Si el 5432 del host está ocupado, cambia `DB_PORT` en `.env`          |
| 3000   | API NestJS (`backend`)                    | Host                                        | `GET /api/health` y Swagger en `/api/docs`                            |
| 5173   | PWA en desarrollo (`frontend`, Vite)      | Host                                        | Es el puerto que se expone con `ngrok http 5173`                      |
| 8080   | PWA en producción (imagen `prod`, Nginx)  | Solo al ejecutar `docker build --target prod ./web` | Nginx sin privilegios; no forma parte de `docker compose up`  |
| 4040   | Inspector web de ngrok                    | Solo `127.0.0.1`                            | Lo abre el propio cliente de ngrok; muestra las peticiones del túnel  |

## 3. Supresión de cachés HTTP

Objetivo: que ningún caché HTTP clásico oculte cambios mientras se desarrolla y se prueba el Service Worker.

| Capa                    | Configuración                                                                                              | Dónde                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Servidor de desarrollo  | `Cache-Control: no-store` en **todas** las respuestas de Vite (HTML, módulos, CSS, _assets_ y dependencias pre-empaquetadas) | `web/vite.config.ts` (`server.headers`)  |
| Navegador (DevTools)    | Network → **Disable cache** y Application → Service Workers → **Update on reload**, con DevTools abierto   | Manual, en cada navegador                |
| Producción (imagen Nginx) | `sw.js` e `index.html` con `Cache-Control: no-cache`; el resto de _assets_ con `max-age` largo           | `web/nginx.conf` (Sprint 4 los afina)    |

**Verificación realizada** (contenedor `frontend` real): `/`, `/src/app/main.tsx`, `/manifest.json`, `/src/shell.css` y una dependencia pre-empaquetada de `node_modules/.vite/deps/` responden `Cache-Control: no-store`. Está cubierto por `web/src/dev-server.test.ts`, que arranca el servidor de Vite y comprueba la cabecera.

## 4. Contexto seguro (`window.isSecureContext`)

Cámara, GPS, Service Worker y notificaciones push solo funcionan en un contexto seguro: HTTPS o `localhost`.

| Origen                                  | Resultado esperado | Estado                                                      |
| --------------------------------------- | ------------------ | ----------------------------------------------------------- |
| `http://localhost:5173`                 | `true`             | **Validado** (Chromium headless (Playwright 1.64) contra el contenedor)  |
| `https://<NGROK_DOMAIN>` (túnel HTTPS)  | `true`             | **Validado** con ngrok y móviles emulados (secciones 5.4 y 6); no probado en un teléfono físico |
| `http://<IP-de-la-LAN>:5173` (sin túnel) | `false`           | Por eso se usa ngrok: un teléfono no puede usar `localhost` |

Cómo comprobarlo: abrir la página, DevTools → Console y ejecutar `window.isSecureContext`.

## 5. Túnel ngrok y prueba en un teléfono real

### 5.1 Preparación (una sola vez)

1. Instalar ngrok y registrar el _authtoken_ de tu cuenta: `ngrok config add-authtoken <TU_TOKEN>`. El token es personal: **no lo pegues en el repositorio, en `.env.example`, en el PR ni en este reporte**.
2. Opcional pero recomendado: reservar un dominio estático gratuito en el panel de ngrok (Universe → Domains). Con dominio aleatorio habría que cambiar `NGROK_DOMAIN` y reiniciar en cada sesión.

### 5.2 Cada sesión

1. En `.env` (copia de `.env.example`), define el dominio **sin esquema**: `NGROK_DOMAIN=mi-app.ngrok-free.app`. Compose lo usa en dos sitios: `server.allowedHosts` de Vite y la lista de CORS del backend.
2. Levantar el entorno: `docker compose up --build -d` (si ya estaba arriba, el mismo comando recrea `frontend` y `backend` con el nuevo valor).
3. Abrir el túnel en el host: `ngrok http --url=mi-app.ngrok-free.app 5173` (con dominio aleatorio, solo `ngrok http 5173` y copiar el dominio que muestra).
4. Abrir `https://mi-app.ngrok-free.app` en el ordenador: el plan gratuito muestra una página de aviso de ngrok; pulsar **Visit Site**. Comprobar `window.isSecureContext === true`.
5. Abrir la misma URL en el teléfono. Con el cascarón visible, navegar a Nuevo reporte, Mis reportes y Panel.

### 5.3 Seguridad del túnel

- Vite solo acepta el Host de `localhost`/IP y el de `NGROK_DOMAIN`; cualquier otro recibe **403** (comprobado con el contenedor real: Host de ngrok → 200, Host ajeno → 403). Nunca se usa `allowedHosts: true`.
- La URL de ngrok es pública mientras el túnel esté abierto: ciérralo (`Ctrl+C`) al terminar y no expongas datos reales.
- El teléfono no alcanza `localhost:3000`. Mientras la PWA no llame a la API no importa; cuando lo haga (Sprint 2), habrá que exponer también el backend o hacer _proxy_ desde Vite.

### 5.4 Validación con Chromium en perfil de móvil (sin teléfono real)

El mecanismo (nombre de host del túnel en `NGROK_DOMAIN` → `server.allowedHosts`) se comprobó contra un túnel de ngrok real (`ngrok http 5173`) y, antes de tener cuenta, contra un _Quick Tunnel_ de Cloudflare. **Es emulación (Chromium con perfil Pixel 7, 412×839, agente de usuario móvil), no un teléfono real**: no sustituye la prueba de la sección 6.

Resultado idéntico en ambos túneles, con Chromium (Playwright 1.64) contra la URL HTTPS pública:

- `/`, `/reportes`, `/reportes/7` y `/panel` cargan y muestran su título.
- `window.isSecureContext === true` y la respuesta trae `Cache-Control: no-store`.
- El WebSocket de _hot reload_ se conecta por `wss://` sin configuración adicional de Vite (`[vite] connected`).
- Sin errores de consola ni de página.
- Con un Host ajeno el servidor responde 403.
- En ngrok, el inspector (`http://127.0.0.1:4040`) registró las peticiones: respuestas 200 y las actualizaciones 101 del WebSocket.
- Las pruebas automáticas con navegador envían la cabecera `ngrok-skip-browser-warning: true` para saltar la página de aviso del plan gratuito; en un navegador normal hay que pulsar **Visit Site**.

## 6. Evidencia de la prueba en móvil

> **Alcance real de la prueba.** Se hizo con navegadores en perfil de móvil (emulación de pantalla, agente de usuario y eventos táctiles) a través del túnel HTTPS de ngrok. **No se probó en un teléfono físico**: por decisión del responsable, la emulación sustituye a la prueba en hardware real. La emulación no cubre cámara, GPS ni el comportamiento de un Android o iOS real; esas pruebas siguen pendientes para cuando existan esas funciones (Sprint 2 en adelante).

Datos de la prueba (2026-11-14): ngrok 3.39.13 (plan gratuito) con `ngrok http 5173`; dominio público omitido porque el dominio aleatorio incluye la IP pública del equipo (`<NGROK_DOMAIN>`).

| Comprobación                                                                 | Resultado | Evidencia                                                                                     |
| ---------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| La PWA abre por la URL HTTPS de ngrok en un Pixel 7 emulado (412×839)        | Correcto  | `docs/evidencia/pixel7-shell.png`                                                             |
| Las rutas navegan: Mis reportes y Panel (Pixel 7)                            | Correcto  | `docs/evidencia/pixel7-reportes.png`, `docs/evidencia/pixel7-panel.png`                       |
| La PWA abre en un iPhone 14 emulado con WebKit (390×664)                     | Correcto  | `docs/evidencia/iphone14-shell.png`, `docs/evidencia/iphone14-panel.png`                      |
| `window.isSecureContext === true` en la URL de ngrok (ambos navegadores)     | Correcto  | `docs/evidencia/ngrok-verificacion.txt`                                                       |
| Sin errores de consola en ninguna ruta                                       | Correcto  | `docs/evidencia/ngrok-verificacion.txt`                                                       |
| El inspector de ngrok registra las peticiones (200 y 101 del WebSocket)      | Correcto  | `docs/evidencia/ngrok-verificacion.txt`                                                       |
| Prueba en un teléfono físico                                                 | **No realizada** | —                                                                                      |

## 7. Cómo reproducir las verificaciones automáticas

```bash
cd web && npm ci && npm test      # incluye src/dev-server.test.ts (no-store y allowedHosts)
```
