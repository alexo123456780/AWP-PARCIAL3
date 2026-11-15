import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service.js';

const serviceWith = (query: () => Promise<unknown>) =>
  new HealthService({ query: vi.fn(query) } as unknown as DataSource);

describe('HealthService', () => {
  it('responde ok cuando la base contesta a SELECT 1', async () => {
    await expect(serviceWith(async () => [{ '?column?': 1 }]).check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('lanza 503 sin exponer el motivo (solo al log) cuando la base no responde', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const service = serviceWith(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
    });
    const error = await service.check().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'error',
      database: 'down',
    });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });
});
