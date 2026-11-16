import { Global, Module, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import webpush from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminModule } from '../src/admin/admin.module.js';
import { configureApp } from '../src/app.setup.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { User } from '../src/auth/user.entity.js';
import { Incident } from '../src/incidents/incident.entity.js';
import { PhotoStorage } from '../src/incidents/photo-storage.js';
import { PushSubscriptionEntity } from '../src/push/push-subscription.entity.js';
import { PushModule } from '../src/push/push.module.js';
import { WEB_PUSH } from '../src/push/push.service.js';

const SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
const KEYS = webpush.generateVAPIDKeys(); // claves reales y efímeras: validan también el formato que exige la config
const REPORTER = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OTHER_REPORTER = '11111111-2222-4333-8444-555555555555';
const INCIDENT_ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const subscribeBody = {
  reporter_id: REPORTER,
  endpoint: ENDPOINT,
  p256dh: 'BKey_p256dh-1',
  auth: 'auth_secret-1',
};

let subscriptions: Map<string, PushSubscriptionEntity>;
let incidents: Map<string, Incident>;
const sender = { sendNotification: vi.fn() };

const fakeSubscriptions = {
  upsert: async (row: PushSubscriptionEntity, [key]: ['endpoint']) => {
    subscriptions.set(row[key], { ...subscriptions.get(row[key]), ...row });
  },
  findBy: async ({ reporter_id }: { reporter_id: string }) =>
    [...subscriptions.values()].filter((row) => row.reporter_id === reporter_id),
  delete: async ({ endpoint }: { endpoint: string }) => void subscriptions.delete(endpoint),
};
const fakeIncidents = {
  findOneBy: async ({ id }: { id: string }) => incidents.get(id) ?? null,
  save: async (incident: Incident) => {
    incidents.set(incident.id, incident);
    return incident;
  },
};

@Global()
@Module({ providers: [{ provide: DataSource, useValue: {} }], exports: [DataSource] })
class FakeTypeOrmModule {}

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [FakeTypeOrmModule, AuthModule, AdminModule, PushModule],
  })
    .overrideProvider(getRepositoryToken(User))
    .useValue({})
    .overrideProvider(getRepositoryToken(Incident))
    .useValue(fakeIncidents)
    .overrideProvider(getRepositoryToken(PushSubscriptionEntity))
    .useValue(fakeSubscriptions)
    .overrideProvider(PhotoStorage)
    .useValue({})
    .overrideProvider(WEB_PUSH)
    .useValue(sender)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { corsOrigins: [] });
  await app.init();
  return app;
}

beforeEach(() => {
  vi.stubEnv('DB_HOST', 'db');
  vi.stubEnv('DB_NAME', 'civicguard');
  vi.stubEnv('DB_USER', 'app');
  vi.stubEnv('DB_PASSWORD', 'clave-de-prueba');
  vi.stubEnv('JWT_SECRET', SECRET);
  vi.stubEnv('VAPID_PUBLIC_KEY', KEYS.publicKey);
  vi.stubEnv('VAPID_PRIVATE_KEY', KEYS.privateKey);
  vi.stubEnv('VAPID_SUBJECT', 'mailto:equipo@civicguard.test');
  subscriptions = new Map();
  incidents = new Map([
    [
      INCIDENT_ID,
      {
        id: INCIDENT_ID,
        reporter_id: REPORTER,
        description: 'Bache profundo',
        status: 'recibido',
        created_at: new Date(Date.UTC(2026, 10, 10)),
      } as Incident,
    ],
  ]);
  sender.sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/push/vapid-public-key y POST /api/push/subscribe (e2e)', () => {
  let app: INestApplication;
  afterEach(() => app.close());
  const subscribe = (body: object) =>
    request(app.getHttpServer()).post('/api/push/subscribe').send(body);

  it('entrega la clave pública VAPID, nunca la privada', async () => {
    app = await createApp();
    const res = await request(app.getHttpServer()).get('/api/push/vapid-public-key').expect(200);
    expect(res.body).toEqual({ public_key: KEYS.publicKey });
    expect(JSON.stringify(res.body)).not.toContain(KEYS.privateKey);
  });

  it('guarda endpoint, p256dh, auth y reporter_id sin pedir sesión', async () => {
    app = await createApp();
    await subscribe(subscribeBody).expect(204);
    expect(subscriptions.get(ENDPOINT)).toMatchObject(subscribeBody);
  });

  it('suscribir dos veces el mismo endpoint deja una sola fila y actualiza sus claves', async () => {
    app = await createApp();
    await subscribe(subscribeBody).expect(204);
    await subscribe({ ...subscribeBody, p256dh: 'BKey_nueva', auth: 'auth_nueva' }).expect(204);
    expect(subscriptions.size).toBe(1);
    expect(subscriptions.get(ENDPOINT)).toMatchObject({ p256dh: 'BKey_nueva', auth: 'auth_nueva' });
  });

  it.each([
    ['un endpoint http', { endpoint: 'http://fcm.googleapis.com/fcm/send/abc' }],
    ['un host que no es un servicio de push (SSRF)', { endpoint: 'https://intranet.local/admin' }],
    [
      'un host que solo se parece al de un servicio',
      { endpoint: 'https://fcm.googleapis.com.evil.example/x' },
    ],
    ['credenciales en la URL', { endpoint: 'https://fcm.googleapis.com@evil.example/x' }],
    ['un reporter_id que no es UUID', { reporter_id: 'no-es-uuid' }],
    ['claves que no son base64url', { p256dh: 'con espacios' }],
    ['campos no declarados', { extra: 1 }],
  ])('responde 400 a %s y no guarda nada', async (_, patch) => {
    app = await createApp();
    await subscribe({ ...subscribeBody, ...patch }).expect(400);
    expect(subscriptions.size).toBe(0);
  });

  it('acepta los servicios de push de Firefox, Safari y Edge', async () => {
    app = await createApp();
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QAbc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      await subscribe({ ...subscribeBody, endpoint }).expect(204);
    }
    expect(subscriptions.size).toBe(3);
  });

  it('responde 503 en ambos endpoints si VAPID no está configurado', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.stubEnv('VAPID_SUBJECT', '');
    app = await createApp();
    await subscribe(subscribeBody).expect(503);
    await request(app.getHttpServer()).get('/api/push/vapid-public-key').expect(503);
    expect(subscriptions.size).toBe(0);
  });
});

