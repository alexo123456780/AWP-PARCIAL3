import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from './cn';

// 44 px de alto como mínimo (objetivo táctil, PRD §4) en todas las variantes.
export const buttonStyles = cva(
  'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800',
        secondary:
          'border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 active:bg-slate-100',
        ghost: 'text-brand-700 hover:bg-brand-50 active:bg-brand-100',
        danger: 'bg-red-700 text-white shadow-sm hover:bg-red-800 active:bg-red-900',
      },
      size: { md: '', lg: 'min-h-12 px-6 text-base' },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  /** Renderiza el hijo (p. ej. un `<Link>`) con el estilo del botón en vez de un `<button>`. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { asChild, variant, size, block, className, type = 'button', ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      ref={ref}
      {...(asChild ? {} : { type })}
      className={cn(buttonStyles({ variant, size, block }), className)}
      {...props}
    />
  );
});
