import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import jsonwebtoken from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
const jwt = new JwtService({ secret: SECRET, signOptions: { algorithm: 'HS256' } });
const guard = new JwtAuthGuard(jwt);

const contextWith = (authorization?: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  }) as ExecutionContext;

describe('JwtAuthGuard', () => {
  it('deja pasar el token válido de un coordinador', async () => {
    const token = await jwt.signAsync({ sub: 'u1', role: 'coordinador' });
    await expect(guard.canActivate(contextWith(`Bearer ${token}`))).resolves.toBe(true);
  });

  it.each([
    ['de un operador de campo', { sub: 'u2', role: 'operador' }],
    ['de un rol desconocido', { sub: 'u3', role: 'admin' }],
    ['sin rol', { sub: 'u4' }],
  ])(
    'responde 403 con un token válido %s: inicia sesión pero no administra',
    async (_name, claims) => {
      const token = await jwt.signAsync(claims);
      await expect(guard.canActivate(contextWith(`Bearer ${token}`))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it.each([
    ['sin encabezado', undefined],
    ['con otro esquema', 'Basic abc'],
    ['sin token', 'Bearer'],
    ['con un token que no es un JWT', 'Bearer basura'],
  ])('responde 401 %s', async (_name, header) => {
    await expect(guard.canActivate(contextWith(header))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('responde 401 con un token firmado con otro secreto', async () => {
    const forged = jsonwebtoken.sign({ sub: 'u1' }, 'otro-secreto-distinto-de-32-caracteres!!');
    await expect(guard.canActivate(contextWith(`Bearer ${forged}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('responde 401 con un token vencido', async () => {
    const expired = await jwt.signAsync({ sub: 'u1' }, { expiresIn: -10 });
    await expect(guard.canActivate(contextWith(`Bearer ${expired}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('responde 401 con un token sin firma (alg none)', async () => {
    const none = jsonwebtoken.sign({ sub: 'u1' }, '', { algorithm: 'none' });
    await expect(guard.canActivate(contextWith(`Bearer ${none}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