describe('PATCH /api/admin/incidents/:id/status envía el push (e2e)', () => {
  let app: INestApplication;
  let auth: string;
  const patch = (status: string) =>
    request(app.getHttpServer())
      .patch(`/api/admin/incidents/${INCIDENT_ID}/status`)
      .set('Authorization', auth)
      .send({ status });
  const addSubscription = (endpoint: string, reporter_id = REPORTER) =>
    subscriptions.set(endpoint, {
      reporter_id,
      endpoint,
      p256dh: 'k',
      auth: 'a',
    } as PushSubscriptionEntity);

  beforeEach(async () => {
    app = await createApp();
    auth = `Bearer ${await app.get(JwtService).signAsync({ sub: 'coordinador', role: 'coordinador' })}`;
  });
  afterEach(() => app.close());

  it('avisa a todos los dispositivos del reportante con el nuevo estatus, y solo a ellos', async () => {
    addSubscription('https://fcm.googleapis.com/telefono');
    addSubscription('https://web.push.apple.com/tableta');
    addSubscription('https://fcm.googleapis.com/ajeno', OTHER_REPORTER);

    await patch('en_atencion').expect(200);

    await vi.waitFor(() => expect(sender.sendNotification).toHaveBeenCalledTimes(2));
    const endpoints = sender.sendNotification.mock.calls.map(([target]) => target.endpoint).sort();
    expect(endpoints).toEqual([
      'https://fcm.googleapis.com/telefono',
      'https://web.push.apple.com/tableta',
    ]);
    const [, payload, options] = sender.sendNotification.mock.calls[0];
    expect(JSON.parse(payload)).toMatchObject({
      incident_id: INCIDENT_ID,
      status: 'en_atencion',
      url: `/reportes/${INCIDENT_ID}`,
      body: '«Bache profundo» ahora está: En atención',
    });
    expect(options.vapidDetails).toMatchObject({
      publicKey: KEYS.publicKey,
      privateKey: KEYS.privateKey,
    });
  });

  it('no avisa si el estatus no cambió', async () => {
    addSubscription('https://fcm.googleapis.com/telefono');
    await patch('recibido').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sender.sendNotification).not.toHaveBeenCalled();
  });

  it('elimina la suscripción que responde 410 y la que responde 404, y el PATCH responde 200', async () => {
    addSubscription('https://fcm.googleapis.com/caducada-410');
    addSubscription('https://fcm.googleapis.com/caducada-404');
    addSubscription('https://fcm.googleapis.com/viva');
    sender.sendNotification.mockImplementation(async (target: { endpoint: string }) => {
      if (target.endpoint.endsWith('410'))
        throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (target.endpoint.endsWith('404'))
        throw Object.assign(new Error('not found'), { statusCode: 404 });
      return { statusCode: 201 };
    });

    await patch('en_revision').expect(200);

    await vi.waitFor(() =>
      expect([...subscriptions.keys()]).toEqual(['https://fcm.googleapis.com/viva']),
    );
  });

  it('un fallo al enviar no hace fallar el cambio de estatus ni borra la suscripción', async () => {
    addSubscription('https://fcm.googleapis.com/telefono');
    sender.sendNotification.mockRejectedValue(
      Object.assign(new Error('boom'), { statusCode: 500 }),
    );

    const res = await patch('resuelto').expect(200);

    expect(res.body).toMatchObject({ id: INCIDENT_ID, status: 'resuelto' });
    expect(incidents.get(INCIDENT_ID)?.status).toBe('resuelto');
    await vi.waitFor(() => expect(sender.sendNotification).toHaveBeenCalled());
    expect(subscriptions.size).toBe(1);
  });

  it('sin VAPID el cambio de estatus funciona y no se envía nada', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.stubEnv('VAPID_SUBJECT', '');
    await app.close();
    app = await createApp();
    auth = `Bearer ${await app.get(JwtService).signAsync({ sub: 'coordinador', role: 'coordinador' })}`;
    addSubscription('https://fcm.googleapis.com/telefono');

    await patch('resuelto').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sender.sendNotification).not.toHaveBeenCalled();
  });
});
