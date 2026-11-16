import { readFile } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import { ToggleServer } from './toggle-server.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Sirve `web/dist` como la imagen `prod` (web/nginx.conf): fallback a index.html y las mismas cabeceras de caché. */
export class StaticServer extends ToggleServer {
  constructor(port: number, root: string) {
    super(port, (req, res) => void serve(root, req, res));
  }
}

async function serve(root: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  // `path.join` + comprobación de prefijo: `/../` no puede salir de `root`.
  let file = path.join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    file = path.join(root, 'index.html'); // try_files $uri /index.html
    body = await readFile(file);
  }
  const noCache = /^(sw|sync)\.js$|^index\.html$/.test(path.basename(file));
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=31536000',
  });
  res.end(body);
}
