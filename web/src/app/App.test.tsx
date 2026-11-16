import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { SessionProvider } from './session';

// El login de las pruebas necesita una API a la que llamar; el resto del módulo de sincronización queda intacto.
vi.mock('../modules/sync', async (original) => ({
  ...(await original<typeof import('../modules/sync')>()),
  API_URL: 'https://api.civicguard.test',
}));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Initial = ComponentProps<typeof SessionProvider>['initial'];

const renderAt = (path: string, initial?: Initial) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider initial={initial}>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );

const operator: Initial = { profile: 'operador' };
const coordinator: Initial = { profile: 'coordinador', token: 'jwt-de-prueba' };
const heading = (name: string) => screen.findByRole('heading', { name, level: 2 });
const navLinks = () =>
  [...screen.getByRole('navigation', { name: 'Principal' }).querySelectorAll('a')].map(
    (link) => link.textContent,
  );

describe('rutas con carga diferida', () => {
  it.each([
    ['/', 'Nuevo reporte', operator],
    ['/reportes', 'Mis reportes', operator],
    ['/reportes/42', 'Detalle del reporte', operator],
    ['/panel', 'Panel del coordinador', coordinator],
    ['/acceso', 'Bienvenido a CivicGuard', undefined],
  ])('%s descarga su página bajo demanda y la muestra', async (path, title, initial) => {
    renderAt(path, initial);

    // Con React.lazy el skeleton aparece primero; una importación estática nunca lo mostraría.
    expect(screen.getByRole('status').textContent).toContain('Cargando');
    expect(await heading(title)).toBeTruthy();
  });
});

describe('acceso por perfiles: cada perfil solo ve sus rutas', () => {
  it.each(['/', '/reportes', '/reportes/42', '/panel', '/ruta-que-no-existe'])(
    'sin perfil, %s lleva a la pantalla de acceso y no muestra nada más',
    async (path) => {
      renderAt(path);

      expect(await heading('Bienvenido a CivicGuard')).toBeTruthy();
      expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Salir' })).toBeNull();
    },
  );

  it('el operador tiene Nuevo reporte y Mis reportes, y nunca ve el Panel ni un enlace hacia él', async () => {
    renderAt('/', operator);

    await heading('Nuevo reporte');
    expect(navLinks()).toEqual(['Nuevo reporte', 'Mis reportes']);
    expect(screen.queryByRole('link', { name: /panel/i })).toBeNull();
    expect(screen.getByText('Operador de campo')).toBeTruthy();
  });

  it('si el operador escribe /panel lo devuelve a su inicio', async () => {
    renderAt('/panel', operator);

    expect(await heading('Nuevo reporte')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Panel del coordinador' })).toBeNull();
  });

  it('el coordinador solo tiene el panel: sin navegación de operador, y si escribe / va al panel', async () => {
    renderAt('/reportes', coordinator);

    expect(await heading('Panel del coordinador')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull();
    expect(screen.getByText('Coordinador')).toBeTruthy();
  });

  it('un coordinador sin token (sesión perdida) no pasa: vuelve al acceso', async () => {
    renderAt('/panel', { profile: 'coordinador' });

    expect(await heading('Bienvenido a CivicGuard')).toBeTruthy();
  });

  it('recuerda a dónde iba: el aviso push a /reportes/:id aterriza en ese detalle tras entrar como operador', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).endsWith('/api/auth/login')
          ? Response.json({ access_token: 'jwt-operador', role: 'operador' })
          : new Response(null, { status: 404 }),
      ),
    );
    renderAt('/reportes/42');
    await heading('Bienvenido a CivicGuard');

    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'op@civicguard.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'una-clave-larga' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await heading('Detalle del reporte')).toBeTruthy();
  });

  it('«Salir» olvida el perfil del operador y vuelve al acceso', async () => {
    renderAt('/', operator);
    await heading('Nuevo reporte');

    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));

    expect(await heading('Bienvenido a CivicGuard')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salir' })).toBeNull();
  });

  it('«Salir» cierra la sesión del coordinador y deja de mostrar el panel', async () => {
    renderAt('/panel', coordinator);
    await heading('Panel del coordinador');

    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Bienvenido a CivicGuard' })).toBeTruthy(),
    );
    expect(screen.queryByRole('heading', { name: 'Panel del coordinador' })).toBeNull();
  });
});
