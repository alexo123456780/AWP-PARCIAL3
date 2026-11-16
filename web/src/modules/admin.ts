import type { IncidentStatus } from '../db/idb';
import type { ServerIncident } from './reports';
import { API_URL } from './sync';

/** Por qué falló una llamada del panel; cada motivo tiene su mensaje en español (`describeFailure`). */
export type AdminFailure =
  | 'invalid-credentials'
  /** El token no vale (falta, es inválido o venció): hay que volver al login. */
  | 'unauthorized'
  | 'rate-limited'
  /** La API no está configurada (sin `VITE_API_URL`) o responde 503 (sin `JWT_SECRET`). */
  | 'unavailable'
  | 'offline'
  | 'server';

export class AdminError extends Error {
  constructor(readonly reason: AdminFailure) {
    super(reason);
  }
}

const MESSAGES: Record<AdminFailure, string> = {
  'invalid-credentials': 'Correo o contraseña incorrectos.',
  unauthorized: 'Tu sesión venció. Inicia sesión de nuevo.',
  'rate-limited': 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.',
  unavailable: 'El panel no está disponible por ahora. Inténtalo más tarde.',
  offline: 'Sin conexión. Iniciar sesión y usar el panel del coordinador necesitan internet.',
  server: 'Algo salió mal en el servidor. Inténtalo de nuevo.',
};

export const describeFailure = (error: unknown): string =>
  MESSAGES[error instanceof AdminError ? error.reason : 'server'];

async function send(path: string, init: RequestInit): Promise<Response> {
  if (!API_URL) throw new AdminError('unavailable');
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new AdminError('offline');
  }
}

/** Perfil de una cuenta: lo decide el servidor, no el usuario. */
export type Role = 'coordinador' | 'operador';

/** Entra con el correo y la contraseña de una cuenta y devuelve su JWT (que solo debe vivir en memoria) y su rol. */
export async function login(
  email: string,
  password: string,
): Promise<{ token: string; role: Role }> {
  const response = await send('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 400 || response.status === 401)
    throw new AdminError('invalid-credentials');
  if (response.status === 429) throw new AdminError('rate-limited');
  if (response.status === 503) throw new AdminError('unavailable');
  if (!response.ok) throw new AdminError('server');
  const { access_token: token, role } = (await response.json()) as {
    access_token: string;
    role: string;
  };
  // Un rol que esta versión de la app no conoce no abre ninguna pantalla: se trata como un fallo del servidor.
  if (role !== 'coordinador' && role !== 'operador') throw new AdminError('server');
  return { token, role };
}

async function authorized(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await send(path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new AdminError('unauthorized');
  if (!response.ok) throw new AdminError('server');
  return response;
}

/** Todos los reportes, del más reciente al más antiguo; con `status`, solo los de ese estatus. */
export async function fetchAdminIncidents(
  token: string,
  status?: IncidentStatus,
): Promise<ServerIncident[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await authorized(token, `/api/admin/incidents${query}`);
  return (await response.json()) as ServerIncident[];
}

/** Cambia el estatus de un reporte (la API avisa por push al reportante) y devuelve el reporte actualizado. */
export async function updateIncidentStatus(
  token: string,
  id: string,
  status: IncidentStatus,
): Promise<ServerIncident> {
  const response = await authorized(
    token,
    `/api/admin/incidents/${encodeURIComponent(id)}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    },
  );
  return (await response.json()) as ServerIncident;
}
