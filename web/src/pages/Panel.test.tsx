import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerIncident } from '../modules/reports';
import { SessionProvider, useSession } from '../app/session';
import Panel from './Panel';

vi.mock('../modules/sync', () => ({ API_URL: 'https://api.civicguard.test' }));

const incident = (id: string, extra: Partial<ServerIncident> = {}): ServerIncident => ({
  id,
  type: 'bache',
  severity: 'alta',
  description: `Descripción de ${id}`,
  lat: 20.9674,
  lng: -89.5926,
  accuracy: 12.4,
  photo_url: `https://storage.civicguard.test/${id}.jpg`,
  status: 'recibido',
  created_at: '2026-11-10T10:00:00.000Z',
  ...extra,
});

const ONE = incident('uno');
const TWO = incident('dos', { type: 'fuga', status: 'en_revision', photo_url: null });

let stored: ServerIncident[];
const fetchMock = vi.fn<typeof fetch>();

// Responde como la API: login, lista (con filtro) y cambio de estatus.
function api({ loginStatus = 200 }: { loginStatus?: number } = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/auth/login') {
      return loginStatus === 200
        ? Response.json({ access_token: 'jwt-de-prueba' })
        : new Response(null, { status: loginStatus });
    }
    if (url.pathname === '/api/admin/incidents') {
      const status = url.searchParams.get('status');
      return Response.json(stored.filter((row) => !status || row.status === status));
    }
    const patch = url.pathname.match(/^\/api\/admin\/incidents\/(.+)\/status$/);
    if (patch && init?.method === 'PATCH') {
      const row = stored.find((item) => item.id === patch[1])!;
      row.status = JSON.parse(String(init.body)).status;
      return Response.json(row);
    }
    return new Response(null, { status: 404 });
  });
}

const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname.startsWith(path));

// Muestra el estado de la sesión para comprobar que un 401 la cierra (el panel solo se pinta con sesión).
function SessionProbe() {
  const { profile, token, expired } = useSession();
  return <p data-testid="sesion">{`${profile}|${token}|${expired}`}</p>;
}

const renderPanel = () =>
  render(
    <SessionProvider
      initial={{ profile: 'coordinador', token: 'jwt-de-prueba', email: 'coord@civicguard.test' }}
    >
      <Panel />
      <SessionProbe />
    </SessionProvider>,
  );
const session = () => screen.getByTestId('sesion').textContent;

