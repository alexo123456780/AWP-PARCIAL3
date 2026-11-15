import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { CreateIncidentDto } from './dto/create-incident.dto.js';
import { Incident } from './incident.entity.js';
import { IncidentStatus } from './incident.enums.js';

/** SQLSTATE de PostgreSQL para una violación de unicidad (aquí, la llave primaria `id`). */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class IncidentsService {
  constructor(@InjectRepository(Incident) private readonly incidents: Repository<Incident>) {}

  async create(dto: CreateIncidentDto): Promise<Incident> {
    const incident = this.incidents.create({
      ...dto,
      accuracy: dto.accuracy ?? null,
      photo_url: null,
      // El estatus lo fija el servidor: el cliente no puede crear un reporte ya «resuelto».
      status: IncidentStatus.Recibido,
      created_at: dto.created_at ? new Date(dto.created_at) : new Date(),
    });
    try {
      // insert, no save: save() haría UPDATE si el id ya existe y un POST repetido pisaría el reporte.
      await this.incidents.insert(incident);
    } catch (error) {
      // shortcut: un id repetido responde 409; la idempotencia (ON CONFLICT DO NOTHING) llega en el Sprint 3.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException('Ya existe un reporte con ese id');
      }
      throw error;
    }
    return incident;
  }

  // shortcut: sin paginación; un dispositivo tiene pocos reportes, paginar si el panel lo necesita.
  findByReporter(reporterId: string): Promise<Incident[]> {
    return this.incidents.find({
      where: { reporter_id: reporterId },
      order: { created_at: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Incident> {
    const incident = await this.incidents.findOneBy({ id });
    if (!incident) {
      throw new NotFoundException('Reporte no encontrado');
    }
    return incident;
  }
}
