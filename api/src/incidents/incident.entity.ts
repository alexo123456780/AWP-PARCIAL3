import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { IncidentSeverity, IncidentStatus, IncidentType } from './incident.enums.js';

/** Mapea la tabla `incidents` de Liquibase (changeset 0002); los nombres de propiedad son los de las columnas. */
@Entity('incidents')
export class Incident {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid')
  reporter_id: string;

  @Column({ type: 'enum', enum: IncidentType, enumName: 'incident_type' })
  type: IncidentType;

  @Column({ type: 'enum', enum: IncidentSeverity, enumName: 'incident_severity' })
  severity: IncidentSeverity;

  @Column('text')
  description: string;

  @Column('double precision')
  lat: number;

  @Column('double precision')
  lng: number;

  @Column({ type: 'double precision', nullable: true })
  accuracy: number | null;

  @Column({ type: 'text', nullable: true })
  photo_url: string | null;

  @Column({ type: 'enum', enum: IncidentStatus, enumName: 'incident_status' })
  status: IncidentStatus;

  /** Hora real de captura (la manda el cliente). */
  @Column('timestamptz')
  created_at: Date;

  /** Hora de recepción: la pone la base (`DEFAULT now()`), nunca el cliente. */
  @CreateDateColumn({ type: 'timestamptz' })
  synced_at: Date;
}
