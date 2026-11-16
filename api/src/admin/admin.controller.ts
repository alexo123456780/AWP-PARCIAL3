import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { IncidentResponseDto } from '../incidents/dto/incident-response.dto.js';
import { IncidentsService } from '../incidents/incidents.service.js';
import { PushService } from '../push/push.service.js';
import { ListAdminIncidentsQueryDto, UpdateIncidentStatusDto } from './dto/admin-incidents.dto.js';

// El guard va en la clase: todo endpoint nuevo de `admin` nace protegido.
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Sin token, o token inválido o vencido' })
@UseGuards(JwtAuthGuard)
@Controller('admin/incidents')
export class AdminController {
  constructor(
    private readonly incidents: IncidentsService,
    private readonly push: PushService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista todos los reportes, del más reciente al más antiguo' })
  @ApiOkResponse({ type: [IncidentResponseDto] })
  @ApiBadRequestResponse({ description: '`status` fuera del enum' })
  findAll(@Query() { status }: ListAdminIncidentsQueryDto): Promise<IncidentResponseDto[]> {
    return this.incidents.findAll(status);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary:
      'Cambia el estatus de un reporte y avisa por push a los dispositivos de quien lo reportó',
  })
  @ApiOkResponse({ type: IncidentResponseDto })
  @ApiBadRequestResponse({ description: '`id` que no es UUID o estatus fuera del enum' })
  @ApiNotFoundResponse({ description: 'No existe un reporte con ese id' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { status }: UpdateIncidentStatusDto,
  ): Promise<IncidentResponseDto> {
    // Solo el valor (no el objeto): `updateStatus` modifica la entidad que recibe y aquí se compara con el anterior.
    const { status: previous } = await this.incidents.findOne(id);
    const incident = await this.incidents.updateStatus(id, status);
    // Sin esperar y sin fallar: el aviso es un extra del cambio de estatus, que ya quedó guardado.
    if (incident.status !== previous) void this.push.notifyStatusChange(incident);
    return incident;
  }
}
