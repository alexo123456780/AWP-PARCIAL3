import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type webpush from 'web-push';
import type { AppConfig } from '../config.js';
import type { Incident } from '../incidents/incident.entity.js';
import { IncidentStatus } from '../incidents/incident.enums.js';
import type { SubscribeDto } from './dto/subscribe.dto.js';
import { PushSubscriptionEntity } from './push-subscription.entity.js';

/** El módulo `web-push` (se inyecta para poder simularlo en las pruebas). */
export const WEB_PUSH = Symbol('WEB_PUSH');
export type WebPush = Pick<typeof webpush, 'sendNotification'>;
/** Identidad VAPID (`AppConfig['push']`); `undefined` = sin configurar. */
export const VAPID = Symbol('VAPID');

/** Lo que recibe el Service Worker en el evento `push` (`web/public/sw.js`). */
export interface StatusPushPayload {
  title: string;
  body: string;
  incident_id: string;
  status: IncidentStatus;
  /** Ruta de la PWA que abre al tocar la notificación. */
  url: string;
}

const STATUS_LABELS: Record<IncidentStatus, string> = {
  [IncidentStatus.Recibido]: 'Recibido',
  [IncidentStatus.EnRevision]: 'En revisión',
  [IncidentStatus.EnAtencion]: 'En atención',
  [IncidentStatus.Resuelto]: 'Resuelto',
};

const SNIPPET_LENGTH = 60;
// Un aviso de estatus caduca a las 24 h: entregárselo a un teléfono apagado días después ya no sirve.
const TTL_SECONDS = 24 * 60 * 60;
// Un servicio de push lento no debe retener la petición del coordinador.
const SEND_TIMEOUT_MS = 5000;

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(PushSubscriptionEntity)
    private readonly subscriptions: Repository<PushSubscriptionEntity>,
    @Inject(WEB_PUSH) private readonly sender: WebPush,
    @Inject(VAPID) private readonly vapid: AppConfig['push'],
  ) {}

  /** Clave que el navegador necesita para suscribirse. */
  publicKey(): string {
    return this.requireVapid().publicKey;
  }

  /** Idempotente por `endpoint`: volver a suscribirse (o con claves nuevas) actualiza la fila, no la duplica. */
  async subscribe({ reporter_id, endpoint, p256dh, auth }: SubscribeDto): Promise<void> {
    this.requireVapid();
    await this.subscriptions.upsert({ reporter_id, endpoint, p256dh, auth }, ['endpoint']);
  }

  /**
   * Avisa a todos los dispositivos del reportante. Nunca lanza: un push que falla no debe deshacer ni retrasar el
   * cambio de estatus que ya se guardó. Una suscripción que el servicio de push da por muerta (404/410) se borra.
   */
  async notifyStatusChange(incident: Incident): Promise<void> {
    if (!this.vapid) return;
    try {
      const subscriptions = await this.subscriptions.findBy({ reporter_id: incident.reporter_id });
      const payload = JSON.stringify(statusPayload(incident));
      await Promise.all(subscriptions.map((subscription) => this.send(subscription, payload)));
    } catch {
      this.logger.warn(`No se pudo avisar del estatus del reporte ${incident.id}`);
    }
  }

  private async send(subscription: PushSubscriptionEntity, payload: string): Promise<void> {
    const { endpoint, p256dh, auth } = subscription;
    try {
      await this.sender.sendNotification({ endpoint, keys: { p256dh, auth } }, payload, {
        vapidDetails: {
          subject: this.vapid!.subject,
          publicKey: this.vapid!.publicKey,
          privateKey: this.vapid!.privateKey,
        },
        TTL: TTL_SECONDS,
        timeout: SEND_TIMEOUT_MS,
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await this.subscriptions.delete({ endpoint }).catch(() => undefined);
      } else {
        // Solo el código: el endpoint es una capacidad de envío y el mensaje de error puede repetirlo.
        this.logger.warn(`Un servicio de push rechazó el envío (${statusCode ?? 'sin respuesta'})`);
      }
    }
  }

  private requireVapid(): NonNullable<AppConfig['push']> {
    if (!this.vapid)
      throw new ServiceUnavailableException('Las notificaciones push no están configuradas');
    return this.vapid;
  }
}

export function statusPayload(incident: Incident): StatusPushPayload {
  const description = incident.description.trim();
  const snippet =
    description.length > SNIPPET_LENGTH ? `${description.slice(0, SNIPPET_LENGTH)}…` : description;
  return {
    title: 'Tu reporte cambió de estatus',
    body: `«${snippet}» ahora está: ${STATUS_LABELS[incident.status]}`,
    incident_id: incident.id,
    status: incident.status,
    url: `/reportes/${incident.id}`,
  };
}
