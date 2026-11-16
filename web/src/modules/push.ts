import { getDeviceId, openCivicGuardDB } from '../db/idb';
import { API_URL } from './sync';

/** Resultado de intentar activar los avisos; un fallo de red o del servidor se lanza como error. */
export type EnablePushResult = 'enabled' | 'denied' | 'unavailable';

/**
 * `PushManager` y `Notification` solo existen si el navegador admite Web Push: en iOS hace falta 16.4 o superior **y**
 * la app instalada en la pantalla de inicio (R3); en una pestaña de Safari y en navegadores viejos faltan.
 */
export const isPushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** La clave pública VAPID de la API; `null` si la API no tiene push configurado (503) o no hay API a la cual preguntar. */
async function fetchPublicKey(): Promise<string | null> {
  if (!API_URL) return null;
  const response = await fetch(`${API_URL}/api/push/vapid-public-key`);
  if (response.status === 503) return null;
  if (!response.ok) throw new Error(`vapid-public-key respondió ${response.status}`);
  return ((await response.json()) as { public_key: string }).public_key;
}

/**
 * Activa los avisos de estatus (RF-8): pide el permiso, suscribe al dispositivo con la clave VAPID del servidor y le
 * manda la suscripción junto con el UUID del dispositivo. Debe llamarse desde el clic de un botón, nunca al cargar:
 * Safari exige que `requestPermission` sea lo primero que ocurre dentro del gesto, y un permiso pedido por sorpresa
 * se rechaza casi siempre.
 */
export async function enablePush(): Promise<EnablePushResult> {
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const publicKey = await fetchPublicKey();
  if (!publicKey) return 'unavailable';

  const { pushManager } = await navigator.serviceWorker.ready;
  // shortcut: se reutiliza la suscripción existente; si el servidor cambiara de claves VAPID habría que darla de baja.
  const subscription =
    (await pushManager.getSubscription()) ??
    (await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }));
  const { endpoint, keys } = subscription.toJSON();

  const db = await openCivicGuardDB();
  let reporterId: string;
  try {
    reporterId = await getDeviceId(db);
  } finally {
    db.close();
  }
  const response = await fetch(`${API_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reporter_id: reporterId,
      endpoint,
      p256dh: keys?.p256dh,
      auth: keys?.auth,
    }),
  });
  if (!response.ok) throw new Error(`push/subscribe respondió ${response.status}`);
  return 'enabled';
}

/** ¿Este dispositivo ya está suscrito? Solo lee: no pide permisos ni crea nada. */
export async function hasPushSubscription(): Promise<boolean> {
  if (Notification.permission !== 'granted') return false;
  const { pushManager } = await navigator.serviceWorker.ready;
  return (await pushManager.getSubscription()) !== null;
}
