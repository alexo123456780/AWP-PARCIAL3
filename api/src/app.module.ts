import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { loadConfig, typeOrmOptions } from './config.js';
import { HealthModule } from './health/health.module.js';
import { IncidentsModule } from './incidents/incidents.module.js';
import { PushModule } from './push/push.module.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: () => typeOrmOptions(loadConfig().database) }),
    HealthModule,
    IncidentsModule,
    AuthModule,
    AdminModule,
    PushModule,
  ],
})
export class AppModule {}
