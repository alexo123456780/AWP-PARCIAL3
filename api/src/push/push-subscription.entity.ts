import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Mapea la tabla `push_subscriptions` de Liquibase (changeset 0003): un dispositivo puede tener varias. */
@Entity('push_subscriptions')
export class PushSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** UUID anónimo del dispositivo, el mismo `reporter_id` con el que se envían sus reportes. */
  @Column('uuid')
  reporter_id: string;

  /** URL del servicio de push que entrega al dispositivo: es una capacidad (quien la tiene puede enviarle), no se loguea. */
  @Column('text')
  endpoint: string;

  @Column('text')
  p256dh: string;

  @Column('text')
  auth: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
