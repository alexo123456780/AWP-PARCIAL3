--liquibase formatted sql

--changeset alejandro:0004-create-users
-- Coordinadores del panel (RF-9). `password_hash` guarda solo el hash, nunca la contraseña.
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'coordinador'
);
--rollback DROP TABLE users;
