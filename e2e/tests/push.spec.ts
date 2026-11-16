import { expect, test } from '@playwright/test';
import { FAKE_VAPID_PUBLIC_KEY, FakeApi } from './support/fake-api.js';
import { capture, dist, enterAsOperator, eventually, launchPhone } from './support/phone.js';
import { API_PORT, APP_ORIGIN, APP_PORT } from './support/ports.js';
import { deviceId, registrationId, stubPushManager } from './support/push.js';
import { StaticServer } from './support/static-server.js';

// Avisos de estatus (RF-8, HU-07). Chromium sin ventana no tiene servicio de push (`subscribe` falla con «push service
// not available»), así que dos tramos se simulan y el resto es el código real de la app y del Service Worker:
//  - la suscripción que devolvería el navegador (PushManager.subscribe), y
//  - la entrega del push al SW, con el mismo cuerpo que arma la API (`statusPayload`, api/src/push/push.service.ts).
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-device';
const INCIDENT_ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const PAYLOAD = {
  title: 'Tu reporte cambió de estatus',
  body: '«Bache profundo frente al mercado» ahora está: En revisión',
  incident_id: INCIDENT_ID,
  status: 'en_revision',
  url: `/reportes/${INCIDENT_ID}`,
};

const app = new StaticServer(APP_PORT, dist);
const api = new FakeApi(API_PORT);
let phone: Awaited<ReturnType<typeof launchPhone>>;

test.beforeAll(async () => {
  // El Chromium «headless shell» (el de Playwright por defecto) siempre reporta `Notification.permission = 'denied'`;
  // el canal `chromium` es el navegador completo en modo sin ventana y sí respeta el permiso concedido.
  phone = await launchPhone({ channel: 'chromium' });
  // Concedido de antemano: es lo que queda tras tocar «Permitir» en el aviso del navegador.
  await phone.context.grantPermissions(['notifications'], { origin: APP_ORIGIN });
  await stubPushManager(phone.context, ENDPOINT);
});

test.afterAll(async () => {
  await phone.close();
  await Promise.all([app.stop(), api.stop()]);
});

test('Avisos: se activan con un clic, llega el push y tocarlo abre el detalle del reporte', async () => {
  await Promise.all([app.start(), api.start()]);
  const page = await phone.context.newPage();
  // Sin perfil la app abre en el acceso; al elegir operador vuelve a la ruta pedida (/reportes).
  await page.goto(`${APP_ORIGIN}/reportes`);
  await enterAsOperator(page);
  await expect(page.getByRole('heading', { name: 'Mis reportes' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);

  // Cargar la app no pide el permiso ni suscribe: solo ofrece el botón.
  const enable = page.getByRole('button', { name: 'Activar avisos' });
  await expect(enable).toBeVisible();
  expect(
    await page.evaluate(() => (window as never as Record<string, number>).__permissionRequests),
  ).toBe(0);
  expect(api.subscriptions.size).toBe(0);

  await enable.click();
  await expect(page.getByText('Avisos activados')).toBeVisible();
  expect(
    await page.evaluate(() => (window as never as Record<string, number>).__permissionRequests),
  ).toBe(1);
  expect(
    await page.evaluate(() => (window as never as Record<string, unknown>).__subscribeOptions),
  ).toEqual({
    userVisibleOnly: true,
    applicationServerKey: FAKE_VAPID_PUBLIC_KEY,
  });
  // La suscripción quedó ligada al UUID del dispositivo (el mismo de sus reportes).
  expect(api.subscriptions.get(ENDPOINT)).toEqual({
    reporter_id: await deviceId(page),
    endpoint: ENDPOINT,
    p256dh: 'clave-p256dh-e2e',
    auth: 'secreto-auth-e2e',
  });
  await capture(page, '4-avisos-activados');

  // Llega el push del servidor: el SW muestra la notificación nativa con el reporte y su nuevo estatus.
  const cdp = await phone.context.newCDPSession(page);
  const registration = await registrationId(cdp);
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: APP_ORIGIN,
    registrationId: registration,
    data: JSON.stringify(PAYLOAD),
  });
  const shown = () =>
    page.evaluate(async () => {
      const worker = await navigator.serviceWorker.ready;
      const list = await worker.getNotifications();
      return list.map(({ title, body, tag, data }) => ({ title, body, tag, data }));
    });
  expect(await eventually(shown, (list) => list.length > 0)).toEqual([
    {
      title: PAYLOAD.title,
      body: PAYLOAD.body,
      tag: INCIDENT_ID,
      data: { url: PAYLOAD.url, incident_id: INCIDENT_ID },
    },
  ]);

  // Tocar la notificación (el evento `notificationclick` del SW) enfoca la app en el detalle de ese reporte.
  // Playwright no puede tocar una notificación del sistema: se entrega el mismo evento al SW. Un evento construido por
  // script no admite `waitUntil` (se sustituye para esperar el trabajo del SW) ni puede enfocar la ventana (eso solo lo
  // permite un toque real), así que ese rechazo se ignora: lo que se comprueba es la navegación y el cierre.
  const [worker] = phone.context.serviceWorkers();
  await worker.evaluate(`(async () => {
    const [notification] = await self.registration.getNotifications();
    const event = new NotificationEvent('notificationclick', { notification });
    let work;
    event.waitUntil = (promise) => (work = promise);
    self.dispatchEvent(event);
    await work.catch(() => undefined);
  })()`);
  await expect(page).toHaveURL(`${APP_ORIGIN}${PAYLOAD.url}`);
  await expect(page.getByRole('heading', { name: 'Detalle del reporte' })).toBeVisible();
  // La notificación se cerró al tocarla.
  expect(await eventually(shown, (list) => list.length === 0)).toEqual([]);
});
