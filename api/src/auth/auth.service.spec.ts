import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { Repository } from 'typeorm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import type { User } from './user.entity.js';

const jwt = new JwtService({ secret: 'secreto-de-prueba-de-al-menos-32-caracteres' });
let user: User;

beforeAll(async () => {
  // Costo mínimo: aquí solo importa que la comparación sea con bcrypt de verdad, no su lentitud.
  user = {
    id: '11111111-2222-4333-8444-555555555555',
    email: 'coordinador@civicguard.test',
    password_hash: await bcrypt.hash('contrasena-correcta', 4),
    role: 'coordinador',
  };
});

function setup(found: User | null = user, enabled = true) {
  const users = { findOneBy: vi.fn().mockResolvedValue(found) };
  return { users, service: new AuthService(users as unknown as Repository<User>, jwt, enabled) };
}

describe('AuthService.login', () => {
  it('devuelve un JWT firmado con el id y el rol cuando las credenciales son válidas', async () => {
    const { service } = setup();
    const { access_token } = await service.login({
      email: user.email,
      password: 'contrasena-correcta',
    });
    expect(await jwt.verifyAsync(access_token)).toMatchObject({
      sub: user.id,
      role: 'coordinador',
    });
  });

  it('devuelve también el rol de la cuenta, para que la app sepa qué pantallas mostrar', async () => {
    const operator = { ...user, email: 'operador@civicguard.test', role: 'operador' };
    const { service } = setup(operator);
    const result = await service.login({ email: operator.email, password: 'contrasena-correcta' });
    expect(result.role).toBe('operador');
    expect(await jwt.verifyAsync(result.access_token)).toMatchObject({ role: 'operador' });
  });

  it('busca el correo en minúsculas', async () => {
    const { users, service } = setup();
    await service.login({ email: 'Coordinador@CivicGuard.TEST', password: 'contrasena-correcta' });
    expect(users.findOneBy).toHaveBeenCalledWith({ email: 'coordinador@civicguard.test' });
  });

  it('responde 401 con el mismo mensaje si la contraseña es incorrecta o el correo no existe', async () => {
    const wrongPassword = setup().service.login({ email: user.email, password: 'otra' });
    const unknownEmail = setup(null).service.login({ email: 'nadie@x.test', password: 'otra' });
    await expect(wrongPassword).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(unknownEmail).rejects.toBeInstanceOf(UnauthorizedException);
    const messages = await Promise.all(
      [wrongPassword, unknownEmail].map((attempt) => attempt.catch((e: Error) => e.message)),
    );
    expect(messages[0]).toBe(messages[1]);
  });

  it('compara contra un hash aunque el correo no exista (no delata qué correos hay)', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    await setup(null)
      .service.login({ email: 'nadie@x.test', password: 'x' })
      .catch(() => undefined);
    expect(compare).toHaveBeenCalledOnce();
    compare.mockRestore();
  });

  it('responde 503 sin tocar la base si no hay JWT_SECRET', async () => {
    const { users, service } = setup(user, false);
    await expect(service.login({ email: user.email, password: 'x' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(users.findOneBy).not.toHaveBeenCalled();
  });
});
