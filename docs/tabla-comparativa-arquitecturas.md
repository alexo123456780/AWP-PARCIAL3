# Tabla comparativa oficial de arquitecturas — CivicGuard PWA

Proyecto Integrador 2 · Entregable técnico de la Semana 1 · Versión 1.0 · 14/11/2026
Documento ligado al [PRD](PRD.md) (§5.1 decisión, §5.3 stack, §10 cumplimiento del enunciado).

**Leyenda:** ✓ cumple · Parcial · ✗ no cumple.

---

## 1. Caso de estudio y criterio de evaluación

CivicGuard PWA lo usan operadores de campo que reportan incidencias de infraestructura urbana (baches, fugas, alumbrado, cables caídos) donde muchas veces **no hay cobertura**. Las cinco arquitecturas se evalúan contra el mismo caso de uso de referencia:

> **Reportar una incidencia en Modo Avión, con GPS y foto de evidencia**, y que el reporte llegue solo al servidor cuando vuelva la red, sin duplicados (PRD O1, O2, O6).

Las capacidades se miden con lo que exige el enunciado: operar sin red, acceder a GPS y cámara, sincronizar en segundo plano y notificar el cambio de estatus.

---

## 2. Matriz de capacidades

| Arquitectura | Offline | GPS | Cámara | Push | Sync en segundo plano | Instalable sin tiendas | Costo / tiempo |
|--------------|:-------:|:---:|:------:|:----:|:---------------------:|:----------------------:|:--------------:|
| Web tradicional | ✗ | Parcial | Parcial | ✗ | ✗ | ✗ | Bajo |
| Orientada a servicios (SPA + API) | ✗ por sí sola | Parcial | Parcial | ✗ | ✗ | ✗ | Medio |
| Móvil nativa | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (tiendas) | Alto |
| Multiplataforma (Flutter / React Native) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (tiendas) | Medio-alto |
| **PWA** | **✓** | **✓** | **✓** | **✓** (iOS limitado) | **✓** (Chromium; *fallback* en el resto) | **✓** | **Bajo** |

*Parcial* en GPS y cámara: las Web APIs existen, pero solo funcionan con la página ya cargada; sin red, esa arquitectura no llega a abrirla.

---

## 3. Herramientas, ventajas y desventajas

| Arquitectura | Herramientas típicas | Ventajas | Desventajas |
|--------------|----------------------|----------|-------------|
| **Web tradicional** (páginas renderizadas en servidor) | HTML/CSS/JS, plantillas de servidor (PHP, Django, Rails, Express + vistas) | Muy simple de construir y desplegar; costo mínimo; buen SEO | Cada pantalla requiere red; no hay caché de aplicación ni almacenamiento estructurado local; sin push; sin instalación; nada funciona en Modo Avión |
| **Orientada a servicios** (SPA que consume API REST) | React/Angular/Vue, API REST o GraphQL, OpenAPI/Swagger, NestJS/Spring | Front y back desacoplados; la API se reutiliza desde varios clientes; escala por servicio | Sin Service Worker depende de la red para cargar el código; sin push ni sincronización en segundo plano; mayor complejidad que una web tradicional |
| **Móvil nativa** | Kotlin + Android Studio, Swift + Xcode, SQLite/Room/Core Data, FCM / APNs | Acceso total al hardware y mejor rendimiento; offline y push de primera clase; presencia en tiendas | Dos bases de código (Android e iOS); publicación y revisión en tiendas; ciclo de actualización lento; costo y curva de aprendizaje altos |
| **Multiplataforma** | Flutter (Dart), React Native / Expo, SQLite, plugins nativos, FCM / APNs | Una base de código para dos sistemas; acceso a hardware vía plugins; rendimiento cercano al nativo | Curva de aprendizaje (Dart, puente nativo); dependencia de plugins; sigue requiriendo compilación nativa y publicación en tiendas |
| **PWA** | Service Worker, Web App Manifest, Cache API, IndexedDB (`idb`), Geolocation, `getUserMedia`, Background Sync, Web Push (VAPID), Lighthouse | Una sola base de código en TypeScript; instalable sin tiendas; offline con Cache API + IndexedDB; GPS y cámara por Web APIs; se despliega con un `git push`; las actualizaciones llegan sin pasar por tiendas | iOS limita Push (16.4+ y app instalada) y no ofrece Background Sync; menos acceso a hardware que lo nativo; el ciclo de vida del Service Worker exige cuidado (R6); los navegadores pueden purgar el almacenamiento de sitios no instalados |

