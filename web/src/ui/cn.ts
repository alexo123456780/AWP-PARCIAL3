import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Une clases condicionales y resuelve los conflictos de Tailwind (la última gana): `cn('px-2', cond && 'px-4')`. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
