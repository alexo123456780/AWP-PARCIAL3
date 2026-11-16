// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../scripts/check-bundle-size.mjs');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Bytes aleatorios: no se comprimen, así que el tamaño gzip es prácticamente el tamaño del archivo.
const noise = (kb: number) => randomBytes(kb * 1000);

// Un dist/ como el que deja `vite build`: index.html + los archivos que se le indiquen.
function makeDist(head: string, files: Record<string, Buffer | string>) {
  const dist = mkdtempSync(join(tmpdir(), 'bundle-size-'));
  dirs.push(dist);
  writeFileSync(join(dist, 'index.html'), `<html><head>${head}</head><body></body></html>`);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  }
  return dist;
}

const check = (dist: string, ...extra: string[]) =>
  spawnSync(process.execPath, [script, dist, ...extra], { encoding: 'utf8' });

describe('check-bundle-size: JS inicial dentro del presupuesto', () => {
  it('imprime el tamaño gzip de cada script y el total, y termina con código 0', () => {
    const dist = makeDist(
      '<script type="module" crossorigin src="/assets/index-AAA.js"></script>',
      {
        'assets/index-AAA.js': noise(100),
      },
    );

    const result = check(dist);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\/assets\/index-AAA\.js 10\d\.\d\d KB gzip/);
    expect(result.stdout).toMatch(/JS inicial 10\d\.\d\d KB gzip de 150 KB permitidos/);
  });

  it('solo cuenta lo que carga index.html: ni los chunks de las páginas, ni el CSS, ni scripts externos', () => {
    const dist = makeDist(
      [
        '<script type="module" src="/assets/index-AAA.js"></script>',
        '<link rel="stylesheet" href="/assets/index-AAA.css">',
        '<script src="https://cdn.example.com/lib.js"></script>',
      ].join(''),
      {
        'assets/index-AAA.js': noise(100),
        'assets/index-AAA.css': noise(100),
        'assets/Panel-BBB.js': noise(100), // React.lazy: se descarga al visitar la ruta
      },
    );

    expect(check(dist).status).toBe(0);
  });
});

describe('check-bundle-size: presupuesto superado (código de salida distinto de 0)', () => {
  it('falla si el script de entrada pasa de 150 KB gzip, e imprime el tamaño medido', () => {
    const dist = makeDist('<script type="module" src="/assets/index-AAA.js"></script>', {
      'assets/index-AAA.js': noise(160),
    });

    const result = check(dist);

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/\/assets\/index-AAA\.js 16\d\.\d\d KB gzip/);
    expect(result.stderr).toMatch(
      /JS inicial 16\d\.\d\d KB gzip de 150 KB permitidos: presupuesto superado/,
    );
  });

  it('suma los chunks con modulepreload: dos de 80 KB pasan del límite aunque cada uno quepa', () => {
    const dist = makeDist(
      '<script type="module" src="/assets/index-AAA.js"></script>' +
        '<link rel="modulepreload" crossorigin href="/assets/vendor-BBB.js">',
      { 'assets/index-AAA.js': noise(80), 'assets/vendor-BBB.js': noise(80) },
    );

    const result = check(dist);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('presupuesto superado');
  });
});

describe('check-bundle-size: errores (código de salida distinto de 0)', () => {
  it('si dist/ no tiene index.html', () => {
    const result = check(join(tmpdir(), 'bundle-size-no-existe'));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('check-bundle-size: no existe');
  });

  it('si index.html no carga ningún script local, en vez de dar por bueno un total de 0 bytes', () => {
    const result = check(makeDist('<link rel="stylesheet" href="/assets/index-AAA.css">', {}));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no carga ningún script local');
  });

  it('si index.html referencia un script que no está en dist/', () => {
    const result = check(
      makeDist('<script type="module" src="/assets/index-AAA.js"></script>', {}),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/assets/index-AAA.js');
  });
});

describe('check-bundle-size: chunks bajo demanda (--lazy)', () => {
  const head = '<script type="module" src="/assets/index-AAA.js"></script>';
  const chunks = {
    'assets/index-AAA.js': noise(20),
    'assets/Panel-BBB.js': noise(9),
    'assets/camera-CCC.js': noise(1),
  };

  it('imprime el tamaño de cada chunk que no carga index.html, sin contarlo en el presupuesto', () => {
    const result = check(makeDist(head, chunks));

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/bajo demanda \/assets\/Panel-BBB\.js 9\.\d\d KB gzip/);
    expect(result.stdout).toMatch(/bajo demanda \/assets\/camera-CCC\.js 1\.\d\d KB gzip/);
    expect(result.stdout).toMatch(/JS inicial 2\d\.\d\d KB gzip/);
  });

  it('confirma que el panel y la cámara son chunks propios', () => {
    const result = check(makeDist(head, chunks), '--lazy', 'Panel,camera');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('bajo demanda confirmado: Panel, camera');
  });

  it('falla si un chunk que debe ser bajo demanda no existe (quedó dentro del JS inicial)', () => {
    const { 'assets/camera-CCC.js': _camera, ...withoutCamera } = chunks;
    void _camera;

    const result = check(makeDist(head, withoutCamera), '--lazy', 'Panel,camera');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('«camera» debe ser un chunk propio');
  });

  it('falla si el chunk existe pero index.html lo carga al abrir la app', () => {
    const result = check(
      makeDist(`${head}<link rel="modulepreload" href="/assets/Panel-BBB.js">`, chunks),
      '--lazy',
      'Panel',
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('«Panel» debe ser un chunk propio');
  });

  it('falla si --lazy no trae nombres', () => {
    const result = check(makeDist(head, chunks), '--lazy');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--lazy necesita una lista de nombres');
  });
});
