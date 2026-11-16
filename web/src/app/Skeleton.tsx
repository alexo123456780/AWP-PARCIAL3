import { Brand } from './Brand';

// Mismo marcado y clases que el skeleton estático de index.html: evita un parpadeo vacío mientras carga la ruta.
export function Skeleton() {
  return (
    <div role="status" className="space-y-3 py-2">
      <span className="visually-hidden">Cargando…</span>
      <div
        aria-hidden="true"
        className="h-7 w-3/5 animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none"
      />
      <div
        aria-hidden="true"
        className="h-4 w-full animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none"
      />
      <div
        aria-hidden="true"
        className="h-4 w-4/5 animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none"
      />
      <div
        aria-hidden="true"
        className="h-32 w-full animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none"
      />
    </div>
  );
}

/**
 * Pantalla completa de carga: la misma cabecera de marca y el mismo contenedor que el cascarón estático de index.html,
 * para que pasar de uno a otro (y luego a la pantalla real) no haga saltar nada.
 */
export function PageSkeleton() {
  return (
    <div className="min-h-dvh">
      <header className="bg-brand-600 text-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4">
          <Brand />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <Skeleton />
      </main>
    </div>
  );
}
