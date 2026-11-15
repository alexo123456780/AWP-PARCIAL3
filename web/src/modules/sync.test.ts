import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { close, setMeta } = vi.hoisted(() => ({ close: vi.fn(), setMeta: vi.fn() }));
vi.mock('../db/idb', () => ({
  openCivicGuardDB: vi.fn().mockResolvedValue({ close }),
  setMeta,
}));

// API_URL se fija al importar el módulo: cada prueba lo carga de nuevo con su propio VITE_API_URL.
async function load(apiUrl: string | null = 'https://api.civicguard.test') {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', apiUrl ?? '');
  return import('./sync');
}

function withServiceWorker(registration: object) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  });
}

const active = () => ({ postMessage: vi.fn() });

// Con llaves: si devolviera el mock, Vitest lo ejecutaría como limpieza al terminar cada prueba.
beforeEach(() => {
  setMeta.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('requestSync', () => {
  it('con Background Sync deja la URL de la API en IndexedDB y registra sync-incidents', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const worker = active();
    withServiceWorker({ sync: { register }, active: worker });
    const { requestSync, SYNC_TAG } = await load();

    await requestSync();

    expect(setMeta).toHaveBeenCalledWith(
      expect.anything(),
      'apiUrl',
      'https://api.civicguard.test',
    );
    expect(close).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledExactlyOnceWith(SYNC_TAG);
    expect(SYNC_TAG).toBe('sync-incidents');
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('sin Background Sync le pide el vaciado al Service Worker con FLUSH_OUTBOX', async () => {
    const worker = active();
    withServiceWorker({ active: worker });
    const { requestSync } = await load();

    await requestSync();

    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'FLUSH_OUTBOX' });
  });

  it('si el registro de Background Sync falla, recurre al mensaje', async () => {
    const worker = active();
    withServiceWorker({
      sync: { register: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) },
      active: worker,
    });
    const { requestSync } = await load();

    await requestSync();

    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'FLUSH_OUTBOX' });
  });

  it('quita la barra final de la URL de la API', async () => {
    withServiceWorker({ active: active() });
    const { requestSync, API_URL } = await load('https://api.civicguard.test///');

    await requestSync();

    expect(API_URL).toBe('https://api.civicguard.test');
    expect(setMeta).toHaveBeenCalledWith(
      expect.anything(),
      'apiUrl',
      'https://api.civicguard.test',
    );
  });

  it('sin VITE_API_URL no hace nada (no hay a dónde enviar)', async () => {
    const worker = active();
    withServiceWorker({ active: worker });
    const { requestSync } = await load(null);

    await requestSync();

    expect(setMeta).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('sin Service Worker en el navegador no hace nada', async () => {
    const { requestSync } = await load();

    await expect(requestSync()).resolves.toBeUndefined();

    expect(setMeta).not.toHaveBeenCalled();
  });

  it('cierra la conexión de IndexedDB aunque falle guardar la URL', async () => {
    withServiceWorker({ active: active() });
    setMeta.mockRejectedValue(new Error('cuota'));
    const { requestSync } = await load();

    await expect(requestSync()).rejects.toThrow('cuota');

    expect(close).toHaveBeenCalledOnce();
  });
});
