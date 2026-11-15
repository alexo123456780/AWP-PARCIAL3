import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// El <body> real de index.html (sin su <script>, que aquí importamos a mano): el cascarón estático de RF-1.
const body = new DOMParser()
  .parseFromString(
    readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8'),
    'text/html',
  )
  .body.innerHTML.replace(/<script[^>]*><\/script>/g, '');

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('montaje de React sobre el cascarón (RF-1, SCRUM-164)', () => {
  it('reemplaza solo el contenido de #root: encabezado y navegación siguen siendo los de index.html', async () => {
    document.body.innerHTML = body;
    const header = document.querySelector('header.shell-header');
    const nav = document.querySelector('nav.shell-nav');
    const root = document.getElementById('root');
    // Antes de montar solo hay skeletons: el contenido de la ruta no viene en el HTML.
    expect(root?.querySelector('.skeleton')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Nuevo reporte' })).toBeNull();

    await import('./main');

    expect(await screen.findByRole('heading', { name: 'Nuevo reporte' })).toBeTruthy();
    expect(document.getElementById('root')).toBe(root);
    expect(document.querySelector('header.shell-header')).toBe(header);
    expect(document.querySelector('nav.shell-nav')).toBe(nav);
    expect(header?.textContent).toContain('CivicGuard');
    expect(nav?.querySelectorAll('a')).toHaveLength(3);
  });

  it('reemplaza los skeletons por el contenido: no queda ningún indicador de carga', async () => {
    document.body.innerHTML = body;

    await import('./main');

    await screen.findByRole('heading', { name: 'Nuevo reporte' });
    await waitFor(() => expect(document.querySelector('.skeleton')).toBeNull());
  });
});
