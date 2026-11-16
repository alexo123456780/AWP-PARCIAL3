import { type ReactNode, useId } from 'react';
import { cn } from './cn';

/** Lo que `Field` le pasa al control para enlazar la etiqueta, la ayuda y el error. */
export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

export const controlStyles =
  'block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 shadow-xs placeholder:text-slate-500 focus-visible:border-brand-600 aria-[invalid=true]:border-red-700 disabled:opacity-60';

/**
 * Etiqueta + control + ayuda + error, con los `id` enlazados (`label for`, `aria-describedby`, `aria-invalid`).
 * El control se recibe como función para no repetir ese cableado en cada formulario:
 * `<Field label="Correo">{(props) => <input {...props} className={controlStyles} />}</Field>`.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800">
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <p id={hintId} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
