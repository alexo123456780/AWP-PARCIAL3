import type { IncidentSeverity, IncidentStatus, IncidentType } from '../db/idb';

// Valores y orden de los ENUM de la API (changeset 0001); `label` es lo que ve el usuario.
export const INCIDENT_TYPES: { value: IncidentType; label: string }[] = [
  { value: 'bache', label: 'Bache' },
  { value: 'fuga', label: 'Fuga' },
  { value: 'alumbrado', label: 'Alumbrado' },
  { value: 'cableado', label: 'Cableado' },
  { value: 'otro', label: 'Otro' },
];

export const INCIDENT_SEVERITIES: { value: IncidentSeverity; label: string }[] = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
  { value: 'critica', label: 'Crítica' },
];

export const INCIDENT_STATUSES: { value: IncidentStatus; label: string }[] = [
  { value: 'recibido', label: 'Recibido' },
  { value: 'en_revision', label: 'En revisión' },
  { value: 'en_atencion', label: 'En atención' },
  { value: 'resuelto', label: 'Resuelto' },
];

/** Etiqueta en español de un valor de ENUM; si llega uno desconocido (API más nueva que la app) se muestra tal cual. */
export const labelOf = (options: { value: string; label: string }[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

/** Igual que `CHECK (char_length(description) <= 500)` de la tabla y el DTO de la API. */
export const MAX_DESCRIPTION = 500;
