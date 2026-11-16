import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeviceId, openCivicGuardDB } from '../db/idb';
import { enablePush, hasPushSubscription, isPushSupported } from './push';

vi.mock('./sync', () => ({ API_URL: 'https://api.civicguard.test' }));

const PUBLIC_KEY = 'B'.repeat(87);
const subscriptionJson = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'clave-p256dh', auth: 'secreto-auth' },
};

let permission: NotificationPermission;
const requestPermission = vi.fn<() => Promise<NotificationPermission>>();
const pushManager = {
  getSubscription: vi.fn<() => Promise<{ toJSON: () => typeof subscriptionJson } | null>>(),
  subscribe: vi.fn(async (): Promise<{ toJSON: () => typeof subscriptionJson }> => ({
    toJSON: () => subscriptionJson,
  })),
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  permission = 'default';
  requestPermission.mockReset().mockImplementation(async () => (permission = 'granted'));
  pushManager.getSubscription.mockReset().mockResolvedValue(null);
  pushManager.subscribe.mockClear();
  fetchMock
    .mockReset()
    .mockImplementation(async (input) =>
      String(input).endsWith('/vapid-public-key')
        ? Response.json({ public_key: PUBLIC_KEY })
        : new Response(null, { status: 204 }),
    );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', {
    get permission() {
      return permission;
    },
    requestPermission,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error: lo definió `beforeEach` en la instancia; jsdom no trae `serviceWorker`.
  delete navigator.serviceWorker;
});

describe('isPushSupported', () => {
  it('es verdadero con Service Worker, PushManager y Notification', () => {
    expect(isPushSupported()).toBe(true);
  });

  it.each(['PushManager', 'Notification'])(
    'es falso si falta %s (p. ej. iOS sin instalar la app)',
    (name) => {
      vi.stubGlobal(name, undefined);
      delete (globalThis as Record<string, unknown>)[name];
      expect(isPushSupported()).toBe(false);
    },
  );

  it('es falso sin Service Worker', () => {
    // @ts-expect-error: lo definió `beforeEach`.
    delete navigator.serviceWorker;
    expect(isPushSupported()).toBe(false);
  });
});

describe('enablePush', () => {
  it('pide el permiso y, si lo niegan, no suscribe ni llama a la API', async () => {
    requestPermission.mockImplementation(async () => (permission = 'denied'));

    await expect(enablePush()).resolves.toBe('denied');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('suscribe con la clave pública VAPID de la API y envía la suscripción con el UUID del dispositivo', async () => {
    await expect(enablePush()).resolves.toBe('enabled');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.civicguard.test/api/push/vapid-public-key',
    );
    expect(pushManager.subscribe).toHaveBeenCalledExactlyOnceWith({
      userVisibleOnly: true,
      applicationServerKey: PUBLIC_KEY,
    });
    const db = await openCivicGuardDB();
    const deviceId = await getDeviceId(db);
    db.close();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.civicguard.test/api/push/subscribe');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init?.body))).toEqual({
      reporter_id: deviceId,
      endpoint: subscriptionJson.endpoint,
      p256dh: 'clave-p256dh',
      auth: 'secreto-auth',
    });
  });

  it('reutiliza la suscripción que el navegador ya tiene, sin crear otra', async () => {
    pushManager.getSubscription.mockResolvedValue({ toJSON: () => subscriptionJson });

    await expect(enablePush()).resolves.toBe('enabled');

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si la API no tiene push configurado (503) no suscribe y lo avisa', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(enablePush()).resolves.toBe('unavailable');

    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('lanza si la API rechaza la suscripción o la clave no se puede leer', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/vapid-public-key')
        ? Response.json({ public_key: PUBLIC_KEY })
        : new Response(null, { status: 400 }),
    );
    await expect(enablePush()).rejects.toThrow('push/subscribe respondió 400');

    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(enablePush()).rejects.toThrow('vapid-public-key respondió 500');

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(enablePush()).rejects.toThrow('Failed to fetch');
  });
});

describe('hasPushSubscription', () => {
  it('sin permiso concedido es falso y no toca el Service Worker ni pide nada', async () => {
    await expect(hasPushSubscription()).resolves.toBe(false);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
  });

  it('con permiso es verdadero solo si hay suscripción', async () => {
    permission = 'granted';
    await expect(hasPushSubscription()).resolves.toBe(false);

    pushManager.getSubscription.mockResolvedValue({ toJSON: () => subscriptionJson });
    await expect(hasPushSubscription()).resolves.toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
