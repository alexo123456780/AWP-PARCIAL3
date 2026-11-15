// Los valores son los de los ENUM de PostgreSQL (changeset 0001); sin tildes: son el contrato con la API.
export enum IncidentType {
  Bache = 'bache',
  Fuga = 'fuga',
  Alumbrado = 'alumbrado',
  Cableado = 'cableado',
  Otro = 'otro',
}

export enum IncidentSeverity {
  Baja = 'baja',
  Media = 'media',
  Alta = 'alta',
  Critica = 'critica',
}

export enum IncidentStatus {
  Recibido = 'recibido',
  EnRevision = 'en_revision',
  EnAtencion = 'en_atencion',
  Resuelto = 'resuelto',
}
