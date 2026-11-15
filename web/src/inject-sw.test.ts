// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../scripts/inject-sw.mjs');
const swSource = readFileSync(resolve(import.meta.dirname, '../public/sw.js'), 'utf8');

// Un dist/ mínimo con una subcarpeta, como el que deja `vite build`.
const BUILD = {
  'index.html': '<html></html>',
  'manifest.json': '{}',
  'offline.html': 'sin conexión',
  'assets/index-AAA.js': 'console.log(1)',
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Crea un dist/ temporal; `sw` = null lo deja sin sw.js.
function makeDist(files: Record<string, string> = BUILD, sw: string | null = swSource) {
  const dist = mkdtempSync(join(tmpdir(), 'inject-sw-'));
  dirs.push(dist);
  for (const [path, content] of Object.entries(sw === null ? files : { ...files, 'sw.js': sw })) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  }
  return dist;
}

const inject = (dist: string) => spawnSync(process.execPath, [script, dist], { encoding: 'utf8' });
const readSw = (dist: string) => readFileSync(join(dist, 'sw.js'), 'utf8');

type Handler = (event: { waitUntil: (promise: Promise<unknown>) => void }) => void;

// Evalúa el sw.js inyectado y devuelve su caché, su precaché y una forma de lanzar `activate`.
function loadSw(dist: string, caches: object = {}) {
  const handlers: Record<string, Handler> = {};
  const self = {
    addEventListener: (type: string, handler: Handler) => (handlers[type] = handler),
    clients: { claim: async () => undefined },
  };
  const [cache, precache] = JSON.parse(
    runInNewContext(`${readSw(dist)};JSON.stringify([CACHE, PRECACHE])`, {
      self,
      caches,
      importScripts: () => undefined, // sync.js se prueba aparte (sync.test.ts)
    }),
  ) as [string, string[]];
  const activate = async () => {
    const pending: Promise<unknown>[] = [];
    handlers.activate({ waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  };
  return { cache, precache, activate };
}

// Un build completo: dist/ + inject-sw.
function build(files: Record<string, string> = BUILD) {
  const dist = makeDist(files);
  expect(inject(dist).status).toBe(0);
  return dist;
}
const versionOf = (files: Record<string, string>) => loadSw(build(files)).cache;

describe('inject-sw: sustitución en dist/sw.js', () => {
  it('escribe la lista real de archivos de dist/ y la caché civicguard-shell-v<hash>', () => {
    const dist = makeDist();
    const result = inject(dist);

    expect(result.status).toBe(0);
    const { cache, precache } = loadSw(dist);
    expect(cache).toMatch(/^civicguard-shell-v[0-9a-f]{12}$/);
    // Recursivo, ordenado, con «/» para el shell y sin el propio sw.js.
    expect(precache).toEqual([
      '/',
      '/assets/index-AAA.js',
      '/index.html',
      '/manifest.json',
      '/offline.html',
    ]);
    expect(result.stdout).toContain(cache);
  });

  it('solo cambia las dos constantes: el resto de sw.js queda igual', () => {
    const dist = makeDist();
    inject(dist);

    const lines = (text: string) =>
      text.split('\n').filter((line) => !/^const (VERSION|PRECACHE) /.test(line));
    expect(lines(readSw(dist))).toEqual(lines(swSource));
  });

  it('es idempotente: correrlo dos veces sobre el mismo dist/ da el mismo resultado', () => {
    const dist = makeDist();
    inject(dist);
    const first = readSw(dist);

    expect(inject(dist).status).toBe(0);
    expect(readSw(dist)).toBe(first);
  });
});

describe('inject-sw: versión', () => {
  it('el mismo contenido da el mismo nombre de caché, aunque sea otro directorio', () => {
    expect(versionOf(BUILD)).toBe(versionOf({ ...BUILD }));
  });

  it('un cambio de código entre dos builds da otro nombre de caché', () => {
    expect(versionOf({ ...BUILD, 'assets/index-AAA.js': 'console.log(2)' })).not.toBe(
      versionOf(BUILD),
    );
  });

  it.each([
    ['cambia un archivo sin hash en el nombre', { ...BUILD, 'manifest.json': '{"name":"x"}' }],
    ['se agrega un archivo', { ...BUILD, 'icons/icon.png': 'png' }],
  ])('cambia cuando %s', (_name, files) => {
    expect(versionOf(files)).not.toBe(versionOf(BUILD));
  });

  it('cambia cuando se renombra un archivo con el mismo contenido', () => {
    const { 'assets/index-AAA.js': code, ...rest } = BUILD;

    expect(versionOf({ ...rest, 'assets/index-BBB.js': code })).not.toBe(versionOf(BUILD));
  });

  it('el SW del build nuevo borra la caché del anterior al activarse y respeta las ajenas', async () => {
    const before = loadSw(build());
    const next = build({ ...BUILD, 'assets/index-AAA.js': 'console.log(2)' });
    const deleted: string[] = [];
    const caches = {
      keys: async () => [before.cache, loadSw(next).cache, 'civicguard-datos'],
      delete: async (key: string) => deleted.push(key),
    };

    await loadSw(next, caches).activate();

    expect(deleted).toEqual([before.cache]);
  });
});

describe('inject-sw: errores (código de salida distinto de 0)', () => {
  it('si dist/ no existe', () => {
    const result = inject(join(tmpdir(), 'inject-sw-no-existe'));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('inject-sw: no existe');
  });

  it('si dist/ no tiene sw.js', () => {
    const result = inject(makeDist(BUILD, null));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('sw.js');
  });

  it.each([
    ['VERSION', "const PRECACHE = ['/'];"],
    ['PRECACHE', "const VERSION = '1';"],
  ])('si a sw.js le falta la constante %s, y no lo modifica', (name, content) => {
    const dist = makeDist(BUILD, content);
    const result = inject(dist);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`const ${name}`);
    expect(readSw(dist)).toBe(content);
  });
});
