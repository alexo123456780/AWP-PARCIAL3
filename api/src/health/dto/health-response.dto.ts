import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok', description: 'Estado del servicio' })
  status: 'ok' | 'error';

  @ApiProperty({ enum: ['up', 'down'], example: 'up', description: 'Conexión a la base de datos' })
  database: 'up' | 'down';
}
