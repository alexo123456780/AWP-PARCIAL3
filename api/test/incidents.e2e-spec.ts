import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource, QueryFailedError } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.setup.js';
import { Incident } from '../src/incidents/incident.entity.js';
import { IncidentsModule } from '../src/incidents/incidents.module.js';

const DEVICE_A = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const DEVICE_B = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ID_1 = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const ID_2 = '7c6b5a49-3827-4615-a403-928374655647';
const MISSING_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const valid = {
  id: ID_1,
  reporter_id: DEVICE_A,
  type: 'bache',
  severity: 'alta',
  description: 'Bache profundo frente al mercado',
  lat: 20.9674,
  lng: -89.5926,
  accuracy: 12.5,
};

// Repositorio en memoria: el e2e prueba HTTP + validación + servicio sin una base real.
const rows = new Map<string, Incident>();
const fakeRepository = {
  create: (entity: Partial<Incident>) => ({ ...entity }) as Incident,
  insert: async (incident: Incident) => {
    if (rows.has(incident.id)) {
      throw new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate'), { code: '23505' }),
      );
    }
    // Igual que la base: DEFAULT now() en synced_at, devuelto a la entidad.
    incident.synced_at = new Date();
    rows.set(incident.id, incident);
  },
  find: async ({ where }: { where: { reporter_id: string } }) =>
    [...rows.values()].filter((row) => row.reporter_id === where.reporter_id),
  findOneBy: async ({ id }: { id: string }) => rows.get(id) ?? null,
};

@Global()
@Module({ providers: [{ provide: DataSource, useValue: {} }], exports: [DataSource] })
class FakeTypeOrmModule {}

describe('API de incidentes (e2e)', () => {
  let app: INestApplication;
  const post = (body: object) => request(app.getHttpServer()).post('/api/incidents').send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeTypeOrmModule, IncidentsModule],
    })
      .overrideProvider(getRepositoryToken(Incident))
      .useValue(fakeRepository)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, { corsOrigins: [] });
    await app.init();
  });

  beforeEach(() => rows.clear());
  afterAll(() => app.close());

  describe('POST /api/incidents', () => {
    it('guarda un reporte válido con estatus «recibido» y responde 201', async () => {
      const res = await post(valid).expect(201);
      expect(res.body).toMatchObject({ ...valid, status: 'recibido', photo_url: null });
      expect(res.body.synced_at).toBeTruthy();
      expect(rows.get(ID_1)?.status).toBe('recibido');
    });

    it('acepta una descripción de exactamente 500 caracteres y un reporte sin accuracy', async () => {
      const res = await post({
        ...valid,
        accuracy: undefined,
        description: 'x'.repeat(500),
      }).expect(201);
      expect(res.body.accuracy).toBeNull();
    });

    it.each([
      ['type fuera del enum', { type: 'terremoto' }, 'type'],
      ['severity fuera del enum', { severity: 'extrema' }, 'severity'],
      ['description de más de 500 caracteres', { description: 'x'.repeat(501) }, 'description'],
      ['id que no es UUID', { id: 'no-es-uuid' }, 'id'],
      ['id UUID que no es v4', { id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' }, 'id'],
      ['reporter_id que no es UUID', { reporter_id: '123' }, 'reporter_id'],
      ['reporter_id ausente', { reporter_id: undefined }, 'reporter_id'],
      ['lat como texto', { lat: '20.9' }, 'lat'],
      ['lat fuera de rango', { lat: 91 }, 'lat'],
      ['lng fuera de rango', { lng: -181 }, 'lng'],
      ['accuracy negativo', { accuracy: -1 }, 'accuracy'],
      ['created_at que no es fecha', { created_at: 'ayer' }, 'created_at'],
    ])('responde 400 con el campo inválido: %s', async (_name, patch, field) => {
      const res = await post({ ...valid, ...patch }).expect(400);
      expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining(field)]));
      expect(rows.size).toBe(0);
    });

    it('responde 400 si el cliente intenta fijar el estatus o manda propiedades ajenas', async () => {
      await post({ ...valid, status: 'resuelto' }).expect(400);
      await post({ ...valid, synced_at: '2020-01-01T00:00:00Z' }).expect(400);
      expect(rows.size).toBe(0);
    });

    it('responde 409 si el id ya existe y conserva el reporte original', async () => {
      await post(valid).expect(201);
      await post({ ...valid, severity: 'baja' }).expect(409);
      expect(rows.get(ID_1)?.severity).toBe('alta');
    });
  });

  describe('GET /api/incidents?reporter_id=', () => {
    it('devuelve solo los reportes de ese dispositivo', async () => {
      await post(valid).expect(201);
      await post({ ...valid, id: ID_2, reporter_id: DEVICE_B }).expect(201);
      const res = await request(app.getHttpServer())
        .get('/api/incidents')
        .query({ reporter_id: DEVICE_A })
        .expect(200);
      expect(res.body.map((row: Incident) => row.id)).toEqual([ID_1]);
    });

    it('devuelve una lista vacía si el dispositivo no tiene reportes', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/incidents')
        .query({ reporter_id: DEVICE_B })
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('responde 400 si reporter_id falta o no es un UUID', async () => {
      const res = await request(app.getHttpServer()).get('/api/incidents').expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('reporter_id')]),
      );
      await request(app.getHttpServer()).get('/api/incidents?reporter_id=abc').expect(400);
    });
  });

  describe('GET /api/incidents/:id', () => {
    it('devuelve el detalle', async () => {
      await post(valid).expect(201);
      const res = await request(app.getHttpServer()).get(`/api/incidents/${ID_1}`).expect(200);
      expect(res.body).toMatchObject({ id: ID_1, description: valid.description });
    });

    it('responde 404 si no existe', async () => {
      await request(app.getHttpServer()).get(`/api/incidents/${MISSING_ID}`).expect(404);
    });

    it('responde 400 si el id no es un UUID', async () => {
      await request(app.getHttpServer()).get('/api/incidents/abc').expect(400);
    });
  });

  describe('Swagger', () => {
    it('documenta los tres endpoints con sus códigos de respuesta', async () => {
      const { body } = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
      const collection = body.paths['/api/incidents'];
      const detail = body.paths['/api/incidents/{id}'];
      expect(Object.keys(collection.post.responses)).toEqual(['201', '400', '409']);
      expect(Object.keys(collection.get.responses)).toEqual(['200', '400']);
      expect(Object.keys(detail.get.responses)).toEqual(['200', '400', '404']);
      expect(collection.post.requestBody.content['application/json'].schema.$ref).toContain(
        'CreateIncidentDto',
      );
      expect(collection.get.parameters.map((p: { name: string }) => p.name)).toEqual([
        'reporter_id',
      ]);
      expect(body.components.schemas.IncidentType.enum).toEqual([
        'bache',
        'fuga',
        'alumbrado',
        'cableado',
        'otro',
      ]);
      expect(body.components.schemas.CreateIncidentDto.properties.description.maxLength).toBe(500);
    });
  });
});
