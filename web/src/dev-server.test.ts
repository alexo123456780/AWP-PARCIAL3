// @vitest-environment node
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NGROK = 'demo-civicguard.ngrok-free.app';
let server: ViteDevServer;
let port: number;

// Node permite fijar la cabecera Host (fetch no), que es lo que cambia al entrar por el túnel.
const get = (path: string, host: string) =>
  new Promise<{ status: number; cacheControl?: string | string[] }>((done, fail) => {
    request({ port, path, headers: { host } }, (res) => {
      res.resume();
      done({ status: res.statusCode ?? 0, cacheControl: res.headers['cache-control'] });
    })
      .on('error', fail)
      .end();
  });

beforeAll(async () => {
  process.env.NGROK_DOMAIN = NGROK;
  server = await createServer({
    configFile: 'vite.config.ts',
    server: { port: 0 },
    logLevel: 'silent',
  });
  await server.listen();
  port = (server.httpServer!.address() as AddressInfo).port;
});

afterAll(async () => {
  delete process.env.NGROK_DOMAIN;
  await server.close();
});

describe('servidor de desarrollo (SCRUM-141)', () => {
  it.each(['/', '/src/app/main.tsx', '/manifest.json', '/src/shell.css'])(
    '%s responde Cache-Control: no-store',
    async (path) => {
      const res = await get(path, `localhost:${port}`);
      expect(res.status).toBe(200);
      expect(res.cacheControl).toBe('no-store');
    },
  );

  it('acepta el dominio de ngrok en server.allowedHosts', async () => {
    expect(server.config.server.allowedHosts).toContain(NGROK);
    expect((await get('/', NGROK)).status).toBe(200);
  });

  it('rechaza cualquier otro Host', async () => {
    expect((await get('/', 'otro-dominio.ngrok-free.app')).status).toBe(403);
  });
});
