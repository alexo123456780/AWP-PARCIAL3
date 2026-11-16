import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SubscribeDto, VapidPublicKeyDto } from './dto/subscribe.dto.js';
import { PushService } from './push.service.js';

@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Clave pública VAPID con la que el navegador se suscribe' })
  @ApiOkResponse({ type: VapidPublicKeyDto })
  @ApiServiceUnavailableResponse({ description: 'VAPID sin configurar' })
  vapidPublicKey(): VapidPublicKeyDto {
    return { public_key: this.push.publicKey() };
  }

  @Post('subscribe')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Registra la suscripción push de un dispositivo; repetir el mismo endpoint no la duplica',
  })
  @ApiNoContentResponse({ description: 'Suscripción guardada' })
  @ApiBadRequestResponse({
    description: 'Cuerpo inválido o endpoint que no es de un servicio de push',
  })
  @ApiServiceUnavailableResponse({ description: 'VAPID sin configurar' })
  subscribe(@Body() dto: SubscribeDto): Promise<void> {
    return this.push.subscribe(dto);
  }
}
