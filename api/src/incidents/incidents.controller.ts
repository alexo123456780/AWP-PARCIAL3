import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateIncidentDto } from './dto/create-incident.dto.js';
import { IncidentResponseDto } from './dto/incident-response.dto.js';
import { ListIncidentsQueryDto } from './dto/list-incidents-query.dto.js';
import { IncidentsService, type UploadedPhoto } from './incidents.service.js';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

@ApiTags('incidents')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  // Sin `storage`, multer guarda en memoria; 5 MB (RF-6) y una sola foto, o responde 413.
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  @ApiOperation({
    summary: 'Registra un reporte con estatus «recibido»; reenviar el mismo id no lo duplica',
    description:
      'JSON o multipart/form-data con los campos del reporte y, opcional, un archivo `photo` (JPEG, PNG o WebP, máx. 5 MB).',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiCreatedResponse({ type: IncidentResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido o foto que no es una imagen' })
  @ApiPayloadTooLargeResponse({ description: 'La foto pesa más de 5 MB' })
  @ApiServiceUnavailableResponse({ description: 'Almacenamiento de fotos sin configurar' })
  @ApiBadGatewayResponse({ description: 'El almacenamiento rechazó la foto' })
  create(
    @Body() dto: CreateIncidentDto,
    @UploadedFile() photo?: UploadedPhoto,
  ): Promise<IncidentResponseDto> {
    return this.incidentsService.create(dto, photo);
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
