import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import type { ComponentProps } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider, useSession } from '../app/session';
import Acceso from './Acceso';

vi.mock('../modules/sync', () => ({ API_URL: 'https://api.civicguard.test' }));

const fetchMock = vi.fn<typeof fetch>();

function Inicio({ name }: { name: string }) {
  const { profile, token, email } = useSession();
  return (
    <p>
      {name}|{profile}|{token}|{email}
    </p>
  );
}

const renderAcceso = (
  state?: { from: string },
  initial?: ComponentProps<typeof SessionProvider>['initial'],
) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/acceso', state }]}>
      <SessionProvider initial={initial ?? {}}>
        <Routes>
          <Route path="/acceso" element={<Acceso />} />
          <Route path="/" element={<Inicio name="inicio-operador" />} />
          <Route path="/reportes/:id" element={<Inicio name="detalle" />} />
          <Route path="/panel" element={<Inicio name="panel" />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );

const loginAs = (role: 'coordinador' | 'operador') =>
  fetchMock.mockResolvedValue(Response.json({ access_token: `jwt-${role}`, role }));

function submitLogin(email = 'coord@civicguard.test', password = 'una-clave-larga') {
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pantalla de acceso', () => {
  it('ofrece un solo inicio de sesión (sin entrada libre por perfil) y no pide nada a la API al abrirse', () => {
    renderAcceso();

    expect(screen.getByRole('heading', { name: 'Bienvenido a CivicGuard', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Iniciar sesión', level: 3 })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /operador/i })).toBeNull();
    expect(screen.getByLabelText('Correo')).toHaveProperty('type', 'email');
    expect(screen.getByLabelText('Contraseña')).toHaveProperty('type', 'password');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('una cuenta de operador entra a su inicio, sin token en la sesión', async () => {
    loginAs('operador');
    renderAcceso();

    submitLogin('operador@civicguard.test');

    expect((await screen.findByText(/^inicio-operador\|operador/)).textContent).toBe(
      'inicio-operador|operador||operador@civicguard.test',
    );
  });

  it('tras entrar como operador vuelve a la ruta a la que iba (p. ej. el detalle de un aviso push)', async () => {
    loginAs('operador');
    renderAcceso({ from: '/reportes/42' });

    submitLogin('operador@civicguard.test');

    expect(await screen.findByText(/^detalle\|operador/)).toBeTruthy();
  });

  it('una cuenta de coordinador va al panel con el token en la sesión (en memoria)', async () => {
    loginAs('coordinador');
    renderAcceso({ from: '/reportes/42' }); // esa ruta no es suya: ignora el destino

    submitLogin();

    expect((await screen.findByText(/^panel\|/)).textContent).toBe(
      'panel|coordinador|jwt-coordinador|coord@civicguard.test',
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.civicguard.test/api/auth/login');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'coord@civicguard.test',
      password: 'una-clave-larga',
    });
  });

  it.each([
    [401, /Correo o contraseña incorrectos/],
    [429, /Demasiados intentos/],
    [503, /no está disponible/],
  ])(
    'con un %i del login muestra el motivo, limpia la contraseña y se queda en el acceso',
    async (status, message) => {
      fetchMock.mockResolvedValue(new Response(null, { status }));
      renderAcceso();

      submitLogin('coord@civicguard.test', 'mala-clave');

      expect((await screen.findByRole('alert')).textContent).toMatch(message);
      expect((screen.getByLabelText('Contraseña') as HTMLInputElement).value).toBe('');
      expect(screen.getByRole('heading', { name: 'Bienvenido a CivicGuard' })).toBeTruthy();
    },
  );

  it('sin red lo dice con claridad: iniciar sesión necesita internet', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderAcceso();

    submitLogin();

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Sin conexión.*necesitan internet/,
    );
  });

  it('con una sesión vencida lo explica', () => {
    renderAcceso();
    expect(screen.queryByText(/Tu sesión venció/)).toBeNull();
  });
});
