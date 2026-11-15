import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadConfig, typeOrmOptions } from './config.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: () => typeOrmOptions(loadConfig().database) }),
    HealthModule,
  ],
})
export class AppModule {}
