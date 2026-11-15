// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://civicguard.test';
const source = readFileSync(resolve(import.meta.dirname, '../public/sw.js'), 'utf8');

type Handler = (event: object) => void;
type FakeRequest = { method: string; url: string; mode: string; destination: string };

const pathOf = (input: string | { url: string }) =>
  new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname;
const request = (url: string, method = 'GET', mode = 'cors', destination = ''): FakeRequest => ({
  method,
  url: url.startsWith('http') ? url : `${ORIGIN}${url}`,
  mode,
  destination,
});

// Ejecuta public/sw.js en un sandbox con una Cache API y una red simuladas, y expone sus manejadores.
function loadServiceWorker({ missing = [] as string[] } = {}) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  let offline = false;
  const served = new Map<string, string>(); // contenido que la red «publica» para una ruta
  const network = vi.fn<(input: string | FakeRequest, init?: RequestInit) => Promise<Response>>(
    async (input) => {
      if (offline) throw new TypeError('Failed to fetch');
      const path = pathOf(input);
      if (missing.includes(path)) return new Response('', { status: 404 });
      return new Response(served.get(path) ?? `red ${path}`);
    },
  );
  const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;

  // Como la Cache API real, `match` entrega una copia nueva de la respuesta guardada (su cuerpo se lee una vez).
  const caches = {
    open: async (name: string) => ({
      // Igual que la Cache API real: si algún archivo falla, addAll rechaza y no guarda nada.
      addAll: async (requests: Request[]) => {
        const responses = await Promise.all(requests.map((r) => network(r)));
        if (responses.some((r) => !r.ok)) throw new TypeError('addAll: respuesta no válida');
        requests.forEach((r, i) => store(name).set(pathOf(r), responses[i]));
      },
      match: async (input: FakeRequest) => store(name).get(pathOf(input))?.clone(),
      put: async (input: FakeRequest, response: Response) => {
        store(name).set(pathOf(input), response);
      },
    }),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (input: string | FakeRequest, options: { cacheName: string }) =>
      stores.get(options.cacheName)?.get(pathOf(input))?.clone(),
  };

  // Dentro de un SW las URL relativas se resuelven contra su propio origen.
  class SWRequest extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, ORIGIN), init);
    }
  }

  const self = {
    addEventListener: (type: string, handler: Handler) => (handlers[type] = handler),
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const importScripts = vi.fn();
  runInNewContext(source, { self, caches, fetch: network, Request: SWRequest, URL, importScripts });

  // Entrega un evento con waitUntil y espera a que termine lo que el SW dejó pendiente.
  const run = async (type: 'install' | 'activate') => {
    const pending: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  };
  const fetchEvent = (req: FakeRequest) => {
    const respondWith = vi.fn();
    const background: Promise<unknown>[] = [];
    handlers.fetch({
      request: req,
      respondWith,
      waitUntil: (p: Promise<unknown>) => background.push(p),
    });
    return {
      respondWith,
      response: () => respondWith.mock.calls[0][0] as Promise<Response>,
      // Espera el trabajo que el SW dejó en segundo plano (la revalidación) con waitUntil.
      settled: () => Promise.all(background),
    };
  };
  const currentCache = () => [...stores.keys()].find((name) => /^civicguard-shell-v.+/.test(name))!;

  return {
    self,
    importScripts,
    stores,
    store,
    network,
    serve: (path: string, body: string) => served.set(path, body),
    run,
    fetchEvent,
    currentCache,
    message: (data: unknown) => handlers.message({ data }),
    goOffline: () => (offline = true),
  };
}

describe('envío de reportes (public/sync.js)', () => {
  it('carga sync.js con importScripts al arrancar, para que el SW atienda sync y FLUSH_OUTBOX', () => {
    const sw = loadServiceWorker();

    expect(sw.importScripts).toHaveBeenCalledExactlyOnceWith('/sync.js');
  });
});

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