---

## 4. Evaluación contra el caso de uso: reportar en Modo Avión con GPS y foto

| Paso del caso | Web tradicional | SPA + API (SOA) | Nativa | Multiplataforma | PWA |
|---------------|:---------------:|:---------------:|:------:|:---------------:|:---:|
| 1. Abrir la app sin red | ✗ la página no carga | ✗ no carga el *bundle* | ✓ | ✓ | ✓ shell desde Cache API |
| 2. Obtener ubicación GPS | ✗ no llega a abrirse | ✗ no llega a abrirse | ✓ | ✓ | ✓ Geolocation API |
| 3. Tomar foto de evidencia | ✗ | ✗ | ✓ | ✓ | ✓ `getUserMedia` + *fallback* `<input capture>` |
| 4. Guardar el reporte localmente | ✗ | ✗ | ✓ SQLite | ✓ SQLite | ✓ IndexedDB (reporte + foto como `Blob`) |
| 5. Enviarlo solo al volver la red, sin duplicados | ✗ el reporte se pierde | ✗ el reporte se pierde | ✓ | ✓ | ✓ Background Sync + `id` UUID idempotente (*fallback* `online` en Safari/Firefox) |
| 6. Notificar el cambio de estatus | ✗ | ✗ | ✓ | ✓ | ✓ Web Push (iOS 16.4+ con app instalada) |
| **Resultado** | **No cumple** | **No cumple** | **Cumple**, con costo alto | **Cumple**, con costo medio-alto | **Cumple**, con costo bajo |

Notas sobre el GPS en Modo Avión: los chips GNSS son receptores pasivos y suelen seguir funcionando sin red; si el dispositivo los apaga, la PWA cae a captura manual de ubicación (PRD HU-11, RF-4).

---

## 5. Veredicto y justificación

**Se elige PWA con arquitectura desacoplada (Headless).**

1. **Es la única opción económica que cumple el caso de uso completo.** Las arquitecturas web tradicional y SOA fallan desde el paso 1: sin red no abren. Las opciones nativa y multiplataforma sí lo cumplen, pero a un costo que el equipo no puede absorber.
2. **Cabe en el plazo y en el equipo.** Cuatro integrantes y cuatro semanas: una sola base de código en TypeScript (React en el cliente, NestJS en la API), sin tiendas ni toolchains nativas. La nativa exigiría dos bases de código y la multiplataforma un lenguaje o puente nuevo.
3. **Cumple los requisitos mínimos obligatorios del enunciado:** front-end autónomo de la base de datos (Headless), persistencia asíncrona sin `localStorage`, Service Worker propio, Geolocalización y Cámara, Background Sync, Push, Cache API + IndexedDB, y despliegue con HTTPS (PRD §10).
4. **Conserva lo valioso de SOA:** la PWA consume una API REST propia, así que el front-end nunca habla directo con la base de datos.

**Limitaciones aceptadas:** Push en iOS exige iOS 16.4+ y la app instalada (PRD R3); Background Sync solo existe en Chromium y se cubre con *fallback* por eventos `online` y `visibilitychange` (PRD R2). El objetivo principal es Chrome/Edge en Android y escritorio.

**Stack resultante** (idéntico al de PRD §5.3): React 18 + TypeScript + Vite · Service Worker escrito a mano, sin Workbox · IndexedDB con `idb` · NestJS sobre Node.js 20 · PostgreSQL 16 con Liquibase · Docker Compose · Web Push con VAPID.
