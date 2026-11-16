import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerIncident } from '../modules/reports';
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

function submitLogin() {
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'coord@civicguard.test' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'una-clave-larga' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

async function signIn() {
  submitLogin();
  await screen.findByRole('combobox', { name: 'Estatus' });
}

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

describe('Panel sin sesión', () => {
  it('solo muestra el login: ningún reporte ni llamada a la API de administración', async () => {
    render(<Panel />);

    expect(screen.getByLabelText('Correo')).toBeTruthy();
    expect(screen.getByLabelText('Contraseña')).toHaveProperty('type', 'password');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/Descripción de/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, /Correo o contraseña incorrectos/],
    [429, /Demasiados intentos/],
    [503, /no está disponible/],
  ])(
    'con una respuesta %i del login muestra el motivo, limpia la contraseña y sigue en el login',
    async (status, message) => {
      api({ loginStatus: status });
      render(<Panel />);
      fireEvent.change(screen.getByLabelText('Correo'), {
        target: { value: 'coord@civicguard.test' },
      });
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'mala-clave' } });
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

      expect(((await screen.findByRole('alert')) as HTMLElement).textContent).toMatch(message);
      expect((screen.getByLabelText('Contraseña') as HTMLInputElement).value).toBe('');
      expect(screen.queryByText(/Descripción de/)).toBeNull();
      expect(callsTo('/api/admin')).toHaveLength(0);
    },
  );

  it('sin red lo dice con claridad en vez de dejar la pantalla vacía', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Panel />);
    fireEvent.change(screen.getByLabelText('Correo'), {
      target: { value: 'coord@civicguard.test' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'una-clave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(((await screen.findByRole('alert')) as HTMLElement).textContent).toMatch(
      /Sin conexión.*necesita internet/,
    );
  });
});

describe('Panel con sesión', () => {
  it('entra, lista los reportes con el token en memoria y no escribe nada en localStorage ni sessionStorage', async () => {
    // `Storage` es el prototipo de ambos: ESLint prohíbe nombrarlos, y así se comprueba que ninguno recibe el token.
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<Panel />);
    await signIn();

    expect(await screen.findByText('Descripción de uno')).toBeTruthy();
    expect(screen.getByText('Descripción de dos')).toBeTruthy();
    const [url, init] = callsTo('/api/admin/incidents')[0];
    expect(String(url)).toBe('https://api.civicguard.test/api/admin/incidents');
    expect(init?.headers).toEqual({ Authorization: 'Bearer jwt-de-prueba' });
    expect(write).not.toHaveBeenCalled();
  });

  it('cerrar sesión vuelve al login y no deja reportes a la vista', async () => {
    render(<Panel />);
    await signIn();
    await screen.findByText('Descripción de uno');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
    expect(screen.queryByText(/Descripción de/)).toBeNull();
  });

  it('un 401 en la lista devuelve al login con el aviso de sesión vencida', async () => {
    render(<Panel />);
    fetchMock.mockImplementation(async (input) =>
      new URL(String(input)).pathname === '/api/auth/login'
        ? Response.json({ access_token: 'jwt-vencido' })
        : new Response(null, { status: 401 }),
    );
    submitLogin();

    expect(await screen.findByText(/Tu sesión venció/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
    expect(screen.queryByText(/Descripción de/)).toBeNull();
  });

  it('filtra por estatus pidiendo ese estatus a la API', async () => {
    render(<Panel />);
    await signIn();
    await screen.findByText('Descripción de uno');

    fireEvent.change(screen.getByLabelText('Estatus'), { target: { value: 'en_revision' } });

    await waitFor(() => expect(screen.queryByText('Descripción de uno')).toBeNull());
    expect(screen.getByText('Descripción de dos')).toBeTruthy();
    expect(String(callsTo('/api/admin/incidents').at(-1)![0])).toMatch(/\?status=en_revision$/);
    const options = within(screen.getByLabelText('Estatus')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Todos',
      'Recibido',
      'En revisión',
      'En atención',
      'Resuelto',
    ]);
  });

  it('sin reportes en un filtro lo dice', async () => {
    render(<Panel />);
    await signIn();
    fireEvent.change(screen.getByLabelText('Estatus'), { target: { value: 'resuelto' } });

    expect(await screen.findByText(/No hay reportes con estatus «Resuelto»/)).toBeTruthy();
  });

  it('si falla la lista muestra el motivo y deja reintentar', async () => {
    render(<Panel />);
    await signIn();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.change(screen.getByLabelText('Estatus'), { target: { value: 'recibido' } });

    expect(((await screen.findByRole('alert')) as HTMLElement).textContent).toMatch(/Sin conexión/);

    api();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Descripción de uno')).toBeTruthy();
  });
});

describe('Detalle del reporte en el panel', () => {
  async function openDetail(text: string) {
    render(<Panel />);
    await signIn();
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

  it('cambiar el estatus pide confirmación, hace el PATCH y la lista refleja el estatus nuevo', async () => {
    await openDetail('Descripción de uno');
    const change = screen.getByRole('button', { name: 'Cambiar estatus' });
    expect(change).toHaveProperty('disabled', true); // el estatus nuevo es igual al actual

    fireEvent.change(screen.getByLabelText('Nuevo estatus'), { target: { value: 'en_atencion' } });
    fireEvent.click(change);
    expect(screen.getByText(/¿Cambiar el estatus a «En atención»\?/)).toBeTruthy();
    expect(callsTo('/api/admin/incidents/uno')).toHaveLength(0); // todavía no se ejecutó

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Estatus actualizado a «En atención».')).toBeTruthy();

    const [url, init] = callsTo('/api/admin/incidents/uno')[0];
    expect(String(url)).toBe('https://api.civicguard.test/api/admin/incidents/uno/status');
    expect(init).toMatchObject({
      method: 'PATCH',
      headers: { Authorization: 'Bearer jwt-de-prueba' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'en_atencion' });

    fireEvent.click(screen.getByRole('button', { name: '← Volver a la lista' }));
    const card = (await screen.findByText('Descripción de uno')).closest('button')!;
    expect(card.textContent).toContain('Estatus: En atención');
  });

  it('cancelar la confirmación no cambia nada', async () => {
    await openDetail('Descripción de uno');
    fireEvent.change(screen.getByLabelText('Nuevo estatus'), { target: { value: 'resuelto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estatus' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
    expect(stored[0].status).toBe('recibido');
    expect(callsTo('/api/admin/incidents/uno')).toHaveLength(0);
  });

  it('si el PATCH falla por red lo avisa y deja el estatus como estaba', async () => {
    await openDetail('Descripción de uno');
    fireEvent.change(screen.getByLabelText('Nuevo estatus'), { target: { value: 'resuelto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estatus' }));
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(((await screen.findByRole('alert')) as HTMLElement).textContent).toMatch(/Sin conexión/);
    expect(stored[0].status).toBe('recibido');
    expect(screen.getByRole('button', { name: 'Cambiar estatus' })).toBeTruthy();
  });

  it('un 401 al cambiar el estatus devuelve al login', async () => {
    await openDetail('Descripción de uno');
    fireEvent.change(screen.getByLabelText('Nuevo estatus'), { target: { value: 'resuelto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estatus' }));
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText(/Tu sesión venció/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
  });
});
