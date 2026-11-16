import { type HTMLAttributes } from 'react';
import { cn } from './cn';

/** Superficie blanca con borde y sombra suaves: el contenedor de casi todo el contenido. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)}
      {...props}
    />
  );
}

/** Título de una sección dentro de una tarjeta o de la página (`h3`). */
export function SectionTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-slate-900', className)} {...props} />;
}
