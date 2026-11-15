import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { LoginDto, LoginResponseDto } from './dto/login.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  // Solo el login lleva límite de intentos: es el único endpoint que se puede probar a ciegas.
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia sesión del coordinador y devuelve un JWT' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido' })
  @ApiUnauthorizedResponse({
    description: 'Credenciales inválidas (no distingue correo de contraseña)',
  })
  @ApiTooManyRequestsResponse({ description: 'Demasiados intentos; se reintenta pasado un minuto' })
  @ApiServiceUnavailableResponse({ description: 'JWT_SECRET sin configurar' })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(dto);
  }
}
