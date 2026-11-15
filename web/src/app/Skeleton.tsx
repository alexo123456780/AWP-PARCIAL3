// Mismo marcado y clases que el skeleton estático de index.html: evita un parpadeo vacío mientras carga la ruta.
export function Skeleton() {
  return (
    <div className="skeleton" role="status">
      <span className="visually-hidden">Cargando…</span>
      <div className="skeleton-line skeleton-title" aria-hidden="true" />
      <div className="skeleton-line" aria-hidden="true" />
      <div className="skeleton-line" aria-hidden="true" />
      <div className="skeleton-card" aria-hidden="true" />
    </div>
  );
}
