import { expect, test, type Page } from '@playwright/test';
import { COORDINATOR, FakeApi, type StoredIncident } from './support/fake-api.js';
import { capture, dist, launchPhone } from './support/phone.js';
import { API_PORT, APP_ORIGIN, APP_PORT } from './support/ports.js';
import { StaticServer } from './support/static-server.js';

// Panel del coordinador (HU-09, RF-9) sobre la compilación de producción, con el doble de la API.
const PHOTO = `${APP_ORIGIN}/icons/icon-192.png`;
const seed = (id: string, extra: Partial<StoredIncident>): StoredIncident => ({
  id,
  reporter_id: '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  type: 'bache',
  severity: 'alta',
  description: `Descripción de ${id}`,
  lat: 20.9674,
  lng: -89.5926,
  accuracy: 12,
  status: 'recibido',
  created_at: '2026-11-10T10:00:00.000Z',
  photo_url: PHOTO,
  photo: { mimeType: 'image/jpeg', bytes: 1, isJpeg: true },
  ...extra,
});

const app = new StaticServer(APP_PORT, dist);
const api = new FakeApi(API_PORT);
let phone: Awaited<ReturnType<typeof launchPhone>>;
let page: Page;
const requestedTiles: string[] = [];

test.beforeAll(async () => {
  phone = await launchPhone();
  // Las teselas del mapa son de un servicio externo: se responden aquí (un PNG de 1×1) para no depender de internet.
  await phone.context.route('https://tile.openstreetmap.org/**', (route) => {
    requestedTiles.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      ),
    });
  });
  api.rows.set('uno', seed('uno', {}));
  api.rows.set(
    'dos',
    seed('dos', { type: 'fuga', status: 'en_revision', created_at: '2026-11-11T10:00:00.000Z' }),
  );
  await Promise.all([app.start(), api.start()]);
});

test.afterAll(async () => {
  await phone.close();
  await Promise.all([app.stop(), api.stop()]);
});

test.describe.configure({ mode: 'serial' });

test('Panel: sin sesión /panel lleva al acceso y no muestra nada, y el token nunca se guarda en el navegador', async () => {
  page = await phone.context.newPage();
  // Anota cualquier escritura en localStorage o sessionStorage (comparten `Storage.prototype`; ESLint prohíbe nombrarlos).
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __storageWrites: string[] }).__storageWrites = writes;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      writes.push(key);
      return setItem.call(this, key, value);
    };
  });
  await page.goto(`${APP_ORIGIN}/panel`);

  await expect(page).toHaveURL(`${APP_ORIGIN}/acceso`);
  await expect(page.getByLabel('Correo')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0);
  await expect(page.getByText(/Descripción de/)).toHaveCount(0);
  expect(api.adminRequests).toBe(0);

  await page.getByLabel('Correo').fill(COORDINATOR.email);
  await page.getByLabel('Contraseña').fill('contraseña-equivocada');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Correo o contraseña incorrectos');
  await expect(page.getByText(/Descripción de/)).toHaveCount(0);

  await page.getByLabel('Contraseña').fill(COORDINATOR.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/panel`);
  await expect(page.getByText('Descripción de dos')).toBeVisible();
  await expect(page.getByText('Descripción de uno')).toBeVisible();

  // Ni localStorage, ni sessionStorage, ni cookies, ni IndexedDB guardan el token (solo vive en memoria).
  const traces = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const stored = await Promise.all(
      databases.map(
        (db) =>
          new Promise<string>((resolve) => {
            const open = indexedDB.open(db.name!);
            open.onsuccess = () => {
              const names = [...open.result.objectStoreNames];
              const tx = open.result.transaction(names);
              const all = names.map((n) => tx.objectStore(n).getAll());
              tx.oncomplete = () => resolve(JSON.stringify(all.map((r) => r.result)));
            };
          }),
      ),
    );
    const writes = (window as unknown as { __storageWrites: string[] }).__storageWrites;
    return [writes.length, document.cookie, ...stored].join('|');
  });
  expect(traces).not.toContain('jwt-de-prueba-e2e');
  expect(traces.startsWith('0|')).toBe(true); // ninguna escritura en localStorage ni sessionStorage
  await capture(page, '5-panel-lista');
});

test('Panel: filtra por estatus y muestra el detalle con foto y mapa estático', async () => {
  await page.getByRole('button', { name: 'En revisión', exact: true }).click();
  await expect(page.getByText('Descripción de uno')).toHaveCount(0);
  await expect(page.getByText('Descripción de dos')).toBeVisible();
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await expect(page.getByText('Descripción de uno')).toBeVisible();

  await page.getByText('Descripción de uno').click();
  await expect(page.getByRole('heading', { name: 'Detalle del reporte' })).toBeVisible();
  const photo = page.getByRole('img', { name: 'Foto de evidencia del reporte' });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const map = page.getByRole('img', { name: 'Mapa con la ubicación del reporte' });
  await expect(map).toBeVisible();
  await expect(map.locator('img')).toHaveCount(9);
  // La tesela del punto (zoom 16) está entre las pedidas.
  await expect.poll(() => requestedTiles).toContain('/16/16458/28862.png');
  await capture(page, '6-panel-detalle');
});

test('Panel: cambiar el estatus pide confirmación y la lista refleja el nuevo estatus', async () => {
  await page.getByLabel('Nuevo estatus').selectOption('en_atencion');
  await page.getByRole('button', { name: 'Cambiar estatus' }).click();
  await expect(page.getByText('¿Cambiar el estatus a «En atención»?')).toBeVisible();
  expect(api.rows.get('uno')?.status).toBe('recibido'); // todavía no
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Estatus actualizado a «En atención».')).toBeVisible();
  expect(api.rows.get('uno')?.status).toBe('en_atencion');

  await page.getByRole('button', { name: 'Volver a la lista' }).click();
  await expect(page.getByRole('button', { name: /Descripción de uno/ })).toContainText(
    'En atención',
  );
});

test('Panel: sin red muestra un mensaje claro y se recupera al volver', async () => {
  await api.stop();
  await page.getByRole('button', { name: 'Resuelto', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Sin conexión');
  await expect(page.getByText(/Descripción de/)).toHaveCount(0);

  await api.start();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText(/No hay reportes con estatus «Resuelto»/)).toBeVisible();
});
