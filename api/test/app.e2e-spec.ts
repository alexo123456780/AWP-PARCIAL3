import { Body, Controller, Global, Module, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../src/app.setup.js';
import { HealthModule } from '../src/health/health.module.js';

const ALLOWED = ['http://localhost:5173', 'https://demo.ngrok-free.app'];

class EchoDto {
  @IsString()
  name: string;
}

// Controlador solo de pruebas: aún no hay endpoints de negocio con cuerpo que validar.
@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() dto: EchoDto) {
    return dto;
  }
}

const query = vi.fn();

// Igual que TypeOrmModule.forRoot() en producción: exporta DataSource de forma global.
@Global()
@Module({ providers: [{ provide: DataSource, useValue: { query } }], exports: [DataSource] })
class FakeTypeOrmModule {}

describe('API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeTypeOrmModule, HealthModule],
      controllers: [EchoController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, { corsOrigins: ALLOWED });
    await app.init();
  });

  beforeEach(() => {
    // Con llaves: vitest toma como limpieza cualquier función que devuelva el hook.
    query.mockResolvedValue([{ '?column?': 1 }]);
  });
  afterAll(() => app.close());

  describe('GET /api/health', () => {
    it('responde 200 con el estado del servicio y de la base', async () => {
      const res = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(res.body).toEqual({ status: 'ok', database: 'up' });
      expect(query).toHaveBeenCalledWith('SELECT 1');
    });

    it('responde 503 cuando la base no está disponible', async () => {
      query.mockRejectedValue(new Error('connection refused'));
      const res = await request(app.getHttpServer()).get('/api/health').expect(503);
      expect(res.body).toEqual({ status: 'error', database: 'down' });
    });
  });

  describe('Swagger', () => {
    it('sirve la interfaz en /api/docs', async () => {
      const res = await request(app.getHttpServer()).get('/api/docs').expect(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
    });

    it('documenta GET /api/health en el documento OpenAPI', async () => {
      const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
      expect(res.body.paths['/api/health'].get.summary).toBeTruthy();
    });
  });

  describe('CORS', () => {
    it.each(ALLOWED)('admite el origen %s', async (origin) => {
      const res = await request(app.getHttpServer()).get('/api/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    });

    it('rechaza un origen fuera de la allowlist (también en el preflight)', async () => {
      const origin = 'https://evil.example';
      const get = await request(app.getHttpServer()).get('/api/health').set('Origin', origin);
      expect(get.headers['access-control-allow-origin']).toBeUndefined();
      const preflight = await request(app.getHttpServer())
        .options('/api/health')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET');
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('cabeceras de seguridad', () => {
    it('incluye las cabeceras de Helmet y oculta X-Powered-By', async () => {
      const { headers } = await request(app.getHttpServer()).get('/api/health');
      expect(headers['content-security-policy']).toContain("default-src 'self'");
      expect(headers['strict-transport-security']).toBeDefined();
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('ValidationPipe global', () => {
    it('responde 400 si el cuerpo no cumple el DTO', async () => {
      await request(app.getHttpServer()).post('/api/echo').send({ name: 42 }).expect(400);
      await request(app.getHttpServer()).post('/api/echo').send({}).expect(400);
    });

    it('responde 400 si el cuerpo trae propiedades no declaradas', async () => {
      await request(app.getHttpServer())
        .post('/api/echo')
        .send({ name: 'ok', admin: true })
        .expect(400);
    });

    it('acepta un cuerpo válido', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/echo')
        .send({ name: 'ok' })
        .expect(201);
      expect(res.body).toEqual({ name: 'ok' });
    });
  });
});
