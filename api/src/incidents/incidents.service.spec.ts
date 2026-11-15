import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { CreateIncidentDto } from './dto/create-incident.dto.js';
import type { Incident } from './incident.entity.js';
import { IncidentSeverity, IncidentStatus, IncidentType } from './incident.enums.js';
import { IncidentsService } from './incidents.service.js';
import type { PhotoStorage } from './photo-storage.js';

const dto: CreateIncidentDto = {
  id: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
  reporter_id: '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  type: IncidentType.Bache,
  severity: IncidentSeverity.Alta,
  description: 'Bache profundo frente al mercado',
  lat: 20.9674,
  lng: -89.5926,
  accuracy: 12.5,
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const SERVER_TIME = new Date('2026-11-20T10:00:05.000Z');

function setup() {
  // Lo que «la base» devolvió al insertar: la fila con la hora del servidor, que solo existe tras el INSERT.
  let stored: Incident | undefined;
  const insertQuery = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn((incident: Incident) => {
      stored = { ...incident, synced_at: SERVER_TIME };
      return insertQuery;
    }),
    orIgnore: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const repo = {
    create: vi.fn((entity: Partial<Incident>) => ({ ...entity })),
    createQueryBuilder: vi.fn(() => insertQuery),
    findOneBy: vi.fn().mockResolvedValue(null),
    findOneByOrFail: vi.fn(async () => stored),
    find: vi.fn(),
  };
  const storage = {
    upload: vi.fn().mockResolvedValue('https://storage.example/incident-photos/foto.jpg'),
  };
  return {
    repo,
    insertQuery,
    storage,
    service: new IncidentsService(
      repo as unknown as Repository<Incident>,
      storage as unknown as PhotoStorage,
    ),
  };
}

describe('IncidentsService', () => {
  describe('create', () => {
    it('inserta con ON CONFLICT DO NOTHING, estatus «recibido», sin foto y con la hora del servidor', async () => {
      const { insertQuery, service } = setup();
      const incident = await service.create(dto);
      expect(incident).toMatchObject({
        ...dto,
        status: IncidentStatus.Recibido,
        photo_url: null,
        synced_at: SERVER_TIME,
      });
      expect(insertQuery.orIgnore).toHaveBeenCalled();
      expect(insertQuery.execute).toHaveBeenCalledOnce();
    });

    it('ignora un estatus enviado por el cliente', async () => {
      const { service } = setup();
      const forged = { ...dto, status: 'resuelto' } as CreateIncidentDto;
      expect((await service.create(forged)).status).toBe(IncidentStatus.Recibido);
    });

    it('conserva la hora de captura del cliente en created_at', async () => {
      const { service } = setup();
      const incident = await service.create({ ...dto, created_at: '2026-11-20T10:00:00.000Z' });
      expect(incident.created_at).toEqual(new Date('2026-11-20T10:00:00.000Z'));
      expect(incident.synced_at).toEqual(SERVER_TIME);
    });

    it('usa la hora de recepción y accuracy nulo en la captura manual', async () => {
      const { service } = setup();
      const manual = { ...dto, accuracy: undefined };
      const before = Date.now();
      const incident = await service.create(manual);
      expect(incident.accuracy).toBeNull();
      expect(incident.created_at.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('sube la foto con un nombre derivado del id y guarda solo su URL', async () => {
      const { insertQuery, service, storage } = setup();
      const incident = await service.create(dto, { buffer: JPEG });
      expect(storage.upload).toHaveBeenCalledWith(`${dto.id}.jpg`, JPEG, 'image/jpeg');
      expect(incident.photo_url).toBe('https://storage.example/incident-photos/foto.jpg');
      expect(insertQuery.values).toHaveBeenCalledWith(
        expect.objectContaining({ photo_url: 'https://storage.example/incident-photos/foto.jpg' }),
      );
    });

    it('reintento: si el id ya existe devuelve el reporte guardado sin insertar ni volver a subir la foto', async () => {
      const { insertQuery, repo, service, storage } = setup();
      const saved = { ...dto, status: IncidentStatus.EnRevision };
      repo.findOneBy.mockResolvedValue(saved);
      await expect(
        service.create({ ...dto, severity: IncidentSeverity.Baja }, { buffer: JPEG }),
      ).resolves.toBe(saved);
      expect(insertQuery.execute).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('envíos simultáneos del mismo id: el segundo INSERT no falla y ambos devuelven la fila guardada', async () => {
      const { service } = setup();
      // Ninguno ve el reporte al consultar; el servidor ignora el INSERT duplicado (ON CONFLICT DO NOTHING).
      const [first, second] = await Promise.all([service.create(dto), service.create(dto)]);
      expect(first.id).toBe(dto.id);
      expect(second.id).toBe(dto.id);
    });

    it('rechaza con 400 un archivo que no es imagen, aunque diga serlo, sin crear el reporte', async () => {
      const { insertQuery, repo, service, storage } = setup();
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      await expect(service.create(dto, { buffer: html })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.upload).not.toHaveBeenCalled();
      expect(repo.findOneBy).not.toHaveBeenCalled();
      expect(insertQuery.execute).not.toHaveBeenCalled();
    });

    it('si el almacenamiento falla, no crea el reporte (queda pendiente en el dispositivo)', async () => {
      const { insertQuery, service, storage } = setup();
      storage.upload.mockRejectedValue(new Error('storage down'));
      await expect(service.create(dto, { buffer: JPEG })).rejects.toThrow('storage down');
      expect(insertQuery.execute).not.toHaveBeenCalled();
    });

    it('propaga cualquier error de la base', async () => {
      const { insertQuery, service } = setup();
      insertQuery.execute.mockRejectedValue(new Error('connection refused'));
      await expect(service.create(dto)).rejects.toThrow('connection refused');
    });
  });

  describe('findByReporter', () => {
    it('consulta solo ese dispositivo, del más reciente al más antiguo', async () => {
      const { repo, service } = setup();
      repo.find.mockResolvedValue([{ id: 'a' }]);
      await expect(service.findByReporter(dto.reporter_id)).resolves.toEqual([{ id: 'a' }]);
      expect(repo.find).toHaveBeenCalledWith({
        where: { reporter_id: dto.reporter_id },
        order: { created_at: 'DESC' },
      });
    });
  });

  describe('findOne', () => {
    it('devuelve el detalle', async () => {
      const { repo, service } = setup();
      repo.findOneBy.mockResolvedValue({ id: dto.id });
      await expect(service.findOne(dto.id)).resolves.toEqual({ id: dto.id });
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: dto.id });
    });

    it('lanza 404 si no existe', async () => {
      const { repo, service } = setup();
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.findOne(dto.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
