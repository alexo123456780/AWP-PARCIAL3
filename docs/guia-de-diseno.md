# Guía de diseño de CivicGuard

El rediseño de la interfaz (noviembre de 2026) reemplazó el CSS propio por un sistema de diseño reutilizable: **Tailwind CSS 4** para los estilos, **Radix UI** para el comportamiento accesible de lo que lo necesita (el diálogo de confirmación y `Slot`), **lucide-react** para los íconos y el patrón de **shadcn/ui** (componentes propios, sin una librería de componentes cerrada) con `class-variance-authority` para las variantes. Se eligió esa combinación porque pesa poco (el JS inicial sigue muy por debajo de 150 KB gzip), no impone un aspecto genérico y hace que todo salga de los mismos _tokens_.

## Un solo color de marca

| Token                  | Valor     | Uso                                                       |
| ---------------------- | --------- | --------------------------------------------------------- |
| `brand-600`            | `#0b5cab` | **El color de CivicGuard**: cabecera, botón primario, enlaces y filtro activo (6.7:1 sobre blanco). También es el `theme_color` del manifest y el de los íconos |
| `brand-50` a `brand-500` | tintes  | Fondos suaves, bordes de foco y estados al pasar el cursor |
| `brand-700` a `brand-900` | oscuros | Hover y pulsado, texto sobre los tintes                   |
| `slate-*`              | neutros   | Texto, bordes y superficies (`--color-app: #f8fafc` es el fondo de la aplicación y el `background_color` del manifest) |
| verde, ámbar, rojo     | semántica | **Solo** para estados (enviado, pendiente, error), siempre con texto e ícono; nunca decorativos |

Los _tokens_ están en `web/src/styles.css` (`@theme`); cambiar la marca es cambiar esos valores.

## Componentes (`web/src/ui/`)

| Componente      | Para qué                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `Button`        | `primary`, `secondary`, `ghost` y `danger`; `size` y `block`; `asChild` para darle su estilo a un enlace |
| `Card`, `SectionTitle` | Superficie blanca con borde y sombra suaves; título de sección (`h3`)                    |
| `Field`         | Etiqueta + control + ayuda + error con los `id` y `aria-*` ya enlazados (el control se pasa como función); `controlStyles` da el estilo de `input`, `select` y `textarea` |
| `Badge`         | Etiqueta de estado (`neutral`, `brand`, `success`, `warning`, `danger`)                         |
| `Alert`         | Mensaje en línea con ícono; `role="alert"` interrumpe (errores) y `role="status"` espera (avisos) |
| `Loading`, `EmptyState`, `PageHeader` | Cargando, vacío y encabezado de página (el único `h2`)                       |
| `ConfirmDialog` | Confirmación modal accesible (Radix AlertDialog); se importa directo de `ui/ConfirmDialog` para que Radix viaje solo en el chunk que lo usa |

Marco de las pantallas: `AppShell` (`web/src/app/`) con la cabecera (marca, perfil activo y «Salir»), la navegación **solo con las rutas del perfil** y el contenido; la pantalla de acceso (`pages/Acceso.tsx`) usa la misma cabecera.

## Reglas

1. **Nada de colores sueltos:** se usan los _tokens_ (`brand-*`, `slate-*`) y los tonos semánticos de `Badge` y `Alert`.
2. **44 px** de alto y de ancho como mínimo en todo lo que se toca (`min-h-11 min-w-11`), con foco visible (`:focus-visible` global de 3 px).
3. **El color nunca es la única señal:** cada estado lleva texto, y casi siempre ícono (`aria-hidden`).
4. **Un `h1` (la marca) y un `h2` por pantalla**; las secciones son `h3`.
5. **Componentes primero:** una pantalla nueva se arma con `ui/`; si falta una pieza, se añade ahí y se documenta en esta tabla.
6. **Presupuesto:** `npm run check:bundle` falla si el JS inicial pasa de 150 KB gzip; lo pesado (Radix, el panel, la cámara) va en chunks bajo demanda.

## Cómo comprobarlo

`tests/accesibilidad.spec.ts` (E2E) audita 16 vistas y estados con axe (contraste incluido), mide los 44 px y recorre cada vista con `Tab` para exigir el foco visible. Ver `docs/auditoria-accesibilidad.md`.
