import { chromium, devices, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** La compilación de producción de la PWA (la deja `global-setup.ts`). */
export const dist = path.resolve(here, '../../../web/dist');
const evidence = path.resolve(here, '../../../docs/evidencia');

type PhoneOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

/** Un «teléfono»: perfil persistente de Chromium (almacenamiento y Service Worker sobreviven entre páginas) con viewport de Pixel 7. */
export async function launchPhone(options: PhoneOptions = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), 'civicguard-e2e-'));
  const context: BrowserContext = await chromium.launchPersistentContext(profile, {
    ...devices['Pixel 7'],
    ...options,
  });
  return {
    context,
    close: async () => {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** Adjunta la captura al informe HTML y, con E2E_EVIDENCE=1, la guarda en docs/evidencia (evidencia versionada). */
export async function capture(page: Page, name: string) {
  const body = await page.screenshot({ fullPage: true });
  await test.info().attach(name, { body, contentType: 'image/png' });
  if (process.env.E2E_EVIDENCE) {
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `e2e-${name}.png`), fullPage: true });
  }
}

/** Repite `read` cada 250 ms hasta que `done` acepte su resultado (máx. `timeout` ms) y devuelve el último valor leído. */
export async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeout = 10_000,
) {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}
