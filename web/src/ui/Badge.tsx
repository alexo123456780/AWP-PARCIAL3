import { cva, type VariantProps } from 'class-variance-authority';
import { type HTMLAttributes } from 'react';
import { cn } from './cn';

// Pares de fondo y texto con contraste AA. El color nunca es la única señal: cada uso lleva texto (y suele llevar ícono).
export const badgeStyles = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
  {
    variants: {
      tone: {
        neutral: 'bg-slate-100 text-slate-800',
        brand: 'bg-brand-50 text-brand-800',
        success: 'bg-emerald-50 text-emerald-800',
        warning: 'bg-amber-50 text-amber-900',
        danger: 'bg-red-50 text-red-800',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  tone,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />;
}
