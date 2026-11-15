// @vitest-environment node
// Entorno node y no jsdom: fake-indexeddb clona con el structuredClone de Node, que convierte en `{}` el Blob de jsdom
// pero conserva el Blob nativo (tipo, tamaño y bytes), igual que haría un navegador.
import 'fake-indexeddb/auto'; // instala los globals de IndexedDB (IDBRequest, IDBKeyRange…)
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  DEVICE_ID_KEY,
  deleteIncident,
  deleteMeta,
  deleteOutboxEntry,
  getDeviceId,
  getIncident,
  getMeta,
  getOutboxEntry,
  listIncidents,
  listOutbox,
  openCivicGuardDB,
  saveIncident,
  saveOutboxEntry,
  saveReport,
  setMeta,
  type IncidentRecord,
  type OutboxEntry,
} from './idb';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Cada prueba parte de un IndexedDB vacío, como un dispositivo en su primer arranque.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('esquema', () => {
  it('abre la base con la versión de esquema y crea los stores incidents, outbox y meta', async () => {
    const db = await openCivicGuardDB();

    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['incidents', 'meta', 'outbox']);
    db.close();
  });

  it('define las claves e índices que usará el Sprint 3', async () => {
    const db = await openCivicGuardDB();
    const tx = db.transaction(['incidents', 'outbox', 'meta']);

    expect(tx.objectStore('incidents').keyPath).toBe('id');
    expect([...tx.objectStore('incidents').indexNames]).toEqual(['by-createdAt']);
    expect(tx.objectStore('outbox').keyPath).toBe('id');
    expect([...tx.objectStore('outbox').indexNames]).toEqual(['by-status']);
    expect(tx.objectStore('meta').keyPath).toBeNull();
    db.close();
  });

  it('reabrir la base conserva los datos (el upgrade solo corre la primera vez)', async () => {
    const incident: IncidentRecord = {
      id: crypto.randomUUID(),
      type: 'bache',
      severity: 'alta',
      description: 'Bache profundo',
      lat: 20.97,
      lng: -89.62,
      accuracy: 12,
      createdAt: '2026-11-18T10:00:00.000Z',
    };
    const first = await openCivicGuardDB();
    await first.put('incidents', incident);
    first.close();

    const second = await openCivicGuardDB();

    expect(await second.get('incidents', incident.id)).toEqual(incident);
    second.close();
  });
});

describe('identidad anónima del dispositivo', () => {
  it('genera un UUID v4 en el primer arranque y lo guarda en meta', async () => {
    const db = await openCivicGuardDB();

    const deviceId = await getDeviceId(db);

    expect(deviceId).toMatch(UUID_V4);
    expect(await db.get('meta', DEVICE_ID_KEY)).toBe(deviceId);
    db.close();
  });

  it('los arranques posteriores reutilizan el mismo UUID, incluso tras cerrar y reabrir la base', async () => {
    const first = await openCivicGuardDB();
    const original = await getDeviceId(first);
    expect(await getDeviceId(first)).toBe(original);
    first.close();

    const reopened = await openCivicGuardDB();

    expect(await getDeviceId(reopened)).toBe(original);
    reopened.close();
  });

  it('dos arranques simultáneos (dos pestañas) terminan con una sola identidad', async () => {
    const [tabA, tabB] = await Promise.all([openCivicGuardDB(), openCivicGuardDB()]);

    const [idA, idB] = await Promise.all([getDeviceId(tabA), getDeviceId(tabB)]);

    expect(idA).toBe(idB);
    expect(await tabA.get('meta', DEVICE_ID_KEY)).toBe(idA);
    tabA.close();
    tabB.close();
  });

  it('dos dispositivos distintos no comparten identidad', async () => {
    const deviceA = await openCivicGuardDB('civicguard-a');
    const deviceB = await openCivicGuardDB('civicguard-b');

    expect(await getDeviceId(deviceA)).not.toBe(await getDeviceId(deviceB));
    deviceA.close();
    deviceB.close();
  });
});

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

