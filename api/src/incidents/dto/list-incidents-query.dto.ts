import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ListIncidentsQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Dispositivo cuyos reportes se consultan' })
  @IsUUID()
  reporter_id: string;
}
