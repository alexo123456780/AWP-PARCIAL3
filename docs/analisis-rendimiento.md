# Análisis de rendimiento de la PWA (SCRUM-207)

Requisitos del PRD §4 bajo 3G simulada: JS inicial < 150 KB gzip, LCP < 2.5 s, panel y cámara bajo demanda y Lighthouse Rendimiento ≥ 90 (meta O4).

## Resultado

| Requisito                                           | Antes                                   | Después                                          |
| --------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| JS inicial (gzip)                                   | 61.6 KB                                 | 61.6 KB (límite 150 KB)                          |
| Panel y cámara bajo demanda                         | Panel sí; cámara dentro del chunk de «Nuevo reporte» | Panel y cámara, cada uno en su chunk |
| Nginx: `no-cache` para `sw.js`, `sync.js`, `index.html` y `max-age` largo para el resto | Cumplía | Cumple (sin cambios) |
| Nginx: compresión                                   | **Ninguna** (el JS salía de 188 KB)     | gzip: el JS viaja en ~62 KB                      |
| LCP, perfil móvil con 3G simulada                   | 2561 ms (no cumplía)                    | 1917 / 2056 / 1958 ms (`/`, `/reportes`, `/panel`) |
| Lighthouse 11.7.1, Rendimiento                      | 89 (no cumplía)                         | **99** en las tres rutas                         |
| Lighthouse 11.7.1, PWA / Accesibilidad              | 100 / —                                 | 100 / 100                                        |

El cambio que mueve la aguja es la **compresión**: sin ella el navegador bajaba 188 KB de JS por una red de 1.6 Mbps; con gzip baja 62 KB. Era el único criterio de Nginx que no se cumplía.

## Bundle por chunk (`npm run build` + `npm run check:bundle`)

| Chunk                          | Sin comprimir | gzip     | Cuándo se descarga                                  |
| ------------------------------ | ------------- | -------- | --------------------------------------------------- |
| `index-*.js` (React, Router, idb, shell) | 188.34 KB | **62.50 KB** (61.64 KB con el nivel 9 que mide el script) | **Inicial** (único script que carga `index.html`) |
| `index-*.css`                  | 5.04 KB       | 1.52 KB  | Inicial (bloquea el render a propósito: estiliza el cascarón estático) |
| `NuevoReporte-*.js`            | 10.61 KB      | 3.64 KB  | Al abrir `/`                                        |
| `MisReportes-*.js`             | 5.09 KB       | 2.07 KB  | Al abrir `/reportes`                                |
| `Detalle-*.js`                 | 2.35 KB       | 1.01 KB  | Al abrir `/reportes/:id`                            |
| `Panel-*.js` (login, lista, detalle, mapa) | 8.82 KB | 3.23 KB | Al abrir `/panel`                                   |
| `camera-*.js`                  | 1.14 KB       | 0.64 KB  | Al tocar «Tomar foto»                               |
| `reports-*.js`, `incident-options-*.js`, `SyncBadge-*.js` | 2.27 KB | 1.17 KB | Compartidos por las rutas que los usan |

- `npm run check:bundle` (corre en el CI tras el build) imprime este desglose, falla si el JS inicial pasa de 150 KB gzip y, con `--lazy Panel,camera`, **falla si el panel o la cámara dejan de ser chunks propios** o si `index.html` los carga al abrir.
- Todos los chunks entran en el precaché del Service Worker (`inject-sw`), así que «Tomar foto» y el panel también cargan sin red tras la primera visita.
- La cámara es un chunk de 0.64 KB: el beneficio de separarla es pequeño, pero cumple el criterio y no cuesta nada (se descarga o sale del precaché en el primer toque). Los tracks de la cámara se sueltan de forma síncrona, sin esperar a ese chunk.

## Nginx (`web/nginx.conf`, imagen `prod`)

