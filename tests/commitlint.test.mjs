import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

const cwd = path.join(import.meta.dirname, '..');

function commitlint(message) {
  return spawnSync('npx', ['--no', '--', 'commitlint'], { cwd, input: message, encoding: 'utf8' });
}

for (const message of [
  'feat(SCRUM-122): agregar configuración de calidad',
  'docs(SCRUM-121): agregar tabla comparativa de arquitecturas',
  'chore: actualizar dependencias',
]) {
  test(`acepta «${message}»`, () => {
    assert.equal(commitlint(message).status, 0);
  });
}

for (const message of ['cambios', 'Update stuff', 'feat sin dos puntos', 'wip: x']) {
  test(`rechaza «${message}»`, () => {
    const { status, stdout } = commitlint(message);
    assert.notEqual(status, 0);
    assert.match(stdout, /✖/);
  });
}
