import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

// Resuelve el compose con `.env.example` y con un entorno vacío (sin heredar variables del equipo).
function composeConfig(envFile) {
  return JSON.parse(
    execFileSync('docker', ['compose', '--env-file', envFile, 'config', '--format', 'json'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    }),
  );
}

const { services, volumes } = composeConfig('.env.example');

test('el compose define exactamente db, liquibase, backend y frontend', () => {
  assert.deepEqual(Object.keys(services).sort(), ['backend', 'db', 'frontend', 'liquibase']);
});

test('db usa postgres:16-alpine con volumen pgdata y healthcheck pg_isready', () => {
  const { db } = services;
  assert.equal(db.image, 'postgres:16-alpine');
  assert.ok(db.volumes.some((v) => v.type === 'volume' && v.source === 'pgdata'));
  assert.ok('pgdata' in volumes);
  assert.match(db.healthcheck.test.join(' '), /pg_isready/);
});

test('liquibase usa una versión fija, es de ejecución única y espera a db healthy', () => {
  const { liquibase } = services;
  assert.match(liquibase.image, /^liquibase\/liquibase:\d+\.\d+\.\d+$/);
  assert.equal(liquibase.restart, 'no');
  assert.equal(liquibase.depends_on.db.condition, 'service_healthy');
});

test('el orden de arranque es db → liquibase → backend → frontend', () => {
  assert.equal(services.backend.depends_on.liquibase.condition, 'service_completed_successfully');
  assert.ok('backend' in services.frontend.depends_on);
});

test('sin DB_USER ni DB_PASSWORD el compose falla en lugar de usar valores por defecto', () => {
  assert.throws(
    () => composeConfig('/dev/null'),
    /required variable DB_(USER|PASSWORD) is missing/,
  );
});

test('.env.example documenta todas las variables que usa el compose', () => {
  // (?<!\$) ignora `$${VAR}`, que Compose deja para el shell del contenedor.
  const used = new Set(
    [...read('docker-compose.yml').matchAll(/(?<!\$)\$\{([A-Z_]+)/g)].map((m) => m[1]),
  );
  const documented = new Set([...read('.env.example').matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]));
  assert.deepEqual(
    [...used].filter((name) => !documented.has(name)),
    [],
  );
  assert.match(read('.env.example'), /^DB_PASSWORD=change-me$/m);
});

for (const [service, dir] of [
  ['backend', 'api'],
  ['frontend', 'web'],
]) {
  test(`${dir}/Dockerfile define las etapas dev y prod y el compose usa dev`, () => {
    const stages = [...read(`${dir}/Dockerfile`).matchAll(/^FROM .+ AS (\w+)$/gm)].map((m) => m[1]);
    assert.ok(stages.includes('dev') && stages.includes('prod'), `etapas: ${stages}`);
    assert.equal(services[service].build.target, 'dev');
  });
}

test('la etapa prod de web sirve estáticos con Nginx en el puerto 8080', () => {
  const dockerfile = read('web/Dockerfile');
  assert.match(dockerfile, /^FROM nginx\S* AS prod$/m);
  assert.match(dockerfile, /^EXPOSE 8080$/m);
  assert.match(read('web/nginx.conf'), /listen 8080;/);
});

test('nginx.conf: sw.js, sync.js e index.html sin caché y el resto con max-age largo', () => {
  const conf = read('web/nginx.conf');
  const header = (location) => {
    const block = conf.match(new RegExp(`location ${location} \\{([^}]*)\\}`))?.[1] ?? '';
    return block.match(/add_header Cache-Control "([^"]+)"/)?.[1];
  };
  // sync.js lo importa sw.js: con max-age largo el navegador conservaría el envío de reportes viejo.
  assert.equal(header('~ \\^/\\(sw\\|sync\\)\\\\\\.js\\$'), 'no-cache');
  assert.equal(header('= /index\\.html'), 'no-cache');
  assert.match(header('/'), /max-age=\d{7,}/);
});

test('nginx.conf: comprime con gzip el JS, el CSS y el JSON, y no los PNG', () => {
  const conf = read('web/nginx.conf');
  assert.match(conf, /^\s*gzip on;$/m);
  const types = conf.match(/^\s*gzip_types ([^;]+);$/m)?.[1].split(/\s+/) ?? [];
  for (const type of ['text/css', 'application/javascript', 'application/json']) {
    assert.ok(types.includes(type), `gzip_types debe incluir ${type}`);
  }
  assert.ok(!types.includes('image/png'), 'un PNG ya va comprimido: no se vuelve a comprimir');
  assert.match(conf, /^\s*gzip_vary on;$/m); // la caché de un CDN no debe mezclar la copia comprimida con la que no
});
