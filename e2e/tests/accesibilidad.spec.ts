import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { COORDINATOR, FakeApi, type StoredIncident } from './support/fake-api.js';
import { dist, launchPhone } from './support/phone.js';
import { API_PORT, APP_ORIGIN, APP_PORT } from './support/ports.js';
import { StaticServer } from './support/static-server.js';

// Accesibilidad (PRD §4, meta O4) de TODAS las pantallas del operador y del panel: reglas WCAG 2.x A/AA de axe (incluye
// contraste de color, `alt` y etiquetas), objetivos táctiles de 44 px y foco visible al recorrer con el teclado.
const TOUCH_TARGET = 44;
const REPORTER_ID = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const seed = (id: string, extra: Partial<StoredIncident> = {}): StoredIncident => ({
  id,
  reporter_id: REPORTER_ID,
  type: 'bache',
  severity: 'alta',
  description: `Descripción de ${id}`,
  lat: 20.9674,
  lng: -89.5926,
  accuracy: 12,
  status: 'recibido',
  created_at: '2026-11-10T10:00:00.000Z',
  photo_url: `${APP_ORIGIN}/icons/icon-192.png`,
  photo: { mimeType: 'image/jpeg', bytes: 1, isJpeg: true },
  ...extra,
});

const app = new StaticServer(APP_PORT, dist);
const api = new FakeApi(API_PORT);
let phone: Awaited<ReturnType<typeof launchPhone>>;
let page: Page;

test.beforeAll(async () => {
  phone = await launchPhone({
    permissions: ['geolocation', 'notifications'],
    geolocation: { latitude: 20.9674, longitude: -89.5926 },
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    channel: 'chromium',
  });
  // Teselas del mapa de un servicio externo: se responden aquí para no depender de internet.
  await phone.context.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  api.rows.set('uno', seed('uno'));
  api.rows.set('dos', seed('dos', { type: 'fuga', status: 'en_revision', photo_url: null }));
  await Promise.all([app.start(), api.start()]);
  page = await phone.context.newPage();
});

test.afterAll(async () => {
  await phone.close();
  await Promise.all([app.stop(), api.stop()]);
});

/** Hallazgos de una pantalla: reglas de axe, elementos táctiles menores a 44 px y controles sin foco visible. */
async function audit(screen: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const rules = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );

  const small = await page.evaluate((min) => {
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} «${(el.textContent ?? '').trim().slice(0, 30)}»`;
    return [
      ...document.querySelectorAll(
        'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]',
      ),
    ]
      .filter((el) => {
        const style = getComputedStyle(el);
        // Un enlace dentro de un párrafo (en línea) queda exento, como en WCAG 2.5.5.
        if (
          style.display === 'inline' ||
          style.visibility === 'hidden' ||
          el.getClientRects().length === 0
        )
          return false;
        if (el.closest('.visually-hidden')) return false;
        const { width, height } = el.getBoundingClientRect();
        return width < min || height < min;
      })
      .map(label);
  }, TOUCH_TARGET);

  // Recorre la pantalla con Tab y anota cada control que recibe el foco sin ningún indicador visible.
  const noFocus: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== 'none';
      return {
        id: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} «${(el.textContent ?? '').trim().slice(0, 30)}»`,
        visible: outline || shadow,
      };
    });
    if (!focused || seen.has(focused.id)) break;
    seen.add(focused.id);
    if (!focused.visible) noFocus.push(focused.id);
  }
  return { screen, axe: rules, tactiles: small, sinFoco: noFocus };
}

const findings: Awaited<ReturnType<typeof audit>>[] = [];
const check = async (screen: string) => {
  const result = await audit(screen);
  findings.push(result);
  expect(result, `Accesibilidad de «${screen}»`).toEqual({
    screen,
    axe: [],
    tactiles: [],
    sinFoco: [],
  });
};

test.describe.configure({ mode: 'serial' });

