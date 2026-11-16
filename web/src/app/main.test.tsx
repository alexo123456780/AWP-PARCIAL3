import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El <body> real de index.html (sin su <script>, que aquí importamos a mano): el cascarón estático de RF-1.
const body = new DOMParser()
  .parseFromString(
    readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8'),
    'text/html',
  )
  .body.innerHTML.replace(/<script[^>]*><\/script>/g, '');

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('montaje de React sobre el cascarón (RF-1, SCRUM-164)', () => {
  it('reemplaza el contenido de #root: el cascarón solo trae la marca y skeletons, y React mantiene el mismo #root', async () => {
    document.body.innerHTML = body;
    const root = document.getElementById('root');
    // Antes de montar solo hay cabecera de marca y skeletons: ninguna pantalla viene en el HTML.
    expect(root?.querySelector('.skeleton')).not.toBeNull();
    expect(root?.querySelector('header')?.textContent).toContain('CivicGuard');
    expect(screen.queryByRole('heading', { name: 'Bienvenido a CivicGuard' })).toBeNull();

    await import('./main');

    // Sin perfil guardado, la app abre en la pantalla de acceso (nunca directo en un formulario ni en el panel).
    expect(await screen.findByRole('heading', { name: 'Bienvenido a CivicGuard' })).toBeTruthy();
    expect(document.getElementById('root')).toBe(root);
    expect(root?.querySelector('header')?.textContent).toContain('CivicGuard');
    expect(window.location.pathname).toBe('/acceso');
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull();
  });

  it('reemplaza los skeletons por el contenido: no queda ningún indicador de carga', async () => {
    document.body.innerHTML = body;

    await import('./main');

    await screen.findByRole('heading', { name: 'Bienvenido a CivicGuard' });
    await waitFor(() => expect(document.querySelector('.skeleton')).toBeNull());
  });
});
