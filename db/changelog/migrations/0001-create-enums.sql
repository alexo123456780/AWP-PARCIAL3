--liquibase formatted sql

--changeset alejandro:0001-create-enums
-- Valores sin tildes ni espacios (p. ej. `critica`): son el contrato estable con la API.
CREATE TYPE incident_type AS ENUM ('bache', 'fuga', 'alumbrado', 'cableado', 'otro');
CREATE TYPE incident_severity AS ENUM ('baja', 'media', 'alta', 'critica');
CREATE TYPE incident_status AS ENUM ('recibido', 'en_revision', 'en_atencion', 'resuelto');
--rollback DROP TYPE incident_status;
--rollback DROP TYPE incident_severity;
--rollback DROP TYPE incident_type;
