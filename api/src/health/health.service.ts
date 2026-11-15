import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { HealthResponseDto } from './dto/health-response.dto.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  // DataSource lo exporta TypeOrmModule.forRoot() globalmente: no hace falta importar nada en el módulo.
  constructor(private readonly dataSource: DataSource) {}

  async check(): Promise<HealthResponseDto> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      // El motivo va al log; la respuesta no expone detalles de la conexión.
      this.logger.error(`La base de datos no responde: ${(error as Error).message}`);
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok', database: 'up' };
  }
}
