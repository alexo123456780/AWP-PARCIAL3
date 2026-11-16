import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email: string;

  // 72 bytes es lo que bcrypt lee de una contraseña: más largo no aporta y solo encarece cada intento.
  @ApiProperty({ minLength: 1, maxLength: 72 })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password: string;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'JWT para el encabezado `Authorization: Bearer <token>`' })
  access_token: string;

  @ApiProperty({ enum: ['coordinador', 'operador'], description: 'Perfil de la cuenta' })
  role: string;
}
