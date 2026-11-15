import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadConfig } from '../config.js';
import { Incident } from './incident.entity.js';
import { IncidentsController } from './incidents.controller.js';
import { IncidentsService } from './incidents.service.js';
import { PhotoStorage } from './photo-storage.js';

@Module({
  imports: [TypeOrmModule.forFeature([Incident])],
  controllers: [IncidentsController],
  providers: [
    IncidentsService,
    { provide: PhotoStorage, useFactory: () => new PhotoStorage(loadConfig().storage) },
  ],
})
export class IncidentsModule {}
