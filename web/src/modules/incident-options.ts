import type { IncidentSeverity, IncidentType } from '../db/idb';

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

/** Igual que `CHECK (char_length(description) <= 500)` de la tabla y el DTO de la API. */
export const MAX_DESCRIPTION = 500;