beforeEach(() => {
  stored = [{ ...ONE }, { ...TWO }];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  api();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const filterButton = (name: string) => screen.getByRole('button', { name });

describe('Panel con sesión', () => {
  it('lista los reportes con el token en memoria y no escribe nada en localStorage ni sessionStorage', async () => {
    // `Storage` es el prototipo de ambos: ESLint prohíbe nombrarlos, y así se comprueba que ninguno recibe el token.
    const write = vi.spyOn(Storage.prototype, 'setItem');
    renderPanel();

    expect(await screen.findByText('Descripción de uno')).toBeTruthy();
    expect(screen.getByText('Descripción de dos')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Panel del coordinador', level: 2 })).toBeTruthy();
    const [url, init] = callsTo('/api/admin/incidents')[0];
    expect(String(url)).toBe('https://api.civicguard.test/api/admin/incidents');
    expect(init?.headers).toEqual({ Authorization: 'Bearer jwt-de-prueba' });
    expect(write).not.toHaveBeenCalled();
  });

  it('un 401 en la lista cierra la sesión (el acceso explicará que venció) y no deja reportes a la vista', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    renderPanel();

    await waitFor(() => expect(session()).toBe('null|null|true'));
    expect(screen.queryByText(/Descripción de/)).toBeNull();
  });

  it('filtra por estatus con botones y pide ese estatus a la API', async () => {
    renderPanel();
    await screen.findByText('Descripción de uno');
    expect(filterButton('Todos').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(filterButton('En revisión'));

    await waitFor(() => expect(screen.queryByText('Descripción de uno')).toBeNull());
    expect(screen.getByText('Descripción de dos')).toBeTruthy();
    expect(String(callsTo('/api/admin/incidents').at(-1)![0])).toMatch(/\?status=en_revision$/);
    expect(filterButton('En revisión').getAttribute('aria-pressed')).toBe('true');
    expect(filterButton('Todos').getAttribute('aria-pressed')).toBe('false');
    const group = screen.getByRole('group', { name: 'Filtrar por estatus' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Todos', 'Recibido', 'En revisión', 'En atención', 'Resuelto']);
  });

  it('sin reportes en un filtro lo dice', async () => {
    renderPanel();
    await screen.findByText('Descripción de uno');

    fireEvent.click(filterButton('Resuelto'));

    expect(await screen.findByText(/No hay reportes con estatus «Resuelto»/)).toBeTruthy();
  });

  it('si falla la lista muestra el motivo y deja reintentar', async () => {
    renderPanel();
    await screen.findByText('Descripción de uno');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.click(filterButton('Recibido'));

    expect(((await screen.findByRole('alert')) as HTMLElement).textContent).toMatch(/Sin conexión/);

    api();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Descripción de uno')).toBeTruthy();
  });
});

describe('Detalle del reporte en el panel', () => {
  async function openDetail(text: string) {
    renderPanel();
    fireEvent.click(await screen.findByText(text));
    await screen.findByRole('heading', { name: 'Detalle del reporte' });
  }

  it('muestra la foto, los datos y un mapa estático con la ubicación', async () => {
    await openDetail('Descripción de uno');

    expect(screen.getByRole('img', { name: 'Foto de evidencia del reporte' })).toHaveProperty(
      'src',
      'https://storage.civicguard.test/uno.jpg',
    );
    expect(screen.getByText(/Lat 20.967400, Lng -89.592600 \(±12 m\)/)).toBeTruthy();
    const map = screen.getByRole('img', { name: 'Mapa con la ubicación del reporte' });
    const tiles = [...map.querySelectorAll('img')].map((tile) => tile.getAttribute('src'));
    expect(tiles).toHaveLength(9);
    expect(tiles).toContain('https://tile.openstreetmap.org/16/16458/28862.png'); // la del punto, al centro
    expect(screen.getByText(/colaboradores de OpenStreetMap/)).toBeTruthy();
  });

  it('un reporte sin foto lo dice', async () => {
    await openDetail('Descripción de dos');

    expect(screen.getByText('Este reporte no tiene foto.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Foto de evidencia del reporte' })).toBeNull();
  });

  it('cambiar el estatus pide confirmación en un diálogo, hace el PATCH y la lista refleja el estatus nuevo', async () => {
    await openDetail('Descripción de uno');
    const change = screen.getByRole('button', { name: 'Cambiar estatus' });
    expect(change).toHaveProperty('disabled', true); // el estatus nuevo es igual al actual

    fireEvent.change(screen.getByLabelText('Nuevo estatus'), { target: { value: 'en_atencion' } });
    fireEvent.click(change);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/¿Cambiar el estatus a «En atención»\?/)).toBeTruthy();
    expect(callsTo('/api/admin/incidents/uno')).toHaveLength(0); // todavía no se ejecutó

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Estatus actualizado a «En atención».')).toBeTruthy();

    const [url, init] = callsTo('/api/admin/incidents/uno')[0];
    expect(String(url)).toBe('https://api.civicguard.test/api/admin/incidents/uno/status');
    expect(init).toMatchObject({
      method: 'PATCH',
      headers: { Authorization: 'Bearer jwt-de-prueba' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'en_atencion' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Volver a la lista' }));
    const card = (await screen.findByText('Descripción de uno')).closest('button')!;
    expect(card.textContent).toContain('En atención');
  });

  it('cancelar la confirmación no cambia nada', async () => {
    await openDetail('Descripción de uno');
    fireEvent.change(screen.getByLabelText('Nuevo estatus'), { target: { value: 'resuelto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estatus' }));

    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }),
    );

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(stored[0].status).toBe('recibido');
    expect(callsTo('/api/admin/incidents/uno')).toHaveLength(0);
  });

  it('si el PATCH falla por red lo avisa y deja el estatus como estaba', async () => {
    await openDetail('Descripción de uno');
    fireEvent.change(screen.getByLabelText('Nuevo estatus'), { target: { value: 'resuelto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estatus' }));
    const dialog = await screen.findByRole('alertdialog');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(((await screen.findByRole('alert')) as HTMLElement).textContent).toMatch(/Sin conexión/);
    expect(stored[0].status).toBe('recibido');
    expect(screen.getByRole('button', { name: 'Cambiar estatus' })).toBeTruthy();
  });

  it('un 401 al cambiar el estatus cierra la sesión', async () => {
    await openDetail('Descripción de uno');
    fireEvent.change(screen.getByLabelText('Nuevo estatus'), { target: { value: 'resuelto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estatus' }));
    const dialog = await screen.findByRole('alertdialog');
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(session()).toBe('null|null|true'));
  });
});
