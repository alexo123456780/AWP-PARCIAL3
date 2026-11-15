import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IncidentSeverity, IncidentType } from '../incident.enums.js';

// En multipart/form-data todos los campos llegan como texto: `@Type` convierte las coordenadas antes de validarlas.
export class CreateIncidentDto {
  @ApiProperty({ format: 'uuid', description: 'UUID v4 generado en el cliente' })
  @IsUUID('4')
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Identidad del dispositivo que reporta' })
  @IsUUID()
  reporter_id: string;

  @ApiProperty({ enum: IncidentType, enumName: 'IncidentType' })
  @IsEnum(IncidentType)
  type: IncidentType;

  @ApiProperty({ enum: IncidentSeverity, enumName: 'IncidentSeverity' })
  @IsEnum(IncidentSeverity)
  severity: IncidentSeverity;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  description: string;

  @ApiProperty({ minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Precisión del GPS en metros; se omite en la captura manual',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Hora real de captura; si se omite se usa la de recepción',
  })
  @IsOptional()
  @IsDateString()
  created_at?: string;
}
