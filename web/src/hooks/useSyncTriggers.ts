import { useEffect } from 'react';
import { requestSync } from '../modules/sync';

/**
 * Pide vaciar el outbox al abrir la app, al volver la red (`online`) y al volver la pestaña a primer plano
 * (`visibilitychange`). Es el único disparador en Safari y Firefox, que no tienen Background Sync (R2), y respalda a
 * Chromium cuando el navegador no dispara `sync` (permiso denegado, ajuste del usuario). Con Background Sync solo
 * vuelve a registrar la etiqueta. Los pedidos seguidos no duplican envíos: public/sync.js comparte el vaciado en curso.
 */
export function useSyncTriggers() {
  useEffect(() => {
    const flush = () => void requestSync().catch(() => undefined);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') flush();
    };
    flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
