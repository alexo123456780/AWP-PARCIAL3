import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { type ReactNode } from 'react';
import { Button } from './Button';

/**
 * Confirmación modal accesible (Radix AlertDialog): atrapa el foco, se cierra con Esc y devuelve el foco al abrirla.
 * El foco inicial cae en «Cancelar», la opción segura.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/50" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl">
          <AlertDialog.Title className="text-lg font-bold text-slate-900">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-slate-600">
            {children}
          </AlertDialog.Description>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" disabled={busy}>
                Cancelar
              </Button>
            </AlertDialog.Cancel>
            <Button onClick={onConfirm} disabled={busy}>
              {busy ? 'Guardando…' : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
