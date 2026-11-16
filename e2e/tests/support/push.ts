import type { BrowserContext, CDPSession, Page } from '@playwright/test';

/**
 * Chromium sin ventana no tiene servicio de push (`subscribe` falla con «push service not available»): se simula la
 * suscripción que devolvería el navegador. El permiso, la clave VAPID y el envío a la API son el código real de la app.
 * Anota en `window.__subscribeOptions` lo que la app pasó a `subscribe` y cuenta en `__permissionRequests` los permisos pedidos.
 */
export async function stubPushManager(context: BrowserContext, endpoint: string) {
  await context.addInitScript((fakeEndpoint) => {
    const w = window as unknown as Record<string, unknown>;
    let current: object | null = null;
    PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
    PushManager.prototype.subscribe = async function (options) {
      w.__subscribeOptions = options;
      current = {
        endpoint: fakeEndpoint,
        toJSON: () => ({
          endpoint: fakeEndpoint,
          keys: { p256dh: 'clave-p256dh-e2e', auth: 'secreto-auth-e2e' },
        }),
      };
      return current as PushSubscription;
    };
    const request = Notification.requestPermission.bind(Notification);
    w.__permissionRequests = 0;
    Notification.requestPermission = (...args) => {
      (w.__permissionRequests as number)++;
      return request(...(args as []));
    };
  }, endpoint);
}

/** El UUID anónimo del dispositivo (el `reporter_id` de sus reportes y de su suscripción). */
export const deviceId = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('civicguard');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('meta').objectStore('meta').get('deviceId');
          get.onsuccess = () => resolve(get.result as string);
        };
      }),
  );

/** El id con el que el navegador registró el SW: lo pide el protocolo para entregarle un push. */
export async function registrationId(cdp: CDPSession) {
  return new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      if (registrations[0]) resolve(registrations[0].registrationId);
    });
    void cdp.send('ServiceWorker.enable');
  });
}