function report(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: crypto.randomUUID(),
    type: 'bache',
    severity: 'alta',
    description: 'Bache profundo',
    lat: 20.97,
    lng: -89.62,
    accuracy: 12,
    createdAt: '2026-11-18T10:00:00.000Z',
    ...overrides,
  };
}

describe('reportes (incidents)', () => {
  it('guarda un reporte con su foto como Blob y lo recupera con el mismo tipo, tamaño y bytes', async () => {
    const db = await openCivicGuardDB();
    const incident = report({ photo: new Blob([BYTES], { type: 'image/jpeg' }) });

    await saveIncident(db, incident);
    const saved = await getIncident(db, incident.id);

    expect(saved).toMatchObject({ ...incident, photo: expect.any(Blob) });
    expect(saved!.photo!.type).toBe('image/jpeg');
    expect(saved!.photo!.size).toBe(BYTES.length);
    expect(new Uint8Array(await saved!.photo!.arrayBuffer())).toEqual(BYTES);
    db.close();
  });

  it('el reporte y su foto siguen ahí al cerrar y volver a abrir la base (sin red)', async () => {
    const incident = report({ photo: new Blob([BYTES], { type: 'image/jpeg' }) });
    const first = await openCivicGuardDB();
    await saveIncident(first, incident);
    first.close();

    const reopened = await openCivicGuardDB();
    const saved = await getIncident(reopened, incident.id);

    expect(saved?.description).toBe('Bache profundo');
    expect(saved?.photo?.size).toBe(BYTES.length);
    reopened.close();
  });

  it('un reporte sin foto se guarda sin photo', async () => {
    const db = await openCivicGuardDB();
    const incident = report();

    await saveIncident(db, incident);

    expect(await getIncident(db, incident.id)).toEqual(incident);
    db.close();
  });

  it('guardar con el mismo id actualiza el reporte en vez de duplicarlo', async () => {
    const db = await openCivicGuardDB();
    const incident = report();
    await saveIncident(db, incident);

    await saveIncident(db, { ...incident, severity: 'critica' });

    expect(await listIncidents(db)).toEqual([{ ...incident, severity: 'critica' }]);
    db.close();
  });

  it('borra un reporte con su foto y leerlo después devuelve undefined', async () => {
    const db = await openCivicGuardDB();
    const incident = report({ photo: new Blob([BYTES], { type: 'image/jpeg' }) });
    await saveIncident(db, incident);

    await deleteIncident(db, incident.id);

    expect(await getIncident(db, incident.id)).toBeUndefined();
    expect(await listIncidents(db)).toEqual([]);
    db.close();
  });

  it('borrar un id que no existe no falla ni toca los demás reportes', async () => {
    const db = await openCivicGuardDB();
    const kept = report();
    await saveIncident(db, kept);

    await expect(deleteIncident(db, crypto.randomUUID())).resolves.toBeUndefined();

    expect(await listIncidents(db)).toEqual([kept]);
    db.close();
  });

  it('lista los reportes del más antiguo al más reciente', async () => {
    const db = await openCivicGuardDB();
    const newer = report({ createdAt: '2026-11-18T12:00:00.000Z' });
    const older = report({ createdAt: '2026-11-18T08:00:00.000Z' });
    await saveIncident(db, newer);
    await saveIncident(db, older);

    expect((await listIncidents(db)).map((i) => i.id)).toEqual([older.id, newer.id]);
    db.close();
  });
});

