import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const migrationsDir = 'db/changelog/migrations';
const migrations = readdirSync(path.join(root, migrationsDir)).sort();

test('el changelog raíz hace includeAll de migrations/', () => {
  const rootChangelog = read('db/changelog/db.changelog-root.yaml');
  assert.match(rootChangelog, /^databaseChangeLog:$/m);
  assert.match(rootChangelog, /includeAll:\s*\n\s+path: migrations\//);
});

test('los changesets iniciales existen, numerados y en orden (PRD §5.4)', () => {
  assert.deepEqual(migrations.slice(0, 4), [
    '0001-create-enums.sql',
    '0002-create-incidents.sql',
    '0003-create-push-subscriptions.sql',
    '0004-create-users.sql',
  ]);
});

for (const file of migrations) {
  test(`${file}: formato Liquibase, id igual al archivo y un --rollback por changeset`, () => {
    const sql = read(`${migrationsDir}/${file}`);
    const ids = [...sql.matchAll(/^--changeset \S+:(\S+)/gm)].map((m) => m[1]);
    const rollbacks = sql.match(/^--rollback /gm) ?? [];
    assert.match(sql, /^--liquibase formatted sql\n/);
    assert.deepEqual(ids, [path.basename(file, '.sql')]);
    assert.ok(rollbacks.length >= 1, 'falta --rollback');
  });
}

test('0001 define los enums del PRD §5.5 y su rollback los elimina', () => {
  const sql = read(`${migrationsDir}/0001-create-enums.sql`);
  assert.match(sql, /incident_type AS ENUM \('bache', 'fuga', 'alumbrado', 'cableado', 'otro'\)/);
  assert.match(sql, /incident_severity AS ENUM \('baja', 'media', 'alta', 'critica'\)/);
  assert.match(
    sql,
    /incident_status AS ENUM \('recibido', 'en_revision', 'en_atencion', 'resuelto'\)/,
  );
  for (const name of ['incident_type', 'incident_severity', 'incident_status']) {
    assert.match(sql, new RegExp(`^--rollback DROP TYPE ${name};$`, 'm'));
  }
});

test('0002 crea incidents con los campos del PRD y descripción de máximo 500 caracteres', () => {
  const sql = read(`${migrationsDir}/0002-create-incidents.sql`);
  for (const column of [
    'id uuid PRIMARY KEY',
    'reporter_id uuid',
    'type incident_type',
    'severity incident_severity',
    'description text',
    'lat double precision',
    'lng double precision',
    'accuracy double precision',
    'photo_url text',
    'status incident_status',
    'created_at timestamptz',
    'synced_at timestamptz',
  ]) {
    assert.ok(sql.includes(column), `falta la columna: ${column}`);
  }
  assert.match(sql, /CHECK \(char_length\(description\) <= 500\)/);
  assert.match(sql, /^--rollback DROP TABLE incidents;$/m);
});

test('0003 crea push_subscriptions con endpoint único', () => {
  const sql = read(`${migrationsDir}/0003-create-push-subscriptions.sql`);
  assert.match(sql, /endpoint text NOT NULL UNIQUE/);
  for (const column of ['reporter_id', 'p256dh', 'auth', 'created_at']) {
    assert.ok(sql.includes(column), `falta la columna: ${column}`);
  }
  assert.match(sql, /^--rollback DROP TABLE push_subscriptions;$/m);
});

test('0004 crea users con email único y solo el hash de la contraseña', () => {
  const sql = read(`${migrationsDir}/0004-create-users.sql`);
  assert.match(sql, /email text NOT NULL UNIQUE/);
  assert.match(sql, /password_hash text NOT NULL/);
  assert.doesNotMatch(sql, /\bpassword text\b/);
  assert.match(sql, /^--rollback DROP TABLE users;$/m);
});

test('CI: el job liquibase-validate usa la imagen fijada en Compose, valida contra la rama base y prueba el rollback', () => {
  const ci = read('.github/workflows/ci.yml');
  const job = ci.slice(ci.indexOf('  liquibase-validate:'));
  assert.ok(job.includes('name: liquibase-validate'));
  assert.match(job, /if: github\.event_name == 'pull_request'/);
  assert.match(job, /image: postgres:16-alpine/);
  // La versión de Liquibase se lee de docker-compose.yml: nunca se repite en el workflow.
  assert.match(job, /grep -oE 'liquibase\/liquibase:\[0-9\.\]\+' docker-compose\.yml/);
  assert.doesNotMatch(job, /liquibase\/liquibase:\d/);
  assert.match(job, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  // Orden: baseline de la base → validate de la PR → update → rollback → update.
  const steps = [
    ...job.matchAll(/^\s+if \[ -d base.*update; fi$|^\s+lb db\/changelog (\S+)/gm),
  ].map((m) => m[1] ?? 'baseline');
  assert.deepEqual(steps, ['baseline', 'validate', 'update', 'rollback-count', 'update']);
  assert.match(read('docker-compose.yml'), /image: liquibase\/liquibase:\d+\.\d+\.\d+/);
});