Cabeceras verificadas con `curl -H 'Accept-Encoding: gzip'` contra la imagen construida:

| Recurso                       | `Cache-Control`               | `Content-Encoding` |
| ----------------------------- | ----------------------------- | ------------------ |
| `/assets/index-*.js` (con hash) | `public, max-age=31536000`  | `gzip`             |
| `/` (`index.html`)            | `no-cache`                    | `gzip`             |
| `/sw.js` y `/sync.js`         | `no-cache`                    | `gzip`             |
| `/manifest.json` (686 B)      | `public, max-age=31536000`    | — (menor que `gzip_min_length`) |
| `/icons/icon-512.png`         | `public, max-age=31536000`    | — (un PNG ya va comprimido) |

Configuración: `gzip on; gzip_comp_level 6; gzip_min_length 1024; gzip_vary on;` para CSS, JS, JSON, SVG y texto. `tests/docker-env.test.mjs` vigila estas directivas y las cabeceras de caché. La imagen de Nginx no trae Brotli; en producción, Vercel sirve la PWA con Brotli/gzip por su CDN.

## Imágenes e íconos

Los íconos (`icon-192.png` 2.4 KB, `icon-512.png` 8.3 KB y las variantes _maskable_) las dibuja `web/scripts/generate-icons.mjs` y ya pesan unos KB; la app no carga ninguna otra imagen en el camino de renderizado (la foto del reporte vive en IndexedDB o en Supabase y solo se pide en Detalle/Panel). Lighthouse confirma `uses-optimized-images` y `uses-text-compression` en verde y un peso total de la página de 73 KiB.

## Lighthouse 11.7.1 (perfil móvil, throttling simulado, imagen `prod` en local)

Perfil: el de Lighthouse para móvil (CPU 4×, 150 ms de RTT y 1.6 Mbps, el «Fast 3G» de DevTools). Resumen y capturas en `docs/evidencia/lighthouse/` (`base-rendimiento-antes.json`, `rendimiento-imagen-prod.json`).

| Ruta        | Rendimiento | LCP     | FCP     | TBT   | CLS   |
| ----------- | ----------- | ------- | ------- | ----- | ----- |
| `/`         | 99          | 1917 ms | 1204 ms | 48 ms | 0     |
| `/reportes` | 99          | 2056 ms | 1203 ms | 57 ms | 0.012 |
| `/panel`    | 99          | 1958 ms | 1202 ms | 53 ms | 0.025 |

Tres ejecuciones intermedias sobre `/` dieron 90, 98 y 98 (LCP de 2091, 1961 y 1911 ms): **hay variación entre corridas** (sobre todo en el TBT, que depende de la CPU de la máquina). Lighthouse avisa además de que esta máquina es más lenta que su CPU de referencia, así que sus cifras son conservadoras. Oportunidades que quedan: _render-blocking resources_ (~100 ms: el CSS de 5 KB, intencional para estilizar el cascarón antes de pintar) y _unused JavaScript_ (~150 ms: código de React y del Router que esta ruta no usa).

## Límites

- Es una medición de laboratorio sobre la imagen `prod` corriendo en local, no sobre la URL pública: la medición en producción (Render + Vercel, con el servicio despierto) es la de SCRUM-209.
- La compresión de la imagen de Nginx es gzip; en Vercel la PWA llega con Brotli.
- No se probó en un teléfono real ni con una red 3G real.

## Cómo repetirlo

```bash
cd web && npm run build && npm run check:bundle          # desglose de chunks y presupuesto
docker build --target prod -t civicguard-web-prod ./web && docker run -d --rm -p 8080:8080 civicguard-web-prod
curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' http://localhost:8080/   # cabeceras
docker run --rm --network host --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/work -w /work/e2e \
  mcr.microsoft.com/playwright:v1.64.1-noble node scripts/lighthouse.mjs http://localhost:8080 --label rendimiento --categories performance,accessibility,pwa
```
