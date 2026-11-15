import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getIncident,
  getOutboxEntry,
  openCivicGuardDB,
  saveReport,
  type IncidentRecord,
} from '../db/idb';
import { useOutbox } from './useOutbox';

vi.mock('../modules/sync', () => ({ API_URL: 'https://api.civicguard.test' }));

const report = (id: string, createdAt: string): IncidentRecord => ({
  id,
  type: 'bache',
  severity: 'alta',
  description: `Reporte ${id}`,
  lat: 20.9,
  lng: -89.6,
  createdAt,
});

const serverReport = (
  id: string,
  status = 'en_revision',
  createdAt = '2026-11-20T10:00:00.000Z',
) => ({
  id,
  type: 'bache',
  severity: 'alta',
  description: `Reporte ${id}`,
  lat: 20.9,
  lng: -89.6,
  accuracy: null,
  photo_url: null,
  status,
  created_at: createdAt,
});

const seed = async (...reports: IncidentRecord[]) => {
  const db = await openCivicGuardDB();
  for (const item of reports) await saveReport(db, item);
  db.close();
};
const answer = (body: unknown, init: ResponseInit = {}) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), init)));
const markSent = async (id: string) => {
  const db = await openCivicGuardDB();
  const entry = await getOutboxEntry(db, id);
  await db.put('outbox', { ...entry!, status: 'sent' });
  db.close();
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('useOutbox', () => {
  it('lee lo local sin red y lo muestra del más reciente al más antiguo', async () => {
    await seed(report('a', '2026-11-20T10:00:00.000Z'), report('b', '2026-11-20T11:00:00.000Z'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { result } = renderHook(() => useOutbox());

    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const state = result.current as Extract<typeof result.current, { status: 'ready' }>;
    expect(state.items.map((item) => [item.id, item.sync])).toEqual([
      ['b', 'pending'],
      ['a', 'pending'],
    ]);
    expect(state.stale).toBe(false);
  });

  it('une lo del servidor: toma su estatus, agrega los reportes que este dispositivo no tiene y lo guarda localmente', async () => {
    await seed(report('a', '2026-11-20T10:00:00.000Z'));
    answer([
      serverReport('a', 'en_atencion'),
      serverReport('solo-servidor', 'resuelto', '2026-11-21T10:00:00.000Z'),
    ]);

    const { result } = renderHook(() => useOutbox());

    await waitFor(() => {
      const state = result.current;
      expect(state.status === 'ready' && state.items.length === 2).toBe(true);
    });
    const items = (result.current as Extract<typeof result.current, { status: 'ready' }>).items;
    expect(items.map((item) => [item.id, item.sync, item.status])).toEqual([
      ['solo-servidor', 'sent', 'resuelto'],
      ['a', 'pending', 'en_atencion'],
    ]);
    // El estatus queda en IndexedDB para que «Detalle» lo muestre sin red.
    const db = await openCivicGuardDB();
    expect((await getIncident(db, 'a'))?.status).toBe('en_atencion');
    db.close();
  });

  it('avisa que son datos guardados cuando el SW sirvió su copia', async () => {
    await seed(report('a', '2026-11-20T10:00:00.000Z'));
    answer([serverReport('a')], { headers: { 'X-Served-From': 'cache' } });

    const { result } = renderHook(() => useOutbox());

    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', stale: true }));
  });

  it('si el servidor responde 503 (sin red y sin copia) sigue mostrando lo local', async () => {
    await seed(report('a', '2026-11-20T10:00:00.000Z'));
    answer({ message: 'Sin conexión y sin datos guardados' }, { status: 503 });

    const { result } = renderHook(() => useOutbox());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toMatchObject({ status: 'ready', stale: false });
    expect((result.current as { items: unknown[] }).items).toHaveLength(1);
  });

  it('cambia a enviado sin recargar cuando el SW avisa OUTBOX_CHANGED', async () => {
    await seed(report('a', '2026-11-20T10:00:00.000Z'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const serviceWorker = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
    const { result } = renderHook(() => useOutbox());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const sync = () => (result.current as { items: { sync: string }[] }).items[0].sync;
    expect(sync()).toBe('pending');

    await markSent('a'); // lo que hace el SW
    act(() => {
      serviceWorker.dispatchEvent(
        new MessageEvent('message', { data: { type: 'OUTBOX_CHANGED' } }),
      );
    });

    await waitFor(() => expect(sync()).toBe('sent'));
  });

  it('ignora otros mensajes del SW', async () => {
    await seed(report('a', '2026-11-20T10:00:00.000Z'));
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const serviceWorker = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
    const { result } = renderHook(() => useOutbox());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OTRA_COSA' } }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('vuelve a leer cuando vuelve la red y deja de escuchar al desmontar', async () => {
    await seed(report('a', '2026-11-20T10:00:00.000Z'));
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(() => useOutbox());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    unmount();
    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sin reportes devuelve una lista vacía', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { result } = renderHook(() => useOutbox());

    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', items: [] }));
  });

  it('si IndexedDB no se puede abrir informa el error en vez de quedarse cargando', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB bloqueada');
    });

    const { result } = renderHook(() => useOutbox());

    await waitFor(() => expect(result.current).toEqual({ status: 'error' }));
  });
});
