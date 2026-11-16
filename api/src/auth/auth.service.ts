import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import type { LoginDto } from './dto/login.dto.js';
import { User } from './user.entity.js';

/** `true` si hay `JWT_SECRET`; sin él el login responde 503 en vez de firmar con un secreto vacío. */
export const AUTH_ENABLED = Symbol('AUTH_ENABLED');

// Hash de una contraseña que nadie usa: con un correo inexistente también se compara contra algo, para que
// la respuesta tarde igual y no delate qué correos existen.
const UNKNOWN_USER_HASH = '$2b$10$57Xz0zrndJnoU.FLxAFtd.828ChvZYHgvxa8QsPFGCYBozaenwKtG';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    @Inject(AUTH_ENABLED) private readonly enabled: boolean,
  ) {}

  async login({ email, password }: LoginDto): Promise<{ access_token: string; role: string }> {
    if (!this.enabled)
      throw new ServiceUnavailableException('La autenticación no está configurada');
    const user = await this.users.findOneBy({ email: email.toLowerCase() });
    const matches = await bcrypt.compare(password, user?.password_hash ?? UNKNOWN_USER_HASH);
    // Un solo mensaje para «no existe» y «contraseña incorrecta».
    if (!user || !matches) throw new UnauthorizedException('Credenciales inválidas');
    return {
      access_token: await this.jwt.signAsync({ sub: user.id, role: user.role }),
      // El cliente decide con esto qué pantallas muestra; lo que se puede hacer lo decide el guard con el rol del JWT.
      role: user.role,
    };
  }
}
