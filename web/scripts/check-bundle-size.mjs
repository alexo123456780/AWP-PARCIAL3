// Tras `npm run build` (SCRUM-165, R14): suma el tamaño gzip del JS inicial de dist/ y falla si pasa de 150 KB.
// JS inicial = lo que index.html carga al abrir la app (<script src> y <link rel="modulepreload">); los chunks
// de cada página (React.lazy) se descargan bajo demanda y no cuentan.
// Uso: node scripts/check-bundle-size.mjs [dist]  (por defecto, el dist/ de este paquete).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { gzipSync } from 'node:zlib';

// 1 KB = 1000 bytes, como el «kB» que imprime `vite build`: el criterio más estricto de los dos.
const BUDGET_BYTES = 150 * 1000;
const dist = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'dist'));

function fail(message) {
  process.stderr.write(`check-bundle-size: ${message}\n`);
  process.exit(1);
}

const indexPath = join(dist, 'index.html');
if (!existsSync(indexPath)) fail(`no existe ${indexPath}; ejecuta «npm run build» antes.`);
const html = readFileSync(indexPath, 'utf8');

// shortcut: regex sobre el HTML que emite Vite (una etiqueta por recurso); si algún día index.html lleva scripts
// con otra forma, cambiar a un parser HTML. Si no encuentra ningún script, falla en vez de medir 0 bytes.
const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];
const urls = tags
  .filter((tag) => tag.startsWith('<script') || /\brel="modulepreload"/.test(tag))
  .map((tag) => /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1])
  .filter((url) => url !== undefined && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url));
if (urls.length === 0)
  fail('index.html no carga ningún script local; no hay JS inicial que medir.');

let total = 0;
for (const url of new Set(urls)) {
  const file = join(dist, url);
  if (!existsSync(file)) fail(`index.html referencia ${url}, que no existe en ${dist}.`);
  const bytes = gzipSync(readFileSync(file), { level: 9 }).length;
  total += bytes;
  process.stdout.write(`check-bundle-size: ${url} ${(bytes / 1000).toFixed(2)} KB gzip\n`);
}

const summary = `JS inicial ${(total / 1000).toFixed(2)} KB gzip de ${BUDGET_BYTES / 1000} KB permitidos`;
if (total > BUDGET_BYTES) fail(`${summary}: presupuesto superado.`);
process.stdout.write(`check-bundle-size: ${summary}.\n`);
