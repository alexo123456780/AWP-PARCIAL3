# Auditoría de accesibilidad (SCRUM-206)

Requisito del PRD §4: contraste AA, navegación completa con teclado y foco visible, `alt` en imágenes, etiqueta en cada campo y objetivos táctiles de al menos 44 px. Meta O4: Lighthouse Accesibilidad ≥ 95 en perfil móvil.

## Resultado

| Comprobación                                            | Resultado                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| axe (WCAG 2.0/2.1/2.2 A y AA, mejores prácticas)        | 0 violaciones en las 16 vistas y estados auditados                                                     |
| Objetivos táctiles ≥ 44 × 44 px                         | 0 elementos por debajo (enlaces dentro de un párrafo, exentos como en WCAG 2.5.5)            |
| Foco visible al recorrer con Tab                        | 0 controles sin indicador de foco                                                            |
| Lighthouse 11.7.1, perfil móvil, Accesibilidad          | **100** en `/`, `/reportes` y `/panel` (imagen `prod`); ver `docs/evidencia/lighthouse/`     |
| Hallazgos de gravedad alta o media                      | **Ninguno**                                                                                  |

No hubo hallazgos que corregir: las pantallas ya cumplían (etiquetas con `for`, `alt`, objetivos de 44 px, foco propio, colores verificados). Lo que entrega esta tarea es la **auditoría repetible** (`e2e/tests/accesibilidad.spec.ts`) que lo comprueba en cada vista y evita regresiones.

## Pantallas y estados auditados

| Pantalla                         | Estados                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Acceso (`/acceso`)               | elegir perfil · login del coordinador con error                                                    |
| Nuevo reporte (`/`)              | vacío · con el botón «Instalar CivicGuard» · con errores de validación · con la ubicación manual (GPS denegado) y sus errores · con la cámara abierta · con la foto capturada |
| Mis reportes (`/reportes`)       | vacío · con reportes (badges de envío y botón de avisos)                                           |
| Detalle (`/reportes/:id`)        | reporte con foto · reporte inexistente (error)                                                     |
| Panel (`/panel`)                 | lista · detalle con foto y mapa · diálogo de confirmación del cambio de estatus                    |
| Sin conexión (`/offline.html`)   | página autónoma del Service Worker                                                                 |

## Cómo se comprobó cada criterio

- **Contraste AA:** la regla `color-contrast` de axe sobre cada vista y estado, más los pares de la paleta (`web/src/shell.css`):

  | Par                                     | Contraste |
  | --------------------------------------- | --------- |
  | Texto `#1a1a1a` sobre blanco            | 17.4 : 1  |
  | Marca `#0b5cab` sobre blanco (enlaces)  | 6.7 : 1   |
  | Blanco sobre marca (cabecera, botones)  | 6.7 : 1   |
  | Error `#b00020` sobre blanco            | 7.3 : 1   |
  | Badge «Pendiente»                       | 7.2 : 1   |
  | Badge «Enviado»                         | 10.4 : 1  |
  | Badge «Con error»                       | 10.2 : 1  |

  El estado de un envío se dice además con ícono y texto, no solo con color.
- **Teclado y foco visible:** la prueba recorre cada vista con `Tab` y comprueba que todo control que recibe el foco tiene contorno o sombra (`:focus-visible` propio en enlaces, botones y campos). Los botones del panel son `<button>` reales (sin `div` con `onClick`), el foco pasa a «Confirmar» al pedir la confirmación y el mapa estático no atrapa el foco.
- **`alt` y etiquetas:** `image-alt`, `label` y `aria-*` de axe; las imágenes decorativas (teselas del mapa, íconos de los badges) van con `alt=""` o `aria-hidden`, y la foto del reporte y el mapa tienen nombre accesible. Cada campo del formulario tiene su `<label for>` y los errores se enlazan con `aria-describedby`.
- **Objetivos táctiles:** la prueba mide cada enlace, botón, campo y selector visible y falla si alguno mide menos de 44 px de ancho o de alto.

## Control negativo de la auditoría

Una auditoría que nunca falla no demuestra nada, así que se comprobó que detecta los defectos: con un rojo de error claro (`#ff9999`) falla `color-contrast` en los mensajes de validación; con botones de 30 px la lista de objetivos pequeños se llena; y con `outline: none` en botones y navegación aparecen los controles sin foco. Los cambios se revirtieron después.

## Hallazgos

| Pantalla | Descripción | Gravedad | Estado |
| -------- | ----------- | -------- | ------ |
| —        | Sin hallazgos de gravedad alta, media ni baja en las comprobaciones automáticas | — | — |

## Limitaciones

- No se probó con un lector de pantalla real (TalkBack o VoiceOver) ni en un teléfono físico: las comprobaciones son automáticas (axe, Lighthouse, medición de tamaños y recorrido con Tab) en Chromium.
- El aviso «Nueva versión disponible» (`UpdateNotice`) solo aparece cuando hay una versión nueva del Service Worker y no está en la auditoría; usa los mismos colores que la cabecera (6.7 : 1) y un botón de 44 px.
- Lighthouse se midió sobre la imagen `prod` de la PWA corriendo en local; la medición sobre la URL pública es la de SCRUM-209.
- La automatización no sustituye una revisión manual completa: axe y Lighthouse detectan solo una parte de los problemas posibles.

## Cómo repetirla

```bash
# Auditoría por pantalla (axe, 44 px y foco): parte de la suite E2E (ver README, «Pruebas E2E»).
docker run --rm --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.64.1-noble npx --prefix e2e playwright test --config e2e/playwright.config.ts accesibilidad

# Lighthouse 11 (perfil móvil) sobre la imagen prod en local:
docker build --target prod -t civicguard-web-prod ./web && docker run -d --rm -p 8080:8080 civicguard-web-prod
docker run --rm --network host --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/work -w /work/e2e \
  mcr.microsoft.com/playwright:v1.64.1-noble node scripts/lighthouse.mjs http://localhost:8080 --label accesibilidad --categories accessibility
```
