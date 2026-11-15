/* global self, indexedDB, fetch, FormData, AbortSignal */
// Envío de los reportes pendientes (RF-6). Lo carga sw.js con importScripts y es la ÚNICA implementación del envío:
// la corre el evento `sync` (Background Sync, Chromium) y, donde no existe, el mensaje FLUSH_OUTBOX que manda la app
// al abrirse, al volver la red o al volver a primer plano (SCRUM-190). Es JS clásico con IndexedDB «a pelo»: un SW
// no puede importar módulos del bundle de la app. Los nombres de la base y los stores son los de web/src/db/idb.ts.

const DB_NAME = 'civicguard';
const SYNC_TAG = 'sync-incidents';
const SEND_TIMEOUT_MS = 60_000;

const wrap = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

// Abre la base que la app ya creó. Nunca la crea: una base de versión 1 sin stores, hecha por el SW, impediría a la
// app ejecutar su `upgrade` (el navegador ya la vería en la versión 1). Sin base no hay nada que enviar.
function openDb() {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

// Cambia solo el estado de la entrada, en su propia transacción: así un fallo en un reporte no deshace los demás.
async function setStatus(db, id, status) {
  const store = db.transaction('outbox', 'readwrite').objectStore('outbox');
  const entry = await wrap(store.get(id));
  if (entry) await wrap(store.put({ ...entry, status }));
}

// Avisa a las pestañas abiertas para que la lista de reportes se refresque sin recargar (SCRUM-181).
async function notifyClients() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: 'OUTBOX_CHANGED' });
}

// Mismos campos que `CreateIncidentDto` de la API; `accuracy` solo existe si el GPS la informó.
function toFormData(incident, reporterId) {
  const form = new FormData();
  form.append('id', incident.id);
  form.append('reporter_id', reporterId);
  form.append('type', incident.type);
  form.append('severity', incident.severity);
  form.append('description', incident.description);
  form.append('lat', String(incident.lat));
  form.append('lng', String(incident.lng));
  if (incident.accuracy !== undefined) form.append('accuracy', String(incident.accuracy));
  form.append('created_at', incident.createdAt);
  if (incident.photo) form.append('photo', incident.photo, `${incident.id}.jpg`);
  return form;
}

// 2xx: llegó (la API responde 201 también al reintento de un id ya guardado). 4xx: el servidor rechazó el reporte
// y reenviarlo igual fallaría siempre, así que queda en `error`; 408 y 429 sí se reintentan. 5xx: se reintenta.
function outcomeOf(status) {
  if (status >= 200 && status < 300) return 'sent';
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'error';
  return 'retry';
}

async function send(apiUrl, incident, reporterId) {
  try {
    const response = await fetch(`${apiUrl}/api/incidents`, {
      method: 'POST',
      body: toFormData(incident, reporterId),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return outcomeOf(response.status);
  } catch {
    return 'offline'; // sin red, o la petición tardó demasiado
  }
}

async function drain() {
  const db = await openDb();
  if (!db) return;
  try {
    const apiUrl = await wrap(db.transaction('meta').objectStore('meta').get('apiUrl'));
    const reporterId = await wrap(db.transaction('meta').objectStore('meta').get('deviceId'));
    // Sin la URL de la API o sin la identidad del dispositivo (las deja la app al guardar) no se puede enviar.
    if (!apiUrl || !reporterId) return;

    const entries = await wrap(db.transaction('outbox').objectStore('outbox').getAll());
    // Solo `pending` (un reporte `sent` o `error` nunca se reenvía), del más antiguo al más reciente.
    const queue = entries
      .filter((entry) => entry.status === 'pending')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    let retry = false;
    for (const entry of queue) {
      const incident = await wrap(
        db.transaction('incidents').objectStore('incidents').get(entry.id),
      );
      // Una entrada sin su reporte no se puede enviar nunca: no debe atascar la cola.
      const outcome = incident ? await send(apiUrl, incident, reporterId) : 'error';
      if (outcome === 'offline') {
        // Sin red: intentar los demás solo gastaría tiempo; el siguiente `sync` reintenta.
        retry = true;
        break;
      }
      if (outcome === 'retry') {
        // El servidor respondió pero no pudo (5xx, 408, 429): este reporte queda pendiente y los demás siguen.
        retry = true;
        continue;
      }
      await setStatus(db, entry.id, outcome);
      await notifyClients();
    }
    // Rechazar le dice al navegador que reintente el `sync` con su espera creciente.
    if (retry) throw new Error('Quedan reportes pendientes de enviar');
  } finally {
    db.close();
  }
}

// Un vaciado en curso se comparte: dos eventos seguidos (`online` + `visibilitychange`) no envían dos veces.
let draining = null;
function flushOutbox() {
  if (!draining) draining = drain().finally(() => (draining = null));
  return draining;
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushOutbox());
});

// Fallback sin Background Sync: la app pide el vaciado; aquí no se reintenta solo (lo hará el siguiente evento).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'FLUSH_OUTBOX') event.waitUntil(flushOutbox().catch(() => undefined));
});