test('Nuevo reporte: vacío, con errores de validación y con el botón de instalación', async () => {
  await page.goto(APP_ORIGIN);
  await expect(page.getByRole('heading', { name: 'Nuevo reporte' })).toBeVisible();
  await check('Nuevo reporte');

  // El botón de instalación solo existe cuando el navegador ofrece instalar: se simula su evento.
  await page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => undefined,
    });
    window.dispatchEvent(event);
  });
  await expect(page.getByRole('button', { name: 'Instalar CivicGuard' })).toBeVisible();
  await check('Nuevo reporte con el botón de instalación');

  await page.getByRole('button', { name: 'Guardar reporte' }).click();
  await expect(page.getByText('Elige el tipo de incidencia.')).toBeVisible();
  await check('Nuevo reporte con errores de validación');
});

test('Nuevo reporte: ubicación denegada con el formulario manual y cámara abierta', async () => {
  // Sin el permiso de ubicación el navegador la rechaza y la pantalla ofrece escribir las coordenadas.
  await phone.context.clearPermissions();
  await phone.context.grantPermissions(['camera', 'notifications'], { origin: APP_ORIGIN });
  await page.goto(APP_ORIGIN);
  await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(page.getByLabel('Latitud')).toBeVisible();
  await page.getByRole('button', { name: 'Usar estas coordenadas' }).click();
  await check('Nuevo reporte con la ubicación manual y sus errores');

  await page.getByRole('button', { name: 'Tomar foto' }).click();
  await expect(page.getByLabel('Vista de la cámara')).toBeVisible();
  await check('Nuevo reporte con la cámara abierta');
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('img', { name: 'Foto de evidencia' })).toBeVisible();
  await check('Nuevo reporte con foto capturada');
});

test('Mis reportes: vacío, con reportes y detalle', async () => {
  await page.goto(`${APP_ORIGIN}/reportes`);
  await expect(page.getByText('Aún no tienes reportes')).toBeVisible();
  await check('Mis reportes vacío');

  // El dispositivo ya tiene identidad: los reportes del servidor de ese dispositivo aparecen como enviados.
  const deviceId = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('civicguard');
        open.onsuccess = () => {
          const get = open.result.transaction('meta').objectStore('meta').get('deviceId');
          get.onsuccess = () => resolve(get.result as string);
        };
      }),
  );
  for (const row of api.rows.values()) row.reporter_id = deviceId;
  await page.reload();
  await expect(page.locator('.report-card')).toHaveCount(2);
  await check('Mis reportes con reportes');

  await page.locator('.report-card', { hasText: 'Descripción de uno' }).click();
  await expect(page.getByRole('heading', { name: 'Detalle del reporte' })).toBeVisible();
  await check('Detalle del reporte');

  await page.goto(`${APP_ORIGIN}/reportes/no-existe`);
  await expect(page.getByRole('alert')).toBeVisible();
  await check('Detalle de un reporte inexistente');
});

test('Panel del coordinador: login, lista, detalle y confirmación', async () => {
  await page.goto(`${APP_ORIGIN}/panel`);
  await expect(page.getByLabel('Correo')).toBeVisible();
  await check('Panel: login');

  await page.getByLabel('Correo').fill(COORDINATOR.email);
  await page.getByLabel('Contraseña').fill('mala');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await check('Panel: login con error');

  await page.getByLabel('Contraseña').fill(COORDINATOR.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Descripción de uno')).toBeVisible();
  await check('Panel: lista');

  await page.getByText('Descripción de uno').click();
  await expect(page.getByRole('heading', { name: 'Detalle del reporte' })).toBeVisible();
  await check('Panel: detalle');

  await page.getByLabel('Nuevo estatus').selectOption('en_atencion');
  await page.getByRole('button', { name: 'Cambiar estatus' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar' })).toBeVisible();
  await check('Panel: confirmación del cambio de estatus');
});

test('Pantalla sin conexión (offline.html)', async () => {
  await page.goto(`${APP_ORIGIN}/offline.html`);
  await check('Sin conexión (offline.html)');
});