describe('fetch: imágenes y fuentes estáticas (Stale-While-Revalidate)', () => {
  const asset = (path: string, destination = 'image') =>
    request(path, 'GET', 'no-cors', destination);

  it.each([
    ['image', '/img/logo.png'],
    ['font', '/fonts/inter.woff2'],
  ])(
    '%s: la primera visita va a la red y la segunda, sin red, sale de la caché',
    async (destination, path) => {
      const sw = loadServiceWorker();
      await sw.run('install');

      const first = sw.fetchEvent(asset(path, destination));
      expect(await (await first.response()).text()).toBe(`red ${path}`);
      sw.goOffline();
      const second = sw.fetchEvent(asset(path, destination));

      expect(await (await second.response()).text()).toBe(`red ${path}`);
      await second.settled(); // la revalidación fallida en segundo plano no debe lanzar
    },
  );

  it('responde al instante con la copia guardada y la actualiza en segundo plano para la próxima visita', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.store(sw.currentCache()).set('/img/logo.png', new Response('copia vieja'));
    sw.serve('/img/logo.png', 'copia nueva');

    const first = sw.fetchEvent(asset('/img/logo.png'));
    expect(await (await first.response()).text()).toBe('copia vieja');
    await first.settled();
    const second = sw.fetchEvent(asset('/img/logo.png'));

    expect(await (await second.response()).text()).toBe('copia nueva');
  });

  it('revalida contra el servidor y no contra la caché HTTP del navegador', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.network.mockClear();

    const event = sw.fetchEvent(asset('/img/logo.png'));
    await event.response();

    expect(sw.network.mock.calls[0][1]).toEqual({ cache: 'no-cache' });
  });

  it('sin copia guardada y sin red falla como cualquier error de red', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.goOffline();

    await expect(sw.fetchEvent(asset('/img/logo.png')).response()).rejects.toThrow(
      'Failed to fetch',
    );
  });

  it('una imagen precacheada en el shell se sigue sirviendo sin red', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.store(sw.currentCache()).set('/icons/icon-192.png', new Response('ícono'));
    sw.goOffline();

    const event = sw.fetchEvent(asset('/icons/icon-192.png'));

    expect(await (await event.response()).text()).toBe('ícono');
    await event.settled();
  });

  it('no guarda una respuesta que no es 200 ni deja que pise una copia buena', async () => {
    const sw = loadServiceWorker({ missing: ['/img/logo.png', '/img/nuevo.png'] });
    await sw.run('install');
    sw.store(sw.currentCache()).set('/img/logo.png', new Response('copia buena'));

    const withCopy = sw.fetchEvent(asset('/img/logo.png'));
    expect(await (await withCopy.response()).text()).toBe('copia buena');
    await withCopy.settled();
    const withoutCopy = sw.fetchEvent(asset('/img/nuevo.png'));
    expect((await withoutCopy.response()).status).toBe(404);

    expect(await (await sw.fetchEvent(asset('/img/logo.png')).response()).text()).toBe(
      'copia buena',
    );
    expect([...sw.store(sw.currentCache()).keys()]).not.toContain('/img/nuevo.png');
  });

  it('no toca /api/*: ni una imagen de la API se guarda', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    const before = [...sw.store(sw.currentCache()).keys()];

    const event = sw.fetchEvent(asset('/api/incidents/42/photo'));

    expect(await (await event.response()).text()).toBe('red /api/incidents/42/photo');
    await event.settled();
    expect([...sw.store(sw.currentCache()).keys()]).toEqual(before);
  });

  it.each([
    ['un script', request('/assets/app.js', 'GET', 'cors', 'script')],
    ['una petición de datos', request('/api/incidents', 'GET', 'cors', '')],
    ['una imagen de otro origen', asset('https://cdn.example/logo.png')],
  ])('no guarda %s', async (_name, req) => {
    const sw = loadServiceWorker();
    await sw.run('install');
    const before = [...sw.store(sw.currentCache()).keys()];

    const event = sw.fetchEvent(req);
    await event.response();
    await event.settled();

    expect([...sw.store(sw.currentCache()).keys()]).toEqual(before);
  });

  it('las copias viven en la caché de la versión y se borran con ella al activarse otra', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    await sw.fetchEvent(asset('/img/logo.png')).response();
    const current = sw.currentCache();
    expect([...sw.store(current).keys()]).toContain('/img/logo.png');
    sw.store('civicguard-shell-v0').set('/img/logo.png', new Response('build anterior'));

    await sw.run('activate');

    expect([...sw.stores.keys()]).toEqual([current]);
  });
});
