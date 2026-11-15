import { useCallback, useEffect, useState } from 'react';
import { openCivicGuardDB, setServerStatuses } from '../db/idb';
import {
  fetchServerReports,
  loadLocalReports,
  mergeReports,
  type ReportItem,
} from '../modules/reports';

export type OutboxState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      items: ReportItem[];
      /** Los datos del servidor son la última copia guardada, no los más recientes. */
      stale: boolean;
    };

/**
 * Los reportes del operador con su estado de envío. Primero lee IndexedDB (rápido y sin red), después le pregunta al
 * servidor y une las dos fuentes. Se vuelve a leer sola cuando el Service Worker avisa que un reporte cambió de
 * estado (`OUTBOX_CHANGED`, p. ej. a `sent`) o cuando vuelve la red, sin recargar la página.
 */
export function useOutbox(): OutboxState {
  const [state, setState] = useState<OutboxState>({ status: 'loading' });

  const refresh = useCallback(async (signal: { cancelled: boolean }) => {
    let db;
    try {
      db = await openCivicGuardDB();
      const local = await loadLocalReports(db);
      if (signal.cancelled) return;
      // Lo local se muestra ya; el servidor lo completa después (o no, sin red).
      setState((current) => ({
        status: 'ready',
        items: local,
        stale: current.status === 'ready' ? current.stale : false,
      }));
      const server = await fetchServerReports(db);
      if (signal.cancelled || !server) return;
      const statuses = new Map(server.incidents.map((incident) => [incident.id, incident.status]));
      await setServerStatuses(db, statuses).catch(() => undefined); // el respaldo local es un extra
      if (signal.cancelled) return;
      setState({
        status: 'ready',
        items: mergeReports(await loadLocalReports(db), server.incidents),
        stale: server.fromCache,
      });
    } catch {
      if (!signal.cancelled)
        setState((current) => (current.status === 'ready' ? current : { status: 'error' }));
    } finally {
      db?.close();
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    const run = () => void refresh(signal);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OUTBOX_CHANGED') run();
    };
    run();
    window.addEventListener('online', run);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      signal.cancelled = true;
      window.removeEventListener('online', run);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [refresh]);

  return state;
}
