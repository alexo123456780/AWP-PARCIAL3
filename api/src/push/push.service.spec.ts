import { ServiceUnavailableException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config.js';
import type { Incident } from '../incidents/incident.entity.js';
import { IncidentStatus } from '../incidents/incident.enums.js';
import type { PushSubscriptionEntity } from './push-subscription.entity.js';
import { PushService, statusPayload, type WebPush } from './push.service.js';

const VAPID: NonNullable<AppConfig['push']> = {
  publicKey: 'clave-publica-de-prueba',
  privateKey: 'clave-privada-de-prueba',
  subject: 'mailto:equipo@civicguard.test',
};
const REPORTER = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const incident = {
  id: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
  reporter_id: REPORTER,
  description: 'Bache profundo frente al mercado',
  status: IncidentStatus.EnRevision,
} as Incident;
const subscription = (endpoint: string) =>
  ({ reporter_id: REPORTER, endpoint, p256dh: 'p256dh', auth: 'auth' }) as PushSubscriptionEntity;

function setup(
  subscriptions: PushSubscriptionEntity[] = [],
  vapid: AppConfig['push'] | null = VAPID,
) {
  const repo = {
    upsert: vi.fn().mockResolvedValue(undefined),
    findBy: vi.fn().mockResolvedValue(subscriptions),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const sender = { sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) };
  const service = new PushService(
    repo as unknown as Repository<PushSubscriptionEntity>,
    sender as unknown as WebPush,
    vapid ?? undefined,
  );
  return { repo, sender, service };
}

describe('PushService', () => {
  describe('subscribe', () => {
    it('guarda endpoint, p256dh, auth y reporter_id con upsert por endpoint (no duplica)', async () => {
      const { repo, service } = setup();
      const dto = {
        reporter_id: REPORTER,
        endpoint: 'https://fcm.googleapis.com/x',
        p256dh: 'k',
        auth: 'a',
      };
      await service.subscribe(dto);
      expect(repo.upsert).toHaveBeenCalledWith(dto, ['endpoint']);
    });

    it('responde 503 y no guarda nada si VAPID no está configurado', async () => {
      const { repo, service } = setup([], null);
      await expect(
        service.subscribe({
          reporter_id: REPORTER,
          endpoint: 'https://fcm.googleapis.com/x',
          p256dh: 'k',
          auth: 'a',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(repo.upsert).not.toHaveBeenCalled();
      expect(() => service.publicKey()).toThrow(ServiceUnavailableException);
    });

    it('expone la clave pública VAPID', () => {
      expect(setup().service.publicKey()).toBe(VAPID.publicKey);
    });
  });

  describe('notifyStatusChange', () => {
    it('envía a cada suscripción del reportante, firmando con VAPID, con el estatus nuevo y con TTL y timeout', async () => {
      const { repo, sender, service } = setup([
        subscription('https://fcm.googleapis.com/uno'),
        subscription('https://web.push.apple.com/dos'),
      ]);
      await service.notifyStatusChange(incident);

      expect(repo.findBy).toHaveBeenCalledWith({ reporter_id: REPORTER });
      expect(sender.sendNotification).toHaveBeenCalledTimes(2);
      const [target, payload, options] = sender.sendNotification.mock.calls[0];
      expect(target).toEqual({
        endpoint: 'https://fcm.googleapis.com/uno',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      });
      expect(JSON.parse(payload)).toEqual({
        title: 'Tu reporte cambió de estatus',
        body: '«Bache profundo frente al mercado» ahora está: En revisión',
        incident_id: incident.id,
        status: 'en_revision',
        url: `/reportes/${incident.id}`,
      });
      expect(options).toMatchObject({ vapidDetails: VAPID, TTL: 86400, timeout: 5000 });
    });

    it.each([404, 410])(
      'borra la suscripción que responde %i y deja las demás',
      async (statusCode) => {
        const { repo, sender, service } = setup([
          subscription('https://fcm.googleapis.com/muerta'),
          subscription('https://fcm.googleapis.com/viva'),
        ]);
        sender.sendNotification.mockImplementation(async (target: { endpoint: string }) => {
          if (target.endpoint.endsWith('muerta'))
            throw Object.assign(new Error('gone'), { statusCode });
          return { statusCode: 201 };
        });
        await service.notifyStatusChange(incident);
        expect(repo.delete).toHaveBeenCalledTimes(1);
        expect(repo.delete).toHaveBeenCalledWith({ endpoint: 'https://fcm.googleapis.com/muerta' });
      },
    );

    it('no lanza ni borra ante otros fallos (5xx o sin red) y sigue con las demás suscripciones', async () => {
      const { repo, sender, service } = setup([
        subscription('https://fcm.googleapis.com/uno'),
        subscription('https://fcm.googleapis.com/dos'),
      ]);
      sender.sendNotification
        .mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))
        .mockRejectedValueOnce(new Error('ECONNRESET'));
      await expect(service.notifyStatusChange(incident)).resolves.toBeUndefined();
      expect(sender.sendNotification).toHaveBeenCalledTimes(2);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('no lanza si falla la lectura de las suscripciones', async () => {
      const { repo, sender, service } = setup();
      repo.findBy.mockRejectedValue(new Error('db caída'));
      await expect(service.notifyStatusChange(incident)).resolves.toBeUndefined();
      expect(sender.sendNotification).not.toHaveBeenCalled();
    });

    it('no hace nada sin VAPID o sin suscripciones', async () => {
      const unconfigured = setup([subscription('https://fcm.googleapis.com/uno')], null);
      await unconfigured.service.notifyStatusChange(incident);
      expect(unconfigured.repo.findBy).not.toHaveBeenCalled();

      const empty = setup([]);
      await empty.service.notifyStatusChange(incident);
      expect(empty.sender.sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('statusPayload', () => {
    it('acorta una descripción larga a 60 caracteres con puntos suspensivos', () => {
      const long = { ...incident, description: 'x'.repeat(100) } as Incident;
      expect(statusPayload(long).body).toBe(`«${'x'.repeat(60)}…» ahora está: En revisión`);
    });

    it.each([
      [IncidentStatus.Recibido, 'Recibido'],
      [IncidentStatus.EnAtencion, 'En atención'],
      [IncidentStatus.Resuelto, 'Resuelto'],
    ])('nombra el estatus %s como «%s»', (status, label) => {
      expect(statusPayload({ ...incident, status } as Incident).body).toContain(
        `ahora está: ${label}`,
      );
    });
  });
});
