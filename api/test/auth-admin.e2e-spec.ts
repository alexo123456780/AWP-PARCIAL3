import { Global, Module, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminModule } from '../src/admin/admin.module.js';
import { configureApp } from '../src/app.setup.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { User } from '../src/auth/user.entity.js';
import { Incident } from '../src/incidents/incident.entity.js';
import { PhotoStorage } from '../src/incidents/photo-storage.js';
import { PushSubscriptionEntity } from '../src/push/push-subscription.entity.js';

const SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
const EMAIL = 'coordinador@civicguard.test';
const PASSWORD = 'contrasena-correcta';
const ID_1 = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const ID_2 = '7c6b5a49-3827-4615-a403-928374655647';
const MISSING_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

let users: User[];
const incidents = new Map<string, Incident>();

const fakeUsers = {
  findOneBy: async ({ email }: { email: string }) => users.find((u) => u.email === email) ?? null,
};
const fakeIncidents = {
  find: async ({ where }: { where: { status?: string } }) =>
    [...incidents.values()]
      .filter((row) => !where.status || row.status === where.status)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime()),
  findOneBy: async ({ id }: { id: string }) => incidents.get(id) ?? null,
  save: async (incident: Incident) => {
    incidents.set(incident.id, incident);
    return incident;
  },
};

@Global()
@Module({ providers: [{ provide: DataSource, useValue: {} }], exports: [DataSource] })
class FakeTypeOrmModule {}

const incident = (id: string, status: string, day: number) =>
  ({
    id,
    reporter_id: '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    type: 'bache',
    severity: 'alta',
    description: 'Bache profundo',
    lat: 20.9,
    lng: -89.6,
    accuracy: null,
    photo_url: `https://storage.example/${id}.jpg`,
    status,
    created_at: new Date(Date.UTC(2026, 10, day)),
    synced_at: new Date(Date.UTC(2026, 10, day, 1)),
  }) as Incident;

// loadConfig() lee el entorno al compilar el módulo: cada app nueva toma el JWT_SECRET vigente en ese momento.
async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [FakeTypeOrmModule, AuthModule, AdminModule],
  })
    .overrideProvider(getRepositoryToken(User))
    .useValue(fakeUsers)
    .overrideProvider(getRepositoryToken(Incident))
    .useValue(fakeIncidents)
    .overrideProvider(getRepositoryToken(PushSubscriptionEntity))
    .useValue({})
    .overrideProvider(PhotoStorage)
    .useValue({})
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { corsOrigins: [] });
  await app.init();
  return app;
}

beforeAll(async () => {
  users = [
    {
      id: '11111111-2222-4333-8444-555555555555',
      email: EMAIL,
      password_hash: await bcrypt.hash(PASSWORD, 4),
      role: 'coordinador',
    },
  ];
});

beforeEach(() => {
  vi.stubEnv('DB_HOST', 'db');
  vi.stubEnv('DB_NAME', 'civicguard');
  vi.stubEnv('DB_USER', 'app');
  vi.stubEnv('DB_PASSWORD', 'clave-de-prueba');
  vi.stubEnv('JWT_SECRET', SECRET);
  incidents.clear();
  incidents.set(ID_1, incident(ID_1, 'recibido', 10));
  incidents.set(ID_2, incident(ID_2, 'resuelto', 12));
});

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/auth/login (e2e)', () => {
  it('devuelve un JWT con credenciales válidas y 401 con las inválidas, sin distinguir cuál falló', async () => {
    const app = await createApp();
    const login = (body: object) => request(app.getHttpServer()).post('/api/auth/login').send(body);

    const ok = await login({ email: EMAIL, password: PASSWORD }).expect(200);
    expect(await app.get(JwtService).verifyAsync(ok.body.access_token)).toMatchObject({
      sub: users[0].id,
      role: 'coordinador',
    });

    const wrongPassword = await login({ email: EMAIL, password: 'otra' }).expect(401);
    const unknownEmail = await login({ email: 'nadie@civicguard.test', password: 'otra' }).expect(
      401,
    );
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);

    await login({ password: PASSWORD }).expect(400);
    await app.close();
  });

  it('responde 429 al pasar de 5 intentos por minuto', async () => {
    const app = await createApp();
    const attempt = () =>
      request(app.getHttpServer()).post('/api/auth/login').send({ email: EMAIL, password: 'mala' });
    for (let i = 0; i < 5; i++) await attempt().expect(401);
    await attempt().expect(429);
    await app.close();
  });

  it('responde 503 si JWT_SECRET no está configurado', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const app = await createApp();
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(503);
    await app.close();
  });
});

describe('/api/admin/incidents (e2e)', () => {
  let app: INestApplication;
  let auth: string;

  beforeEach(async () => {
    app = await createApp();
    auth = `Bearer ${await app.get(JwtService).signAsync({ sub: users[0].id, role: 'coordinador' })}`;
  });
  afterEach(() => app.close());

  const get = (query = '') => request(app.getHttpServer()).get(`/api/admin/incidents${query}`);
  const patch = (id: string, body: object) =>
    request(app.getHttpServer()).patch(`/api/admin/incidents/${id}/status`).send(body);

  describe('GET', () => {
    it('responde 401 sin token, con un token inválido o con uno firmado con otro secreto', async () => {
      await get().expect(401);
      await get().set('Authorization', 'Bearer basura').expect(401);
      const foreign = await new JwtService({
        secret: 'otro-secreto-de-32-caracteres-o-mas!!',
      }).signAsync({
        sub: 'x',
      });
      await get().set('Authorization', `Bearer ${foreign}`).expect(401);
    });

    it('lista todos los reportes, del más reciente al más antiguo, con tipo, severidad, estatus, fecha y photo_url', async () => {
      const res = await get().set('Authorization', auth).expect(200);
      expect(res.body.map((row: Incident) => row.id)).toEqual([ID_2, ID_1]);
      expect(res.body[0]).toMatchObject({
        type: 'bache',
        severity: 'alta',
        status: 'resuelto',
        created_at: '2026-11-12T00:00:00.000Z',
        photo_url: `https://storage.example/${ID_2}.jpg`,
      });
    });

    it('filtra por estatus y responde 400 a un valor fuera del enum', async () => {
      const res = await get('?status=recibido').set('Authorization', auth).expect(200);
      expect(res.body.map((row: Incident) => row.id)).toEqual([ID_1]);
      await get('?status=inventado').set('Authorization', auth).expect(400);
    });
  });

  describe('PATCH :id/status', () => {
    it('responde 401 sin token y no cambia el reporte', async () => {
      await patch(ID_1, { status: 'resuelto' }).expect(401);
      expect(incidents.get(ID_1)?.status).toBe('recibido');
    });

    it('actualiza el estatus y devuelve el reporte', async () => {
      const res = await patch(ID_1, { status: 'en_atencion' })
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({ id: ID_1, status: 'en_atencion' });
      expect(incidents.get(ID_1)?.status).toBe('en_atencion');
    });

    it('responde 400 a un estatus fuera del enum, a campos ajenos o a un id que no es UUID', async () => {
      await patch(ID_1, { status: 'inventado' }).set('Authorization', auth).expect(400);
      await patch(ID_1, { status: 'resuelto', lat: 0 }).set('Authorization', auth).expect(400);
      await patch('abc', { status: 'resuelto' }).set('Authorization', auth).expect(400);
      expect(incidents.get(ID_1)?.status).toBe('recibido');
    });

    it('responde 404 si el reporte no existe', async () => {
      await patch(MISSING_ID, { status: 'resuelto' }).set('Authorization', auth).expect(404);
    });
  });
});
