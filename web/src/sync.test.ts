// @vitest-environment node
// Entorno node: fake-indexeddb conserva el Blob nativo (ver idb.test.ts) y public/sync.js corre en un sandbox como en un SW.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_ID_KEY,
  getDeviceId,
  getOutboxEntry,
  openCivicGuardDB,
  saveReport,
  setMeta,
  type IncidentRecord,
} from './db/idb';

const source = readFileSync(resolve(import.meta.dirname, '../public/sync.js'), 'utf8');
const API = 'https://api.civicguard.test';

let factory: IDBFactory;
beforeEach(() => {
  factory = new IDBFactory();
  globalThis.indexedDB = factory;
});

const report = (
  id: string,
  createdAt: string,
  extra: Partial<IncidentRecord> = {},
): IncidentRecord => ({
  id,
  type: 'bache',
  severity: 'alta',
  description: 'Bache profundo',
  lat: 20.9674,
  lng: -89.5926,
  accuracy: 12.5,
  photo: new Blob(['jpeg'], { type: 'image/jpeg' }),
  createdAt,
  ...extra,
});

const A = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6a';
const B = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const C = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6c';

// Deja la base como la deja la app: reportes guardados, identidad del dispositivo y URL de la API.
async function prepare(reports: IncidentRecord[], { apiUrl = API as string | null } = {}) {
  const db = await openCivicGuardDB();
  const deviceId = await getDeviceId(db);
  if (apiUrl) await setMeta(db, 'apiUrl', apiUrl);
  for (const item of reports) await saveReport(db, item);
  return { db, deviceId };
}

type Handler = (event: object) => void;

function loadSync(
  respond: (form: FormData) => Response | Promise<Response> = () =>
    new Response('{}', { status: 201 }),
) {
  const handlers: Record<string, Handler> = {};
  const sent: { url: string; form: FormData }[] = [];
  const fetchMock = vi.fn(async (url: string, init: { body: FormData }) => {
    sent.push({ url, form: init.body });
    return respond(init.body);
  });
  const posted = vi.fn();
  const self = {
    addEventListener: (type: string, handler: Handler) => (handlers[type] = handler),
    clients: { matchAll: vi.fn(async () => [{ postMessage: posted }]) },
  };
  runInNewContext(source, { self, indexedDB: factory, fetch: fetchMock, FormData, AbortSignal });

  // Entrega un evento y devuelve lo que el SW pasó a waitUntil (lo que decide si el navegador reintenta).
  const dispatch = (type: string, event: object) => {
    const pending: Promise<unknown>[] = [];
    handlers[type]({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    return pending[0];
  };
  return {
    sent,
    fetchMock,
    posted,
    sync: () => dispatch('sync', { tag: 'sync-incidents' }),
    dispatch,
  };
}

const statusOf = async (id: string) => {
  const db = await openCivicGuardDB();
  const entry = await getOutboxEntry(db, id);
  db.close();
  return entry?.status;
};
const ids = (sent: { form: FormData }[]) => sent.map(({ form }) => form.get('id'));

describe('sync-incidents: envío de los pendientes', () => {
  it('envía cada reporte pendiente como multipart a POST /api/incidents con los campos de la API y lo marca sent', async () => {
    const { deviceId } = await prepare([report(A, '2026-11-20T10:00:00.000Z')]);
    const worker = loadSync();

    await worker.sync();

    expect(worker.sent).toHaveLength(1);
    const { url, form } = worker.sent[0];
    expect(url).toBe(`${API}/api/incidents`);
    expect(Object.fromEntries([...form.entries()].filter(([name]) => name !== 'photo'))).toEqual({
      id: A,
      reporter_id: deviceId,
      type: 'bache',
      severity: 'alta',
      description: 'Bache profundo',
      lat: '20.9674',
      lng: '-89.5926',
      accuracy: '12.5',
      created_at: '2026-11-20T10:00:00.000Z',
    });
    const photo = form.get('photo') as File;
    expect(photo.type).toBe('image/jpeg');
    expect(photo.name).toBe(`${A}.jpg`);
    expect(await photo.text()).toBe('jpeg');
    expect(await statusOf(A)).toBe('sent');
  });

  it('la captura manual (sin accuracy) no manda ese campo, y un reporte sin foto tampoco manda photo', async () => {
    await prepare([
      report(A, '2026-11-20T10:00:00.000Z', { accuracy: undefined, photo: undefined }),
    ]);
    const worker = loadSync();

    await worker.sync();

    const { form } = worker.sent[0];
    expect(form.has('accuracy')).toBe(false);
    expect(form.has('photo')).toBe(false);
  });

  it('envía del más antiguo al más reciente, aunque se hayan guardado desordenados', async () => {
    await prepare([
      report(B, '2026-11-20T11:00:00.000Z'),
      report(A, '2026-11-20T10:00:00.000Z'),
      report(C, '2026-11-20T12:00:00.000Z'),
    ]);
    const worker = loadSync();

    await worker.sync();

    expect(ids(worker.sent)).toEqual([A, B, C]);
  });

  it('un reporte sent no se vuelve a enviar', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z')]);
    const worker = loadSync();
    await worker.sync();
    expect(worker.fetchMock).toHaveBeenCalledOnce();

    await worker.sync();

    expect(worker.fetchMock).toHaveBeenCalledOnce();
  });

  it('avisa a las pestañas abiertas por cada cambio de estado', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z'), report(B, '2026-11-20T11:00:00.000Z')]);
    const worker = loadSync();

    await worker.sync();

    expect(worker.posted).toHaveBeenCalledTimes(2);
    expect(worker.posted).toHaveBeenCalledWith({ type: 'OUTBOX_CHANGED' });
  });

  it('ignora otras etiquetas de sync', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z')]);
    const worker = loadSync();

    expect(worker.dispatch('sync', { tag: 'otra-cosa' })).toBeUndefined();
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });
});

