# Guía de la demo y del code freeze (SCRUM-210)

Prepara la entrega: el estado verificado del repositorio, el procedimiento del _code freeze_ (10 de diciembre), el guion del ensayo de la demo con el registro de fallos y lo que falta con su responsable. El ensayo con los cuatro integrantes sobre producción y el _freeze_ en sí son acciones del equipo en esa fecha; aquí queda lo que se pudo comprobar y automatizar hoy (2026-11-16).

## 1. Estado verificado

| Comprobación                                                                | Resultado hoy |
| --------------------------------------------------------------------------- | :-----------: |
| El repositorio es público (`gh repo view`: `PUBLIC`, rama por defecto `prod`) | ✅ |
| El README permite reproducir el entorno con `docker compose up --build`     | ✅ Verificado de cero |
| El historial muestra commits de los 4 integrantes                           | ❌ **Solo hay una persona** |
| Desde el 10-dic solo se fusionan correcciones aprobadas por PR              | ⏳ Pendiente de la fecha (ver §2) |
| El ensayo recorre los cinco pasos de la demo                                | ✅ Automatizado (con dobles); ⏳ falta con el equipo sobre producción |

**Reproducción con Compose:** `cp .env.example .env` (con `DB_PASSWORD` propia) y `docker compose up -d --build` en un proyecto aislado: la base queda sana, Liquibase aplica los 4 changesets, `GET /api/health` → `{"status":"ok","database":"up"}`, Swagger en `/api/docs` (200), `GET /api/push/vapid-public-key` → 503 sin variables `VAPID_*` (el comportamiento documentado) y la PWA en `http://localhost:5173` (200); todo en unos 50 s. Se desmontó con `down -v --rmi local`.

**Historial de commits (`git shortlog -sne origin/develop`):** 41 commits de _Alejandro_, 13 de _Alex_ (la cuenta de GitHub `alexo123456780`), 1 de _alejandromagaty_ (un correo de trabajo) y 24 de `github-actions[bot]` (las fusiones automáticas). Las tres identidades humanas son **la misma persona**; Jose Ariel, Mario y Héctor no tienen ningún commit. No se debe reescribir el historial ni crear commits que no hizo cada quien: hace falta que cada integrante contribuya de verdad por PR (§3). Además, uno de esos commits lleva un correo de trabajo en un repositorio público; conviene que su dueño decida si le importa (cambiarlo exige reescribir historia y no se ha hecho).

**Protección de ramas hoy:** `develop` y `prod` exigen PR y los checks `lint-and-test` y `liquibase-validate`, con **0 aprobaciones**, y el repositorio tiene **un solo colaborador**. Por eso el flujo actual fusiona solo (`auto-merge.yml`) y nadie más puede aprobar.

## 2. Code freeze: procedimiento para el 10 de diciembre

Objetivo: desde ese día solo entran **correcciones aprobadas por PR**. No se ejecutó nada de esto todavía (cambia la configuración del repositorio y es decisión del equipo el día acordado).

