import { ApiProperty } from '@nestjs/swagger';
import { IncidentSeverity, IncidentStatus, IncidentType } from '../incident.enums.js';

export class IncidentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  reporter_id: string;

  @ApiProperty({ enum: IncidentType, enumName: 'IncidentType' })
  type: IncidentType;

  @ApiProperty({ enum: IncidentSeverity, enumName: 'IncidentSeverity' })
  severity: IncidentSeverity;

  @ApiProperty({ maxLength: 500 })
  description: string;

  @ApiProperty()
  lat: number;

  @ApiProperty()
  lng: number;

  @ApiProperty({ type: Number, nullable: true })
  accuracy: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'Aún sin subida de fotos (Sprint 3)' })
  photo_url: string | null;

  @ApiProperty({ enum: IncidentStatus, enumName: 'IncidentStatus' })
  status: IncidentStatus;

  @ApiProperty({ format: 'date-time', description: 'Hora real de captura (cliente)' })
  created_at: Date;

  @ApiProperty({ format: 'date-time', description: 'Hora de recepción (servidor)' })
  synced_at: Date;
}
