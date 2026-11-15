--liquibase formatted sql

--changeset alejandro:0002-create-incidents
-- `id` lo genera el cliente: el servidor hace INSERT ... ON CONFLICT (id) DO NOTHING (idempotencia, RF-6).
-- `created_at` es la hora real de captura (cliente); `synced_at`, la de recepción (servidor).
CREATE TABLE incidents (
    id uuid PRIMARY KEY,
    reporter_id uuid NOT NULL,
    type incident_type NOT NULL,
    severity incident_severity NOT NULL,
    description text NOT NULL CONSTRAINT incidents_description_max_length CHECK (char_length(description) <= 500),
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    accuracy double precision,
    photo_url text,
    status incident_status NOT NULL DEFAULT 'recibido',
    created_at timestamptz NOT NULL,
    synced_at timestamptz NOT NULL DEFAULT now()
);
--rollback DROP TABLE incidents;
