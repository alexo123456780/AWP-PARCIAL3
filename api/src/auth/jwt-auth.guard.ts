import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

/**
 * Exige `Authorization: Bearer <JWT>` válido y vigente (si no, 401) **de un coordinador** (si no, 403): un operador de
 * campo también inicia sesión, pero su token no abre la administración. Un token sin rol tampoco pasa.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();
    let payload: { role?: unknown };
    try {
      // Algoritmo fijado: un token firmado con `none` u otro algoritmo no se acepta.
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.role !== 'coordinador') throw new ForbiddenException();
    return true;
  }
}
