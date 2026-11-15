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
  accuracy: number;
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
