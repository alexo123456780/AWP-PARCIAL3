# Reporte de Actividades — SCRUM-121 (subtareas SCRUM-130 y SCRUM-131)

## Actividad

Documentar el proyecto: PRD final y tabla comparativa oficial de arquitecturas.

## Objetivo

Dejar en el repositorio el documento de definición del proyecto con la justificación de arquitectura y la Tabla Comparativa Oficial exigida por el enunciado de la Semana 1, de forma coherente entre sí.

## Actividades realizadas

- Se revisó el PRD contra el enunciado del Proyecto Integrador (objetivos, entregables y requerimientos mínimos de las cuatro semanas).
- Se completó la matriz de cumplimiento (§10) con los requisitos que no estaban trazados: justificación de arquitectura, entorno local seguro con túnel, `manifest.json`, Application Shell, Service Worker con ámbito global, ciclo de vida del SW, operación en Modo Avión y métricas de Lighthouse.
- Se agregó la sección §10.1 que relaciona cada entregable técnico del enunciado con su ubicación y responsable.
- Se actualizó la versión del PRD a 1.3 y se enlazó la tabla comparativa desde §5.1 y desde el plan de la Semana 1.
- Se redactó `docs/tabla-comparativa-arquitecturas.md` con la matriz de capacidades (offline, GPS, cámara, push, sincronización en segundo plano, instalación, costo), herramientas, ventajas y desventajas de las cinco arquitecturas.
- Se evaluó cada arquitectura contra el caso de uso «reportar en Modo Avión con GPS y foto» en seis pasos, y se concluyó con el veredicto y la justificación de la PWA con arquitectura desacoplada.
- Se creó el `README.md` con el enlace al PRD y a la tabla comparativa.

## Criterios atendidos

- PRD y tabla comparativa presentes en `docs/`.
- La tabla compara las 5 arquitecturas en capacidades, herramientas, ventajas y desventajas.
- Cada arquitectura se evalúa contra el caso de uso en Modo Avión con GPS y foto.
- La tabla concluye PWA con veredicto y justificación.
- Cada requisito mínimo obligatorio del enunciado aparece trazado en el PRD (§10) sin huecos.
- La justificación de PWA y Headless (§5.1) está redactada y el README enlaza a `docs/PRD.md`.
- PRD y tabla coinciden en la decisión de arquitectura y en el stack tecnológico.

## Resultado

El proyecto cuenta con un PRD v1.3 con trazabilidad completa hacia el enunciado y con una tabla comparativa oficial en un documento propio, coherentes entre sí.

## Validación

- Verificación automatizada de los documentos: los enlaces relativos resuelven, las tablas tienen columnas consistentes, las cinco arquitecturas y el veredicto PWA aparecen en ambos documentos, el stack es idéntico y cada requisito y entregable del enunciado está trazado en §10. Resultado: sin hallazgos.
- Revisión manual del contenido de la tabla contra los valores del resumen de §5.1.
- Cambios exclusivamente de documentación: no aplican pruebas de código, compilación ni renderizado.

## Observaciones

- El criterio de aceptación menciona la rama `main`, pero el repositorio trabaja con `develop` (integración) y `prod` (por defecto); el PRD conserva el nombre `main`. Queda pendiente que el equipo defina cuál es el nombre definitivo.
- El «Reporte de Configuración del Entorno» queda fuera de esta tarea.
