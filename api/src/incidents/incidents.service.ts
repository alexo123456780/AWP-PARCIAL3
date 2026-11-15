import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CreateIncidentDto } from './dto/create-incident.dto.js';
import { Incident } from './incident.entity.js';
import { IncidentStatus } from './incident.enums.js';
import { detectImage, PhotoStorage } from './photo-storage.js';

/** Foto recibida por multipart (en memoria; el límite de 5 MB lo aplica el interceptor). */
export interface UploadedPhoto {
  buffer: Buffer;
}

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    private readonly storage: PhotoStorage,
  ) {}

  /** Idempotente: reenviar un reporte ya guardado devuelve el existente en vez de duplicarlo o fallar (RF-6). */
  async create(dto: CreateIncidentDto, photo?: UploadedPhoto): Promise<Incident> {
    // Antes de tocar nada: un archivo que no es imagen no crea el reporte ni llega al almacenamiento.
    const image = photo ? detectImage(photo.buffer) : null;
    if (photo && !image) {
      throw new BadRequestException('La foto debe ser una imagen JPEG, PNG o WebP');
    }
    // Un reintento no vuelve a subir la foto (ni la pisa) cuando el reporte ya está guardado.
    const existing = await this.incidents.findOneBy({ id: dto.id });
    if (existing) return existing;

    const photo_url =
      photo && image
        ? await this.storage.upload(`${dto.id}.${image.extension}`, photo.buffer, image.contentType)
        : null;
    const incident = this.incidents.create({
      ...dto,
      accuracy: dto.accuracy ?? null,
      photo_url,
      // El estatus lo fija el servidor: el cliente no puede crear un reporte ya «resuelto».
      status: IncidentStatus.Recibido,
      created_at: dto.created_at ? new Date(dto.created_at) : new Date(),
    });
    // `id` es la única restricción única de la tabla, así que ON CONFLICT DO NOTHING equivale a ON CONFLICT (id):
    // si dos envíos con el mismo id llegan a la vez, uno inserta y el otro no falla.
    await this.incidents.createQueryBuilder().insert().values(incident).orIgnore().execute();
    // Se relee: en un duplicado no hay RETURNING y `synced_at` (la hora del servidor) solo existe en la base.
    return this.incidents.findOneByOrFail({ id: dto.id });
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