describe('fallos del envío', () => {
  it('sin red deja el reporte pending, rechaza (el navegador reintenta con backoff) y no intenta los demás', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z'), report(B, '2026-11-20T11:00:00.000Z')]);
    const worker = loadSync(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(worker.sync()).rejects.toThrow('pendientes');

    expect(worker.fetchMock).toHaveBeenCalledOnce();
    expect(await statusOf(A)).toBe('pending');
    expect(await statusOf(B)).toBe('pending');
    expect(worker.posted).not.toHaveBeenCalled();
  });

  it.each([500, 502, 503, 408, 429])(
    'una respuesta %i deja el reporte pending y rechaza para reintentar, pero los demás se siguen intentando',
    async (status) => {
      await prepare([report(A, '2026-11-20T10:00:00.000Z'), report(B, '2026-11-20T11:00:00.000Z')]);
      const worker = loadSync((form) =>
        form.get('id') === A ? new Response('', { status }) : new Response('{}', { status: 201 }),
      );

      await expect(worker.sync()).rejects.toThrow('pendientes');

      expect(await statusOf(A)).toBe('pending');
      expect(await statusOf(B)).toBe('sent');
    },
  );

  it.each([400, 404, 413])(
    'una respuesta %i es definitiva: el reporte queda en error, no se reintenta y no atasca a los demás',
    async (status) => {
      await prepare([report(A, '2026-11-20T10:00:00.000Z'), report(B, '2026-11-20T11:00:00.000Z')]);
      const worker = loadSync((form) =>
        form.get('id') === A ? new Response('', { status }) : new Response('{}', { status: 201 }),
      );

      await expect(worker.sync()).resolves.toBeUndefined();

      expect(await statusOf(A)).toBe('error');
      expect(await statusOf(B)).toBe('sent');
      await worker.sync();
      expect(worker.fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('al volver la red el siguiente sync envía lo que quedó pending', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z')]);
    let online = false;
    const worker = loadSync(() => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 201 });
    });
    await expect(worker.sync()).rejects.toThrow();
    expect(await statusOf(A)).toBe('pending');

    online = true;
    await worker.sync();

    expect(await statusOf(A)).toBe('sent');
  });

  it('reenviar un reporte que el servidor ya recibió (responde 201 con el original) lo marca sent', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z')]);
    // 1.er intento: el servidor lo guarda pero la respuesta no llega; 2.º: lo reconoce y responde 201 igual.
    let attempt = 0;
    const worker = loadSync(() => {
      if (++attempt === 1) throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 201 });
    });
    await expect(worker.sync()).rejects.toThrow();

    await worker.sync();

    expect(await statusOf(A)).toBe('sent');
    expect(ids(worker.sent)).toEqual([A, A]);
  });

  it('una entrada sin su reporte pasa a error y no atasca la cola', async () => {
    const { db } = await prepare([report(B, '2026-11-20T11:00:00.000Z')]);
    await db.put('outbox', { id: A, status: 'pending', createdAt: '2026-11-20T10:00:00.000Z' });
    db.close();
    const worker = loadSync();

    await worker.sync();

    expect(await statusOf(A)).toBe('error');
    expect(await statusOf(B)).toBe('sent');
    expect(ids(worker.sent)).toEqual([B]);
  });
});

