import {
  getDeviceId,
  type CivicGuardConnection,
  type IncidentRecord,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
  listIncidents,
  listOutbox,
  type OutboxEntry,
} from '../db/idb';
import { API_URL } from './sync';

/** Estado de envío de un reporte (lo que ve el operador): `OutboxEntry['status']`. */
export type SyncState = OutboxEntry['status'];

/** Un reporte tal como lo muestran «Mis reportes» y «Detalle»: lo local manda, el servidor completa. */
export interface ReportItem {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  description: string;
  lat: number;
  lng: number;
  accuracy?: number;
  /** ISO 8601: hora real de captura. */
  createdAt: string;
  sync: SyncState;
  /** Último estatus conocido del servidor. */
  status?: IncidentStatus;
  /** Foto guardada en el dispositivo (solo reportes hechos aquí). */
  photo?: Blob;
  /** Foto en el almacenamiento externo (reportes que el dispositivo no tiene guardados). */
  photoUrl?: string;
}

/** Forma de un reporte en la API (snake_case, como las columnas). */
export interface ServerIncident {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  description: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  photo_url: string | null;
  status: IncidentStatus;
  created_at: string;
}

export const fromLocal = (incident: IncidentRecord, entry?: OutboxEntry): ReportItem => ({
  id: incident.id,
  type: incident.type,
  severity: incident.severity,
  description: incident.description,
  lat: incident.lat,
  lng: incident.lng,
  accuracy: incident.accuracy,
  createdAt: incident.createdAt,
  // Un reporte sin entrada en la cola no debería existir; ante la duda se muestra como pendiente.
  sync: entry?.status ?? 'pending',
  status: incident.status,
  photo: incident.photo,
});

export const fromServer = (incident: ServerIncident): ReportItem => ({
  id: incident.id,
  type: incident.type,
  severity: incident.severity,
  description: incident.description,
  lat: incident.lat,
  lng: incident.lng,
  accuracy: incident.accuracy ?? undefined,
  createdAt: incident.created_at,
  sync: 'sent', // si el servidor lo tiene, ya llegó
  status: incident.status,
  photoUrl: incident.photo_url ?? undefined,
});

/**
 * Une lo local con lo que dice el servidor, del reporte más reciente al más antiguo. Un reporte hecho en este
 * dispositivo conserva su estado de envío y su foto locales y toma el estatus del servidor; uno que solo conoce el
 * servidor entra como enviado.
 */
export function mergeReports(local: ReportItem[], server: ServerIncident[]): ReportItem[] {
  const serverById = new Map(server.map((incident) => [incident.id, incident]));
  const merged = local.map((item) => {
    const remote = serverById.get(item.id);
    serverById.delete(item.id);
    return remote ? { ...item, status: remote.status } : item;
  });
  const onlyServer = [...serverById.values()].map(fromServer);
  return [...merged, ...onlyServer].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Lo guardado en el dispositivo, unido con el estado de envío de cada reporte. */
export async function loadLocalReports(db: CivicGuardConnection): Promise<ReportItem[]> {
  const [incidents, outbox] = await Promise.all([listIncidents(db), listOutbox(db)]);
  const entries = new Map(outbox.map((entry) => [entry.id, entry]));
  // `listIncidents` va del más antiguo al más reciente; la pantalla muestra lo más nuevo primero, también sin red.
  return incidents.map((incident) => fromLocal(incident, entries.get(incident.id))).reverse();
}

export interface ServerReports {
  incidents: ServerIncident[];
  /** `true` si el SW entregó su copia guardada (sin red, red lenta o error del servidor). */
  fromCache: boolean;
}

/**
 * Pide al servidor los reportes de este dispositivo. El SW responde primero con la red y, si no puede, con la
 * última copia (`X-Served-From: cache`). `null` si no hay a dónde preguntar o no hubo respuesta útil: «Mis reportes»
 * sigue mostrando lo local.
 */
export async function fetchServerReports(db: CivicGuardConnection): Promise<ServerReports | null> {
  if (!API_URL) return null;
  try {
    const deviceId = await getDeviceId(db);
    const response = await fetch(
      `${API_URL}/api/incidents?reporter_id=${encodeURIComponent(deviceId)}`,
    );
    if (!response.ok) return null;
    const incidents: unknown = await response.json();
    if (!Array.isArray(incidents)) return null;
    return {
      incidents: incidents as ServerIncident[],
      fromCache: response.headers.get('X-Served-From') === 'cache',
    };
  } catch {
    return null;
  }
}

/**
 * Un reporte por id desde el servidor (para uno que este dispositivo no tiene guardado). Con `freshOnly`, una copia que
 * el SW entregó de su respaldo (`X-Served-From: cache`) cuenta como «sin respuesta»: sirve para mostrar, no para
 * decidir que el estatus cambió.
 */
export async function fetchServerReport(id: string, freshOnly = false): Promise<ReportItem | null> {
  if (!API_URL) return null;
  try {
    const response = await fetch(`${API_URL}/api/incidents/${encodeURIComponent(id)}`);
    if (!response.ok || (freshOnly && response.headers.get('X-Served-From') === 'cache'))
      return null;
    return fromServer((await response.json()) as ServerIncident);
  } catch {
    return null;
  }
}

/** «15 nov 2026, 3:02 p. m.»: la hora real de captura, en la zona del dispositivo. */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
