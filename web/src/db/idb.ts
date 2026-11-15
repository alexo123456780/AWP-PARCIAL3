import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const DB_NAME = 'civicguard';
/** Súbela solo al cambiar stores o índices y añade el paso correspondiente en `upgrade`. */
export const DB_VERSION = 1;
export const DEVICE_ID_KEY = 'deviceId';

export type IncidentType = 'bache' | 'fuga' | 'alumbrado' | 'cableado' | 'otro';
export type IncidentSeverity = 'baja' | 'media' | 'alta' | 'critica';

/** Reporte guardado en el dispositivo (PRD §5.5). `id` es el UUID v4 del cliente: el servidor deduplica por él. */
export interface IncidentRecord {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  description: string;
  lat: number;
  lng: number;
  /** Metros de error del GPS; ausente en la captura manual. */
  accuracy?: number;
  photo?: Blob;
  /** ISO 8601: hora real de captura. */
  createdAt: string;
}

/** Entrada de la cola de envío; una por reporte, con el mismo `id` que su `IncidentRecord`. */
export interface OutboxEntry {
  id: string;
  status: 'pending' | 'failed';
  /** ISO 8601, para vaciar la cola en orden de captura. */
  createdAt: string;
}

export interface CivicGuardDB extends DBSchema {
  incidents: {
    key: string;
    value: IncidentRecord;
    indexes: { 'by-createdAt': string };
  };
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { 'by-status': OutboxEntry['status'] };
  };
  /** Metadatos del dispositivo con clave explícita (p. ej. `deviceId`). */
  meta: { key: string; value: string };
}

export type CivicGuardConnection = IDBPDatabase<CivicGuardDB>;

// shortcut: sin `blocking`/`blocked`; añadirlos al publicar la versión 2, cuando una pestaña vieja pueda frenar el upgrade.
export function openCivicGuardDB(name = DB_NAME): Promise<CivicGuardConnection> {
  return openDB<CivicGuardDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('incidents', { keyPath: 'id' }).createIndex(
          'by-createdAt',
          'createdAt',
        );
        db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('by-status', 'status');
        db.createObjectStore('meta');
      }
    },
  });
}

// Operaciones locales (RF-5, SCRUM-183): todas asíncronas, sobre una conexión abierta con `openCivicGuardDB`.
// `save*` y `setMeta` crean o actualizan según exista la clave. La foto viaja como `Blob` dentro del reporte:
// IndexedDB lo clona con su tipo y tamaño. Los errores (p. ej. `QuotaExceededError`) llegan como rechazo al llamador.

export const saveIncident = (db: CivicGuardConnection, incident: IncidentRecord) =>
  db.put('incidents', incident);

export const getIncident = (db: CivicGuardConnection, id: string) => db.get('incidents', id);

/** Del reporte más antiguo al más reciente. */
export const listIncidents = (db: CivicGuardConnection) =>
  db.getAllFromIndex('incidents', 'by-createdAt');

export const deleteIncident = (db: CivicGuardConnection, id: string) => db.delete('incidents', id);

/**
 * Guarda un reporte nuevo y lo encola como `pending` en UNA transacción: o quedan los dos o ninguno, así no
 * puede existir un reporte que nunca se envíe ni una entrada de la cola sin su reporte (p. ej. por falta de cuota).
 */
export async function saveReport(
  db: CivicGuardConnection,
  incident: IncidentRecord,
): Promise<void> {
  const tx = db.transaction(['incidents', 'outbox'], 'readwrite');
  await Promise.all([
    tx.objectStore('incidents').put(incident),
    tx
      .objectStore('outbox')
      .put({ id: incident.id, status: 'pending', createdAt: incident.createdAt }),
    tx.done,
  ]);
}

export const saveOutboxEntry = (db: CivicGuardConnection, entry: OutboxEntry) =>
  db.put('outbox', entry);

export const getOutboxEntry = (db: CivicGuardConnection, id: string) => db.get('outbox', id);

/** En orden de captura, que es el orden en que se vaciará la cola. */
export async function listOutbox(db: CivicGuardConnection): Promise<OutboxEntry[]> {
  const entries = await db.getAll('outbox');
  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const deleteOutboxEntry = (db: CivicGuardConnection, id: string) => db.delete('outbox', id);

export const setMeta = (db: CivicGuardConnection, key: string, value: string) =>
  db.put('meta', value, key);

export const getMeta = (db: CivicGuardConnection, key: string) => db.get('meta', key);

export const deleteMeta = (db: CivicGuardConnection, key: string) => db.delete('meta', key);

/**
 * UUID anónimo del dispositivo: se genera en la primera llamada y las siguientes reutilizan el guardado.
 * Leer y escribir ocurren en una misma transacción `readwrite`, que IndexedDB serializa entre
 * pestañas, así que dos arranques simultáneos no pueden crear dos identidades distintas.
 */
export async function getDeviceId(db: CivicGuardConnection): Promise<string> {
  const tx = db.transaction('meta', 'readwrite');
  let deviceId = await tx.store.get(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await tx.store.put(deviceId, DEVICE_ID_KEY);
  }
  await tx.done;
  return deviceId;
}