describe('vaciado único y casos sin nada que enviar', () => {
  it('dos eventos seguidos comparten un solo vaciado: ningún reporte se envía dos veces', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z'), report(B, '2026-11-20T11:00:00.000Z')]);
    const worker = loadSync();

    await Promise.all([
      worker.sync(),
      worker.dispatch('message', { data: { type: 'FLUSH_OUTBOX' } }),
      worker.sync(),
    ]);

    expect(ids(worker.sent)).toEqual([A, B]);
  });

  it('FLUSH_OUTBOX (fallback sin Background Sync) envía igual y no rechaza si falla', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z')]);
    const failing = loadSync(() => new Response('', { status: 503 }));

    await expect(
      failing.dispatch('message', { data: { type: 'FLUSH_OUTBOX' } }),
    ).resolves.toBeUndefined();

    expect(failing.fetchMock).toHaveBeenCalledOnce();
    expect(await statusOf(A)).toBe('pending');
  });

  it('ignora los demás mensajes', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z')]);
    const worker = loadSync();

    expect(worker.dispatch('message', { data: { type: 'SKIP_WAITING' } })).toBeUndefined();
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it('sin la URL de la API no envía nada', async () => {
    await prepare([report(A, '2026-11-20T10:00:00.000Z')], { apiUrl: null });
    const worker = loadSync();

    await expect(worker.sync()).resolves.toBeUndefined();

    expect(worker.fetchMock).not.toHaveBeenCalled();
    expect(await statusOf(A)).toBe('pending');
  });

  it('sin la identidad del dispositivo no envía nada', async () => {
    const db = await openCivicGuardDB();
    await setMeta(db, 'apiUrl', API);
    await saveReport(db, report(A, '2026-11-20T10:00:00.000Z'));
    expect(await db.get('meta', DEVICE_ID_KEY)).toBeUndefined();
    db.close();
    const worker = loadSync();

    await expect(worker.sync()).resolves.toBeUndefined();

    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it('si la app nunca creó la base, el SW no la crea (rompería el upgrade de la app) y no falla', async () => {
    const worker = loadSync();

    await expect(worker.sync()).resolves.toBeUndefined();

    expect((await factory.databases()).map((database) => database.name)).not.toContain(
      'civicguard',
    );
    // La app puede abrirla después con normalidad y obtener sus stores.
    const db = await openCivicGuardDB();
    expect([...db.objectStoreNames].sort()).toEqual(['incidents', 'meta', 'outbox']);
    db.close();
  });
});
