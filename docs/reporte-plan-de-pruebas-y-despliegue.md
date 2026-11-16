# Reporte del plan de pruebas y despliegue — CivicGuard PWA

Entregable de la Semana 4 (SCRUM-209). Resume el plan de pruebas del PRD §8 con su resultado, las métricas de Lighthouse sobre la URL pública, el checklist PWA y el estado del despliegue. Fecha de las mediciones: 2026-11-16 (UTC), ya con el release `2a6a13f` (PR #34) desplegado en producción.

## 1. URL pública y versiones

| Pieza                | Dirección                                       | Verificación                                                                        |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| PWA (Vercel)         | **https://civicguard-pwa.vercel.app**           | HTTPS con TLS 1.3, certificado de Google Trust Services (`*.vercel.app`, vigente hasta 2027-01-29), HSTS (`max-age=63072000; includeSubDomains; preload`), Brotli |
| API (Render)         | https://civicguard-api-nhww.onrender.com        | TLS 1.3, certificado de Google Trust Services (vigente hasta 2026-12-20, lo renueva Render); `GET /api/health` → `200 {"status":"ok","database":"up"}` |
| Repositorio público  | https://github.com/alexo123456780/AWP-PARCIAL3  | —                                                                                   |

| Herramienta        | Versión                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| **Lighthouse**     | **11.7.1** (`npx lighthouse@11`; riesgo R1: Lighthouse 12 eliminó la categoría PWA) |
| Navegador          | Chromium 156 (el de Playwright 1.64.1), modo `--headless=new`                      |
| Perfil             | Móvil, throttling simulado de Lighthouse (CPU 4×, RTT 150 ms, 1.6 Mbps: el «Fast 3G» de DevTools) |
| Servicio de Render | **Despierto** antes de medir (`/api/health` respondió 200 al primer intento)       |

## 2. Resultados de Lighthouse

Comandos (reproducibles, ver README «Pruebas E2E → Lighthouse 11»):

```bash
node scripts/lighthouse.mjs https://civicguard-pwa.vercel.app --label produccion-release-pwa   --categories pwa
node scripts/lighthouse.mjs https://civicguard-pwa.vercel.app --label produccion-release-movil --categories performance,accessibility
```

La primera ejecuta `npx lighthouse@11 --only-categories=pwa`; la segunda, el perfil móvil con throttling para Rendimiento y Accesibilidad. Resumen en JSON y capturas del informe en `docs/evidencia/lighthouse/`.

### 2.1 Producción (URL pública con el release `2a6a13f` desplegado)

Medido a las 03:15–03:16 UTC, con el despliegue de Vercel del release (PR #34, que lleva todo el trabajo de SCRUM-182 a SCRUM-210) ya completado y el servicio de Render despierto.

| Ruta        | PWA (meta ≥ 90) | Rendimiento (≥ 90) | Accesibilidad (≥ 95) | LCP (< 2.5 s) | FCP     | TBT    | CLS   |
| ----------- | :-------------: | :----------------: | :------------------: | ------------- | ------- | ------ | ----- |
| `/`         | **100**         | **98**             | **100**              | 1511 ms       | 1332 ms | 129 ms | 0.053 |
| `/reportes` | **100**         | **100**            | **100**              | 1431 ms       | 1288 ms | 60 ms  | 0.012 |
| `/panel`    | **100**         | **100**            | **100**              | 1406 ms       | 806 ms  | 45 ms  | 0.025 |

**Se cumplen las tres metas (O3 y O4) en las tres rutas.** Ninguna medición quedó bajo la meta, así que no hay hallazgos que asignar por incumplimiento (ver §5 para lo pendiente). Hay variación entre corridas: una medición minutos antes, con el release `96e1d80`, dio Rendimiento 100 en las tres rutas (su resumen se sustituyó por esta medición), y la del release anterior `d76ef29` (100 / 100 / 96) se conserva en `docs/evidencia/lighthouse/` como `produccion-pwa.json` y `produccion-movil.json`.

### 2.2 Imagen `prod` de Docker en local (Nginx con gzip, sin CDN)

La misma versión servida por la imagen que construye el repositorio, para comprobar la compresión y las cabeceras de Nginx.

| Ruta        | PWA | Rendimiento | Accesibilidad | LCP     |
| ----------- | :-: | :---------: | :-----------: | ------- |
| `/`         | 100 | 99          | 100           | 1917 ms |
| `/reportes` | 100 | 99          | 100           | 2056 ms |
| `/panel`    | 100 | 99          | 100           | 1958 ms |

Sus LCP son mayores que los de Vercel (CDN con Brotli y red real) porque es una medición local con una CPU más lenta que la de referencia de Lighthouse; todas cumplen. Antes de las optimizaciones de SCRUM-207 la misma imagen daba Rendimiento 89 y LCP de 2561 ms (`docs/analisis-rendimiento.md`).

### 2.3 Checklist PWA (Lighthouse 11.7.1, producción)

| Comprobación                                                              | Resultado |
| ------------------------------------------------------------------------- | :-------: |
| Manifest y Service Worker cumplen los requisitos de instalabilidad        | ✅ |
| Pantalla de bienvenida (_splash_) personalizada                           | ✅ |
| Color de tema en la barra de direcciones                                  | ✅ |
| Contenido dimensionado para el _viewport_                                 | ✅ |
| `<meta name="viewport">` con `width` o `initial-scale`                    | ✅ |
| Ícono _maskable_ en el manifest                                           | ✅ |
| Funciona en varios navegadores                                            | Manual: Chromium verificado; WebKit solo emulado en sprints anteriores; Firefox sin probar |
| Las transiciones de página no esperan a la red                            | Manual: ✅ (la navegación resuelve en el cliente, sin ir a la red) |
| Cada página tiene su URL                                                  | Manual: ✅ (`/`, `/reportes`, `/reportes/:id`, `/panel`) |
| Redirección HTTP → HTTPS y arranque sin red tras la primera visita        | ✅ Vercel (308) y Render (301) redirigen HTTP a HTTPS y Vercel envía HSTS; sin red, el cascarón sale del precaché (prueba E2E de Modo Avión) |

## 3. Plan de pruebas del PRD §8

| Prueba                      | Cómo se verificó                                                                                                   | Resultado |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | :-------: |
| Arranque offline            | E2E con Playwright apagando de verdad los servidores (`e2e/tests/modo-avion.spec.ts`) y pruebas del Service Worker | ✅ Cumple (emulado) |
| Captura offline             | El mismo escenario: ubicación y cámara simuladas, el reporte queda en IndexedDB como «Pendiente»                   | ✅ Cumple (emulado) |
| Sincronización              | Al volver la red el reporte llega con su foto JPEG y pasa a «Enviado» (E2E; también con la API real y PostgreSQL en el SCRUM-177) | ✅ Cumple |
| Reintento idempotente       | E2E (mismo `id` dos veces → una fila), pruebas de la API (`ON CONFLICT DO NOTHING`) y PostgreSQL real (SCRUM-153/178) | ✅ Cumple |
| Actualización del SW        | Pruebas de `UpdateNotice` y del ciclo de vida (`docs/mapeo-ciclo-de-vida-sw.md`, 23/23 comprobaciones en Chromium)   | ✅ Cumple |
| Push                        | API: `web-push` simulado y envío real a FCM (suscripción caducada → borrada); navegador: la suscripción, el aviso con el reporte y el toque que abre el detalle (E2E con la entrega del `push` simulada, porque Chromium sin ventana no tiene servicio de push) | ⚠️ Parcial: falta la prueba en un teléfono real |
| Sin `localStorage`          | Regla de ESLint (con su prueba) en cada PR y E2E del panel que comprueba que nada se escribe en el almacenamiento    | ✅ Cumple |
| Instalabilidad              | Lighthouse `installable-manifest`, `splash-screen` y `maskable-icon` en verde; `Page.getInstallabilityErrors` vacío (SCRUM-151) | ⚠️ Parcial: falta instalar en un Chrome Android real |
| Lighthouse                  | §2: PWA 100, Rendimiento 96–100, Accesibilidad 100 en producción con Lighthouse 11.7.1                              | ✅ Cumple |
| Producción                  | HTTPS válido y `/api/health` → 200 en la URL pública (§1)                                                           | ✅ Cumple |

Otras verificaciones del plan de calidad: 375 pruebas de la PWA, 165 de la API y 47 de la raíz (corren en el CI en cada PR) y 12 escenarios E2E con Playwright (2 de Modo Avión, 1 de avisos, 4 del panel y 5 de accesibilidad sobre 16 vistas), que se ejecutan en local con Docker y no están en el CI porque necesitan el navegador; auditoría de accesibilidad en `docs/auditoria-accesibilidad.md`.

## 4. Despliegue

- **Arquitectura:** PWA estática en Vercel (proyecto `civicguard-pwa`, rama de producción `prod`); API NestJS en Docker en Render (plan gratuito, duerme tras 15 min sin tráfico); PostgreSQL gestionado en Render. El PRD §5.8 preveía Neon como base: se usó el Postgres de Render, ya operativo, sin cambios de código (la API lee `DATABASE_URL`).
- **CI/CD:** cada PR corre lint, formato, pruebas, build, presupuesto de JS y `liquibase validate`; los PR a `develop` se fusionan solos al pasar los checks; el release `develop → prod` es un PR manual y, al fusionarse, `deploy-backend` migra con Liquibase, llama al _deploy hook_ de Render y espera `/api/health`, mientras Vercel construye la PWA.
- **Estado hoy:** producción corresponde al release del PR #34 (`prod` en `2a6a13f`, fusionado el 2026-11-16 a las 03:13 UTC); su CI (`lint-and-test` y `deploy-backend`: migración, _deploy hook_ de Render y comprobación de `/api/health`) terminó en verde y Vercel completó el despliegue de producción (estado `Deployment has completed`; el chunk `reports-*.js` de producción es idéntico al de la compilación de `develop`). Verificado en la URL pública: `sw.js` trae los eventos `push` y `notificationclick`, `GET /api/health` → 200, `GET /api/admin/incidents` sin token → 401, `/api/docs` → 200 y `GET /api/push/vapid-public-key` → **503**, que es lo esperado mientras no estén las variables `VAPID_*` en Render.
- **Por qué Vercel dice «1 Skipped Deployment / Ignored» en los PR:** `web/vercel.json` define un `ignoreCommand` que solo deja construir la rama `prod`. El comentario del bot en un PR corresponde a la _vista previa_ de su rama de origen (`develop` o `feature/*`), que se omite a propósito («Canceled by Ignored Build Step»); el despliegue de producción lo dispara el commit de fusión sobre `prod` y aparece como _deployment_ `production` del commit y como estado `Vercel: success`.

## 5. Pendientes y responsables

Ninguna medición quedó bajo la meta. Esto es lo que falta para cerrar el entregable y quién lo hace (responsables según el PRD §6 y los tickets de Jira), con plazo anterior al _code freeze_ del 10 de diciembre:

| Pendiente                                                                                                                                | Responsable                     | Plazo      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------- |
| Generar el par VAPID (`npx web-push generate-vapid-keys` en `api/`), capturar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en Render y sembrar el coordinador (`npm run seed:coordinator`); sin esto el push de producción responde 503 | Alejandro + Jose Ariel          | 2026-12-08 |
| Prueba manual en un teléfono real: instalar en Chrome Android, Modo Avión, push con clic al detalle (subtarea SCRUM-215, evidencia en capturas o video) | Mario + Jose Ariel              | 2026-12-09 |
| Si hay más cambios antes del _freeze_: repetir la medición de §2.1 tras el release final (`node scripts/lighthouse.mjs …`)                | Héctor (Lighthouse)             | 2026-12-09 |
| Opcional: reducir el JavaScript sin uso que Lighthouse señala (~150 ms de ahorro posible; no afecta a las metas)                         | Mario (rendimiento)             | Tras el _freeze_, si hay tiempo |

## 6. Evidencia

- Lighthouse: `docs/evidencia/lighthouse/produccion-release-pwa.json` y `produccion-release-movil.json` (producción con el release `2a6a13f`), `produccion-pwa.json` y `produccion-movil.json` (producción con el release anterior) y `rendimiento-imagen-prod.json`, `accesibilidad-imagen-prod.json`, `base-rendimiento-antes.json` (imagen `prod` local), con una captura del informe por ruta.
- E2E: `docs/evidencia/e2e-*.png` y `docs/evidencia/panel-mapa-osm-teselas-reales.png`.
- Análisis: `docs/analisis-rendimiento.md`, `docs/auditoria-accesibilidad.md`, `docs/mapeo-ciclo-de-vida-sw.md`, `docs/guia-despliegue-vercel-render.md`.
