import { openCivicGuardDB, setMeta } from '../db/idb';

/** Etiqueta de Background Sync que escucha public/sync.js. */
export const SYNC_TAG = 'sync-incidents';

/** URL base de la API (sin barra final); vacía si el build no la define y entonces no hay envío. */
export const API_URL = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

// `registration.sync` no está en los tipos de lib.dom.
type SyncRegistration = ServiceWorkerRegistration & {
  sync?: { register(tag: string): Promise<void> };
};

/**
 * Pide al Service Worker que envíe los reportes pendientes. Con Background Sync registra `sync-incidents` (el
 * navegador lo dispara al haber red y reintenta con espera creciente); sin él, o si el registro falla, le manda
 * FLUSH_OUTBOX. En ambos casos envía el SW, con el mismo código (public/sync.js), no la página.
 * El SW no ve las variables de Vite, así que la URL de la API se le deja en IndexedDB antes de pedirlo.
 */
export async function requestSync(): Promise<void> {
  if (!API_URL || !('serviceWorker' in navigator)) return;
  const db = await openCivicGuardDB();
  try {
    await setMeta(db, 'apiUrl', API_URL);
  } finally {
    db.close();
  }
  const registration: SyncRegistration = await navigator.serviceWorker.ready;
  try {
    if (!registration.sync) throw new Error('sin Background Sync');
    await registration.sync.register(SYNC_TAG);
  } catch {
    registration.active?.postMessage({ type: 'FLUSH_OUTBOX' });
  }
}