1. **Antes (hasta el 9-dic):** añadir a Jose Ariel, Mario y Héctor como colaboradores (_Settings → Collaborators_); todo lo pendiente del Sprint 4 integrado en `develop`; hacer el release final `develop → prod` si hay cambios nuevos (el del PR #34 ya incluye todo hasta hoy), comprobar el despliegue y repetir las auditorías de Lighthouse (`docs/reporte-plan-de-pruebas-y-despliegue.md` §5).
2. **El día del freeze:**
   ```bash
   # 1) Que ningún PR se fusione solo: se apaga el workflow de fusión automática.
   gh workflow disable "Auto-merge" --repo alexo123456780/AWP-PARCIAL3
   # 2) Que cada PR necesite la aprobación de otra persona (en develop y en prod).
   for branch in develop prod; do
     gh api -X PATCH "repos/alexo123456780/AWP-PARCIAL3/branches/$branch/protection/required_pull_request_reviews" \
       -F required_approving_review_count=1
   done
   ```
   Avisar al equipo (grupo y Jira) con la regla: _solo correcciones, con PR, aprobado por otra persona y con los checks en verde_; nada de funcionalidad nueva.
3. **Excepciones:** una corrección urgente sigue el mismo camino (rama `fix/…` → PR a `develop` → aprobación → release a `prod`). Nada de _push_ directo ni de `--admin`.
4. **Después de la entrega:** reactivar el workflow (`gh workflow enable "Auto-merge"`) y volver a 0 aprobaciones si se quiere el flujo anterior.

## 3. Historial de los cuatro integrantes

Para que `git shortlog -sne` muestre a los cuatro, cada uno debe hacer **su propio commit con su identidad de Git** (`git config user.name/user.email` con el correo ligado a su cuenta de GitHub) mediante un PR real. Tareas del Sprint 4 que le corresponden a cada uno y que son contribuciones genuinas:

| Integrante | Contribución sugerida (ya definida en Jira)                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Jose Ariel | Variables `VAPID_*` y coordinador sembrado en Render; prueba manual del push con un teléfono real y su evidencia (SCRUM-215)   |
| Mario      | Instalación en Chrome Android y verificación en teléfono real; ajustes de rendimiento que quedaron opcionales (SCRUM-207)     |
| Héctor     | Repetir las auditorías Lighthouse con el release desplegado y actualizar el reporte (SCRUM-209)                               |

## 4. Guion del ensayo de la demo

**Antes de empezar (riesgo R5):** despertar el servicio con una petición — `curl https://civicguard-api-nhww.onrender.com/api/health` hasta ver `200` (el plan gratuito tarda ~1 min tras 15 min inactivo) — y comprobar que: el release está desplegado, hay un coordinador, `VAPID_*` están en Render, la PWA está instalada en el teléfono con los avisos activados («Mis reportes → Activar avisos») y el panel está abierto en el equipo del coordinador.

| # | Paso (quién)                                    | Qué se hace                                                                                                        | Resultado esperado                                                                                  | Plan B si falla                                                                 |
| - | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1 | Reporte en Modo Avión (operador)                | Modo Avión; abrir la app; llenar tipo, severidad y descripción; «Usar mi ubicación»; «Tomar foto»; «Guardar reporte» | Confirmación de guardado; en «Mis reportes» el reporte sale **Pendiente**                           | Ubicación manual con latitud y longitud; elegir una foto del selector            |
| 2 | Reconexión y sincronización (operador)          | Desactivar Modo Avión y esperar unos segundos                                                                      | El reporte pasa solo a **Enviado**, sin duplicados                                                  | Abrir la app o cambiar de pestaña (dispara el envío); revisar `/api/health`      |
| 3 | Cambio de estatus en `/panel` (coordinador)     | Iniciar sesión; abrir el reporte; elegir «En revisión»; «Cambiar estatus» → «Confirmar»                            | «Estatus actualizado a “En revisión”»; el reporte aparece con ese estatus en la lista               | Reintentar (límite de 5 intentos de login por minuto); revisar `JWT_SECRET`     |
| 4 | Notificación push (operador)                    | Mirar el teléfono                                                                                                  | Notificación nativa «Tu reporte cambió de estatus» con el reporte y «En revisión»                    | Mostrar la prueba E2E del push; revisar `VAPID_*` y que el permiso no esté bloqueado |
| 5 | Abrir el detalle (operador)                     | Tocar la notificación                                                                                              | La app se abre en el detalle del reporte con el estatus **En revisión**                             | Abrir «Mis reportes → el reporte»                                                |

Duración estimada: 6–8 minutos. Reparto sugerido: Alejandro conduce y despierta Render; Mario opera el teléfono; Héctor opera el panel; Jose Ariel explica el backend (idempotencia, VAPID, limpieza de suscripciones).

### Registro de fallos del ensayo

| #  | Paso | Fallo encontrado                                                                                                                                                           | Responsable                    | Estado |
| -- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| F1 | 5    | Al abrir el detalle desde la notificación se veía el estatus **anterior** («Recibido»): el detalle solo leía IndexedDB. Ahora pregunta el estatus vigente al servidor (sin red conserva el último y una copia vieja del respaldo no lo pisa) | Mario (cliente) / Alejandro | ✅ Corregido (PR #33) y en producción (release #34) |
| F2 | —    | El historial de Git solo muestra a una persona (§1)                                                                                                                         | Jose Ariel, Mario y Héctor     | ⏳ Abierto (antes del freeze) |
| F3 | 4    | Sin `VAPID_*` en Render el push de producción no llega: `GET /api/push/vapid-public-key` responde 503 (el release #34 ya está desplegado; `docs/reporte-plan-de-pruebas-y-despliegue.md` §4) | Alejandro + Jose Ariel         | ⏳ Abierto (antes del ensayo) |
| F4 | 5    | La corrección de F1 llegó a producción con el release #34 (`2a6a13f`); el despliegue de Vercel se confirmó (`Deployment has completed`)                                      | Alejandro                      | ✅ Cerrado |

Anota aquí cada fallo nuevo del ensayo real con su responsable.

## 5. Ensayo automatizado

`e2e/tests/ensayo-demo.spec.ts` (`npm test --prefix e2e`, ver README) recorre en una sola corrida los cinco pasos con la compilación de producción de la PWA, apagando de verdad la red y usando los dobles de la API y del servicio de push de las demás pruebas E2E (la entrega del `push` y el toque de la notificación se simulan en el navegador, como en `push.spec.ts`). Es lo que encontró F1. Capturas en `docs/evidencia/e2e-7-demo-panel-cambio-de-estatus.png` y `e2e-8-demo-detalle-con-estatus-nuevo.png`.

**No sustituye** el ensayo con el equipo sobre producción: no prueba el servicio real de push, el teléfono ni la latencia de Render.
