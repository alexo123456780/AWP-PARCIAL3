import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { IncidentStatus } from '../../incidents/incident.enums.js';

export class ListAdminIncidentsQueryDto {
  @ApiPropertyOptional({ enum: IncidentStatus, enumName: 'IncidentStatus' })
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;
}

export class UpdateIncidentStatusDto {
  @ApiProperty({ enum: IncidentStatus, enumName: 'IncidentStatus' })
  @IsEnum(IncidentStatus)
  status: IncidentStatus;
}
