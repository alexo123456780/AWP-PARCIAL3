import 'fake-indexeddb/auto'; // jsdom no trae IndexedDB: instala sus globals (IDBRequest, IDBKeyRange…)
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  DEVICE_ID_KEY,
  getDeviceId,
  openCivicGuardDB,
  type IncidentRecord,
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
