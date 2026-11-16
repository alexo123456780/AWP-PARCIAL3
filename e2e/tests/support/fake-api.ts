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
  status: 'recibido';
  created_at: string;
  /** Lo que llegó en la parte `photo`: el contenido real, no solo que existiera. */
  photo: { mimeType: string; bytes: number; isJpeg: boolean };
}

/**
 * Doble de la API de `api/src/incidents` (mismo contrato: multipart a `POST /api/incidents`, 201 también al reintento
 * de un id ya guardado). Es un doble: la idempotencia real (`ON CONFLICT DO NOTHING`) la cubren las pruebas de `api/`.
 */
export class FakeApi extends ToggleServer {
  /** La «tabla incidents»: `id` es su clave primaria. */
  readonly rows = new Map<string, StoredIncident>();
  /** Cada `POST /api/incidents` recibido, incluidos los reintentos de un reporte que ya estaba. */
  posts = 0;

  constructor(port: number) {
    super(port, (req, res) => void this.handle(req, res).catch(() => res.writeHead(500).end()));
  }

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      // La PWA vive en otro origen (otro puerto): sin esto el navegador descarta la respuesta.
      'Access-Control-Allow-Origin': APP_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(body));
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
