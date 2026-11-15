// Tras `vite build` (SCRUM-150, R6): escribe en dist/sw.js la lista real de precaché y la versión del build,
// para que cada despliegue invalide las cachés viejas sin mantener listas a mano.
// Uso: node scripts/inject-sw.mjs [dist]  (por defecto, el dist/ de este paquete).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const SW = 'sw.js';
const dist = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'dist'));

function fail(message) {
  process.stderr.write(`inject-sw: ${message}\n`);
  process.exit(1);
}

if (!existsSync(dist)) fail(`no existe ${dist}; ejecuta «vite build» antes.`);
if (!existsSync(join(dist, SW)))
  fail(`no existe ${join(dist, SW)}; ¿está public/${SW} en el build?`);

// sw.js queda fuera del precaché y del hash: se reescribe aquí, y así correr el script dos veces da lo mismo.
// shortcut: un cambio solo en la lógica de sw.js no cambia el nombre de la caché (los archivos cacheados son los
// mismos); el navegador igualmente instala el SW nuevo. Si eso estorba, incluir el sw.js original en el hash.
const files = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join('/'))
  .filter((path) => path !== SW)
  .sort();

// Hash global = hash de «ruta + hash del contenido» de cada archivo: cambia si cambia un archivo, y solo entonces.
const global = createHash('sha256');
for (const path of files) {
  const content = createHash('sha256')
    .update(readFileSync(join(dist, path)))
    .digest('hex');
  global.update(`${path}\0${content}\n`);
}
const version = global.digest('hex').slice(0, 12);
const precache = ['/', ...files.map((path) => `/${path}`)];

// Sustituye la línea `const <name> = ...;` de sw.js; si ya no existe, falla en vez de dejar el SW sin versión.
function replaceConstant(source, name, value) {
  const line = new RegExp(`^const ${name} = .*;$`, 'm');
  if (!line.test(source))
    fail(`${SW} no tiene la línea «const ${name} = ...;» que se debe sustituir.`);
  return source.replace(line, () => `const ${name} = ${JSON.stringify(value)};`);
}

let source = readFileSync(join(dist, SW), 'utf8');
source = replaceConstant(source, 'VERSION', version);
source = replaceConstant(source, 'PRECACHE', precache);
writeFileSync(join(dist, SW), source);

process.stdout.write(
  `inject-sw: civicguard-shell-v${version}, ${precache.length} archivos en el precaché\n`,
);
