import { expect, test, type Page } from '@playwright/test';
import { COORDINATOR, FakeApi } from './support/fake-api.js';
import { capture, dist, enterAsOperator, eventually, launchPhone } from './support/phone.js';
import { API_PORT, APP_ORIGIN, APP_PORT } from './support/ports.js';
import { registrationId, stubPushManager } from './support/push.js';
import { StaticServer } from './support/static-server.js';

// Ensayo automatizado de la demo (SCRUM-210/228), en el orden en que se presenta: reporte en Modo Avión → reconexión y
// sincronización → cambio de estatus en /panel → notificación push → abrir el detalle. Es el mismo recorrido de
// docs/guia-demo-y-code-freeze.md, con los dobles de la API y del servicio de push de las demás pruebas E2E: no
// reemplaza el ensayo con el equipo sobre producción.
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-demo';
const app = new StaticServer(APP_PORT, dist);
const api = new FakeApi(API_PORT);
let phone: Awaited<ReturnType<typeof launchPhone>>;

test.beforeAll(async () => {
  phone = await launchPhone({
    channel: 'chromium',
    geolocation: { latitude: 20.9674, longitude: -89.5926, accuracy: 15 },
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  await phone.context.grantPermissions(['geolocation', 'camera', 'notifications'], {
    origin: APP_ORIGIN,
  });
  await stubPushManager(phone.context, ENDPOINT);
  // Las teselas del mapa del panel son de un servicio externo: se responden aquí para no depender de internet.
  await phone.context.route('https://tile.openstreetmap.org/**', (route) => route.abort());
});

test.afterAll(async () => {
  await phone.close();
  await Promise.all([app.stop(), api.stop()]);
});

test('Demo: Modo Avión → sincronización → cambio de estatus en /panel → push → detalle', async () => {
  // 0. Antes de empezar (R5): una petición despierta al servicio, y la app queda instalada con los avisos activados.
  await Promise.all([app.start(), api.start()]);
  expect((await fetch(`http://localhost:${API_PORT}/api/health`)).status).toBe(200);
  const phonePage = await phone.context.newPage();
  await phonePage.goto(`${APP_ORIGIN}/reportes`);
  await enterAsOperator(phonePage);
  await phonePage.evaluate(() => navigator.serviceWorker.ready);
  await phonePage.getByRole('button', { name: 'Activar avisos' }).click();
  await expect(phonePage.getByText('Avisos activados')).toBeVisible();
  expect(api.subscriptions.size).toBe(1);

  // 1. Reporte en Modo Avión: se apagan la PWA y la API; la app arranca y guarda el reporte como «Pendiente».
  await Promise.all([app.stop(), api.stop()]);
  await phonePage.close();
  const operator = await phone.context.newPage();
  await operator.goto(APP_ORIGIN);
  await operator.getByLabel('Tipo de incidencia').selectOption('bache');
  await operator.getByLabel('Severidad').selectOption('alta');
  await operator.getByLabel('Descripción').fill('Bache profundo frente al mercado');
  await operator.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(operator.getByText('Lat 20.967400, Lng -89.592600')).toBeVisible();
  await operator.getByRole('button', { name: 'Tomar foto' }).click();
  // Como una persona, espera a ver la imagen de la cámara antes de capturar.
  await operator.waitForFunction(() => (document.querySelector('video')?.videoWidth ?? 0) > 0);
  await operator.getByRole('button', { name: 'Capturar' }).click();
  await expect(operator.getByRole('img', { name: 'Foto de evidencia' })).toBeVisible();
  await operator.getByRole('button', { name: 'Guardar reporte' }).click();
  await expect(operator.getByText('Reporte guardado en tu dispositivo')).toBeVisible();
  await operator.getByRole('link', { name: 'Mis reportes' }).click();
  await expect(operator.getByRole('link', { name: /Bache · Alta/ })).toContainText('Pendiente');
  expect(api.rows.size).toBe(0);

  // 2. Reconexión y sincronización: vuelve la red y el reporte pasa a «Enviado» sin tocar nada.
  await Promise.all([app.start(), api.start()]);
  await operator.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(operator.getByRole('link', { name: /Bache · Alta/ })).toContainText('Enviado');
  expect(api.rows.size).toBe(1);
  const reportId = [...api.rows.keys()][0];

  // 3. Cambio de estatus en /panel (otra pestaña: el coordinador en su equipo).
  // El coordinador usa su propio equipo (otro perfil de navegador): el del teléfono ya tiene el perfil de operador.
  const desk = await launchPhone();
  const panel: Page = await desk.context.newPage();
  await panel.goto(`${APP_ORIGIN}/panel`); // sin sesión lleva al acceso, donde el coordinador inicia sesión
  await panel.getByLabel('Correo').fill(COORDINATOR.email);
  await panel.getByLabel('Contraseña').fill(COORDINATOR.password);
  await panel.getByRole('button', { name: 'Entrar', exact: true }).click();
  await panel.getByText('Bache profundo frente al mercado').click();
  await panel.getByLabel('Nuevo estatus').selectOption('en_revision');
  await panel.getByRole('button', { name: 'Cambiar estatus' }).click();
  await panel.getByRole('button', { name: 'Confirmar' }).click();
  await expect(panel.getByText('Estatus actualizado a «En revisión».')).toBeVisible();
  await capture(panel, '7-demo-panel-cambio-de-estatus');
  await desk.close();

  // 4. Notificación push: el servidor avisa al dispositivo del reportante y el SW muestra la notificación nativa.
  expect(api.pushes).toHaveLength(1);
  const [{ endpoint, payload }] = api.pushes;
  expect(endpoint).toBe(ENDPOINT);
  const cdp = await phone.context.newCDPSession(operator);
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: APP_ORIGIN,
    registrationId: await registrationId(cdp),
    data: JSON.stringify(payload),
  });
  const shown = () =>
    operator.evaluate(async () => {
      const worker = await navigator.serviceWorker.ready;
      return (await worker.getNotifications()).map(({ title, body }) => ({ title, body }));
    });
  expect(await eventually(shown, (list) => list.length > 0)).toEqual([
    {
      title: 'Tu reporte cambió de estatus',
      body: '«Bache profundo frente al mercado» ahora está: En revisión',
    },
  ]);

  // 5. Abrir el detalle: tocar la notificación lleva al reporte y ahí se ve el estatus nuevo.
  const [worker] = phone.context.serviceWorkers();
  await worker.evaluate(`(async () => {
    const [notification] = await self.registration.getNotifications();
    const event = new NotificationEvent('notificationclick', { notification });
    let work;
    event.waitUntil = (promise) => (work = promise);
    self.dispatchEvent(event);
    await work.catch(() => undefined);
  })()`);
  await expect(operator).toHaveURL(`${APP_ORIGIN}/reportes/${reportId}`);
  await expect(operator.getByRole('heading', { name: 'Detalle del reporte' })).toBeVisible();
  await expect(operator.getByText('Enviado')).toBeVisible();
  // El detalle debe mostrar el estatus que acaba de poner el coordinador, no el que tenía al guardarse.
  await expect(operator.locator('dt', { hasText: 'Estatus' }).locator('+ dd')).toHaveText(
    'En revisión',
  );
  await capture(operator, '8-demo-detalle-con-estatus-nuevo');
});
