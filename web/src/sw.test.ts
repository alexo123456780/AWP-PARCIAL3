// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://civicguard.test';
const source = readFileSync(resolve(import.meta.dirname, '../public/sw.js'), 'utf8');

type Handler = (event: object) => void;
type FakeRequest = {
  method: string;
  url: string;
  mode: string;
  destination: string;
  headers: Headers;
};

// Ruta + query: las lecturas de la API se distinguen por su query (`?reporter_id=`).
const pathOf = (input: string | { url: string }) => {
  const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
  return url.pathname + url.search;
};
const request = (
  url: string,
  method = 'GET',
  mode = 'cors',
  destination = '',
  headers: Record<string, string> = {},
): FakeRequest => ({
  method,
  url: url.startsWith('http') ? url : `${ORIGIN}${url}`,
  mode,
  destination,
  headers: new Headers(headers),
});

// Ejecuta public/sw.js en un sandbox con una Cache API y una red simuladas, y expone sus manejadores.
function loadServiceWorker({ missing = [] as string[] } = {}) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  let offline = false;
  let hanging = false; // red lenta: la petición no responde hasta que se la aborta
  let failCachePut = false;
  const served = new Map<string, string>(); // contenido que la red «publica» para una ruta
  const statuses = new Map<string, number>(); // código HTTP que la red responde para una ruta
  const network = vi.fn<(input: string | FakeRequest, init?: RequestInit) => Promise<Response>>(
    async (input, init) => {
      if (offline) throw new TypeError('Failed to fetch');
      if (hanging) {
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          ),
        );
      }
      const path = pathOf(input);
      if (missing.includes(path)) return new Response('', { status: 404 });
      return new Response(served.get(path) ?? `red ${path}`, { status: statuses.get(path) ?? 200 });
    },
  );
  const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;

  // Como la Cache API real, `match` entrega una copia nueva de la respuesta guardada (su cuerpo se lee una vez).
  const caches = {
    open: async (name: string) => {
      // Como en un navegador, abrir la caché no es instantáneo: la página puede empezar a leer la respuesta antes.
      await new Promise((resolve) => setImmediate(resolve));
      return {
        // Igual que la Cache API real: si algún archivo falla, addAll rechaza y no guarda nada.
        addAll: async (requests: Request[]) => {
          const responses = await Promise.all(requests.map((r) => network(r)));
          if (responses.some((r) => !r.ok)) throw new TypeError('addAll: respuesta no válida');
          requests.forEach((r, i) => store(name).set(pathOf(r), responses[i]));
        },
        match: async (input: FakeRequest) => store(name).get(pathOf(input))?.clone(),
        put: async (input: FakeRequest, response: Response) => {
          if (failCachePut) throw new DOMException('cuota', 'QuotaExceededError');
          store(name).set(pathOf(input), response);
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: vi.fn(
      async (input: string | FakeRequest, options: { cacheName: string; ignoreVary?: boolean }) =>
        stores.get(options.cacheName)?.get(pathOf(input))?.clone(),
    ),
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
  runInNewContext(source, {
    self,
    caches,
    fetch: network,
    Request: SWRequest,
    URL,
    importScripts,
    Response,
    Headers,
    AbortController,
    // Siempre el de globalThis, para que los temporizadores falsos de Vitest también apliquen al SW.
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
  });

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
    cachesMatch: caches.match,
    stores,
    store,
    network,
    serve: (path: string, body: string) => served.set(path, body),
    serveStatus: (path: string, status: number) => statuses.set(path, status),
    goSlow: () => (hanging = true),
    failCachePut: () => (failCachePut = true),
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
  it('busca en el precaché con ignoreVary: un servidor con `Vary: Origin` no debe dejar sin red a los scripts crossorigin', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.store(sw.currentCache()).set('/assets/app.js', new Response('desde caché'));

    await sw.fetchEvent(request('/assets/app.js', 'GET', 'cors', 'script')).response();

    expect(sw.cachesMatch).toHaveBeenCalledWith(expect.anything(), {
      cacheName: sw.currentCache(),
      ignoreVary: true,
    });
  });

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

  it.each(['/', '/reportes', '/reportes/3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b', '/panel'])(
    'una navegación sin red a %s abre el cascarón precacheado, para que la SPA resuelva la ruta',
    async (path) => {
      const sw = loadServiceWorker();
      await sw.run('install');
      sw.goOffline();

      const { response } = sw.fetchEvent(request(path, 'GET', 'navigate'));

      expect(await (await response()).text()).toBe('red /');
    },
  );

  it('una navegación sin red muestra offline.html solo si el cascarón no está en la caché', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    sw.store(sw.currentCache()).delete('/');
    sw.goOffline();

    const { response } = sw.fetchEvent(request('/reportes', 'GET', 'navigate'));

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

describe('fetch: lecturas de la API (Network-First con respaldo)', () => {
  const LIST = '/api/incidents?reporter_id=9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const API_CACHE = 'civicguard-api-v1';
  const read = async (event: ReturnType<ReturnType<typeof loadServiceWorker>['fetchEvent']>) => {
    const response = await event.response();
    await event.settled();
    return response;
  };

  afterEach(() => vi.useRealTimers());

  it('con red responde los datos del servidor y actualiza el respaldo local', async () => {
    const sw = loadServiceWorker();
    sw.serve(LIST, '[{"id":"nuevo"}]');
    sw.store(API_CACHE).set(LIST, new Response('[{"id":"viejo"}]'));

    // La página empieza a leer el cuerpo en cuanto recibe la respuesta; el SW debe haber clonado ANTES de entregarla.
    const event = sw.fetchEvent(request(LIST));
    const response = await event.response();
    const body = await response.text();
    await event.settled();

    expect(body).toBe('[{"id":"nuevo"}]');
    expect(response.headers.get('X-Served-From')).toBeNull();
    expect(await sw.store(API_CACHE).get(LIST)!.text()).toBe('[{"id":"nuevo"}]');
  });

  it('guarda una copia por URL: la lista de otro dispositivo no pisa la de éste', async () => {
    const sw = loadServiceWorker();
    await read(sw.fetchEvent(request(LIST)));
    await read(sw.fetchEvent(request('/api/incidents?reporter_id=otro')));
    await read(sw.fetchEvent(request('/api/incidents/42')));

    expect([...sw.store(API_CACHE).keys()].sort()).toEqual(
      [LIST, '/api/incidents?reporter_id=otro', '/api/incidents/42'].sort(),
    );
  });

  it('sin red responde con el respaldo y lo avisa en X-Served-From', async () => {
    const sw = loadServiceWorker();
    sw.store(API_CACHE).set(LIST, new Response('[{"id":"guardado"}]'));
    sw.goOffline();

    const response = await read(sw.fetchEvent(request(LIST)));

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Served-From')).toBe('cache');
    expect(await response.text()).toBe('[{"id":"guardado"}]');
  });

  it('con red lenta espera hasta 3 s, aborta la petición y responde con el respaldo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sw = loadServiceWorker();
    sw.store(API_CACHE).set(LIST, new Response('[{"id":"guardado"}]'));
    sw.goSlow();
    let settled = false;
    const event = sw.fetchEvent(request(LIST));
    const answer = event.response().then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await answer;

    expect(sw.network.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
    expect(response.headers.get('X-Served-From')).toBe('cache');
    expect(await response.text()).toBe('[{"id":"guardado"}]');
  });

  it('con red rápida no queda ningún temporizador pendiente', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sw = loadServiceWorker();

    await sw.fetchEvent(request(LIST)).response();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('sin red y sin respaldo responde 503 con un JSON que la pantalla puede leer', async () => {
    const sw = loadServiceWorker();
    sw.goOffline();

    const response = await read(sw.fetchEvent(request(LIST)));

    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.json()).toEqual({ message: 'Sin conexión y sin datos guardados' });
  });

  it('un 5xx del servidor cae al respaldo si lo hay; si no, se entrega tal cual', async () => {
    const sw = loadServiceWorker();
    sw.serveStatus(LIST, 502);
    sw.store(API_CACHE).set(LIST, new Response('[{"id":"guardado"}]'));

    const withBackup = await read(sw.fetchEvent(request(LIST)));
    expect(withBackup.status).toBe(200);
    expect(withBackup.headers.get('X-Served-From')).toBe('cache');

    const none = await read(sw.fetchEvent(request('/api/incidents/42')));
    expect(none.status).toBe(200); // otra URL, sin 5xx
    sw.serveStatus('/api/incidents/43', 503);
    const noBackup = await read(sw.fetchEvent(request('/api/incidents/43')));
    expect(noBackup.status).toBe(503);
    expect(noBackup.headers.get('X-Served-From')).toBeNull();
    expect([...sw.store(API_CACHE).keys()]).not.toContain('/api/incidents/43');
  });

  it('un 4xx es una respuesta válida: se entrega, no se guarda y no cae al respaldo', async () => {
    const sw = loadServiceWorker();
    sw.serveStatus('/api/incidents/404', 404);
    sw.store(API_CACHE).set('/api/incidents/404', new Response('copia vieja'));

    const response = await read(sw.fetchEvent(request('/api/incidents/404')));

    expect(response.status).toBe(404);
    expect(await sw.store(API_CACHE).get('/api/incidents/404')!.text()).toBe('copia vieja');
  });

  it('si no se puede guardar el respaldo (cuota) igual entrega la respuesta del servidor', async () => {
    const sw = loadServiceWorker();
    sw.serve(LIST, '[{"id":"nuevo"}]');
    sw.failCachePut();

    const response = await read(sw.fetchEvent(request(LIST)));

    expect(await response.text()).toBe('[{"id":"nuevo"}]');
  });

  it('funciona con una API en otro dominio (Render)', async () => {
    const sw = loadServiceWorker();
    const url = 'https://civicguard-api.example.com/api/incidents?reporter_id=A';
    sw.store(API_CACHE).set('/api/incidents?reporter_id=A', new Response('[{"id":"guardado"}]'));
    sw.goOffline();

    const response = await read(sw.fetchEvent(request(url)));

    expect(await response.text()).toBe('[{"id":"guardado"}]');
  });

  it('POST /api/incidents va solo a la red: ni se intercepta ni se guarda', async () => {
    const sw = loadServiceWorker();
    await read(sw.fetchEvent(request(LIST)));
    const before = [...sw.store(API_CACHE).keys()];

    const event = sw.fetchEvent(request('/api/incidents', 'POST'));

    expect(event.respondWith).not.toHaveBeenCalled();
    expect([...sw.store(API_CACHE).keys()]).toEqual(before);
    expect(sw.network).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['PUT', request('/api/incidents/42', 'PUT')],
    ['PATCH', request('/api/admin/incidents/42/status', 'PATCH')],
  ])('las escrituras (%s) no se interceptan ni se guardan', async (_name, req) => {
    const sw = loadServiceWorker();

    const event = sw.fetchEvent(req);

    expect(event.respondWith).not.toHaveBeenCalled();
    expect(sw.stores.has(API_CACHE)).toBe(false);
  });

  // Estas lecturas NO usan Network-First: aunque hubiera una copia en el respaldo, sin red fallan como cualquier GET
  // (y con red no se guardan).
  it.each([
    ['/api/health (un «ok» guardado mentiría)', request('/api/health')],
    ['/api/docs', request('/api/docs')],
    [
      'una lectura con Authorization (datos del coordinador)',
      request('/api/admin/incidents', 'GET', 'cors', '', { Authorization: 'Bearer abc' }),
    ],
  ])('no usa el respaldo ni lo llena: %s', async (_name, req) => {
    const sw = loadServiceWorker();
    const key = pathOf(req);
    sw.store(API_CACHE).set(key, new Response('copia que no debe servirse'));
    const before = [...sw.store(API_CACHE).keys()];

    await read(sw.fetchEvent(req));
    sw.goOffline();

    await expect(sw.fetchEvent(req).response()).rejects.toThrow('Failed to fetch');
    expect([...sw.store(API_CACHE).keys()]).toEqual(before);
    expect(await sw.store(API_CACHE).get(key)!.text()).toBe('copia que no debe servirse');
  });

  it('el respaldo sobrevive a un build nuevo: activate solo borra las cachés del shell', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    await read(sw.fetchEvent(request(LIST)));
    sw.store('civicguard-shell-v0').set('/viejo', new Response('build anterior'));

    await sw.run('activate');

    expect([...sw.stores.keys()].sort()).toEqual([API_CACHE, sw.currentCache()].sort());
    expect(await sw.store(API_CACHE).get(LIST)!.text()).toBe(`red ${LIST}`);
  });
});