describe('cola de envío (outbox)', () => {
  const entry = (createdAt: string, status: OutboxEntry['status'] = 'pending'): OutboxEntry => ({
    id: crypto.randomUUID(),
    status,
    createdAt,
  });

  it('crea, lee, actualiza y borra una entrada', async () => {
    const db = await openCivicGuardDB();
    const pending = entry('2026-11-18T10:00:00.000Z');

    await saveOutboxEntry(db, pending);
    expect(await getOutboxEntry(db, pending.id)).toEqual(pending);

    await saveOutboxEntry(db, { ...pending, status: 'error' });
    expect((await getOutboxEntry(db, pending.id))?.status).toBe('error');

    await deleteOutboxEntry(db, pending.id);
    expect(await getOutboxEntry(db, pending.id)).toBeUndefined();
    db.close();
  });

  it('lista la cola en orden de captura', async () => {
    const db = await openCivicGuardDB();
    const second = entry('2026-11-18T11:00:00.000Z');
    const first = entry('2026-11-18T09:00:00.000Z', 'error');
    const third = entry('2026-11-18T12:00:00.000Z');
    for (const e of [second, first, third]) await saveOutboxEntry(db, e);

    expect((await listOutbox(db)).map((e) => e.id)).toEqual([first.id, second.id, third.id]);
    db.close();
  });
});

describe('metadatos (meta)', () => {
  it('crea, lee, actualiza y borra un valor por clave', async () => {
    const db = await openCivicGuardDB();

    await setMeta(db, 'ultimaSync', '2026-11-18T10:00:00.000Z');
    expect(await getMeta(db, 'ultimaSync')).toBe('2026-11-18T10:00:00.000Z');

    await setMeta(db, 'ultimaSync', '2026-11-18T11:00:00.000Z');
    expect(await getMeta(db, 'ultimaSync')).toBe('2026-11-18T11:00:00.000Z');

    await deleteMeta(db, 'ultimaSync');
    expect(await getMeta(db, 'ultimaSync')).toBeUndefined();
    db.close();
  });

  it('una clave inexistente da undefined y no afecta a la identidad del dispositivo', async () => {
    const db = await openCivicGuardDB();
    const deviceId = await getDeviceId(db);

    expect(await getMeta(db, 'noExiste')).toBeUndefined();
    expect(await getMeta(db, DEVICE_ID_KEY)).toBe(deviceId);
    db.close();
  });
});

describe('saveReport', () => {
  const report: IncidentRecord = {
    id: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
    type: 'bache',
    severity: 'alta',
    description: 'Bache profundo',
    lat: 20.9674,
    lng: -89.5926,
    photo: new Blob(['jpeg'], { type: 'image/jpeg' }),
    createdAt: '2026-11-20T10:00:00.000Z',
  };

  it('guarda el reporte con su foto y lo encola como pending, con la misma hora de captura', async () => {
    const db = await openCivicGuardDB();

    await saveReport(db, report);

    const saved = await getIncident(db, report.id);
    expect(saved).toMatchObject({ ...report, photo: expect.any(Blob) });
    expect(saved?.photo?.type).toBe('image/jpeg');
    expect(saved?.accuracy).toBeUndefined();
    expect(await getOutboxEntry(db, report.id)).toEqual({
      id: report.id,
      status: 'pending',
      createdAt: report.createdAt,
    });
    db.close();
  });

  it('guarda también un reporte con accuracy (GPS)', async () => {
    const db = await openCivicGuardDB();

    await saveReport(db, { ...report, accuracy: 8.4 });

    expect((await getIncident(db, report.id))?.accuracy).toBe(8.4);
    db.close();
  });

  it('si el reporte no se puede guardar, no queda una entrada huérfana en la cola', async () => {
    const db = await openCivicGuardDB();
    // Una función no se puede clonar a IndexedDB: la escritura del reporte falla con DataCloneError.
    const unclonable = { ...report, photo: () => undefined } as unknown as IncidentRecord;

    await expect(saveReport(db, unclonable)).rejects.toThrow();

    expect(await getIncident(db, report.id)).toBeUndefined();
    expect(await getOutboxEntry(db, report.id)).toBeUndefined();
    db.close();
  });

  it('guardar dos veces el mismo id no duplica ni el reporte ni la entrada de la cola', async () => {
    const db = await openCivicGuardDB();

    await saveReport(db, report);
    await saveReport(db, report);

    expect(await listIncidents(db)).toHaveLength(1);
    expect(await listOutbox(db)).toHaveLength(1);
    db.close();
  });
});
