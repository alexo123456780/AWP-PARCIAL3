// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://civicguard.test';
const source = readFileSync(resolve(import.meta.dirname, '../public/sw.js'), 'utf8');

type Handler = (event: object) => void;
type FakeRequest = { method: string; url: string; mode: string };

const pathOf = (input: string | { url: string }) =>
  new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname;
const request = (url: string, method = 'GET', mode = 'cors'): FakeRequest => ({
  method,
  url: `${ORIGIN}${url}`,
  mode,
});

// Ejecuta public/sw.js en un sandbox con una Cache API y una red simuladas, y expone sus manejadores.
function loadServiceWorker({ missing = [] as string[] } = {}) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  let offline = false;
  const network = vi.fn(async (input: string | FakeRequest) => {
    if (offline) throw new TypeError('Failed to fetch');
    const path = pathOf(input);
    return missing.includes(path) ? new Response('', { status: 404 }) : new Response(`red ${path}`);
  });
  const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;

  const caches = {
    open: async (name: string) => ({
      // Igual que la Cache API real: si algún archivo falla, addAll rechaza y no guarda nada.
      addAll: async (requests: Request[]) => {
        const responses = await Promise.all(requests.map((r) => network(r)));
        if (responses.some((r) => !r.ok)) throw new TypeError('addAll: respuesta no válida');
        requests.forEach((r, i) => store(name).set(pathOf(r), responses[i]));
      },
    }),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (input: string | FakeRequest, options: { cacheName: string }) =>
      stores.get(options.cacheName)?.get(pathOf(input)),
  };

  // Dentro de un SW las URL relativas se resuelven contra su propio origen.
  class SWRequest extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, ORIGIN), init);
    }
  }

  const self = {
    addEventListener: (type: string, handler: Handler) => (handlers[type] = handler),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  runInNewContext(source, { self, caches, fetch: network, Request: SWRequest });

  // Entrega un evento con waitUntil y espera a que termine lo que el SW dejó pendiente.
  const run = async (type: 'install' | 'activate') => {
    const pending: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  };
  const fetchEvent = (req: FakeRequest) => {
    const respondWith = vi.fn();
    handlers.fetch({ request: req, respondWith });
    return { respondWith, response: () => respondWith.mock.calls[0][0] as Promise<Response> };
  };
  const currentCache = () => [...stores.keys()].find((name) => /^civicguard-shell-v.+/.test(name))!;

  return {
    self,
    stores,
    store,
    network,
    run,
    fetchEvent,
    currentCache,
    message: (data: unknown) => handlers.message({ data }),
    goOffline: () => (offline = true),
  };
}

describe('install', () => {
  it('precachea el shell y offline.html en civicguard-shell-vN con la caché HTTP saltada', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');

    expect(sw.currentCache()).toMatch(/^civicguard-shell-v.+/);
    expect([...sw.store(sw.currentCache()).keys()]).toEqual(
      expect.arrayContaining(['/', '/offline.html', '/manifest.json']),
    );
    for (const [req] of sw.network.mock.calls) expect((req as Request).cache).toBe('reload');
  });

  it('no termina si falta un archivo del precaché y no deja una caché a medias', async () => {
    const sw = loadServiceWorker({ missing: ['/offline.html'] });

    await expect(sw.run('install')).rejects.toThrow();
    expect(sw.stores.size).toBe(0);
  });

  it('no llama a skipWaiting: la versión nueva espera', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');

    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
  });
});

describe('activate', () => {
  it('borra las cachés civicguard-shell-v* de otras versiones, respeta las demás y reclama clientes', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    const current = sw.currentCache();
    sw.store('civicguard-shell-v0');
    sw.store('civicguard-shell-vabc123');
    sw.store('civicguard-datos');

    await sw.run('activate');

    expect([...sw.stores.keys()].sort()).toEqual([current, 'civicguard-datos'].sort());
    expect(sw.self.clients.claim).toHaveBeenCalledOnce();
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
  });
});

describe('message', () => {
  it('llama a skipWaiting con {type:"SKIP_WAITING"}', () => {
    const sw = loadServiceWorker();
    sw.message({ type: 'SKIP_WAITING' });

    expect(sw.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it.each([
    [undefined],
    [null],
    ['SKIP_WAITING'],
    [{}],
    [{ type: 'OTRO' }],
    [{ type: 'skip_waiting' }],
  ])('ignora el mensaje %j', (data) => {
    const sw = loadServiceWorker();
    sw.message(data);

    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
  });
});

describe('fetch', () => {
  it('responde los GET del shell desde la caché sin ir a la red', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.store(sw.currentCache()).set('/assets/app.js', new Response('desde caché'));
    sw.network.mockClear();

    const { response } = sw.fetchEvent(request('/assets/app.js'));

    expect(await (await response()).text()).toBe('desde caché');
    expect(sw.network).not.toHaveBeenCalled();
  });

  it('va a la red cuando no está en la caché y no guarda nada', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    const before = [...sw.store(sw.currentCache()).keys()];

    const { response } = sw.fetchEvent(request('/api/incidents'));

    expect(await (await response()).text()).toBe('red /api/incidents');
    expect([...sw.store(sw.currentCache()).keys()]).toEqual(before);
  });

  it('solo usa la caché de su versión, no la de otras', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.store('civicguard-shell-v0').set('/viejo.js', new Response('versión vieja'));

    const { response } = sw.fetchEvent(request('/viejo.js'));

    expect(await (await response()).text()).toBe('red /viejo.js');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'no intercepta %s (por ejemplo POST /api/incidents)',
    async (method) => {
      const sw = loadServiceWorker();
      await sw.run('install');
      sw.network.mockClear();

      const { respondWith } = sw.fetchEvent(request('/api/incidents', method));

      expect(respondWith).not.toHaveBeenCalled();
      expect(sw.network).not.toHaveBeenCalled();
    },
  );

  it('una navegación sin red devuelve offline.html precacheada', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.goOffline();

    const { response } = sw.fetchEvent(request('/reportes/42', 'GET', 'navigate'));

    expect(await (await response()).text()).toBe('red /offline.html');
  });

  it('sin red, un recurso que no es navegación falla como cualquier error de red', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.goOffline();

    await expect(sw.fetchEvent(request('/assets/otro.js')).response()).rejects.toThrow(
      'Failed to fetch',
    );
  });
});
