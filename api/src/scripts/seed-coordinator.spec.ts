import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { MIN_PASSWORD_LENGTH, seedCoordinator } from './seed-coordinator.js';

const PASSWORD = 'contrasena-larga-de-prueba';

describe('seedCoordinator', () => {
  it('inserta el correo en minúsculas con un hash bcrypt, nunca la contraseña', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 'x' }]);
    await expect(seedCoordinator({ query }, 'Coord@CivicGuard.test', PASSWORD)).resolves.toBe(true);
    const [sql, [email, hash]] = query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (email) DO NOTHING');
    expect(email).toBe('coord@civicguard.test');
    expect(hash).not.toContain(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, hash)).toBe(true);
  });

  it('informa que ya existía (y no cambia nada) cuando el INSERT no devuelve filas', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await expect(seedCoordinator({ query }, 'coord@civicguard.test', PASSWORD)).resolves.toBe(
      false,
    );
  });

  it('rechaza una contraseña corta sin tocar la base', async () => {
    const query = vi.fn();
    await expect(
      seedCoordinator({ query }, 'coord@civicguard.test', 'x'.repeat(MIN_PASSWORD_LENGTH - 1)),
    ).rejects.toThrow('al menos');
    expect(query).not.toHaveBeenCalled();
  });
});
