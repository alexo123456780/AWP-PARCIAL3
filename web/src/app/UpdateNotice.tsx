import { useEffect, useState } from 'react';
import { Alert, Button } from '../ui';

// Registra el SW y devuelve el worker nuevo que espera su turno (RF-3): nunca se activa solo.
function useWaitingWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const { serviceWorker } = navigator;
    const abort = new AbortController();
    const { signal } = abort;

    // Un worker "installed" con la página ya controlada es una actualización; sin controlador es la primera instalación.
    const track = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const check = () => {
        if (worker.state === 'installed' && serviceWorker.controller) setWaiting(worker);
      };
      check();
      worker.addEventListener('statechange', check, { signal });
    };

    serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (signal.aborted) return;
        track(registration.waiting);
        track(registration.installing);
        registration.addEventListener('updatefound', () => track(registration.installing), {
          signal,
        });
      })
      .catch((error) => console.error('No se pudo registrar el Service Worker', error));

    return () => abort.abort();
  }, []);

  return waiting;
}

export function UpdateNotice() {
  const waiting = useWaitingWorker();
  if (!waiting) return null;

  const update = () => {
    // Se recarga al quedar `activated`, no en `controllerchange`: si la página se recarga en ese instante,
    // WebKit deja al SW atascado en `activating`. Solo tras aceptar, nunca por la primera instalación.
    waiting.addEventListener('statechange', () => {
      if (waiting.state === 'activated') location.reload();
    });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  // Aviso flotante y fijo: la app se registra y se actualiza igual en cualquier pantalla (también en el acceso).
  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md">
      <Alert role="status" tone="info" className="shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">Nueva versión disponible</span>
          <Button onClick={update}>Actualizar</Button>
        </div>
      </Alert>
    </div>
  );
}
