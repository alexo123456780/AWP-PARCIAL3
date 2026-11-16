import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

const alertStyles = cva('flex gap-3 rounded-lg border p-3 text-sm', {
  variants: {
    tone: {
      info: 'border-brand-200 bg-brand-50 text-brand-900',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
      danger: 'border-red-200 bg-red-50 text-red-900',
    },
  },
  defaultVariants: { tone: 'info' },
});

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

/**
 * Mensaje en línea. `role` decide cómo lo anuncia un lector de pantalla: `alert` interrumpe (errores), `status` espera
 * (confirmaciones y avisos); sin `role` es contenido estático.
 */
export function Alert({
  tone = 'info',
  children,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'children'> &
  VariantProps<typeof alertStyles> & { children: ReactNode }) {
  const Icon = ICONS[tone ?? 'info'];
  return (
    <div className={cn(alertStyles({ tone }), className)} {...props}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
