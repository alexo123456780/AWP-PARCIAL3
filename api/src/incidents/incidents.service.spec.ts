import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { CreateIncidentDto } from './dto/create-incident.dto.js';
import type { Incident } from './incident.entity.js';
import { IncidentSeverity, IncidentStatus, IncidentType } from './incident.enums.js';
import { IncidentsService } from './incidents.service.js';

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

const uniqueViolation = () =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505' }));

function setup() {
  const repo = {
    create: vi.fn((entity: Partial<Incident>) => ({ ...entity })),
    insert: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(),
    findOneBy: vi.fn(),
  };
  return { repo, service: new IncidentsService(repo as unknown as Repository<Incident>) };
}

describe('IncidentsService', () => {
  describe('create', () => {
    it('guarda el reporte con estatus «recibido» y sin foto', async () => {
      const { repo, service } = setup();
      const incident = await service.create(dto);
      expect(incident).toMatchObject({ ...dto, status: IncidentStatus.Recibido, photo_url: null });
      expect(repo.insert).toHaveBeenCalledWith(incident);
    });

    it('ignora un estatus enviado por el cliente', async () => {
      const { service } = setup();
      const forged = { ...dto, status: 'resuelto' } as CreateIncidentDto;
      expect((await service.create(forged)).status).toBe(IncidentStatus.Recibido);
    });

    it('usa la hora de captura del cliente cuando llega', async () => {
      const { service } = setup();
      const incident = await service.create({ ...dto, created_at: '2026-11-20T10:00:00.000Z' });
      expect(incident.created_at).toEqual(new Date('2026-11-20T10:00:00.000Z'));
    });

    it('usa la hora de recepción y accuracy nulo en la captura manual', async () => {
      const { service } = setup();
      const manual = { ...dto, accuracy: undefined };
      const before = Date.now();
      const incident = await service.create(manual);
      expect(incident.accuracy).toBeNull();
      expect(incident.created_at.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('responde 409 si el id ya existe, sin sobrescribir el reporte', async () => {
      const { repo, service } = setup();
      repo.insert.mockRejectedValue(uniqueViolation());
      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('propaga cualquier otro error de la base', async () => {
      const { repo, service } = setup();
      repo.insert.mockRejectedValue(new Error('connection refused'));
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
