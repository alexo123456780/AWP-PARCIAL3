// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDeviceId,
  openCivicGuardDB,
  saveReport,
  type IncidentRecord,
  type OutboxEntry,
} from '../db/idb';

// API_URL se fija al importar `sync`: cada caso carga los módulos con su propio VITE_API_URL.
async function load(apiUrl = 'https://api.civicguard.test') {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', apiUrl);
  return import('./reports');
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const incident = (
  id: string,
  createdAt: string,
  extra: Partial<IncidentRecord> = {},
): IncidentRecord => ({
  id,
  type: 'bache',
  severity: 'alta',
  description: `Reporte ${id}`,
  lat: 20.9,
  lng: -89.6,
  createdAt,
  ...extra,
});

const server = (id: string, createdAt: string, extra: object = {}) => ({
  id,
  type: 'fuga' as const,
  severity: 'media' as const,
  description: `Del servidor ${id}`,
  lat: 21,
  lng: -90,
  accuracy: null,
  photo_url: `https://storage.test/${id}.jpg`,
  status: 'en_revision' as const,
  created_at: createdAt,
  ...extra,
});

describe('mergeReports', () => {
  it('une lo local con lo del servidor: lo local conserva su estado de envío y toma el estatus del servidor', async () => {
    const { fromLocal, mergeReports } = await load();
    const local = fromLocal(incident('a', '2026-11-20T10:00:00.000Z'), {
      id: 'a',
      status: 'pending',
      createdAt: '2026-11-20T10:00:00.000Z',
    });

    const [merged] = mergeReports(
      [local],
      [server('a', '2026-11-20T10:00:00.000Z', { status: 'resuelto' })],
    );

    expect(merged).toMatchObject({
      id: 'a',
      sync: 'pending',
      status: 'resuelto',
      description: 'Reporte a',
    });
    expect(merged.photoUrl).toBeUndefined();
  });

  it('un reporte que solo conoce el servidor entra como enviado, con su foto remota', async () => {
    const { mergeReports } = await load();

    const [merged] = mergeReports([], [server('z', '2026-11-20T10:00:00.000Z')]);

    expect(merged).toMatchObject({
      id: 'z',
      sync: 'sent',
      status: 'en_revision',
      photoUrl: 'https://storage.test/z.jpg',
      accuracy: undefined,
    });
  });

  it('ordena del más reciente al más antiguo sin duplicar un id presente en las dos fuentes', async () => {
    const { fromLocal, mergeReports } = await load();
    const local = [
      fromLocal(incident('viejo', '2026-11-18T10:00:00.000Z')),
      fromLocal(incident('medio', '2026-11-19T10:00:00.000Z')),
    ];

    const merged = mergeReports(local, [
      server('medio', '2026-11-19T10:00:00.000Z'),
      server('nuevo', '2026-11-21T10:00:00.000Z'),
    ]);

    expect(merged.map((item) => item.id)).toEqual(['nuevo', 'medio', 'viejo']);
  });

  it('un reporte local sin entrada en la cola se muestra como pendiente', async () => {
    const { fromLocal } = await load();
    expect(fromLocal(incident('a', '2026-11-20T10:00:00.000Z')).sync).toBe('pending');
  });
});

describe('loadLocalReports', () => {
  it('une cada reporte con el estado de su entrada en el outbox', async () => {
    const { loadLocalReports } = await load();
    const db = await openCivicGuardDB();
    await saveReport(db, incident('a', '2026-11-20T10:00:00.000Z'));
    await saveReport(db, incident('b', '2026-11-20T11:00:00.000Z'));
    await db.put('outbox', {
      id: 'b',
      status: 'sent',
      createdAt: '2026-11-20T11:00:00.000Z',
    } satisfies OutboxEntry);

    const items = await loadLocalReports(db);

    // Del más reciente al más antiguo, aunque no haya servidor que los ordene.
    expect(items.map(({ id, sync }) => [id, sync])).toEqual([
      ['b', 'sent'],
      ['a', 'pending'],
    ]);
    db.close();
  });
});

describe('fetchServerReports', () => {
  it('pide la lista de este dispositivo y avisa si el SW la sirvió de su copia guardada', async () => {
    const { fetchServerReports } = await load();
    const db = await openCivicGuardDB();
    const deviceId = await getDeviceId(db);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([server('a', '2026-11-20T10:00:00.000Z')]), {
        headers: { 'X-Served-From': 'cache' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchServerReports(db);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.civicguard.test/api/incidents?reporter_id=${deviceId}`,
    );
    expect(result).toMatchObject({ fromCache: true });
    expect(result?.incidents).toHaveLength(1);
    db.close();
  });

  it('con respuesta del servidor fromCache es falso', async () => {
    const { fetchServerReports } = await load();
    const db = await openCivicGuardDB();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]')));

    expect(await fetchServerReports(db)).toEqual({ incidents: [], fromCache: false });
    db.close();
  });

  it.each([
    ['red caída', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['503 sin copia', () => Promise.resolve(new Response('{"message":"x"}', { status: 503 }))],
    ['una respuesta que no es una lista', () => Promise.resolve(new Response('{"a":1}'))],
    ['un cuerpo que no es JSON', () => Promise.resolve(new Response('<html>'))],
  ])('devuelve null con %s (la pantalla sigue con lo local)', async (_name, respond) => {
    const { fetchServerReports } = await load();
    const db = await openCivicGuardDB();
    vi.stubGlobal('fetch', vi.fn(respond));

    expect(await fetchServerReports(db)).toBeNull();
    db.close();
  });

  it('sin VITE_API_URL no pregunta a nadie', async () => {
    const { fetchServerReports } = await load('');
    const db = await openCivicGuardDB();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchServerReports(db)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    db.close();
  });
});

describe('fetchServerReport', () => {
  it('devuelve el reporte como enviado, con su estatus', async () => {
    const { fetchServerReport } = await load();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(server('x', '2026-11-20T10:00:00.000Z')))),
    );

    expect(await fetchServerReport('x')).toMatchObject({
      id: 'x',
      sync: 'sent',
      status: 'en_revision',
    });
  });

  it('devuelve null si no existe o no hay red', async () => {
    const { fetchServerReport } = await load();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    expect(await fetchServerReport('x')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await fetchServerReport('x')).toBeNull();
  });
});

describe('formatDateTime', () => {
  it('da fecha y hora legibles en español', async () => {
    const { formatDateTime } = await load();
    expect(formatDateTime('2026-11-20T10:00:00.000Z')).toMatch(/2026/);
  });
});
