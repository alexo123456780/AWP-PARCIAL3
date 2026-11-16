import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminError,
  describeFailure,
  fetchAdminIncidents,
  login,
  updateIncidentStatus,
} from './admin';

vi.mock('./sync', () => ({ API_URL: 'https://api.civicguard.test' }));

const fetchMock = vi.fn<typeof fetch>();
const failureOf = async (call: Promise<unknown>) =>
  call.then(
    () => undefined,
    (error: unknown) => (error as AdminError).reason,
  );

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('login', () => {
  it('envía las credenciales a POST /api/auth/login y devuelve el JWT', async () => {
    fetchMock.mockResolvedValue(Response.json({ access_token: 'jwt-de-prueba' }));

    await expect(login('coord@civicguard.test', 'clave')).resolves.toBe('jwt-de-prueba');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.civicguard.test/api/auth/login');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'coord@civicguard.test',
      password: 'clave',
    });
  });

  it.each([
    [400, 'invalid-credentials'],
    [401, 'invalid-credentials'],
    [429, 'rate-limited'],
    [503, 'unavailable'],
    [500, 'server'],
  ])('una respuesta %i es «%s»', async (status, reason) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    expect(await failureOf(login('a@b.test', 'x'))).toBe(reason);
  });

  it('sin red es «offline»', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await failureOf(login('a@b.test', 'x'))).toBe('offline');
  });
});

describe('fetchAdminIncidents', () => {
  it('pide los reportes con el token en Authorization y, con filtro, el estatus en la consulta', async () => {
    fetchMock.mockImplementation(async () => Response.json([{ id: 'uno' }]));

    await expect(fetchAdminIncidents('el-token')).resolves.toEqual([{ id: 'uno' }]);
    await fetchAdminIncidents('el-token', 'en_revision');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.civicguard.test/api/admin/incidents');
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.civicguard.test/api/admin/incidents?status=en_revision',
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer el-token' });
  });

  it('un 401 es «unauthorized» (hay que volver al login) y un 5xx es «server»', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    expect(await failureOf(fetchAdminIncidents('vencido'))).toBe('unauthorized');
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    expect(await failureOf(fetchAdminIncidents('t'))).toBe('server');
  });
});

describe('updateIncidentStatus', () => {
  it('manda PATCH /api/admin/incidents/:id/status con el estatus y devuelve el reporte', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'abc', status: 'resuelto' }));

    await expect(updateIncidentStatus('t', 'abc', 'resuelto')).resolves.toEqual({
      id: 'abc',
      status: 'resuelto',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.civicguard.test/api/admin/incidents/abc/status');
    expect(init).toMatchObject({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'resuelto' });
  });
});

describe('describeFailure', () => {
  it('da un mensaje en español por motivo y uno genérico para un error desconocido', () => {
    expect(describeFailure(new AdminError('offline'))).toMatch(/necesita internet/);
    expect(describeFailure(new AdminError('unauthorized'))).toMatch(/sesión venció/);
    expect(describeFailure(new Error('raro'))).toMatch(/Algo salió mal/);
  });
});
