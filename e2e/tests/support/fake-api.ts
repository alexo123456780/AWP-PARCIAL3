import type http from 'node:http';
import { Readable } from 'node:stream';
import { APP_ORIGIN } from './ports.js';
import { ToggleServer } from './toggle-server.js';

export interface StoredIncident {
  id: string;
  reporter_id: string;
  type: string;
  severity: string;
  description: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  status: 'recibido' | 'en_revision' | 'en_atencion' | 'resuelto';
  created_at: string;
  /** URL pública de la foto (en la API real la pone el almacenamiento); los reportes del panel la traen sembrada. */
  photo_url?: string | null;
  /** Lo que llegó en la parte `photo`: el contenido real, no solo que existiera. */
  photo: { mimeType: string; bytes: number; isJpeg: boolean };
}

export interface StoredSubscription {
  reporter_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** El coordinador de prueba: solo existe en este doble, no es ninguna credencial real. */
export const COORDINATOR = {
  email: 'coordinador@civicguard.test',
  password: 'clave-de-prueba-e2e',
};
const COORDINATOR_TOKEN = 'jwt-de-prueba-e2e';

/** Clave pública VAPID de mentira (87 caracteres base64url): el navegador de prueba no suscribe de verdad. */
export const FAKE_VAPID_PUBLIC_KEY = 'B'.repeat(87);

/**
 * Doble de la API de `api/src/incidents` (mismo contrato: multipart a `POST /api/incidents`, 201 también al reintento
 * de un id ya guardado). Es un doble: la idempotencia real (`ON CONFLICT DO NOTHING`) la cubren las pruebas de `api/`.
 */
export class FakeApi extends ToggleServer {
  /** La «tabla incidents»: `id` es su clave primaria. */
  readonly rows = new Map<string, StoredIncident>();
  /** La tabla `push_subscriptions`: `endpoint` es único (el mismo endpoint dos veces actualiza, no duplica). */
  readonly subscriptions = new Map<string, StoredSubscription>();
  /** Peticiones a `/api/admin/*` con un token válido (el panel no debe hacer ninguna antes de iniciar sesión). */
  adminRequests = 0;
  /** Cada `POST /api/incidents` recibido, incluidos los reintentos de un reporte que ya estaba. */
  posts = 0;

  constructor(port: number) {
    super(port, (req, res) => void this.handle(req, res).catch(() => res.writeHead(500).end()));
  }

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
      // La PWA vive en otro origen (otro puerto): sin esto el navegador descarta la respuesta.
      'Access-Control-Allow-Origin': APP_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    });
    res.end(status === 204 ? undefined : JSON.stringify(body));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'OPTIONS') return this.json(res, 204, null);
    if (url.pathname === '/api/health') return this.json(res, 200, { status: 'ok' });

    if (req.method === 'POST' && url.pathname === '/api/incidents') {
      this.posts += 1;
      const form = await new Request(url, {
        method: 'POST',
        headers: req.headers as Record<string, string>,
        body: Readable.toWeb(req) as ReadableStream,
        duplex: 'half',
      } as RequestInit).formData();
      const photo = form.get('photo');
      const id = String(form.get('id') ?? '');
      if (!id || !form.get('reporter_id') || !(photo instanceof File)) {
        return this.json(res, 400, { message: 'Reporte inválido' });
      }
      if (!this.rows.has(id)) {
        const head = new Uint8Array(await photo.slice(0, 3).arrayBuffer());
        this.rows.set(id, {
          id,
          reporter_id: String(form.get('reporter_id')),
          type: String(form.get('type')),
          severity: String(form.get('severity')),
          description: String(form.get('description')),
          lat: Number(form.get('lat')),
          lng: Number(form.get('lng')),
          accuracy: form.has('accuracy') ? Number(form.get('accuracy')) : null,
          status: 'recibido',
          created_at: String(form.get('created_at')),
          photo: {
            mimeType: photo.type,
            bytes: photo.size,
            isJpeg: head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
          },
        });
      }
      return this.json(res, 201, this.rows.get(id));
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = (await new Response(Readable.toWeb(req) as ReadableStream).json()) as {
        email?: string;
        password?: string;
      };
      return body.email === COORDINATOR.email && body.password === COORDINATOR.password
        ? this.json(res, 200, { access_token: COORDINATOR_TOKEN })
        : this.json(res, 401, { message: 'Unauthorized' });
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (req.headers.authorization !== `Bearer ${COORDINATOR_TOKEN}`) {
        return this.json(res, 401, { message: 'Unauthorized' });
      }
      this.adminRequests += 1;
      if (req.method === 'GET' && url.pathname === '/api/admin/incidents') {
        const status = url.searchParams.get('status');
        const rows = [...this.rows.values()]
          .filter((row) => !status || row.status === status)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        return this.json(
          res,
          200,
          rows.map((row) => ({ photo_url: null, ...row })),
        );
      }
      const patch = url.pathname.match(/^\/api\/admin\/incidents\/([^/]+)\/status$/);
      if (req.method === 'PATCH' && patch) {
        const row = this.rows.get(patch[1]);
        if (!row) return this.json(res, 404, { message: 'Reporte no encontrado' });
        row.status = (
          (await new Response(Readable.toWeb(req) as ReadableStream).json()) as {
            status: StoredIncident['status'];
          }
        ).status;
        return this.json(res, 200, { photo_url: null, ...row });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/push/vapid-public-key') {
      return this.json(res, 200, { public_key: FAKE_VAPID_PUBLIC_KEY });
    }
    if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
      const body = (await new Response(
        Readable.toWeb(req) as ReadableStream,
      ).json()) as StoredSubscription;
      this.subscriptions.set(body.endpoint, body);
      return this.json(res, 204, null);
    }

    if (req.method === 'GET' && url.pathname === '/api/incidents') {
      const reporter = url.searchParams.get('reporter_id');
      return this.json(
        res,
        200,
        [...this.rows.values()].filter((row) => row.reporter_id === reporter),
      );
    }
    this.json(res, 404, { message: 'No encontrado' });
  }
}
