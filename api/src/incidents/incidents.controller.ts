import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateIncidentDto } from './dto/create-incident.dto.js';
import { IncidentResponseDto } from './dto/incident-response.dto.js';
import { ListIncidentsQueryDto } from './dto/list-incidents-query.dto.js';
import { IncidentsService } from './incidents.service.js';

@ApiTags('incidents')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  @ApiOperation({ summary: 'Registra un reporte de incidencia con estatus «recibido»' })
  @ApiCreatedResponse({ type: IncidentResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido; el mensaje nombra cada campo' })
  @ApiConflictResponse({ description: 'Ya existe un reporte con ese id' })
  create(@Body() dto: CreateIncidentDto): Promise<IncidentResponseDto> {
    return this.incidentsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista los reportes de un dispositivo, del más reciente al más antiguo',
  })
  @ApiOkResponse({ type: [IncidentResponseDto] })
  @ApiBadRequestResponse({ description: '`reporter_id` ausente o que no es un UUID' })
  findByReporter(@Query() query: ListIncidentsQueryDto): Promise<IncidentResponseDto[]> {
    return this.incidentsService.findByReporter(query.reporter_id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un reporte' })
  @ApiOkResponse({ type: IncidentResponseDto })
  @ApiBadRequestResponse({ description: '`id` que no es un UUID' })
  @ApiNotFoundResponse({ description: 'No existe un reporte con ese id' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<IncidentResponseDto> {
    return this.incidentsService.findOne(id);
  }
}
