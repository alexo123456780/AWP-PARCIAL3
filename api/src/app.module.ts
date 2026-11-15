import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadConfig, typeOrmOptions } from './config.js';
import { HealthModule } from './health/health.module.js';
import { IncidentsModule } from './incidents/incidents.module.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: () => typeOrmOptions(loadConfig().database) }),
    HealthModule,
    IncidentsModule,
  ],
})
export class AppModule {}
