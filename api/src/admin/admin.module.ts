import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IncidentsModule } from '../incidents/incidents.module.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [AuthModule, IncidentsModule],
  controllers: [AdminController],
})
export class AdminModule {}
