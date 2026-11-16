import { Loader2, type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from './cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      aria-hidden="true"
      className={cn('size-5 animate-spin text-brand-600 motion-reduce:animate-none', className)}
    />
  );
}

/** Cargando: ícono y texto (con `role="status"`, lo anuncian los lectores de pantalla). */
export function Loading({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 text-sm text-slate-600">
      <Spinner />
      {children}
    </p>
  );
}

/** Estado vacío: qué pasa y, si hay, la siguiente acción. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-700">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <p className="text-base font-semibold text-slate-900">{title}</p>
      {children && <p className="max-w-sm text-sm text-slate-600">{children}</p>}
      {action}
    </div>
  );
}

/** Encabezado de página: un solo `h2` por pantalla (el `h1` es la marca del encabezado). */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
