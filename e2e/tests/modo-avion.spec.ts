import { chromium, devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeApi } from './support/fake-api.js';
import { API_PORT, APP_ORIGIN, APP_PORT } from './support/ports.js';
import { StaticServer } from './support/static-server.js';

// Modo Avión (RF-3, RF-5, RF-6): un solo «teléfono» (perfil persistente de Chromium con viewport de Pixel 7) que vive
// los dos escenarios en orden: primero captura sin red y, después, recupera la red y sincroniza.
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../web/dist');
const evidence = path.resolve(here, '../../docs/evidencia');

const app = new StaticServer(APP_PORT, dist);
const api = new FakeApi(API_PORT);
let profile: string;
let context: BrowserContext;
// La pestaña del «teléfono»: la crea el primer escenario y el segundo sigue en ella.
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'civicguard-e2e-'));
  context = await chromium.launchPersistentContext(profile, {
    ...devices['Pixel 7'],
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 20.9674, longitude: -89.5926, accuracy: 15 },
    // Cámara y permiso simulados: el navegador entrega un video de prueba en vez de pedir la cámara real.
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
});

test.afterAll(async () => {
  await context.close();
  await Promise.all([app.stop(), api.stop()]);
  rmSync(profile, { recursive: true, force: true });
});

/** Adjunta la captura al informe HTML y, con E2E_EVIDENCE=1, la guarda en docs/evidencia (evidencia versionada). */
async function capture(page: Page, name: string) {
  const body = await page.screenshot({ fullPage: true });
  await test.info().attach(name, { body, contentType: 'image/png' });
  if (process.env.E2E_EVIDENCE) {
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `e2e-${name}.png`), fullPage: true });
  }
}

test('Modo Avión: captura un reporte con ubicación y foto y lo deja pendiente', async () => {
  // Primera visita con red: instala el Service Worker y precachea el cascarón.
  await Promise.all([app.start(), api.start()]);
  const first = await context.newPage();
  await first.goto(APP_ORIGIN);
  await first.evaluate(() => navigator.serviceWorker.ready);
  await first.close();

  // Modo Avión: se apagan de verdad el servidor de la PWA y el de la API.
  await Promise.all([app.stop(), api.stop()]);

  // La app arranca sin red: el SW entrega el cascarón precacheado.
  page = await context.newPage();
  await page.goto(APP_ORIGIN);
  await expect(page.getByRole('heading', { name: 'Nuevo reporte' })).toBeVisible();

  await page.getByLabel('Tipo de incidencia').selectOption('bache');
  await page.getByLabel('Severidad').selectOption('alta');
  await page.getByLabel('Descripción').fill('Bache profundo frente al mercado');
  await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(page.getByText('Lat 20.967400, Lng -89.592600')).toBeVisible();
  await page.getByRole('button', { name: 'Tomar foto' }).click();
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('img', { name: 'Foto de evidencia' })).toBeVisible();
  await capture(page, '1-formulario-sin-red');

  await page.getByRole('button', { name: 'Guardar reporte' }).click();
  await expect(page.getByText('Reporte guardado en tu dispositivo')).toBeVisible();

  // «Mis reportes» (otra navegación, también sin red) lo muestra pendiente y nada llegó al servidor.
  await page.getByRole('link', { name: 'Mis reportes' }).click();
  const card = page.locator('.report-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Bache · Alta');
  await expect(card).toContainText('Pendiente');
  expect(api.rows.size).toBe(0);
  await capture(page, '2-mis-reportes-pendiente');
});

/** Dispara lo mismo que el navegador al recuperar la red: el evento `online` de la ventana. */
const reconnect = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

test('Reconexión: el reporte llega al servidor, pasa a enviado y un reenvío no lo duplica', async () => {
  const card = page.locator('.report-card');
  await expect(card).toContainText('Pendiente');

  // Vuelve la red: los dos servidores se encienden y la app lo nota.
  await Promise.all([app.start(), api.start()]);
  await reconnect(page);

  await expect(card).toContainText('Enviado');
  expect(api.rows.size).toBe(1);
  const [row] = [...api.rows.values()];
  expect(row).toMatchObject({
    type: 'bache',
    severity: 'alta',
    description: 'Bache profundo frente al mercado',
    lat: 20.9674,
    lng: -89.5926,
    status: 'recibido',
  });
  // La foto llegó entera y comprimida (JPEG), no un archivo vacío ni el original.
  expect(row.photo).toMatchObject({ mimeType: 'image/jpeg', isJpeg: true });
  expect(row.photo.bytes).toBeGreaterThan(0);
  expect(api.posts).toBe(1);
  await capture(page, '3-mis-reportes-enviado');

  // Reenvío del mismo reporte (p. ej. la respuesta se perdió y la app no supo que llegó): vuelve a `pending`.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('civicguard');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('outbox', 'readwrite');
          const store = tx.objectStore('outbox');
          store.getAll().onsuccess = (event) => {
            for (const entry of (event.target as IDBRequest<{ status: string }[]>).result) {
              store.put({ ...entry, status: 'pending' });
            }
          };
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await reconnect(page);

  // El servidor recibió el mismo `id` por segunda vez y sigue habiendo una sola fila.
  await expect.poll(() => api.posts).toBe(2);
  expect(api.rows.size).toBe(1);
  await page.reload();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Enviado');
});
